
import { NextResponse } from "next/server";
import { connectDB } from "@/lib/mongodb";
import Booking from "@/models/booking";
import BookingLock from "@/models/bookingLock";
import Facility from "@/models/facility";
import Membership from "@/models/membership";
import { sendBookingEmail } from "@/lib/sendBookingEmail";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LIVE_URL =
  "https://securepay.sslcommerz.com/validator/api/validationserverAPI.php";
const SANDBOX_URL =
  "https://sandbox.sslcommerz.com/validator/api/validationserverAPI.php";
const SUCCESS_STATUSES = new Set(["VALID", "VALIDATED"]);

const normalizeString = (value) =>
  typeof value === "string" ? value.trim() : "";

const parseAmount = (value) => {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : null;
};

const amountsMatch = (a, b) => {
  a = Number(a);
  b = Number(b);
  return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) < 0.01;
};

const isSandbox = () =>
  String(process.env.SSLCOMMERZ_IS_LIVE).trim().toLowerCase() !== "true";

const getCredentials = () => {
  const storeId = normalizeString(process.env.SSLCOMMERZ_STORE_ID);
  const storePassword = normalizeString(process.env.SSLCOMMERZ_STORE_PASSWORD);
  return storeId && storePassword ? { storeId, storePassword } : null;
};

const respond = (message, status = 200) =>
  NextResponse.json({ success: status >= 200 && status < 300, message }, { status });

async function readRequestData(request) {
  const contentType = request.headers.get("content-type") || "";

  if (contentType.toLowerCase().includes("application/json")) {
    try {
      return await request.json();
    } catch {
      return {};
    }
  }

  try {
    const formData = await request.formData();
    return Object.fromEntries(
      [...formData.entries()].map(([key, value]) => [
        key,
        typeof value === "string" ? value : String(value),
      ])
    );
  } catch {
    return {};
  }
}

async function cleanupExpiredBookings() {
  const now = new Date();
  const filter = {
    status: "pending",
    paymentStatus: "pending",
    expiresAt: { $ne: null, $lte: now },
  };

  const groupReferences = (
    await Booking.distinct("bookingGroupReference", filter)
  ).filter(Boolean);

  if (!groupReferences.length) return;

  await Booking.updateMany(filter, {
    $set: {
      status: "cancelled",
      paymentStatus: "failed",
      cancelledAt: now,
      expiresAt: null,
      cancellationReason: "Payment session expired.",
    },
  });

  await BookingLock.deleteMany({
    bookingGroupReference: { $in: groupReferences },
  });

  await BookingLock.deleteMany({
    expiresAt: { $ne: null, $lte: now },
  });
}

function getMembershipDefinition(service) {
  switch (normalizeString(service?.slug).toLowerCase()) {
    case "gym-monthly":
      return { membershipType: "gym", facilities: ["gym"] };
    case "pool-monthly":
      return { membershipType: "pool", facilities: ["pool"] };
    case "gym-pool-monthly":
      return { membershipType: "gym_pool", facilities: ["gym", "pool"] };
    default:
      return null;
  }
}

function addOneMonth(date) {
  const source = new Date(date);
  if (Number.isNaN(source.getTime())) return null;

  const year = source.getUTCFullYear();
  const month = source.getUTCMonth() + 1;
  const day = source.getUTCDate();
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

  return new Date(Date.UTC(year, month, Math.min(day, lastDay)));
}

function getMonthPrefix(date) {
  return (
    ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"][
      new Date(date).getUTCMonth()
    ] || "JAN"
  );
}

async function generateMembershipCode(startDate) {
  const prefix = getMonthPrefix(startDate);
  const [result] = await Membership.aggregate([
    { $match: { membershipCode: { $regex: `^${prefix}-[0-9]+$` } } },
    {
      $project: {
        number: {
          $convert: {
            input: {
              $arrayElemAt: [{ $split: ["$membershipCode", "-"] }, 1],
            },
            to: "long",
            onError: 0,
            onNull: 0,
          },
        },
      },
    },
    { $group: { _id: null, highest: { $max: "$number" } } },
  ]);

  return `${prefix}-${Math.max(1000, result?.highest || 1000) + 1}`;
}

