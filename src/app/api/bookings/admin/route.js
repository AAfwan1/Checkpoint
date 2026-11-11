import { NextResponse } from "next/server";
import mongoose from "mongoose";

import { connectDB } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/requireAdmin";

import Booking from "@/models/booking";
import Payment from "@/models/payment";
import BookingLock from "@/models/bookingLock";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_LIMIT = 100;

function jsonError(message, status = 400) {
  return NextResponse.json(
    {
      success: false,
      error: message,
    },
    { status }
  );
}

function parsePositiveInteger(value, fallback) {
  const number = Number.parseInt(value, 10);

  if (!Number.isFinite(number) || number < 1) {
    return fallback;
  }

  return number;
}

function normalizeDate(value) {
  if (!value || typeof value !== "string") return null;

  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);

  if (!match) return null;

  const [, year, month, day] = match;

  const date = new Date(
    Date.UTC(
      Number(year),
      Number(month) - 1,
      Number(day)
    )
  );

  if (
    date.getUTCFullYear() !== Number(year) ||
    date.getUTCMonth() !== Number(month) - 1 ||
    date.getUTCDate() !== Number(day)
  ) {
    return null;
  }

  return date;
}

function getEndDate(date) {
  const end = new Date(date);
  end.setUTCDate(end.getUTCDate() + 1);
  return end;
}

function serializeBooking(booking) {
  return {
    id: booking._id.toString(),
    bookingReference: booking.bookingReference,
    bookingGroupReference: booking.bookingGroupReference,

    customer: {
      name: booking.customerName,
      email: booking.customerEmail,
      phone: booking.customerPhone,
    },

    facility: {
      id: booking.facilityId?.toString() || "",
      name: booking.facilityName,
    },

    service: {
      id: booking.serviceId?.toString() || "",
      name: booking.serviceName,
    },

    bookingDate: booking.bookingDate,
    startTime: booking.startTime,
    endTime: booking.endTime,
    durationMinutes: booking.durationMinutes,
    quantity: booking.quantity,
    movieName: booking.movieName || "",
    priceAtBooking: booking.priceAtBooking,
    totalAmount: booking.totalAmount,
    status: booking.status,
    paymentStatus: booking.paymentStatus,

    paymentTransactionId: booking.paymentTransactionId || "",
    paymentValidationId: booking.paymentValidationId || "",
    paymentBankTransactionId: booking.paymentBankTransactionId || "",
    paymentCardType: booking.paymentCardType || "",
    paymentMethod: booking.paymentMethod || "",

    paymentInitiatedAt: booking.paymentInitiatedAt || null,
    paymentPaidAt: booking.paymentPaidAt || null,
    expiresAt: booking.expiresAt || null,

    checkedIn: booking.checkedIn,
    checkedInAt: booking.checkedInAt || null,
    checkedOut: booking.checkedOut,
    checkedOutAt: booking.checkedOutAt || null,

    cancelledAt: booking.cancelledAt || null,
    cancellationReason: booking.cancellationReason || "",

    createdAt: booking.createdAt,
    updatedAt: booking.updatedAt,
  };
}

