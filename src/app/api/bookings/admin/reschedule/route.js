
import { NextResponse } from "next/server";
import mongoose from "mongoose";

import { connectDB } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/requireAdmin";

import Booking from "@/models/booking";
import BookingLock from "@/models/bookingLock";
import Facility from "@/models/facility";
import SlotBlock from "@/models/slotBlock";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TIME_SLICE_MINUTES = 30;
const OPEN_TIME = 11 * 60;
const CLOSE_TIME = 23 * 60;

const MOVIE_SESSIONS = [
  { startTime: "11:00", endTime: "14:00" },
  { startTime: "14:00", endTime: "17:00" },
  { startTime: "17:00", endTime: "20:00" },
  { startTime: "20:00", endTime: "23:00" },
];

const ACTIVE_BOOKING_STATUSES = ["pending", "confirmed"];

function errorResponse(error, status = 400) {
  return NextResponse.json(
    { success: false, error },
    { status }
  );
}

function toMinutes(time) {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(time || ""))) {
    return null;
  }

  const [hours, minutes] = time.split(":").map(Number);

  return hours * 60 + minutes;
}

function toTime(minutes) {
  const safe = Math.max(0, Math.min(1439, minutes));

  return `${String(Math.floor(safe / 60)).padStart(2, "0")}:${String(
    safe % 60
  ).padStart(2, "0")}`;
}

function getSliceTimes(startTime, durationMinutes) {
  const start = toMinutes(startTime);

  if (start === null || !Number.isFinite(durationMinutes)) {
    return [];
  }

  const slices = [];

  for (
    let i = 0,
      count = Math.ceil(durationMinutes / TIME_SLICE_MINUTES);
    i < count;
    i++
  ) {
    slices.push(
      toTime(start + i * TIME_SLICE_MINUTES)
    );
  }

  return slices;
}

function getDhakaDateParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Dhaka",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);

  return Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map(({ type, value }) => [type, value])
  );
}

function isValidDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const date = new Date(`${value}T00:00:00.000Z`);

  return (
    !Number.isNaN(date.getTime()) &&
    date.toISOString().slice(0, 10) === value
  );
}

function getDateRange(date) {
  const start = new Date(`${date}T00:00:00.000Z`);
  const end = new Date(start);

  end.setUTCDate(end.getUTCDate() + 1);

  return { $gte: start, $lt: end };
}

function isOverlapping(startA, endA, startB, endB) {
  return startA < endB && endA > startB;
}

function getResourceKey(facility, service) {
  const facilityId = facility._id.toString();

  if (
    facility.slug === "playground" ||
    facility.facilityType === "playground"
  ) {
    return `playground:${facilityId}`;
  }

  if (service.exclusive === true) {
    return `exclusive:${facilityId}:${service._id}`;
  }

  return `service:${facilityId}:${service._id}`;
}

function isMovieService(facility, service) {
  return (
    facility.facilityType === "movie" ||
    facility.slug === "private-movie" ||
    service.type === "private_movie" ||
    service.pricingType === "per_ticket"
  );
}

function isMembershipService(service) {
  return (
    service.type === "membership" ||
    service.pricingType === "monthly"
  );
}

function getSlotDuration(facility, service) {
  if (isMovieService(facility, service)) {
    return 180;
  }

  const duration = Number(service.durationMinutes);

  return Number.isFinite(duration) && duration > 0
    ? duration
    : null;
}

function getSchedule(facility, dayOfWeek) {
  return (facility.schedules || []).filter(
    (schedule) =>
      schedule.active === true &&
      Number(schedule.dayOfWeek) === dayOfWeek
  );
}

function getMatchingSchedule(
  schedules,
  start,
  end,
  duration
) {
  return schedules.find((schedule) => {
    const scheduleStart = toMinutes(schedule.startTime);
    const scheduleEnd = toMinutes(schedule.endTime);
    const slotDuration = Number(schedule.slotDurationMinutes);

    if (
      scheduleStart === null ||
      scheduleEnd === null ||
      !Number.isFinite(slotDuration) ||
      slotDuration < 1
    ) {
      return false;
    }

    return (
      start >= scheduleStart &&
      end <= scheduleEnd &&
      (start - scheduleStart) % slotDuration === 0 &&
      end - start === duration
    );
  });
}