async function createMembershipsForPaidBookings(bookings, transactionId) {
  let created = 0;
  let existing = 0;

  for (const booking of bookings) {
    if (booking.status !== "confirmed" || booking.paymentStatus !== "paid") {
      continue;
    }

    if (!booking.facilityId || !booking.serviceId) {
      throw new Error(`Membership booking ${booking._id} has no facilityId or serviceId.`);
    }

    const facility = await Facility.findById(booking.facilityId)
      .select("name slug services")
      .lean();

    if (!facility) {
      throw new Error(`Facility ${booking.facilityId} was not found.`);
    }

    const service = (facility.services || []).find(
      (item) => String(item._id) === String(booking.serviceId)
    );

    if (!service) {
      throw new Error(
        `Service ${booking.serviceId} was not found inside facility ${booking.facilityId}.`
      );
    }

    const definition = getMembershipDefinition(service);
    if (!definition) continue;

    if (Number(booking.quantity) !== 1) {
      throw new Error(`Invalid membership quantity for booking ${booking._id}.`);
    }

    const startDate = new Date(booking.bookingDate);
    if (Number.isNaN(startDate.getTime())) {
      throw new Error(`Invalid membership start date for booking ${booking._id}.`);
    }

    const expiryDate = addOneMonth(startDate);
    if (!expiryDate) {
      throw new Error(`Unable to calculate membership expiry for booking ${booking._id}.`);
    }

    const price = Number(booking.priceAtBooking);
    if (!Number.isFinite(price) || price < 0) {
      throw new Error(`Invalid membership price for booking ${booking._id}.`);
    }

    const notes = `Activated via SSLCommerz transaction ${transactionId}`;
    const membershipFilter = {
      customerEmail: booking.customerEmail,
      membershipType: definition.membershipType,
      startDate,
      expiryDate,
      notes,
    };

    if (await Membership.exists(membershipFilter)) {
      existing++;
      continue;
    }

    let membershipCreated = false;

    for (let attempt = 0; attempt < 5; attempt++) {
      const membershipCode = await generateMembershipCode(startDate);

      try {
        await Membership.create({
          membershipCode,
          customerName: booking.customerName,
          customerEmail: booking.customerEmail,
          customerPhone: booking.customerPhone,
          membershipType: definition.membershipType,
          facilities: definition.facilities,
          price,
          startDate,
          expiryDate,
          active: true,
          dailyEntries: [],
          renewalHistory: [],
          lastRenewedAt: null,
          renewalCount: 0,
          notes,
        });

        created++;
        membershipCreated = true;
        break;
      } catch (error) {
        if (error?.code === 11000 && error?.keyPattern?.membershipCode) {
          continue;
        }
        throw error;
      }
    }

    if (!membershipCreated) {
      throw new Error(
        `Unable to generate a unique membership code for booking ${booking._id}.`
      );
    }
  }

  return { created, existing };
}