export async function GET(request) {
  try {
    // ADMIN AUTHENTICATION
    const auth = await requireAdmin();

    if (!auth.authenticated) {
      return jsonError("Unauthorized", 401);
    }

    // DATABASE
    await connectDB();

    // QUERY PARAMETERS
    const { searchParams } = new URL(request.url);

    const page = Math.max(
      1,
      parsePositiveInteger(searchParams.get("page"), 1)
    );

    const limit = Math.min(
      MAX_LIMIT,
      parsePositiveInteger(searchParams.get("limit"), 50)
    );

    const dateParam = searchParams.get("date")?.trim() || "";
    const monthParam = searchParams.get("month")?.trim() || "";

    const facilityId = searchParams.get("facilityId")?.trim() || "";
    const status = searchParams.get("status")?.trim() || "";

    const paymentStatus =
      searchParams.get("paymentStatus")?.trim() || "";

    const search = searchParams.get("search")?.trim() || "";

    // BUILD QUERY
    const query = {};

    // DATE / MONTH FILTER
    if (dateParam && monthParam) {
      return jsonError("Select either a date or a month.");
    }

    // EXACT DATE FILTER
    if (dateParam) {
      const startDate = normalizeDate(dateParam);

      if (!startDate) {
        return jsonError("Invalid date. Use YYYY-MM-DD.");
      }

      query.bookingDate = {
        $gte: startDate,
        $lt: getEndDate(startDate),
      };
    }

    // MONTH FILTER
    if (monthParam) {
      const match = monthParam.match(/^(\d{4})-(\d{2})$/);

      if (!match) {
        return jsonError("Invalid month. Use YYYY-MM.");
      }

      const year = Number(match[1]);
      const month = Number(match[2]);

      if (month < 1 || month > 12) {
        return jsonError("Invalid month.");
      }

      const startDate = new Date(
        Date.UTC(year, month - 1, 1)
      );

      const endDate = new Date(
        Date.UTC(year, month, 1)
      );

      query.bookingDate = {
        $gte: startDate,
        $lt: endDate,
      };
    }

    // FACILITY FILTER
    if (facilityId) {
      if (!mongoose.isValidObjectId(facilityId)) {
        return jsonError("Invalid facility ID.");
      }

      query.facilityId = new mongoose.Types.ObjectId(facilityId);
    }

    // BOOKING STATUS FILTER
    const allowedStatuses = new Set([
      "pending",
      "confirmed",
      "completed",
      "cancelled",
    ]);

    if (status) {
      if (!allowedStatuses.has(status)) {
        return jsonError("Invalid booking status.");
      }

      query.status = status;
    }

    // PAYMENT STATUS FILTER
    const allowedPaymentStatuses = new Set([
      "unpaid",
      "pending",
      "paid",
      "failed",
      "refunded",
    ]);

    if (paymentStatus) {
      if (!allowedPaymentStatuses.has(paymentStatus)) {
        return jsonError("Invalid payment status.");
      }

      query.paymentStatus = paymentStatus;
    }

    // SEARCH
    if (search) {
      const escapedSearch = search.replace(
        /[.*+?^${}()|[\]\\]/g,
        "\\$&"
      );

      const regex = new RegExp(escapedSearch, "i");

      query.$or = [
        { bookingReference: regex },
        { bookingGroupReference: regex },
        { customerName: regex },
        { customerEmail: regex },
        { customerPhone: regex },
        { facilityName: regex },
        { serviceName: regex },
      ];
    }

    // PAGINATION
    const skip = (page - 1) * limit;

    // FETCH BOOKINGS + TOTAL COUNT
    const [bookings, total] = await Promise.all([
      Booking.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),

      Booking.countDocuments(query),
    ]);

    // RESPONSE
    const totalPages = Math.ceil(total / limit);

    return NextResponse.json({
      success: true,

      data: bookings.map(serializeBooking),

      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1,
      },

      filters: {
        date: dateParam || null,
        month: monthParam || null,
        facilityId: facilityId || null,
        status: status || null,
        paymentStatus: paymentStatus || null,
        search: search || null,
      },
    });
  } catch (error) {
    console.error("Admin bookings API error:", error);

    return jsonError(
      "Unable to load bookings.",
      500
    );
  }
}

export async function DELETE(request) {
  let session;

  try {
    // AUTHENTICATE ADMIN
    const auth = await requireAdmin();

    if (!auth.authenticated) {
      return jsonError("Unauthorized", 401);
    }

    // VALIDATE BOOKING ID
    const { searchParams } = new URL(request.url);
    const bookingId = searchParams.get("id")?.trim();

    if (!bookingId || !mongoose.isValidObjectId(bookingId)) {
      return jsonError("Invalid booking ID.");
    }

    // CONNECT TO DATABASE
    await connectDB();

    // START TRANSACTION
    session = await mongoose.startSession();

    let bookingNotFound = false;
    let deletedPaymentsCount = 0;

    await session.withTransaction(async () => {
      bookingNotFound = false;
      deletedPaymentsCount = 0;

      // FIND BOOKING
      const booking = await Booking.findById(bookingId)
        .session(session)
        .lean();

      if (!booking) {
        bookingNotFound = true;
        return;
      }

      // IDENTIFY RELATED PAYMENT RECORDS
      const paymentConditions = [
        { bookingIds: booking._id },
      ];

      if (booking.bookingGroupReference) {
        paymentConditions.push({
          bookingGroupReference: booking.bookingGroupReference,
        });
      }

      if (booking.paymentTransactionId) {
        paymentConditions.push(
          { transactionId: booking.paymentTransactionId },
          { gatewayTransactionId: booking.paymentTransactionId }
        );
      }

      // DELETE ASSOCIATED PAYMENTS
      const paymentResult = await Payment.deleteMany(
        { $or: paymentConditions },
        { session }
      );

      deletedPaymentsCount = paymentResult.deletedCount || 0;

      // DELETE BOOKING LOCKS
      await BookingLock.deleteMany(
        { bookingId: booking._id },
        { session }
      );

      // DELETE SELECTED BOOKING
      const bookingResult = await Booking.deleteOne(
        { _id: booking._id },
        { session }
      );

      if (bookingResult.deletedCount !== 1) {
        throw new Error("Booking deletion failed.");
      }
    });

    if (bookingNotFound) {
      return jsonError("Booking not found.", 404);
    }

    return NextResponse.json({
      success: true,
      message: "Booking permanently deleted.",

      deleted: {
        bookings: 1,
        payments: deletedPaymentsCount,
      },
    });
  } catch (error) {
    console.error("Admin booking delete API error:", error);

    return jsonError(
      "Unable to delete booking.",
      500
    );
  } finally {
    if (session) {
      await session.endSession();
    }
  }
}