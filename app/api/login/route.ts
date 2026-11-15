import { NextResponse } from "next/server";
import { COOKIE, PASS, token } from "@/lib/auth";

export async function POST(req: Request) {
  const form = await req.formData();
  const ok = !PASS || String(form.get("code") || "") === PASS;
  const res = NextResponse.redirect(new URL(ok ? "/" : "/login?fejl=1", req.url), 303);
  if (ok) res.cookies.set(COOKIE, token(), { httpOnly: true, secure: true, sameSite: "lax", maxAge: 60 * 60 * 24 * 365, path: "/" });
  return res;
}
