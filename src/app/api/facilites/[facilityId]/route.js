
import mongoose from "mongoose";
import { NextResponse } from "next/server";
import { connectDB } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/requireAdmin";
import Facility from "@/models/facility";

const TIME_REGEX = /^([01]\d|2[0-3]):([0-5]\d)$/;
const SLOT_DURATIONS = new Set([15, 30, 60, 90, 120, 180]);
const DAY_MS = 86400000;
const BD_OFFSET_MS = 6 * 60 * 60 * 1000;

const response = (message, status) =>
  NextResponse.json({ success: false, message }, { status });

const isValidId = (id) => mongoose.Types.ObjectId.isValid(id);

const isValidTime = (value) =>
  typeof value === "string" && TIME_REGEX.test(value);

const toMinutes = (value) => {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
};

function validateSchedule(schedule) {
  if (!schedule || typeof schedule !== "object") {
    return "Schedule is required";
  }

  if (!isValidTime(schedule.startTime)) return "Invalid start time";
  if (!isValidTime(schedule.endTime)) return "Invalid end time";

  const duration = Number(schedule.slotDurationMinutes);
  const difference = toMinutes(schedule.endTime) - toMinutes(schedule.startTime);

  if (difference <= 0) return "End time must be later than start time";
  if (!SLOT_DURATIONS.has(duration)) return "Invalid slot duration";
  if (difference < duration) return "Slot duration is longer than the schedule";
  if (schedule.active !== undefined && typeof schedule.active !== "boolean") {
    return "Invalid active value";
  }

  return null;
}

function validateService(service) {
  if (!service || typeof service !== "object") return "Service is required";
  if (!isValidId(service.id)) return "Invalid service ID";

  const numericFields = [
    ["price", 0, false],
    ["capacity", 1, true],
    ["durationMinutes", 1, true],
    ["minimumQuantity", 1, true],
    ["maximumQuantity", 1, true],
  ];

  for (const [field, minimum, integer] of numericFields) {
    const value = service[field];

    if (value === undefined || (value === null && field !== "price" && field !== "minimumQuantity")) {
      continue;
    }

    if (
      typeof value !== "number" ||
      !Number.isFinite(value) ||
      value < minimum ||
      (integer && !Number.isInteger(value))
    ) {
      return `Invalid ${field === "durationMinutes" ? "duration" : field === "minimumQuantity" ? "minimum quantity" : field === "maximumQuantity" ? "maximum quantity" : field}`;
    }
  }

  for (const field of ["active", "exclusive"]) {
    if (service[field] !== undefined && typeof service[field] !== "boolean") {
      return `Invalid ${field} value`;
    }
  }

  if (service.name !== undefined &&
      (typeof service.name !== "string" || !service.name.trim())) {
    return "Invalid service name";
  }

  return null;
}

function parseBangladeshDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }

  const [year, month, day] = value.split("-").map(Number);
  const utc = Date.UTC(year, month - 1, day);

  const date = new Date(utc);

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return new Date(utc - BD_OFFSET_MS);
}

function addPriceHistoryEntry(service, price, effectiveFrom) {
  const history = (service.priceHistory || []).map((entry) => ({
    price: entry.price,
    effectiveFrom: entry.effectiveFrom,
  }));

  const timestamp = effectiveFrom.getTime();
  const index = history.findIndex(
    (entry) => new Date(entry.effectiveFrom).getTime() === timestamp
  );

  const entry = { price, effectiveFrom };

  if (index === -1) history.push(entry);
  else history[index] = entry;

  history.sort(
    (a, b) => new Date(a.effectiveFrom).getTime() -
              new Date(b.effectiveFrom).getTime()
  );

  service.priceHistory = history;
}

function updateCurrentPriceFromHistory(service) {
  let latest = null;
  const now = Date.now();

  for (const entry of service.priceHistory || []) {
    if (new Date(entry.effectiveFrom).getTime() <= now &&
        (!latest || new Date(entry.effectiveFrom).getTime() >
                    new Date(latest.effectiveFrom).getTime())) {
      latest = entry;
    }
  }

  if (latest) service.price = latest.price;
}

async function authorize() {
  const { authenticated } = await requireAdmin();
  return authenticated;
}

async function getFacility(facilityId) {
  if (!isValidId(facilityId)) {
    return { error: response("Invalid facility ID", 400) };
  }

  await connectDB();

  const facility = await Facility.findById(facilityId);
  if (!facility) {
    return { error: response("Facility not found", 404) };
  }

  return { facility };
}

