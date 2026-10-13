
import { NextResponse } from "next/server";
import { connectDB } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/requireAdmin";
import Membership from "@/models/membership";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TIME_ZONE = "Asia/Dhaka";
const DAY_MS = 86400000;
const BD_OFFSET_MS = 6 * 60 * 60 * 1000;
const VALID_STATUSES = new Set(["active", "upcoming", "expired", "pending"]);
const VALID_PAYMENT_STATUSES = new Set(["paid", "pending", "failed"]);
const TYPE_MAP = {
  Gym: "gym",
  "Swimming Pool": "pool",
  "Gym + Pool": "gym_pool",
  gym: "gym",
  pool: "pool",
  gym_pool: "gym_pool",
};

function getDateKey(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function getMembershipDateKey(value) {
  if (!value) return "";

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : getDateKey(date);
}

function addOneDay(dateKey) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + 1))
    .toISOString()
    .slice(0, 10);
}

function getBangladeshMidnight(dateKey) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day) - BD_OFFSET_MS);
}

function getMembershipStatus(membership, today) {
  if (!membership?.active) return "expired";

  const start = getMembershipDateKey(membership.startDate);
  const expiry = getMembershipDateKey(membership.expiryDate);

  if (!start || !expiry) return "expired";
  if (today < start) return "upcoming";
  if (today >= expiry) return "expired";

  return "active";
}

function isTodayEntry(entry, today) {
  if (!entry) return false;

  if (entry.checkedInAt) {
    const date = new Date(entry.checkedInAt);

    if (!Number.isNaN(date.getTime())) {
      return getDateKey(date) === today;
    }
  }

  return Boolean(entry.date) && String(entry.date).slice(0, 10) === today;
}

function serializeMembership(membership, today, now) {
  const entries = Array.isArray(membership.dailyEntries)
    ? membership.dailyEntries
    : [];

  let todayEntry = null;
  let lastEntry = null;
  let lastTime = -Infinity;

  for (const entry of entries) {
    if (isTodayEntry(entry, today) && !todayEntry) {
      todayEntry = entry;
    }

    const time = entry?.checkedInAt
      ? new Date(entry.checkedInAt).getTime()
      : 0;

    if (time > lastTime) {
      lastTime = time;
      lastEntry = entry;
    }
  }

  return {
    id: membership._id.toString(),
    code: membership.membershipCode,
    customer: membership.customerName,
    email: membership.customerEmail,
    phone: membership.customerPhone,
    type: membership.membershipType,
    facilities: membership.facilities,
    price: membership.price,
    startDate: membership.startDate,
    expiryDate: membership.expiryDate,
    active: membership.active,
    status: getMembershipStatus(membership, today),
    paymentStatus: membership.paymentStatus || "paid",
    todayEntry: Boolean(todayEntry),
    todayEntryTime: todayEntry?.checkedInAt || null,
    totalEntries: entries.length,
    lastEntry: lastEntry
      ? {
          date: lastEntry.date,
          checkedInAt: lastEntry.checkedInAt,
        }
      : null,
    lastRenewedAt: membership.lastRenewedAt,
    renewalCount: membership.renewalCount || 0,
    notes: membership.notes || "",
    renewalHistory: membership.renewalHistory || [],
    createdAt: membership.createdAt,
    updatedAt: membership.updatedAt,
  };
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildStatusQuery(status, todayStart, tomorrowStart) {
  if (status === "pending") {
    return { paymentStatus: "pending" };
  }

  if (status === "upcoming") {
    return {
      active: true,
      startDate: { $gte: tomorrowStart },
    };
  }

  if (status === "active") {
    return {
      active: true,
      startDate: { $lt: tomorrowStart },
      expiryDate: { $gte: tomorrowStart },
    };
  }

  if (status === "expired") {
    return {
      $or: [
        { active: false },
        { startDate: { $exists: false } },
        { startDate: null },
        { expiryDate: { $exists: false } },
        { expiryDate: null },
        {
          active: true,
          startDate: { $lt: tomorrowStart },
          expiryDate: { $lt: tomorrowStart },
        },
      ],
    };
  }

  return {};
}

export async function GET(request) {
  try {
    await requireAdmin();
    await connectDB();

    const { searchParams } = new URL(request.url);

    const pageValue = Number(searchParams.get("page"));
    const limitValue = Number(searchParams.get("limit"));

    const page =
      Number.isFinite(pageValue) && pageValue > 0
        ? Math.floor(pageValue)
        : 1;

    const limit =
      Number.isFinite(limitValue) && limitValue > 0
        ? Math.min(Math.floor(limitValue), 100)
        : 50;

    const search = (searchParams.get("search") || "").trim();
    const type = (searchParams.get("type") || "").trim();
    const status = (searchParams.get("status") || "").trim().toLowerCase();
    const paymentStatus = (searchParams.get("paymentStatus") || "")
      .trim()
      .toLowerCase();

    const today = getDateKey();
    const tomorrow = addOneDay(today);
    const todayStart = getBangladeshMidnight(today);
    const tomorrowStart = getBangladeshMidnight(tomorrow);

    const query = {};

    if (search) {
      const regex = new RegExp(escapeRegex(search), "i");

      query.$or = [
        { customerName: regex },
        { customerEmail: regex },
        { customerPhone: regex },
        { membershipCode: regex },
      ];
    }

    if (TYPE_MAP[type]) {
      query.membershipType = TYPE_MAP[type];
    }

    const statusQuery = VALID_STATUSES.has(status)
      ? buildStatusQuery(status, todayStart, tomorrowStart)
      : {};

    const filteredQuery = { $and: [query, statusQuery] };

    const total = await Membership.countDocuments(query);

    const totalCount = VALID_STATUSES.has(status)
      ? await Membership.countDocuments(filteredQuery)
      : total;

    const memberships = await Membership.find(filteredQuery)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();

    if (VALID_PAYMENT_STATUSES.has(paymentStatus)) {
      for (let i = memberships.length - 1; i >= 0; i--) {
        if ((memberships[i].paymentStatus || "paid") !== paymentStatus) {
          memberships.splice(i, 1);
        }
      }
    }

    const summaryRecords = await Membership.find(query)
      .select("active startDate expiryDate price paymentStatus")
      .lean();

    const summary = {
      total: summaryRecords.length,
      active: 0,
      upcoming: 0,
      expired: 0,
      paidValue: 0,
    };

    for (const membership of summaryRecords) {
      const membershipStatus = getMembershipStatus(membership, today);

      summary[membershipStatus]++;

      if (
        (membership.paymentStatus || "paid") === "paid" &&
        membershipStatus !== "expired"
      ) {
        summary.paidValue += Number(membership.price || 0);
      }
    }

    return NextResponse.json(
      {
        success: true,
        memberships: memberships.map((membership) =>
          serializeMembership(membership, today, Date.now())
        ),
        pagination: {
          page,
          limit,
          total: totalCount,
          totalPages: Math.ceil(totalCount / limit),
        },
        summary,
      },
      {
        headers: {
          "Cache-Control": "no-store, max-age=0",
        },
      }
    );
  } catch (error) {
    console.error("GET /api/memberships error:", error);

    if (error?.status === 401) {
      return NextResponse.json(
        { success: false, message: "Unauthorized." },
        { status: 401 }
      );
    }

    return NextResponse.json(
      { success: false, message: "Failed to load memberships." },
      { status: 500 }
    );
  }
}
