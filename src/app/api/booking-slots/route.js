
import { NextResponse } from "next/server";

import { connectDB } from "@/lib/mongodb";
import Facility from "@/models/facility";
import Booking from "@/models/booking";

export const dynamic = "force-dynamic";

const VALID_TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;
const VALID_DATE = /^\d{4}-\d{2}-\d{2}$/;

const ACTIVE_BOOKING_STATUSES = ["pending", "confirmed"];

const MOVIE_SESSIONS = [
  { startTime: "11:00", endTime: "14:00" },
  { startTime: "14:00", endTime: "17:00" },
  { startTime: "17:00", endTime: "20:00" },
  { startTime: "20:00", endTime: "23:00" },
];

function errorResponse(message, status = 400) {
  return NextResponse.json(
    { success: false, error: message },
    { status }
  );
}

function successResponse(data, status = 200) {
  return NextResponse.json(
    { success: true, ...data },
    { status }
  );
}

function parseDateOnly(dateString) {
  if (typeof dateString !== "string" || !VALID_DATE.test(dateString)) {
    return null;
  }

  const [year, month, day] = dateString.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return { year, month, day, date };
}

function getDayOfWeek(dateString) {
  const parsed = parseDateOnly(dateString);
  return parsed ? parsed.date.getUTCDay() : null;
}

function getDateRange(dateString) {
  const parsed = parseDateOnly(dateString);
  if (!parsed) return null;

  return {
    start: new Date(
      Date.UTC(parsed.year, parsed.month - 1, parsed.day)
    ),
    end: new Date(
      Date.UTC(parsed.year, parsed.month - 1, parsed.day + 1)
    ),
  };
}

