
import mongoose from "mongoose";
import { NextResponse } from "next/server";

import { connectDB } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/requireAdmin";
import Membership from "@/models/membership";
import {
  addDhakaCalendarDays,
  addDhakaCalendarMonths,
  getDhakaTodayStart,
  getMembershipStatus,
} from "@/lib/membershipDate";

export const runtime = "nodejs";

const MEMBERSHIP_PRICES = {
  gym: 4000,
  pool: 4000,
  gym_pool: 6000,
};

const unauthorized = () =>
  NextResponse.json(
    { success: false, message: "Unauthorized" },
    { status: 401 }
  );

export async function POST(_request, { params }) {
  try {
    const auth = await requireAdmin();

    if (!auth.authenticated) return unauthorized();

    const { id } = await params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return NextResponse.json(
        { success: false, message: "Invalid membership ID" },
        { status: 400 }
      );
    }

    await connectDB();

    const now = new Date();
    const todayStart = getDhakaTodayStart(now);
    const tomorrowStart = addDhakaCalendarDays(todayStart, 1);

    const membership = await Membership.findById(id)
      .select("active startDate expiryDate membershipType")
      .lean();

    if (!membership) {
      return NextResponse.json(
        { success: false, message: "Membership not found" },
        { status: 404 }
      );
    }

    const status = getMembershipStatus(membership, now);

    if (status !== "expired") {
      return NextResponse.json(
        {
          success: false,
          message:
            status === "active"
              ? "This membership is still active and cannot be renewed yet."
              : "This membership has not started yet.",
        },
        { status: 400 }
      );
    }

    const price = MEMBERSHIP_PRICES[membership.membershipType];

    if (typeof price !== "number") {
      return NextResponse.json(
        {
          success: false,
          message: "Unable to determine the membership renewal price.",
        },
        { status: 400 }
      );
    }

    const newStartDate = todayStart;
    const newExpiryDate = addDhakaCalendarDays(
      addDhakaCalendarMonths(newStartDate, 1),
      -1
    );

    const adminId = auth.admin?._id?.toString() || "";

    const updatedMembership = await Membership.findOneAndUpdate(
      {
        _id: id,
        active: true,
        expiryDate: { $lt: tomorrowStart },
      },
      {
        $set: {
          startDate: newStartDate,
          expiryDate: newExpiryDate,
          active: true,
          lastRenewedAt: now,
        },
        $inc: { renewalCount: 1 },
        $push: {
          renewalHistory: {
            renewedAt: now,
            previousStartDate: membership.startDate,
            previousExpiryDate: membership.expiryDate,
            newStartDate,
            newExpiryDate,
            price,
            paymentStatus: "pending",
            paymentTransactionId: "",
            adminId,
          },
        },
      },
      { new: true }
    )
      .select("-dailyEntries -renewalHistory")
      .lean();

    if (!updatedMembership) {
      const latest = await Membership.findById(id)
        .select("active startDate expiryDate")
        .lean();

      if (!latest) {
        return NextResponse.json(
          { success: false, message: "Membership not found" },
          { status: 404 }
        );
      }

      return NextResponse.json(
        {
          success: false,
          message:
            getMembershipStatus(latest, new Date()) !== "expired"
              ? "This membership was already renewed or is no longer expired."
              : "Renewal could not be completed. Please try again.",
        },
        { status: 409 }
      );
    }

    return NextResponse.json({
      success: true,
      message: "Membership renewed successfully.",
      membership: {
        id: updatedMembership._id.toString(),
        code: updatedMembership.membershipCode,
        customer: updatedMembership.customerName,
        type: updatedMembership.membershipType,
        price: updatedMembership.price,
        renewalPrice: price,
        startDate: updatedMembership.startDate,
        expiryDate: updatedMembership.expiryDate,
        active: updatedMembership.active,
        status: getMembershipStatus(updatedMembership, new Date()),
        renewalCount: updatedMembership.renewalCount,
        lastRenewedAt: updatedMembership.lastRenewedAt,
        paymentStatus: "pending",
      },
    });
  } catch (error) {
    console.error("POST /api/memberships/[id]/renew failed:", error);

    if (error?.status === 401) return unauthorized();

    return NextResponse.json(
      { success: false, message: "Failed to renew membership" },
      { status: 500 }
    );
  }
}
