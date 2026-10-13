
import { NextResponse } from "next/server";
import { connectDB } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/requireAdmin";
import Booking from "@/models/booking";
import Facility from "@/models/facility";
import Payment from "@/models/payment";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TIME_ZONE = "Asia/Dhaka";
const UPCOMING_LIMIT = 10;
const ACTIVE_STATUSES = ["pending", "confirmed"];

const jsonError = (message, status = 500) =>
  NextResponse.json({ success: false, error: message }, { status });

function getDhakaDateParts(date) {
  return Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(date)
      .map(({ type, value }) => [type, value])
  );
}

function getDateRange(dateString, days = 1) {
  const start = new Date(`${dateString}T00:00:00.000Z`);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + days);
  return { $gte: start, $lt: end };
}

const toMinutes = (time) => {
  const [hours, minutes] = String(time || "").split(":").map(Number);
  return hours * 60 + minutes;
};

const toTime = (minutes) =>
  `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(
    minutes % 60
  ).padStart(2, "0")}`;

function getCurrentSlot(schedules, service, dayOfWeek, nowMinutes) {
  const duration = Number(service.durationMinutes);

  for (const schedule of schedules || []) {
    if (
      !schedule.active ||
      Number(schedule.dayOfWeek) !== dayOfWeek ||
      nowMinutes < toMinutes(schedule.startTime) ||
      nowMinutes >= toMinutes(schedule.endTime)
    ) {
      continue;
    }

    const start = toMinutes(schedule.startTime);
    const end = toMinutes(schedule.endTime);
    const slotDuration =
      duration > 0 ? duration : Number(schedule.slotDurationMinutes);

    if (!Number.isFinite(slotDuration) || slotDuration <= 0) continue;

    const slotStart =
      start + Math.floor((nowMinutes - start) / slotDuration) * slotDuration;
    const slotEnd = Math.min(slotStart + slotDuration, end);

    return {
      startTime: toTime(slotStart),
      endTime: toTime(slotEnd),
      startMinutes: slotStart,
      endMinutes: slotEnd,
    };
  }

  return null;
}

function serializeUpcomingBooking(booking) {
  return {
    id: String(booking._id),
    bookingReference: booking.bookingReference,
    customerName: booking.customerName,
    facilityId: String(booking.facilityId),
    facilityName: booking.facilityName,
    serviceId: String(booking.serviceId),
    serviceName: booking.serviceName,
    startTime: booking.startTime,
    endTime: booking.endTime,
    quantity: booking.quantity,
    status: booking.status,
    paymentStatus: booking.paymentStatus,
  };
}