function isMovieSessionValid(startTime, endTime) {
  return MOVIE_SESSIONS.some(
    (session) =>
      session.startTime === startTime &&
      session.endTime === endTime
  );
}

function getRequiredCapacityUnits(service, quantity) {
  if (
    service.exclusive === true ||
    service.pricingType === "per_booking"
  ) {
    return [0];
  }

  return Array.from(
    { length: quantity },
    (_, index) => index
  );
}

export async function POST(request) {
  let session;

  try {
    const auth = await requireAdmin();

    if (!auth?.authenticated) {
      return errorResponse("Unauthorized.", 401);
    }

    await connectDB();

    const body = await request.json();

    const bookingId = String(body.bookingId || "");
    const newDate = String(body.date || "");
    const newStartTime = String(body.startTime || "");

    if (
      !mongoose.Types.ObjectId.isValid(bookingId) ||
      !isValidDate(newDate)
    ) {
      return errorResponse("Invalid booking or date.");
    }

    if (toMinutes(newStartTime) === null) {
      return errorResponse("Invalid booking time.");
    }

    const today = getDhakaDateParts();

    const todayString = `${today.year}-${today.month}-${today.day}`;

    if (newDate < todayString) {
      return errorResponse("You cannot select a past date.");
    }

    const booking = await Booking.findById(bookingId);

    if (!booking) {
      return errorResponse("Booking not found.", 404);
    }

    if (
      booking.status !== "confirmed" ||
      booking.paymentStatus !== "paid"
    ) {
      return errorResponse(
        "Only confirmed and paid bookings can be rescheduled.",
        409
      );
    }

    if (booking.checkedIn || booking.checkedOut) {
      return errorResponse(
        "A checked-in or checked-out booking cannot be rescheduled.",
        409
      );
    }

    const facility = await Facility.findById(booking.facilityId);

    if (!facility || facility.active === false) {
      return errorResponse("Facility is unavailable.", 404);
    }

    const service = facility.services.id(booking.serviceId);

    if (!service || service.active === false) {
      return errorResponse("Service is unavailable.", 404);
    }

    if (isMembershipService(service)) {
      return errorResponse(
        "Membership bookings cannot be rescheduled through this operation.",
        400
      );
    }

    const duration = getSlotDuration(facility, service);
    const startMinutes = toMinutes(newStartTime);

    if (!duration || startMinutes === null) {
      return errorResponse("Invalid booking duration or time.");
    }

    const endMinutes = startMinutes + duration;

    if (
      startMinutes < OPEN_TIME ||
      endMinutes > CLOSE_TIME
    ) {
      return errorResponse(
        "Booking must be between 11:00 and 23:00."
      );
    }

    if (
      startMinutes % TIME_SLICE_MINUTES !== 0
    ) {
      return errorResponse(
        "The selected time must be on a 30-minute interval."
      );
    }

    if (
      newDate === todayString &&
      startMinutes <=
        Number(today.hour) * 60 + Number(today.minute)
    ) {
      return errorResponse(
        "The selected time has already passed."
      );
    }

    const endTime = toTime(endMinutes);

    const dateObject = new Date(
      `${newDate}T00:00:00.000Z`
    );

    const dayOfWeek = dateObject.getUTCDay();

    if (isMovieService(facility, service)) {
      if (!isMovieSessionValid(newStartTime, endTime)) {
        return errorResponse(
          "Please select one of the available movie sessions."
        );
      }
    } else {
      const schedules = getSchedule(facility, dayOfWeek);

      const matchingSchedule = getMatchingSchedule(
        schedules,
        startMinutes,
        endMinutes,
        duration
      );

      if (!matchingSchedule) {
        return errorResponse(
          "The selected time is outside the facility schedule or does not match its slot duration.",
          409
        );
      }
    }

    const resourceKey = getResourceKey(facility, service);
    const dateRange = getDateRange(newDate);

    const slotBlock = await SlotBlock.findOne({
      facilityId: booking.facilityId,
      bookingDate: dateRange,
      resourceKey,
      startTime: { $lt: endTime },
      endTime: { $gt: newStartTime },
    })
      .select("_id")
      .lean();

    if (slotBlock) {
      return errorResponse(
        "This time slot is manually blocked.",
        409
      );
    }

    const existingBookings = await Booking.find({
      _id: { $ne: booking._id },
      facilityId: booking.facilityId,
      bookingDate: dateRange,
      status: { $in: ACTIVE_BOOKING_STATUSES },
      paymentStatus: { $in: ["unpaid", "pending", "paid"] },
      startTime: { $lt: endTime },
      endTime: { $gt: newStartTime },
    })
      .select(
        "_id serviceId startTime endTime quantity status paymentStatus expiresAt"
      )
      .lean();

    const isPlayground =
      facility.slug === "playground" ||
      facility.facilityType === "playground";

    const isMovie = isMovieService(facility, service);

    const isExclusive =
      service.exclusive === true ||
      service.pricingType === "per_booking";

    const relevantBookings = existingBookings.filter((item) => {
      if (
        item.status === "pending" &&
        item.expiresAt &&
        new Date(item.expiresAt).getTime() <= Date.now()
      ) {
        return false;
      }

      if (
        isPlayground
      ) {
        return true;
      }

      return String(item.serviceId) === String(service._id);
    });

    if (isPlayground && relevantBookings.length > 0) {
      return errorResponse(
        "The selected time slot is already booked.",
        409
      );
    }

    if (isExclusive && relevantBookings.length > 0) {
      return errorResponse(
        "The selected time slot is already booked.",
        409
      );
    }

    const bookedQuantity = relevantBookings.reduce(
      (total, item) =>
        total + (Number(item.quantity) || 0),
      0
    );

    if (isMovie) {
      const capacity = Number(service.capacity || 50);

      if (
        bookedQuantity + Number(booking.quantity || 1) >
        capacity
      ) {
        return errorResponse(
          "There is not enough remaining capacity for this movie session.",
          409
        );
      }
    } else if (!isExclusive && !isPlayground) {
      const capacity =
        service.capacity == null
          ? null
          : Number(service.capacity);

      if (
        capacity !== null &&
        Number.isFinite(capacity) &&
        bookedQuantity + Number(booking.quantity || 1) >
          capacity
      ) {
        return errorResponse(
          "There is not enough remaining capacity for this time slot.",
          409
        );
      }
    }

    session = await mongoose.startSession();

    await session.withTransaction(async () => {
      const latestBooking = await Booking.findOne({
        _id: booking._id,
        status: "confirmed",
        paymentStatus: "paid",
        checkedIn: { $ne: true },
        checkedOut: { $ne: true },
      }).session(session);

      if (!latestBooking) {
        throw new Error("BOOKING_CHANGED");
      }

      // Remove only this booking's old locks inside the transaction.
      await BookingLock.deleteMany(
        { bookingId: booking._id },
        { session }
      );

      const slices = getSliceTimes(
        newStartTime,
        duration
      );

      const units = getRequiredCapacityUnits(
        service,
        Number(latestBooking.quantity || 1)
      );

      const lockDocuments = [];

      for (const timeSlice of slices) {
        for (const unit of units) {
          lockDocuments.push({
            bookingGroupReference:
              latestBooking.bookingGroupReference,
            bookingId: latestBooking._id,
            facilityId: latestBooking.facilityId,
            serviceId: latestBooking.serviceId,
            bookingDate: dateObject,
            resourceKey,
            timeSlice,
            unit,
            expiresAt: null,
          });
        }
      }

      if (lockDocuments.length) {
        await BookingLock.insertMany(lockDocuments, {
          session,
          ordered: true,
        });
      }

      latestBooking.bookingDate = dateObject;
      latestBooking.startTime = newStartTime;
      latestBooking.endTime = endTime;
      latestBooking.durationMinutes = duration;

      await latestBooking.save({ session });
    });

    return NextResponse.json({
      success: true,
      message: "Booking rescheduled successfully.",
    });
  } catch (error) {
    if (
      error?.code === 11000 ||
      error?.message === "BOOKING_CHANGED"
    ) {
      return errorResponse(
        "This slot is no longer available. Please choose another time.",
        409
      );
    }

    console.error("Admin reschedule error:", error);

    return errorResponse(
      "Unable to reschedule this booking.",
      500
    );
  } finally {
    if (session) {
      await session.endSession();
    }
  }
}