export async function GET(request, { params }) {
  try {
    if (!(await authorize())) return response("Unauthorized", 401);

    const { facilityId } = await params;

    if (!isValidId(facilityId)) {
      return response("Invalid facility ID", 400);
    }

    await connectDB();

    const facility = await Facility.findById(facilityId).lean();
    if (!facility) return response("Facility not found", 404);

    return NextResponse.json({ success: true, facility });
  } catch (error) {
    console.error("GET /api/admin/facilities/[facilityId] error:", error);
    return response("Failed to load facility", 500);
  }
}

export async function PATCH(request, { params }) {
  try {
    if (!(await authorize())) return response("Unauthorized", 401);

    const { facilityId } = await params;
    if (!isValidId(facilityId)) return response("Invalid facility ID", 400);

    let body;
    try {
      body = await request.json();
    } catch {
      return response("Invalid JSON request body", 400);
    }

    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return response("Invalid JSON request body", 400);
    }

    const { facility, error } = await getFacility(facilityId);
    if (error) return error;

    if (body.active !== undefined) {
      if (typeof body.active !== "boolean") {
        return response("Invalid active value", 400);
      }
      facility.active = body.active;
    }

    if (body.service !== undefined) {
      const input = body.service;
      const serviceError = validateService(input);
      if (serviceError) return response(serviceError, 400);

      const service = facility.services.id(input.id);
      if (!service) return response("Service not found", 404);

      if (input.price !== undefined && input.price !== service.price) {
        if (!input.effectiveDate) {
          return response("Price changes require an effective date", 400);
        }

        const date = parseBangladeshDate(input.effectiveDate);
        if (!date) return response("Invalid price effective date", 400);

        addPriceHistoryEntry(service, input.price, date);

        if (date.getTime() <= Date.now()) service.price = input.price;
      } else if (input.price !== undefined && input.effectiveDate) {
        const date = parseBangladeshDate(input.effectiveDate);
        if (!date) return response("Invalid price effective date", 400);

        addPriceHistoryEntry(service, input.price, date);
        updateCurrentPriceFromHistory(service);
      }

      if (input.name !== undefined) service.name = input.name.trim();

      for (const field of [
        "capacity",
        "durationMinutes",
        "minimumQuantity",
        "maximumQuantity",
        "active",
        "exclusive",
      ]) {
        if (input[field] !== undefined) service[field] = input[field];
      }

      if (
        service.maximumQuantity != null &&
        service.minimumQuantity > service.maximumQuantity
      ) {
        return response(
          "Minimum quantity cannot exceed maximum quantity",
          400
        );
      }
    }

    if (body.schedules !== undefined) {
      if (!Array.isArray(body.schedules) || body.schedules.length !== 7) {
        return response("Exactly seven weekly schedules are required", 400);
      }

      const receivedDays = new Set();

      for (const incoming of body.schedules) {
        if (!incoming || typeof incoming !== "object") {
          return response("Invalid schedule", 400);
        }

        const day = incoming.dayOfWeek;

        if (!Number.isInteger(day) || day < 0 || day > 6) {
          return response("Invalid day of week", 400);
        }

        if (receivedDays.has(day)) {
          return response("Duplicate day of week", 400);
        }

        receivedDays.add(day);

        const scheduleError = validateSchedule(incoming);
        if (scheduleError) return response(scheduleError, 400);
      }

      const schedulesByDay = new Map(
        facility.schedules.map((schedule) => [schedule.dayOfWeek, schedule])
      );

      for (const incoming of body.schedules) {
        const schedule = schedulesByDay.get(incoming.dayOfWeek);

        if (!schedule) {
          return response(
            `Schedule not found for day ${incoming.dayOfWeek}`,
            404
          );
        }

        schedule.startTime = incoming.startTime;
        schedule.endTime = incoming.endTime;
        schedule.slotDurationMinutes = Number(incoming.slotDurationMinutes);

        if (incoming.active !== undefined) {
          schedule.active = incoming.active;
        }
      }
    }

    await facility.save();

    return NextResponse.json({
      success: true,
      message: "Facility updated successfully",
      facility: facility.toObject(),
    });
  } catch (error) {
    console.error("PATCH /api/admin/facilities/[facilityId] error:", error);
    return response("Failed to update facility", 500);
  }
}