export async function GET() {
  try {
    const auth = await requireAdmin();
    if (!auth?.authenticated) return jsonError("Unauthorized", 401);

    await connectDB();

    const now = new Date();
    const parts = getDhakaDateParts(now);
    const today = `${parts.year}-${parts.month}-${parts.day}`;
    const nowMinutes = Number(parts.hour) * 60 + Number(parts.minute);
    const nowTime = toTime(nowMinutes);

    const weekdays = {
      Sun: 0, Mon: 1, Tue: 2, Wed: 3,
      Thu: 4, Fri: 5, Sat: 6,
    };
    const dayOfWeek = weekdays[parts.weekday];
    const todayRange = getDateRange(today);
    const nextSevenDaysRange = getDateRange(today, 7);

    const [facilities, todayBookings, revenueResult] = await Promise.all([
      Facility.find({ active: true })
        .select("name slug facilityType sharedResource services schedules")
        .lean(),

      Booking.find({
        bookingDate: todayRange,
        status: { $in: ACTIVE_STATUSES },
        $or: [
          { status: "confirmed" },
          { status: "pending", expiresAt: { $gt: now } },
        ],
      })
        .select(
          "_id bookingReference customerName facilityId facilityName serviceId serviceName startTime endTime quantity status paymentStatus"
        )
        .sort({ startTime: 1 })
        .lean(),

      Payment.aggregate([
        { $match: { status: "paid", paidAt: todayRange } },
        {
          $group: {
            _id: null,
            total: { $sum: "$amount" },
            count: { $sum: 1 },
          },
        },
      ]),
    ]);

    const membershipIds = new Set(
      facilities.flatMap((facility) =>
        (facility.services || [])
          .filter((service) => service.type === "membership")
          .map((service) => String(service._id))
      )
    );

    const nonMembershipFilter = membershipIds.size
      ? {
          serviceId: {
            $nin: [...membershipIds],
          },
        }
      : {};

    const [todayBookingCount, upcomingBookingCount, activeMemberships] =
      await Promise.all([
        Booking.countDocuments({
          bookingDate: todayRange,
          status: { $in: ["pending", "confirmed", "completed"] },
          ...nonMembershipFilter,
          $or: [
            { status: { $in: ["confirmed", "completed"] } },
            { status: "pending", expiresAt: { $gt: now } },
          ],
        }),

        Booking.countDocuments({
          bookingDate: nextSevenDaysRange,
          status: { $in: ACTIVE_STATUSES },
          ...nonMembershipFilter,
          $or: [
            { status: "confirmed" },
            { status: "pending", expiresAt: { $gt: now } },
          ],
        }),

        membershipIds.size
          ? Booking.countDocuments({
              serviceId: { $in: [...membershipIds] },
              status: "confirmed",
              paymentStatus: "paid",
            })
          : Promise.resolve(0),
      ]);

    const facilityOverview = facilities.map((facility) => {
      const services = [];

      for (const service of facility.services || []) {
        if (!service.active || service.type === "membership") continue;

        const rawCapacity = Number(service.capacity);
        const capacity =
          Number.isFinite(rawCapacity) && rawCapacity > 0
            ? rawCapacity
            : null;

        const slot = getCurrentSlot(
          facility.schedules,
          service,
          dayOfWeek,
          nowMinutes
        );

        let booked = 0;

        if (slot && capacity) {
          for (const booking of todayBookings) {
            if (
              String(booking.facilityId) !== String(facility._id) ||
              toMinutes(booking.startTime) >= slot.endMinutes ||
              toMinutes(booking.endTime) <= slot.startMinutes
            ) {
              continue;
            }

            if (
              facility.sharedResource ||
              String(booking.serviceId) === String(service._id)
            ) {
              booked += Number(booking.quantity || 0);
            }
          }
        }

        const occupancyPercent =
          slot && capacity
            ? Math.min(100, Math.round((booked / capacity) * 100))
            : 0;

        services.push({
          id: String(service._id),
          name: service.name,
          capacity,
          currentSlot: slot
            ? { startTime: slot.startTime, endTime: slot.endTime }
            : null,
          booked,
          occupancyPercent,
          full: Boolean(slot && capacity && booked >= capacity),
        });
      }

      const current = services.find((service) => service.currentSlot);

      return {
        id: String(facility._id),
        name: facility.name,
        slug: facility.slug,
        facilityType: facility.facilityType,
        currentSlot: current?.currentSlot || null,
        booked: current?.booked ?? 0,
        capacity: current?.capacity ?? null,
        occupancyPercent: current?.occupancyPercent ?? 0,
        full: current?.full ?? false,
        services,
      };
    });

    const upcomingBookings = [];
    for (const booking of todayBookings) {
      if (
        booking.startTime > nowTime &&
        !membershipIds.has(String(booking.serviceId))
      ) {
        upcomingBookings.push(serializeUpcomingBooking(booking));
        if (upcomingBookings.length === UPCOMING_LIMIT) break;
      }
    }

    const revenue = revenueResult[0] || { total: 0, count: 0 };

    return NextResponse.json(
      {
        success: true,
        data: {
          date: today,
          currentTime: nowTime,
          stats: {
            todayBookings: todayBookingCount,
            todayRevenue: revenue.total,
            todayPayments: revenue.count,
            upcomingBookings: upcomingBookingCount,
            activeMemberships,
            averageOccupancy: facilityOverview.length
              ? Math.round(
                  facilityOverview.reduce(
                    (total, facility) => total + facility.occupancyPercent,
                    0
                  ) / facilityOverview.length
                )
              : 0,
          },
          facilities: facilityOverview,
          todaySchedule: upcomingBookings,
        },
      },
      {
        headers: { "Cache-Control": "private, no-store, max-age=0" },
      }
    );
  } catch (error) {
    console.error("Dashboard API error:", error);
    return jsonError("Unable to load dashboard data.");
  }
}
