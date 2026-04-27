import { NextResponse } from "next/server";

const SESSION_COOKIE_NAME = "cr_session";

export const runtime = "nodejs";

function publicBase(request: Request): string {
  const explicit = process.env.PUBLIC_BASE_URL;
  if (explicit) {
    return explicit.replace(/\/$/, "");
  }
  const forwardedHost = request.headers.get("x-forwarded-host");
  const forwardedProto = request.headers.get("x-forwarded-proto") ?? "https";
  return forwardedHost
    ? `${forwardedProto}://${forwardedHost}`
    : new URL(request.url).origin;
}

export async function POST(request: Request) {
  const base = publicBase(request);
  const response = NextResponse.redirect(new URL("/login", base), 303);
  response.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });

  return response;
}