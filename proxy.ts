import { NextResponse, type NextRequest } from "next/server";
import { COOKIE, PASS, token } from "./lib/auth";

export function proxy(req: NextRequest) {
  if (!PASS) return NextResponse.next();
  const p = req.nextUrl.pathname;
  if (p === "/login" || p === "/api/login") return NextResponse.next();
  if (req.cookies.get(COOKIE)?.value === token()) return NextResponse.next();
  if (p.startsWith("/api/")) return NextResponse.json({ error: "locked" }, { status: 401 });
  return NextResponse.redirect(new URL("/login", req.url));
}

export const config = {
  matcher: ["/((?!_next/|favicon|icon|apple-icon|manifest).*)"],
};
