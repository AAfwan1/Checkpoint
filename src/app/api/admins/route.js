
import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";

import { connectDB } from "@/lib/mongodb";
import Admin from "@/models/admin";
import { requireAdmin } from "@/lib/requireAdmin";

const createAdminSchema = z.object({
  name: z.string().min(2).max(100),
  email: z.string().email(),
  password: z.string().min(8),
});

const respond = (message, status) =>
  NextResponse.json({ success: false, message }, { status });

async function authorizeMain() {
  const auth = await requireAdmin();

  if (!auth.authenticated) return respond("Unauthorized", 401);
  if (auth.admin.adminLevel !== "main") return respond("Forbidden", 403);

  return null;
}

export async function GET() {
  try {
    const denied = await authorizeMain();
    if (denied) return denied;

    await connectDB();

    const admins = await Admin.find({})
      .select("_id name email role adminLevel isActive createdAt")
      .sort({ createdAt: -1 })
      .lean();

    return NextResponse.json({ success: true, admins });
  } catch (error) {
    console.error("Get admins error:", error);
    return respond("Something went wrong", 500);
  }
}

export async function POST(request) {
  try {
    const denied = await authorizeMain();
    if (denied) return denied;

    const result = createAdminSchema.safeParse(await request.json());

    if (!result.success) return respond("Invalid input", 400);

    const { name, password } = result.data;
    const email = result.data.email.toLowerCase();

    await connectDB();

    if (await Admin.exists({ email })) {
      return respond("Admin already exists", 409);
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const admin = await Admin.create({
      name,
      email,
      passwordHash,
      role: "admin",
      adminLevel: "moderator",
      isActive: true,
    });

    return NextResponse.json(
      {
        success: true,
        message: "Admin created successfully",
        admin: {
          _id: admin._id,
          name: admin.name,
          email: admin.email,
          role: admin.role,
          adminLevel: admin.adminLevel,
          isActive: admin.isActive,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Create admin error:", error);
    return respond("Something went wrong", 500);
  }
}