function timeToMinutes(value) {
  if (typeof value !== "string" || !VALID_TIME.test(value)) {
    return null;
  }

  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

function minutesToTime(totalMinutes) {
  const normalized = Math.max(0, Math.min(1439, totalMinutes));
  const hours = Math.floor(normalized / 60);
  const minutes = normalized % 60;

  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function overlaps(startA, endA, startB, endB) {
  return startA < endB && endA > startB;
}

function isMembershipService(service) {
  return (
    service?.type === "membership" ||
    service?.pricingType === "monthly"
  );
}

/*
 * Only fitness day_pass services use unlimited date-only availability.
 * Monthly memberships retain their separate existing behavior.
 */
function isUnlimitedFitnessDayPass(facility, service) {
  return (
    facility?.facilityType === "fitness" &&
    service?.type === "day_pass" &&
    !isMembershipService(service)
  );
}

function isMovieFacility(facility) {
  return (
    facility?.facilityType === "movie" ||
    facility?.slug === "private-movie"
  );
}

function isPlaygroundFacility(facility) {
  return (
    facility?.facilityType === "playground" ||
    facility?.slug === "playground"
  );
}

function isSlotBasedService(service) {
  return !isMembershipService(service);
}

function getBookingQuantity(booking) {
  const quantity = Number(booking?.quantity);

  if (!Number.isFinite(quantity) || quantity <= 0) {
    return 0;
  }

  return quantity;
}

async function getBookingsForDate(facilityId, dateRange) {
  return Booking.find({
    facilityId,
    bookingDate: {
      $gte: dateRange.start,
      $lt: dateRange.end,
    },
    status: {
      $in: ACTIVE_BOOKING_STATUSES,
    },
  })
    .select(
      "_id serviceId serviceName startTime endTime durationMinutes quantity status paymentStatus movieName"
    )
    .lean();
}

function getSchedulesForDay(facility, dayOfWeek) {
  if (!Array.isArray(facility.schedules)) {
    return [];
  }

  return facility.schedules.filter(
    (schedule) =>
      schedule?.active !== false &&
      Number(schedule?.dayOfWeek) === dayOfWeek &&
      typeof schedule?.startTime === "string" &&
      VALID_TIME.test(schedule.startTime) &&
      typeof schedule?.endTime === "string" &&
      VALID_TIME.test(schedule.endTime) &&
      Number(schedule?.slotDurationMinutes) > 0
  );
}

function generateStartTimes(schedule) {
  const start = timeToMinutes(schedule.startTime);
  const end = timeToMinutes(schedule.endTime);
  const interval = Number(schedule.slotDurationMinutes);

  if (
    start === null ||
    end === null ||
    !Number.isFinite(interval) ||
    interval <= 0 ||
    start >= end
  ) {
    return [];
  }

  const result = [];

  for (let current = start; current < end; current += interval) {
    result.push(minutesToTime(current));
  }

  return result;
}

function generateStandardSlots(facility, service, dayOfWeek) {
  const schedules = getSchedulesForDay(facility, dayOfWeek);

  if (schedules.length === 0) return [];

  const serviceDuration = Number(service.durationMinutes);

  if (!Number.isFinite(serviceDuration) || serviceDuration <= 0) {
    return [];
  }

  const slots = [];

  for (const schedule of schedules) {
    const scheduleEnd = timeToMinutes(schedule.endTime);

    for (const startTime of generateStartTimes(schedule)) {
      const startMinutes = timeToMinutes(startTime);

      if (startMinutes === null) continue;

      const endMinutes = startMinutes + serviceDuration;

      if (endMinutes > scheduleEnd) continue;

      const endTime = minutesToTime(endMinutes);

      const duplicate = slots.some(
        (slot) =>
          slot.startTime === startTime &&
          slot.endTime === endTime
      );

      if (duplicate) continue;

      slots.push({
        startTime,
        endTime,
        durationMinutes: serviceDuration,
      });
    }
  }

  return slots.sort(
    (a, b) =>
      timeToMinutes(a.startTime) - timeToMinutes(b.startTime)
  );
}

function generateMovieSlots(facility, service, dayOfWeek) {
  const schedules = getSchedulesForDay(facility, dayOfWeek);

  if (schedules.length === 0) return [];

  const slots = [];

  for (const session of MOVIE_SESSIONS) {
    const sessionStart = timeToMinutes(session.startTime);
    const sessionEnd = timeToMinutes(session.endTime);

    const allowedBySchedule = schedules.some((schedule) => {
      const scheduleStart = timeToMinutes(schedule.startTime);
      const scheduleEnd = timeToMinutes(schedule.endTime);

      return (
        scheduleStart <= sessionStart &&
        scheduleEnd >= sessionEnd
      );
    });

    if (!allowedBySchedule) continue;

    slots.push({
      startTime: session.startTime,
      endTime: session.endTime,
      durationMinutes: sessionEnd - sessionStart,
    });
  }

  return slots;
}

function calculateCapacityAvailability({ service, slot, bookings }) {
  const capacity = Number(service.capacity);

  if (!Number.isFinite(capacity) || capacity <= 0) {
    return {
      capacity: null,
      booked: 0,
      remaining: 0,
      available: false,
    };
  }

  const relevantBookings = bookings.filter((booking) => {
    if (String(booking.serviceId) !== String(service._id)) {
      return false;
    }

    const bookingStart = timeToMinutes(booking.startTime);
    const bookingEnd = timeToMinutes(booking.endTime);
    const slotStart = timeToMinutes(slot.startTime);
    const slotEnd = timeToMinutes(slot.endTime);

    if (
      bookingStart === null ||
      bookingEnd === null ||
      slotStart === null ||
      slotEnd === null
    ) {
      return false;
    }

    return overlaps(
      slotStart,
      slotEnd,
      bookingStart,
      bookingEnd
    );
  });

  const booked = relevantBookings.reduce(
    (sum, booking) => sum + getBookingQuantity(booking),
    0
  );

  const remaining = Math.max(0, capacity - booked);

  return {
    capacity,
    booked,
    remaining,
    available: remaining > 0,
  };
}

function calculateExclusiveAvailability({ slot, bookings }) {
  const slotStart = timeToMinutes(slot.startTime);
  const slotEnd = timeToMinutes(slot.endTime);

  const occupied = bookings.some((booking) => {
    const bookingStart = timeToMinutes(booking.startTime);
    const bookingEnd = timeToMinutes(booking.endTime);

    if (
      bookingStart === null ||
      bookingEnd === null ||
      slotStart === null ||
      slotEnd === null
    ) {
      return false;
    }

    return overlaps(
      slotStart,
      slotEnd,
      bookingStart,
      bookingEnd
    );
  });

  return {
    capacity: 1,
    booked: occupied ? 1 : 0,
    remaining: occupied ? 0 : 1,
    available: !occupied,
  };
}

function calculatePlaygroundAvailability({ slot, bookings }) {
  const slotStart = timeToMinutes(slot.startTime);
  const slotEnd = timeToMinutes(slot.endTime);

  const occupiedBooking = bookings.find((booking) => {
    const bookingStart = timeToMinutes(booking.startTime);
    const bookingEnd = timeToMinutes(booking.endTime);

    if (
      bookingStart === null ||
      bookingEnd === null ||
      slotStart === null ||
      slotEnd === null
    ) {
      return false;
    }

    return overlaps(
      slotStart,
      slotEnd,
      bookingStart,
      bookingEnd
    );
  });

  return {
    capacity: 1,
    booked: occupiedBooking ? 1 : 0,
    remaining: occupiedBooking ? 0 : 1,
    available: !occupiedBooking,
    occupiedBy: occupiedBooking
      ? {
          bookingId: String(occupiedBooking._id),
          serviceName: occupiedBooking.serviceName,
          startTime: occupiedBooking.startTime,
          endTime: occupiedBooking.endTime,
        }
      : null,
  };
}

function calculateMovieAvailability({ service, slot, bookings }) {
  const capacity =
    Number(service.capacity) > 0 ? Number(service.capacity) : 50;

  const slotStart = timeToMinutes(slot.startTime);
  const slotEnd = timeToMinutes(slot.endTime);

  const relevantBookings = bookings.filter((booking) => {
    const bookingStart = timeToMinutes(booking.startTime);
    const bookingEnd = timeToMinutes(booking.endTime);

    if (
      bookingStart === null ||
      bookingEnd === null ||
      slotStart === null ||
      slotEnd === null
    ) {
      return false;
    }

    return overlaps(
      slotStart,
      slotEnd,
      bookingStart,
      bookingEnd
    );
  });

  const booked = relevantBookings.reduce(
    (sum, booking) => sum + getBookingQuantity(booking),
    0
  );

  const remaining = Math.max(0, capacity - booked);

  return {
    capacity,
    booked,
    remaining,
    available: remaining > 0,
  };
}

function calculateSlotAvailability({
  facility,
  service,
  slot,
  bookings,
}) {
  if (isMovieFacility(facility)) {
    return calculateMovieAvailability({
      service,
      slot,
      bookings,
    });
  }

  if (isPlaygroundFacility(facility)) {
    return calculatePlaygroundAvailability({
      slot,
      bookings,
    });
  }

  if (service.exclusive === true) {
    return calculateExclusiveAvailability({
      slot,
      bookings,
    });
  }

  return calculateCapacityAvailability({
    service,
    slot,
    bookings,
  });
}

function buildSlotResponse({ service, slot, availability }) {
  const capacity =
    availability.capacity === null ? null : availability.capacity;

  return {
    startTime: slot.startTime,
    endTime: slot.endTime,
    durationMinutes: slot.durationMinutes,
    available: availability.available,
    capacity,
    booked: availability.booked,
    remaining: availability.remaining,
    price: Number(service.price),
    pricingType: service.pricingType,
    minimumQuantity: Number(service.minimumQuantity || 1),
    maximumQuantity:
      service.maximumQuantity == null
        ? capacity
        : Number(service.maximumQuantity),
    exclusive: Boolean(service.exclusive),
    ...(availability.occupiedBy
      ? { occupiedBy: availability.occupiedBy }
      : {}),
  };
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);

    const facilityId = searchParams.get("facilityId")?.trim();
    const serviceId = searchParams.get("serviceId")?.trim();
    const date = searchParams.get("date")?.trim();

    if (!facilityId) {
      return errorResponse("facilityId is required.");
    }

    if (!serviceId) {
      return errorResponse("serviceId is required.");
    }

    if (!date) {
      return errorResponse("date is required.");
    }

    if (!parseDateOnly(date)) {
      return errorResponse("Invalid date. Use YYYY-MM-DD.");
    }

    await connectDB();

    const facility = await Facility.findOne({
      _id: facilityId,
      active: true,
    }).lean();

    if (!facility) {
      return errorResponse("Facility not found or inactive.", 404);
    }

    const service = Array.isArray(facility.services)
      ? facility.services.find(
          (item) =>
            String(item._id) === String(serviceId) &&
            item.active !== false
        )
      : null;

    if (!service) {
      return errorResponse(
        "Service not found or inactive for this facility.",
        404
      );
    }

    const facilityResponse = {
      id: String(facility._id),
      name: facility.name,
      slug: facility.slug,
      description: facility.description || "",
      image: facility.image || "",
      facilityType: facility.facilityType,
      sharedResource: Boolean(facility.sharedResource),
    };

    const serviceResponse = {
      id: String(service._id),
      name: service.name,
      slug: service.slug,
      type: service.type,
      pricingType: service.pricingType,
      price: Number(service.price),
      capacity:
        service.capacity == null ? null : Number(service.capacity),
      durationMinutes:
        service.durationMinutes == null
          ? null
          : Number(service.durationMinutes),
      minimumQuantity: Number(service.minimumQuantity || 1),
      maximumQuantity:
        service.maximumQuantity == null
          ? null
          : Number(service.maximumQuantity),
      exclusive: Boolean(service.exclusive),
    };

    /*
     * Memberships keep their existing date-only behavior.
     */
    if (isMembershipService(service)) {
      return successResponse({
        facility: facilityResponse,
        service: serviceResponse,
        date,
        slotBased: false,
        slots: [],
        message: "Membership services do not use time slots.",
      });
    }

    /*
     * Unlimited fitness day passes:
     * Gym Day Pass, Swimming Pool Day Pass, Gym + Pool Combo Day Pass.
     *
     * Return before schedule checks and booking queries.
     * No time slots, capacity checks, or daily booking limits.
     */
    if (isUnlimitedFitnessDayPass(facility, service)) {
      return successResponse({
        facility: facilityResponse,
        service: {
          ...serviceResponse,
          capacity: null,
          maximumQuantity: null,
          exclusive: false,
        },
        date,
        slotBased: false,
        dateOnly: true,
        unlimited: true,
        slots: [],
        capacity: null,
        maximumQuantity: null,
        message:
          "This day pass is booked by date and quantity. Time slots and daily capacity limits do not apply.",
      });
    }

    const dayOfWeek = getDayOfWeek(date);

    if (dayOfWeek === null) {
      return errorResponse("Unable to determine day of week.");
    }

    const schedules = getSchedulesForDay(facility, dayOfWeek);

    if (schedules.length === 0) {
      return successResponse({
        facility: facilityResponse,
        service: serviceResponse,
        date,
        dayOfWeek,
        slotBased: true,
        schedules: [],
        slots: [],
        message: "No active schedule is configured for this day.",
      });
    }

    const slots = isMovieFacility(facility)
      ? generateMovieSlots(facility, service, dayOfWeek)
      : generateStandardSlots(facility, service, dayOfWeek);

    const dateRange = getDateRange(date);

    if (!dateRange) {
      return errorResponse("Unable to create date range.");
    }

    const bookings = await getBookingsForDate(
      facility._id,
      dateRange
    );

    const responseSlots = slots.map((slot) => {
      const availability = calculateSlotAvailability({
        facility,
        service,
        slot,
        bookings,
      });

      return buildSlotResponse({
        service,
        slot,
        availability,
      });
    });

    const totalSlots = responseSlots.length;
    const availableSlots = responseSlots.filter(
      (slot) => slot.available
    ).length;
    const fullSlots = responseSlots.filter(
      (slot) => !slot.available
    ).length;

    return successResponse({
      facility: facilityResponse,
      service: serviceResponse,
      date,
      dayOfWeek,
      schedules: schedules.map((schedule) => ({
        id: String(schedule._id),
        dayOfWeek: Number(schedule.dayOfWeek),
        startTime: schedule.startTime,
        endTime: schedule.endTime,
        slotDurationMinutes: Number(
          schedule.slotDurationMinutes
        ),
        active: schedule.active !== false,
      })),
      slotBased: isSlotBasedService(service),
      summary: {
        totalSlots,
        availableSlots,
        fullSlots,
        activeBookingsCount: bookings.length,
      },
      slots: responseSlots,
    });
  } catch (error) {
    console.error("GET /api/booking-slots error:", error);

    return errorResponse(
      "Unable to load booking availability.",
      500
    );
  }
}
