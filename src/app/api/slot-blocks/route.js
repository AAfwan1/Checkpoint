
import { NextResponse } from "next/server";
import mongoose from "mongoose";

import { connectDB } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/requireAdmin";
import Facility from "@/models/facility";
import Booking from "@/models/booking";
import BookingLock from "@/models/bookingLock";
import SlotBlock from "@/models/slotBlock";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ACTIVE_STATUSES = ["pending", "confirmed"];
const TIME_SLICE_MINUTES = 30;

function errorResponse(message, status = 400) {
  return NextResponse.json(
    { success: false, message },
    { status }
  );
}

function validTime(value) {
  return (
    typeof value === "string" &&
    /^([01]\d|2[0-3]):[0-5]\d$/.test(value)
  );
}

function validDate(value) {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value)
  ) {
    return false;
  }

  const date = new Date(`${value}T00:00:00.000Z`);

  return (
    !Number.isNaN(date.getTime()) &&
    date.toISOString().slice(0, 10) === value
  );
}

function dateStart(value) {
  return new Date(`${value}T00:00:00.000Z`);
}

function dateRange(date) {
  const start = dateStart(date);

  return {
    $gte: start,
    $lt: new Date(start.getTime() + 86400000),
  };
}

function timeMinutes(value) {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

function isPlayground(facility) {
  return (
    facility.slug === "playground" ||
    facility.facilityType === "playground"
  );
}

function resourceKey(facility, service) {
  const facilityId = facility._id.toString();
  const serviceId = service._id.toString();

  if (isPlayground(facility)) {
    return `playground:${facilityId}`;
  }

  if (service.exclusive === true) {
    return `exclusive:${facilityId}:${serviceId}`;
  }

  return `service:${facilityId}:${serviceId}`;
}

async function authorize() {
  const auth = await requireAdmin();

  if (!auth.authenticated) {
    return {
      response: errorResponse(
        "Admin authentication required.",
        401
      ),
    };
  }

  if (auth.admin.adminLevel !== "main") {
    return {
      response: errorResponse(
        "You do not have permission to manage slot blocks.",
        403
      ),
    };
  }

  return { admin: auth.admin };
}

async function findOverlappingLock({
  facilityId,
  date,
  key,
  startTime,
  endTime,
}) {
  // Lock slices are 30 minutes long. Fetch all slices that begin
  // before the requested end, then check their actual overlap.
  const locks = await BookingLock.find({
    facilityId,
    bookingDate: dateRange(date),
    resourceKey: key,
    timeSlice: { $lt: endTime },
  })
    .select("timeSlice expiresAt")
    .lean();

  const blockStart = timeMinutes(startTime);
  const blockEnd = timeMinutes(endTime);
  const now = Date.now();

  return locks.some((lock) => {
    if (!validTime(lock.timeSlice)) {
      return false;
    }

    // Ignore expired locks. Existing active bookings are checked
    // separately before a block is created.
    if (
      lock.expiresAt &&
      new Date(lock.expiresAt).getTime() <= now
    ) {
      return false;
    }

    const sliceStart = timeMinutes(lock.timeSlice);
    const sliceEnd = sliceStart + TIME_SLICE_MINUTES;

    return sliceStart < blockEnd && sliceEnd > blockStart;
  });
}

export async function GET(request) {
  try {
    const access = await authorize();
    if (access.response) return access.response;

    await connectDB();

    const params = new URL(request.url).searchParams;
    const date = params.get("date") || "";
    const facilityId = params.get("facilityId") || "";

    if (!validDate(date)) {
      return errorResponse("A valid date is required.");
    }

    const query = {
      bookingDate: dateRange(date),
    };

    if (facilityId) {
      if (!mongoose.isValidObjectId(facilityId)) {
        return errorResponse("Invalid facility ID.");
      }

      query.facilityId = new mongoose.Types.ObjectId(facilityId);
    }

    const blocks = await SlotBlock.find(query)
      .sort({ startTime: 1 })
      .lean();

    return NextResponse.json({
      success: true,
      blocks: blocks.map((block) => ({
        id: block._id.toString(),
        facilityId: block.facilityId.toString(),
        serviceId: block.serviceId.toString(),
        date: block.bookingDate.toISOString().slice(0, 10),
        startTime: block.startTime,
        endTime: block.endTime,
        reason: block.reason || "",
        createdAt: block.createdAt,
      })),
    });
  } catch (error) {
    console.error("GET slot blocks error:", error);
    return errorResponse("Unable to load slot blocks.", 500);
  }
}

export async function POST(request) {
  try {
    const access = await authorize();
    if (access.response) return access.response;

    await connectDB();

    const body = await request.json();

    const facilityId = String(body?.facilityId || "").trim();
    const serviceId = String(body?.serviceId || "").trim();
    const date = String(body?.date || "").trim();
    const startTime = String(body?.startTime || "").trim();
    const endTime = String(body?.endTime || "").trim();
    const reason =
      typeof body?.reason === "string"
        ? body.reason.trim().slice(0, 200)
        : "";

    if (
      !mongoose.isValidObjectId(facilityId) ||
      !mongoose.isValidObjectId(serviceId)
    ) {
      return errorResponse("Invalid facility or service ID.");
    }

    if (
      !validDate(date) ||
      !validTime(startTime) ||
      !validTime(endTime)
    ) {
      return errorResponse(
        "A valid date and time range are required."
      );
    }

    if (timeMinutes(endTime) <= timeMinutes(startTime)) {
      return errorResponse("End time must be after start time.");
    }

    const facility = await Facility.findOne({
      _id: facilityId,
      active: true,
    });

    if (!facility) {
      return errorResponse("Facility not found.", 404);
    }

    const service = facility.services.id(serviceId);

    if (!service || !service.active) {
      return errorResponse("Active service not found.", 404);
    }

    const key = resourceKey(facility, service);
    const bookingDate = dateStart(date);

    // Refuse blocks that overlap existing active bookings.
    const existingBookings = await Booking.find({
      facilityId,
      bookingDate: dateRange(date),
      status: { $in: ACTIVE_STATUSES },
      paymentStatus: { $in: ["unpaid", "pending", "paid"] },
      startTime: { $lt: endTime },
      endTime: { $gt: startTime },
    })
      .select("_id serviceId")
      .lean();

    const blocksWholeResource =
      isPlayground(facility) || service.exclusive === true;

    const conflictingBooking = existingBookings.some(
      (booking) =>
        blocksWholeResource ||
        booking.serviceId.toString() === serviceId
    );

    if (conflictingBooking) {
      return errorResponse(
        "This time overlaps an existing booking and cannot be blocked.",
        409
      );
    }

    // Prevent overlapping blocks for the same resource.
    const existingBlock = await SlotBlock.findOne({
      facilityId,
      resourceKey: key,
      bookingDate: dateRange(date),
      startTime: { $lt: endTime },
      endTime: { $gt: startTime },
    })
      .select("_id")
      .lean();

    if (existingBlock) {
      return errorResponse(
        "An overlapping slot block already exists.",
        409
      );
    }

    // Check the full 30-minute lock interval, not just whether
    // the lock's start time falls inside the requested block.
    const existingLock = await findOverlappingLock({
      facilityId,
      date,
      key,
      startTime,
      endTime,
    });

    if (existingLock) {
      return errorResponse(
        "This time has an active booking reservation and cannot be blocked.",
        409
      );
    }

    const block = await SlotBlock.create({
      facilityId,
      serviceId,
      bookingDate,
      startTime,
      endTime,
      resourceKey: key,
      reason,
      createdBy: access.admin._id,
    });

    return NextResponse.json(
      {
        success: true,
        block: {
          id: block._id.toString(),
          facilityId: block.facilityId.toString(),
          serviceId: block.serviceId.toString(),
          date,
          startTime: block.startTime,
          endTime: block.endTime,
          reason: block.reason,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("POST slot block error:", error);
    return errorResponse("Unable to block this slot.", 500);
  }
}

export async function DELETE(request) {
  try {
    const access = await authorize();
    if (access.response) return access.response;

    await connectDB();

    const id = new URL(request.url).searchParams.get("id") || "";

    if (!mongoose.isValidObjectId(id)) {
      return errorResponse("Invalid slot block ID.");
    }

    const result = await SlotBlock.deleteOne({ _id: id });

    if (!result.deletedCount) {
      return errorResponse("Slot block not found.", 404);
    }

    return NextResponse.json({
      success: true,
      message: "Slot block removed.",
    });
  } catch (error) {
    console.error("DELETE slot block error:", error);
    return errorResponse("Unable to remove slot block.", 500);
  }
}
