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
    (path) => pathname === path || pathname.startsWith(`${path}/`)
  );
}

export function proxy(request) {
  const token = request.cookies.get("admin_session")?.value;

  // No login cookie: redirect to the login page.
  if (!token) {
    return NextResponse.redirect(new URL(LOGIN, request.url));
  }

  const admin = verifyAdminToken(token);

  // Invalid token or unauthorized role: show 404.
  if (!admin?.adminId || admin.role !== "admin") {
    const response = NextResponse.rewrite(
      new URL(NOT_FOUND, request.url)
    );

    response.cookies.delete("admin_session");
    return response;
  }

  // Main admin can access every admin page.
  if (admin.adminLevel === "main") {
    return NextResponse.next();
  }

  // Moderators cannot access restricted pages.
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