
import { NextResponse } from "next/server";
import mongoose from "mongoose";
import { z } from "zod";

import { connectDB } from "@/lib/mongodb";
import Admin from "@/models/admin";
import { requireAdmin } from "@/lib/requireAdmin";

const updateSchema = z.object({ isActive: z.boolean() });

const respond = (message, status) =>
  NextResponse.json({ success: false, message }, { status });

export async function PATCH(request, { params }) {
  try {
    const auth = await requireAdmin();

    if (!auth.authenticated) return respond("Unauthorized", 401);
    if (auth.admin.adminLevel !== "main") return respond("Forbidden", 403);

    const { id } = await params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return respond("Invalid admin ID", 400);
    }

    const result = updateSchema.safeParse(await request.json());
    if (!result.success) return respond("Invalid input", 400);

    await connectDB();

    const admin = await Admin.findById(id)
      .select("_id name email role adminLevel isActive");

    if (!admin) return respond("Admin not found", 404);

    if (
      admin.adminLevel === "main" &&
      admin._id.toString() === auth.admin._id.toString()
    ) {
      return respond("You cannot disable the main admin", 400);
    }

    admin.isActive = result.data.isActive;
    await admin.save();

    return NextResponse.json({
      success: true,
      message: admin.isActive ? "Admin enabled" : "Admin disabled",
      admin: {
        _id: admin._id,
        name: admin.name,
        email: admin.email,
        role: admin.role,
        adminLevel: admin.adminLevel,
        isActive: admin.isActive,
      },
    });
  } catch (error) {
    console.error("Update admin error:", error);
    return respond("Something went wrong", 500);
  }
}