export async function POST(request) {
  try {
    await connectDB();
    await cleanupExpiredBookings();

    const credentials = getCredentials();
    if (!credentials) {
      console.error("SSLCommerz credentials are not configured.");
      return respond("Payment gateway is not configured.", 500);
    }

    const data = await readRequestData(request);
    const tranId = normalizeString(data.tran_id);
    const valId = normalizeString(data.val_id);
    const ipnStatus = normalizeString(data.status).toUpperCase();
    const ipnAmount = parseAmount(data.amount);
    const ipnCurrency = normalizeString(data.currency).toUpperCase();
    const ipnGroupReference = normalizeString(data.value_a).toUpperCase();

    if (!tranId) return respond("Missing transaction ID.", 400);

    const bookings = await Booking.find({ paymentTransactionId: tranId }).lean();

    if (!bookings.length) return respond("Transaction not found.", 404);

    const bookingGroupReference = bookings[0].bookingGroupReference;

    if (bookings.some((booking) => booking.bookingGroupReference !== bookingGroupReference)) {
      console.error("Inconsistent booking group:", tranId);
      return respond("Invalid booking group.", 500);
    }

    if (ipnGroupReference && ipnGroupReference !== bookingGroupReference) {
      return respond("Booking group mismatch.", 400);
    }

    const allAlreadyPaid = bookings.every(
      (booking) => booking.paymentStatus === "paid" && booking.status === "confirmed"
    );

    if (allAlreadyPaid) {
      await BookingLock.updateMany(
        { bookingGroupReference },
        { $set: { expiresAt: null } }
      );

      try {
        await createMembershipsForPaidBookings(bookings, tranId);
      } catch (error) {
        console.error("Membership provisioning failed for already-paid transaction:", error);
        return respond("Payment is confirmed but membership provisioning requires retry.", 503);
      }

      return respond("Payment already processed.");
    }

    if (!SUCCESS_STATUSES.has(ipnStatus)) {
      if (["FAILED", "CANCELLED", "CANCELED"].includes(ipnStatus)) {
        await Booking.updateMany(
          {
            paymentTransactionId: tranId,
            status: "pending",
            paymentStatus: "pending",
          },
          {
            $set: {
              status: "cancelled",
              paymentStatus: "failed",
              cancelledAt: new Date(),
              expiresAt: null,
              cancellationReason: `SSLCommerz payment status: ${ipnStatus}`,
            },
          }
        );

        await BookingLock.deleteMany({ bookingGroupReference });
      }

      return respond(`Payment status received: ${ipnStatus || "UNKNOWN"}.`);
    }

    if (!valId) return respond("Validation ID is missing.", 400);

    const validationURL = isSandbox() ? SANDBOX_URL : LIVE_URL;
    const params = new URLSearchParams({
      val_id: valId,
      store_id: credentials.storeId,
      store_passwd: credentials.storePassword,
      v: "1",
      format: "json",
    });

    let validationResponse;

    try {
      validationResponse = await fetch(`${validationURL}?${params}`, {
        method: "GET",
        cache: "no-store",
        signal: AbortSignal.timeout(30000),
      });
    } catch (error) {
      console.error("SSLCommerz validation request failed:", error);
      return respond("Payment validation service temporarily unavailable.", 503);
    }

    if (!validationResponse.ok) {
      return respond("Payment validation failed temporarily.", 503);
    }

    let validation;

    try {
      validation = await validationResponse.json();
    } catch {
      return respond("Invalid payment validation response.", 502);
    }

    const validationStatus = normalizeString(validation?.status).toUpperCase();

    if (!SUCCESS_STATUSES.has(validationStatus)) {
      return respond("Payment could not be validated.", 400);
    }

    const validatedTranId = normalizeString(validation?.tran_id);

    if (!validatedTranId || validatedTranId !== tranId) {
      return respond("Transaction validation mismatch.", 400);
    }

    const validatedCurrency = normalizeString(validation?.currency).toUpperCase();

    if (validatedCurrency !== "BDT") {
      return respond("Invalid payment currency.", 400);
    }

    if (ipnCurrency && ipnCurrency !== "BDT") {
      return respond("Invalid IPN currency.", 400);
    }

    const expectedAmount = bookings.reduce((total, booking) => {
      const amount = Number(booking.totalAmount);
      return Number.isFinite(amount) ? total + amount : NaN;
    }, 0);

    if (!Number.isFinite(expectedAmount) || expectedAmount <= 0) {
      console.error("Invalid database payment amount:", { tranId, expectedAmount });
      return respond("Invalid booking payment amount.", 500);
    }

    const validatedAmount = parseAmount(validation?.amount);

    if (validatedAmount === null || !amountsMatch(expectedAmount, validatedAmount)) {
      return respond("Payment amount does not match the booking.", 400);
    }

    if (ipnAmount !== null && !amountsMatch(expectedAmount, ipnAmount)) {
      return respond("IPN payment amount mismatch.", 400);
    }

    const currentTime = Date.now();
    const hasExpiredBooking = bookings.some(
      (booking) =>
        booking.status === "pending" &&
        booking.paymentStatus === "pending" &&
        booking.expiresAt &&
        new Date(booking.expiresAt).getTime() <= currentTime
    );

    if (hasExpiredBooking) {
      await Booking.updateMany(
        {
          paymentTransactionId: tranId,
          status: "pending",
          paymentStatus: "pending",
        },
        {
          $set: {
            status: "cancelled",
            paymentStatus: "failed",
            cancelledAt: new Date(),
            expiresAt: null,
            cancellationReason: "Payment was validated after the booking session expired.",
          },
        }
      );

      await BookingLock.deleteMany({ bookingGroupReference });

      return respond(
        "Payment was validated after the booking session expired. The booking was not confirmed.",
        409
      );
    }

    const riskLevel = String(validation?.risk_level ?? data?.risk_level ?? "").trim();

    if (riskLevel === "1") {
      await Booking.updateMany(
        { paymentTransactionId: tranId, paymentStatus: "pending" },
        {
          $set: {
            paymentValidationId: valId,
            paymentBankTransactionId: normalizeString(validation?.bank_tran_id),
            paymentCardType: normalizeString(validation?.card_type),
            paymentMethod: normalizeString(validation?.card_type),
          },
        }
      );

      return respond("Payment validated but requires additional verification.");
    }

    const paymentUpdate = {
      paymentStatus: "paid",
      status: "confirmed",
      paymentValidationId: valId,
      paymentBankTransactionId: normalizeString(validation?.bank_tran_id),
      paymentCardType: normalizeString(validation?.card_type),
      paymentMethod: normalizeString(validation?.card_type),
      paymentPaidAt: new Date(),
      expiresAt: null,
      cancelledAt: null,
      cancellationReason: "",
    };

    const updateResult = await Booking.updateMany(
      {
        paymentTransactionId: tranId,
        status: "pending",
        paymentStatus: "pending",
        expiresAt: { $gt: new Date() },
      },
      { $set: paymentUpdate }
    );

    if (updateResult.modifiedCount !== bookings.length) {
      await cleanupExpiredBookings();

      const finalBookings = await Booking.find({ paymentTransactionId: tranId })
        .select("status paymentStatus")
        .lean();

      const allConfirmed =
        finalBookings.length === bookings.length &&
        finalBookings.every(
          (booking) => booking.status === "confirmed" && booking.paymentStatus === "paid"
        );

      if (!allConfirmed) {
        await BookingLock.deleteMany({ bookingGroupReference });
        return respond("Payment validated but booking confirmation requires retry.", 503);
      }
    }

    await BookingLock.updateMany(
      { bookingGroupReference },
      { $set: { expiresAt: null } }
    );

    const confirmedBookings = await Booking.find({
      paymentTransactionId: tranId,
      status: "confirmed",
      paymentStatus: "paid",
    }).lean();

// Send confirmation email
try {
  await sendBookingEmail({
    to: confirmedBookings[0].customerEmail,
    customerName: confirmedBookings[0].customerName,
    bookingGroupReference,
    bookings: confirmedBookings,
    totalAmount: expectedAmount,
  });
} catch (error) {
  console.error("Booking email failed:", error);
}

    let membershipResult;

    try {
      membershipResult = await createMembershipsForPaidBookings(confirmedBookings, tranId);
    } catch (error) {
      console.error("Membership provisioning failed:", error);
      return respond("Payment confirmed but membership provisioning requires retry.", 503);
    }

    console.log("SSLCommerz payment confirmed:", {
      tranId,
      bookingCount: confirmedBookings.length,
      amount: expectedAmount,
      membershipsCreated: membershipResult.created,
      membershipsAlreadyExisting: membershipResult.existing,
    });

    return respond("Payment validated, bookings confirmed, and memberships provisioned.");
  } catch (error) {
    console.error("SSLCommerz IPN processing failed:", error);
    return respond("IPN processing temporarily failed.", 500);
  }
}
