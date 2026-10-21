
import { NextResponse } from "next/server";

import { connectDB } from "@/lib/mongodb";
import Booking from "@/models/booking";
import Facility from "@/models/facility";
import { requireAdmin } from "@/lib/requireAdmin";
import mongoose from "mongoose";
import Payment from "@/models/payment";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PAYMENT_STATUSES = [
  "unpaid",
  "pending",
  "paid",
  "failed",
  "refunded",
];

function jsonError(message, status = 400) {
  return NextResponse.json({ success: false, message }, { status });
}

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function formatDate(date) {
  if (!date) return null;

  const parsed = new Date(date);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function getDisplayStatus(status) {
  switch (status) {
    case "paid":
      return "Paid";
    case "failed":
      return "Failed";
    case "refunded":
      return "Refunded";
    case "pending":
    case "unpaid":
    default:
      return "Pending";
  }
}

function getPaymentMethod(booking) {
  return (
    booking.paymentMethod ||
    booking.paymentCardType ||
    (booking.paymentTransactionId ? "SSLCommerz" : "—")
  );
}

export async function GET(request) {
  try {
    const auth = await requireAdmin();

    if (!auth.authenticated) {
      return jsonError("Admin authentication required.", 401);
    }

    await connectDB();

    const params = new URL(request.url).searchParams;
    const search = normalizeString(params.get("search")).toLowerCase();
    const paymentStatus = normalizeString(params.get("status")).toLowerCase();
    const type = normalizeString(params.get("type")).toLowerCase();
    const method = normalizeString(params.get("method")).toLowerCase();

    const query = {};

    if (PAYMENT_STATUSES.includes(paymentStatus)) {
      query.paymentStatus = paymentStatus;
    }

    const bookings = await Booking.find(query)
      .select(
        [
          "bookingReference",
          "bookingGroupReference",
          "customerName",
          "customerEmail",
          "customerPhone",
          "serviceName",
          "facilityName",
          "facilityId",
          "serviceId",
          "bookingDate",
          "startTime",
          "endTime",
          "totalAmount",
          "paymentMethod",
          "paymentTransactionId",
          "paymentStatus",
          "status",
          "paymentValidationId",
          "paymentBankTransactionId",
          "paymentCardType",
          "paymentPaidAt",
          "paymentInitiatedAt",
          "createdAt",
        ].join(" ")
      )
      .sort({ createdAt: -1 })
      .lean();

    const facilityIds = [
      ...new Set(
        bookings
          .map((booking) => booking.facilityId?.toString())
          .filter(Boolean)
      ),
    ];

    const facilities = facilityIds.length
      ? await Facility.find({ _id: { $in: facilityIds } })
          .select("_id services._id services.type")
          .lean()
      : [];

    const serviceTypes = new Map();

    for (const facility of facilities) {
      for (const service of facility.services || []) {
        serviceTypes.set(
          `${facility._id}:${service._id}`,
          service.type
        );
      }
    }

    const transactions = [];

    const summary = {
      total: 0,
      paid: 0,
      paidAmount: 0,
      pending: 0,
      pendingAmount: 0,
      failed: 0,
      refunded: 0,
    };

    for (const booking of bookings) {
      const bookingReference = booking.bookingReference || "";
      const groupReference = booking.bookingGroupReference || "";
      const customer = booking.customerName || "";
      const email = booking.customerEmail || "";
      const phone = booking.customerPhone || "";
      const serviceName = booking.serviceName || "";
      const transactionId = booking.paymentTransactionId || "";
      const status = booking.paymentStatus || "";
      const amount = Number(booking.totalAmount || 0);

      const serviceType = serviceTypes.get(
        `${booking.facilityId}:${booking.serviceId}`
      );

      const transactionType =
        serviceType === "membership" ? "Membership" : "Booking";

      const transactionMethod = getPaymentMethod(booking);

      const transaction = {
        id: bookingReference,
        bookingId: bookingReference,
        bookingGroupReference: groupReference,
        customer,
        email,
        phone,
        service: serviceName,
        facility: booking.facilityName || "",
        date: formatDate(booking.bookingDate),
        time:
          booking.startTime && booking.endTime
            ? `${booking.startTime} - ${booking.endTime}`
            : booking.startTime || "—",
        amount,
        method: transactionMethod,
        gateway: transactionId ? "SSLCommerz" : "—",
        status: getDisplayStatus(status),
        type: transactionType,
        transactionId: transactionId || "—",
        paymentDate: formatDate(
          booking.paymentPaidAt ||
            booking.paymentInitiatedAt ||
            booking.createdAt
        ),
        paymentStatus: status,
        bookingStatus: booking.status,
        paymentValidationId: booking.paymentValidationId || "",
        paymentBankTransactionId:
          booking.paymentBankTransactionId || "",
        paymentCardType: booking.paymentCardType || "",
        paymentPaidAt: formatDate(booking.paymentPaidAt),
        createdAt: formatDate(booking.createdAt),
      };

      const matchesSearch =
        !search ||
        bookingReference.toLowerCase().includes(search) ||
        groupReference.toLowerCase().includes(search) ||
        customer.toLowerCase().includes(search) ||
        email.toLowerCase().includes(search) ||
        phone.toLowerCase().includes(search) ||
        serviceName.toLowerCase().includes(search) ||
        transactionId.toLowerCase().includes(search);

      if (!matchesSearch) continue;
      if (type && transactionType.toLowerCase() !== type) continue;
      if (method && transactionMethod.toLowerCase() !== method) continue;

      transactions.push(transaction);

      summary.total++;

      if (status === "paid") {
        summary.paid++;
        summary.paidAmount += amount;
      } else if (status === "pending" || status === "unpaid") {
        summary.pending++;
        summary.pendingAmount += amount;
      } else if (status === "failed") {
        summary.failed++;
      } else if (status === "refunded") {
        summary.refunded++;
      }
    }

    return NextResponse.json({
      success: true,
      transactions,
      summary,
      total: transactions.length,
    });
  } catch (error) {
    console.error("GET /api/payment failed:", error);

    return jsonError("Unable to load payment transactions.", 500);
  }
}

export async function DELETE(request) {
  try {
    // 1. Authenticate admin
    const auth = await requireAdmin();

    if (!auth.authenticated) {
      return jsonError("Admin authentication required.", 401);
    }

    // 2. Validate payment document ID
    const params = new URL(request.url).searchParams;
    const paymentId = normalizeString(params.get("id"));

    if (!mongoose.isValidObjectId(paymentId)) {
      return jsonError("Invalid payment ID.");
    }

    // 3. Connect to MongoDB
    await connectDB();

    // 4. Permanently delete only the selected Payment document
    const result = await Payment.deleteOne({
      _id: new mongoose.Types.ObjectId(paymentId),
    });

    if (result.deletedCount === 0) {
      return jsonError("Payment not found.", 404);
    }

    return NextResponse.json({
      success: true,
      message: "Payment permanently deleted.",
    });
  } catch (error) {
    console.error("DELETE /api/payment failed:", error);

    return jsonError("Unable to delete payment.", 500);
  }
}
