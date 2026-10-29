
import { NextResponse } from "next/server";

import { connectDB } from "@/lib/mongodb";
import Facility from "@/models/facility";
import Booking from "@/models/booking";
import SlotBlock from "@/models/slotBlock";

export const dynamic = "force-dynamic";

const VALID_TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;
const VALID_DATE = /^\d{4}-\d{2}-\d{2}$/;
const VALID_OBJECT_ID = /^[a-f\d]{24}$/i;

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
  return NextResponse.json({ success: true, ...data }, { status });
}

function parseDateOnly(value) {
  if (typeof value !== "string" || !VALID_DATE.test(value)) {
    return null;
  }

  const [year, month, day] = value.split("-").map(Number);
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

function getDateRange({ year, month, day }) {
  return {
    start: new Date(Date.UTC(year, month - 1, day)),
    end: new Date(Date.UTC(year, month - 1, day + 1)),
  };
}

function timeToMinutes(value) {
  if (typeof value !== "string" || !VALID_TIME.test(value)) {
    return null;
  }

  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

function minutesToTime(minutes) {
  const normalized = Math.max(0, Math.min(1439, minutes));
  const hours = Math.floor(normalized / 60);

  return `${String(hours).padStart(2, "0")}:${String(
    normalized % 60
  ).padStart(2, "0")}`;
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

function getResourceKey(facility, service) {
  if (isPlaygroundFacility(facility)) {
    return `playground:${facility._id}`;
  }

  if (service.exclusive === true) {
    return `exclusive:${facility._id}:${service._id}`;
  }

  return `service:${facility._id}:${service._id}`;
}

function getBookingQuantity(booking) {
  const quantity = Number(booking?.quantity);
  return Number.isFinite(quantity) && quantity > 0 ? quantity : 0;
}

async function getBookingsForDate(facilityId, dateRange) {
  const bookings = await Booking.find({
    facilityId,
    bookingDate: {
      $gte: dateRange.start,
      $lt: dateRange.end,
    },
    status: { $in: ACTIVE_BOOKING_STATUSES },
  })
    .select("_id serviceId serviceName startTime endTime quantity")
    .lean();

  return bookings.map((booking) => ({
    _id: booking._id,
    serviceId: String(booking.serviceId),
    serviceName: booking.serviceName,
    startTime: booking.startTime,
    endTime: booking.endTime,
    startMinutes: timeToMinutes(booking.startTime),
    endMinutes: timeToMinutes(booking.endTime),
    quantity: getBookingQuantity(booking),
  }));
}

async function getSlotBlocksForDate(
  facilityId,
  dateRange,
  resourceKey
) {
  const blocks = await SlotBlock.find({
    facilityId,
    bookingDate: {
      $gte: dateRange.start,
      $lt: dateRange.end,
    },
    resourceKey,
  })
    .select("startTime endTime reason")
    .lean();

  return blocks.map((block) => ({
    startMinutes: timeToMinutes(block.startTime),
    endMinutes: timeToMinutes(block.endTime),
    reason: block.reason || "",
  }));
}

function findSlotBlock(slot, blocks) {
  const start = timeToMinutes(slot.startTime);
  const end = timeToMinutes(slot.endTime);

  return blocks.find(
    (block) =>
      block.startMinutes !== null &&
      block.endMinutes !== null &&
      overlaps(
        start,
        end,
        block.startMinutes,
        block.endMinutes
      )
  ) || null;
}

function getSchedulesForDay(facility, dayOfWeek) {
  if (!Array.isArray(facility.schedules)) return [];

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

  const times = [];

  for (let current = start; current < end; current += interval) {
    times.push(minutesToTime(current));
  }

  return times;
}

function generateStandardSlots(schedules, service) {
  const duration = Number(service.durationMinutes);

  if (!Number.isFinite(duration) || duration <= 0) return [];

  const slots = [];
  const seen = new Set();

  for (const schedule of schedules) {
    const scheduleEnd = timeToMinutes(schedule.endTime);

    for (const startTime of generateStartTimes(schedule)) {
      const start = timeToMinutes(startTime);
      if (start === null) continue;

      const end = start + duration;
      if (end > scheduleEnd) continue;

      const endTime = minutesToTime(end);
      const key = `${startTime}|${endTime}`;

      if (seen.has(key)) continue;
      seen.add(key);

      slots.push({
        startTime,
        endTime,
        durationMinutes: duration,
      });
    }
  }

  return slots.sort(
    (a, b) =>
      timeToMinutes(a.startTime) - timeToMinutes(b.startTime)
  );
}

function generateMovieSlots(schedules) {
  return MOVIE_SESSIONS.filter((session) => {
    const start = timeToMinutes(session.startTime);
    const end = timeToMinutes(session.endTime);

    return schedules.some(
      (schedule) =>
        timeToMinutes(schedule.startTime) <= start &&
        timeToMinutes(schedule.endTime) >= end
    );
  }).map((session) => ({
    ...session,
    durationMinutes:
      timeToMinutes(session.endTime) -
      timeToMinutes(session.startTime),
  }));
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

  const slotStart = timeToMinutes(slot.startTime);
  const slotEnd = timeToMinutes(slot.endTime);
  const serviceId = String(service._id);

  let booked = 0;

  for (const booking of bookings) {
    if (
      booking.serviceId === serviceId &&
      booking.startMinutes !== null &&
      booking.endMinutes !== null &&
      overlaps(
        slotStart,
        slotEnd,
        booking.startMinutes,
        booking.endMinutes
      )
    ) {
      booked += booking.quantity;
    }
  }

  const remaining = Math.max(0, capacity - booked);

  return {
    capacity,
    booked,
    remaining,
    available: remaining > 0,
  };
}

function calculateExclusiveAvailability({ slot, bookings }) {
  const start = timeToMinutes(slot.startTime);
  const end = timeToMinutes(slot.endTime);

  const occupied = bookings.some(
    (booking) =>
      booking.startMinutes !== null &&
      booking.endMinutes !== null &&
      overlaps(start, end, booking.startMinutes, booking.endMinutes)
  );

  return {
    capacity: 1,
    booked: occupied ? 1 : 0,
    remaining: occupied ? 0 : 1,
    available: !occupied,
  };
}

function calculatePlaygroundAvailability({ slot, bookings }) {
  const start = timeToMinutes(slot.startTime);
  const end = timeToMinutes(slot.endTime);

  const occupiedBooking = bookings.find(
    (booking) =>
      booking.startMinutes !== null &&
      booking.endMinutes !== null &&
      overlaps(start, end, booking.startMinutes, booking.endMinutes)
  );

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
  const configuredCapacity = Number(service.capacity);
  const capacity =
    configuredCapacity > 0 ? configuredCapacity : 50;

  const start = timeToMinutes(slot.startTime);
  const end = timeToMinutes(slot.endTime);

  let booked = 0;

  for (const booking of bookings) {
    if (
      booking.startMinutes !== null &&
      booking.endMinutes !== null &&
      overlaps(start, end, booking.startMinutes, booking.endMinutes)
    ) {
      booked += booking.quantity;
    }
  }

  const remaining = Math.max(0, capacity - booked);

  return {
    capacity,
    booked,
    remaining,
    available: remaining > 0,
  };
}

function calculateSlotAvailability({ facility, service, slot, bookings }) {
  if (isMovieFacility(facility)) {
    return calculateMovieAvailability({ service, slot, bookings });
  }

  if (isPlaygroundFacility(facility)) {
    return calculatePlaygroundAvailability({ slot, bookings });
  }

  if (service.exclusive === true) {
    return calculateExclusiveAvailability({ slot, bookings });
  }

  return calculateCapacityAvailability({ service, slot, bookings });
}

function buildSlotResponse({ service, slot, availability, block }) {
  const capacity = availability.capacity;

  return {
    startTime: slot.startTime,
    endTime: slot.endTime,
    durationMinutes: slot.durationMinutes,
    available: block ? false : availability.available,
    capacity,
    booked: availability.booked,
    remaining: block ? 0 : availability.remaining,
    price: Number(service.price),
    pricingType: service.pricingType,
    minimumQuantity: Number(service.minimumQuantity || 1),
    maximumQuantity:
      service.maximumQuantity == null
        ? capacity
        : Number(service.maximumQuantity),
    exclusive: Boolean(service.exclusive),
    blocked: Boolean(block),
    ...(block?.reason ? { blockReason: block.reason } : {}),
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

    if (!facilityId) return errorResponse("facilityId is required.");
    if (!serviceId) return errorResponse("serviceId is required.");
    if (!date) return errorResponse("date is required.");

    if (!VALID_OBJECT_ID.test(facilityId)) {
      return errorResponse("Invalid facilityId.");
    }

    if (!VALID_OBJECT_ID.test(serviceId)) {
      return errorResponse("Invalid serviceId.");
    }

    const parsedDate = parseDateOnly(date);
    if (!parsedDate) {
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
            String(item._id) === serviceId &&
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

    const dayOfWeek = parsedDate.date.getUTCDay();
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
      ? generateMovieSlots(schedules)
      : generateStandardSlots(schedules, service);

    const range = getDateRange(parsedDate);

    const [bookings, blocks] = await Promise.all([
      getBookingsForDate(facility._id, range),
      getSlotBlocksForDate(
        facility._id,
        range,
        getResourceKey(facility, service)
      ),
    ]);

    const responseSlots = slots.map((slot) => {
      const availability = calculateSlotAvailability({
        facility,
        service,
        slot,
        bookings,
      });

      const block = findSlotBlock(slot, blocks);

      return buildSlotResponse({
        service,
        slot,
        availability,
        block,
      });
    });

    let availableSlots = 0;

    for (const slot of responseSlots) {
      if (slot.available) availableSlots++;
    }

    const totalSlots = responseSlots.length;

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
        slotDurationMinutes: Number(schedule.slotDurationMinutes),
        active: schedule.active !== false,
      })),
      slotBased: !isMembershipService(service),
      summary: {
        totalSlots,
        availableSlots,
        fullSlots: totalSlots - availableSlots,
        activeBookingsCount: bookings.length,
      },
      slots: responseSlots,
    });
  } catch (error) {
    console.error("GET /api/booking-slots error:", error);

    return errorResponse("Unable to load booking availability.", 500);
  }
}
