import { cookies } from "next/headers";
import { connectDB } from "@/lib/mongodb";
import Admin from "@/models/admin";
import { verifyAdminToken } from "@/lib/adminAuth";

export async function requireAdmin() {
  try {
    const token = (await cookies()).get("admin_session")?.value;
    const payload = token && verifyAdminToken(token);

    if (!payload?.adminId || payload.role !== "admin") {
      return { authenticated: false, admin: null };
    }

    await connectDB();

    const admin = await Admin.findOne({
      _id: payload.adminId,
      role: "admin",
      isActive: true,
    })
      .select("_id name email role adminLevel isActive")
      .lean();

    return { authenticated: !!admin, admin: admin || null };
  } catch {
    return { authenticated: false, admin: null };
  }
}