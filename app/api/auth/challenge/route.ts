import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { CHALLENGE_COOKIE, seal } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const issuedAt = new Date().toISOString();
  const challenge = {
    nonce: randomBytes(16).toString("base64url"),
    domain: request.nextUrl.host,
    issuedAt,
    expiresAt: Date.now() + 5 * 60_000,
  };
  const response = NextResponse.json(challenge);
  response.cookies.set(CHALLENGE_COOKIE, seal(challenge), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 5 * 60,
    path: "/",
  });
  return response;
}
