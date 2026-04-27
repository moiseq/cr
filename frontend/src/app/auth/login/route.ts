import crypto from "node:crypto";
import { NextResponse } from "next/server";

const SESSION_COOKIE_NAME = "cr_session";

function getSessionToken() {
  const username = process.env.AUTH_USERNAME || "admin";
  const password = process.env.AUTH_PASSWORD || "changeme";
  const secret = process.env.AUTH_SECRET || "dev-auth-secret";

  if (process.env.AUTH_SESSION_TOKEN) {
    return process.env.AUTH_SESSION_TOKEN;
  }

  return crypto
    .createHash("sha256")
    .update(`${username}:${password}:${secret}`)
    .digest("hex");
}

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
  const formData = await request.formData();
  const username = String(formData.get("username") ?? "");
  const password = String(formData.get("password") ?? "");

  const validUsername = process.env.AUTH_USERNAME || "admin";
  const validPassword = process.env.AUTH_PASSWORD || "changeme";

  const base = publicBase(request);

  if (username !== validUsername || password !== validPassword) {
    return NextResponse.redirect(new URL("/login?error=1", base), 303);
  }

  const response = NextResponse.redirect(new URL("/", base), 303);
  response.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: getSessionToken(),
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 12,
  });

  return response;
}