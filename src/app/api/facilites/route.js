
import { NextResponse } from "next/server";
import { connectDB } from "@/lib/mongodb";
import Facility from "@/models/facility";

export const dynamic = "force-dynamic";

const PLAYGROUND_DISCOUNT = {
  percentage: 30,
  startTime: "11:00",
  endTime: "16:00",
};

const FIXED_FACILITIES = [
  {
    name: "Gym",
    slug: "gym",
    description: "Premium gym access",
    image: "",
    facilityType: "fitness",
    sharedResource: false,
    services: [
      {
        name: "Gym Day Pass",
        slug: "gym-day-pass",
        type: "day_pass",
        pricingType: "per_person",
        price: 500,
        capacity: 15,
        durationMinutes: 60,
        minimumQuantity: 1,
        maximumQuantity: 15,
        exclusive: false,
        active: true,
      },
      {
        name: "Gym Monthly Membership",
        slug: "gym-monthly",
        type: "membership",
        pricingType: "monthly",
        price: 4000,
        capacity: null,
        durationMinutes: null,
        minimumQuantity: 1,
        maximumQuantity: null,
        exclusive: false,
        active: true,
      },
    ],
  },
  {
    name: "Swimming Pool",
    slug: "swimming-pool",
    description: "Swimming pool access",
    image: "",
    facilityType: "fitness",
    sharedResource: false,
    services: [
      {
        name: "Swimming Pool Day Pass",
        slug: "pool-day-pass",
        type: "day_pass",
        pricingType: "per_person",
        price: 500,
        capacity: 15,
        durationMinutes: 60,
        minimumQuantity: 1,
        maximumQuantity: 15,
        exclusive: false,
        active: true,
      },
      {
        name: "Swimming Pool Monthly Membership",
        slug: "pool-monthly",
        type: "membership",
        pricingType: "monthly",
        price: 4000,
        capacity: null,
        durationMinutes: null,
        minimumQuantity: 1,
        maximumQuantity: null,
        exclusive: false,
        active: true,
      },
    ],
  },
  {
    name: "Gym + Pool",
    slug: "gym-pool",
    description: "Combined gym and swimming pool access",
    image: "",
    facilityType: "fitness",
    sharedResource: false,
    services: [
      {
        name: "Gym + Pool Day Pass",
        slug: "gym-pool-day-pass",
        type: "day_pass",
        pricingType: "per_person",
        price: 700,
        capacity: 15,
        durationMinutes: 60,
        minimumQuantity: 1,
        maximumQuantity: 15,
        exclusive: false,
        active: true,
      },
      {
        name: "Gym + Pool Monthly Membership",
        slug: "gym-pool-monthly",
        type: "membership",
        pricingType: "monthly",
        price: 6000,
        capacity: null,
        durationMinutes: null,
        minimumQuantity: 1,
        maximumQuantity: null,
        exclusive: false,
        active: true,
      },
    ],
  },
  {
    name: "Steam Bath",
    slug: "steam-bath",
    description: "Private steam bath session",
    image: "",
    facilityType: "steam",
    sharedResource: false,
    services: [
      {
        name: "Steam Bath",
        slug: "steam-bath-session",
        type: "activity",
        pricingType: "per_person",
        price: 300,
        capacity: 6,
        durationMinutes: 30,
        minimumQuantity: 1,
        maximumQuantity: 6,
        exclusive: true,
        active: true,
      },
    ],
  },
  {
    name: "Playground",
    slug: "playground",
    description: "Shared sports playground",
    image: "",
    facilityType: "playground",
    sharedResource: true,
    services: [
      {
        name: "Futsal",
        slug: "futsal",
        type: "activity",
        pricingType: "per_booking",
        price: 1500,
        capacity: 1,
        durationMinutes: 90,
        minimumQuantity: 1,
        maximumQuantity: 1,
        exclusive: true,
        active: true,
      },
      {
        name: "Basketball",
        slug: "basketball",
        type: "activity",
        pricingType: "per_booking",
        price: 900,
        capacity: 1,
        durationMinutes: 60,
        minimumQuantity: 1,
        maximumQuantity: 1,
        exclusive: true,
        active: true,
      },
      {
        name: "Badminton",
        slug: "badminton",
        type: "activity",
        pricingType: "per_booking",
        price: 800,
        capacity: 1,
        durationMinutes: 60,
        minimumQuantity: 1,
        maximumQuantity: 1,
        exclusive: true,
        active: true,
      },
      {
        name: "Pickleball",
        slug: "pickleball",
        type: "activity",
        pricingType: "per_booking",
        price: 800,
        capacity: 1,
        durationMinutes: 60,
        minimumQuantity: 1,
        maximumQuantity: 1,
        exclusive: true,
        active: true,
      },
    ],
  },
  {
    name: "Private Movie",
    slug: "private-movie",
    description: "Private movie viewing",
    image: "",
    facilityType: "movie",
    sharedResource: false,
    services: [
      {
        name: "Private Movie",
        slug: "private-movie-booking",
        type: "private_movie",
        pricingType: "per_ticket",
        price: 250,
        capacity: 50,
        durationMinutes: 180,
        minimumQuantity: 10,
        maximumQuantity: 50,
        exclusive: true,
        active: true,
      },
    ],
  },
];

function createSchedule(slotDurationMinutes) {
  return Array.from({ length: 7 }, (_, dayOfWeek) => ({
    dayOfWeek,
    startTime: "11:00",
    endTime: "23:00",
    slotDurationMinutes,
    active: true,
  }));
}

function getSchedules({ slug }) {
  if (slug === "private-movie") {
    return Array.from({ length: 7 }, (_, dayOfWeek) =>
      [
        ["11:00", "14:00"],
        ["14:00", "17:00"],
        ["17:00", "20:00"],
        ["20:00", "23:00"],
      ].map(([startTime, endTime]) => ({
        dayOfWeek,
        startTime,
        endTime,
        slotDurationMinutes: 180,
        active: true,
      }))
    ).flat();
  }

  return createSchedule(
    slug === "steam-bath" || slug === "playground" ? 30 : 60
  );
}

async function ensureFixedFacilities() {
  const existing = await Facility.find({
    slug: { $in: FIXED_FACILITIES.map(({ slug }) => slug) },
  })
    .select("slug")
    .lean();

  const existingSlugs = new Set(existing.map(({ slug }) => slug));

  await Promise.all(
    FIXED_FACILITIES.filter(({ slug }) => !existingSlugs.has(slug)).map(
      (facility) =>
        Facility.create({
          ...facility,
          schedules: getSchedules(facility),
        })
    )
  );
}

function addDiscountMetadata(facility) {
  if (facility.slug !== "playground" || !Array.isArray(facility.services)) {
    return facility;
  }

  return {
    ...facility,
    services: facility.services.map((service) => ({
      ...service,
      offPeakDiscount: { ...PLAYGROUND_DISCOUNT, applies: true },
    })),
  };
}

export async function GET() {
  try {
    await connectDB();
    await ensureFixedFacilities();

    const facilities = await Facility.find({})
      .sort({ createdAt: 1 })
      .lean();

    return NextResponse.json({
      success: true,
      facilities: facilities.map(addDiscountMetadata),
    });
  } catch (error) {
    console.error("GET /api/admin/facilities error:", error);

    return NextResponse.json(
      { success: false, message: "Failed to load facilities" },
      { status: 500 }
    );
  }
}
