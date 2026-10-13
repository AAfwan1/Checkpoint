
import { NextResponse } from "next/server";
import { verifyAdminToken } from "@/lib/adminAuth";

const NOT_FOUND = "/404";
const LOGIN = "/login";

const MODERATOR_RESTRICTED_PATHS = [
  "/admin/facalites",
  "/admin/booking-slots",
];

function isRestrictedForModerator(pathname) {
  return MODERATOR_RESTRICTED_PATHS.some(
    (path) =>
      pathname === path || pathname.startsWith(`${path}/`)
  );
}

export function proxy(request) {
  const token = request.cookies.get("admin_session")?.value;

  if (!token) {
    return NextResponse.redirect(new URL(LOGIN, request.url));
  }

  let admin;

  try {
    admin = verifyAdminToken(token);
  } catch {
    admin = null;
  }

  if (!admin?.adminId || admin.role !== "admin") {
    const response = NextResponse.rewrite(
      new URL(NOT_FOUND, request.url)
    );

    response.cookies.delete("admin_session");
    return response;
  }

  if (admin.adminLevel === "main") {
    return NextResponse.next();
  }

  if (
    admin.adminLevel === "moderator" &&
    !isRestrictedForModerator(request.nextUrl.pathname)
  ) {
    return NextResponse.next();
  }

  return NextResponse.rewrite(new URL(NOT_FOUND, request.url));
}

export const config = {
  matcher: "/admin/:path*",
};
