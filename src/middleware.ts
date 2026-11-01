import { NextResponse, type NextRequest } from "next/server";

/**
 * Quick first gate: no session cookie, no app. (The real check, including roles,
 * happens on every page and API call on the server.)
 */
export function middleware(req: NextRequest) {
  if (req.cookies.get("dd_session")) return NextResponse.next();
  if (req.nextUrl.pathname.startsWith("/api/")) return NextResponse.json({ error: "Please log in." }, { status: 401 });
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = `?next=${encodeURIComponent(req.nextUrl.pathname + req.nextUrl.search)}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!login|_next|favicon.ico).*)"],
};
