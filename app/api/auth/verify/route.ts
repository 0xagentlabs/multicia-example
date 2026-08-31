import { NextRequest, NextResponse } from "next/server";
import { CHALLENGE_COOKIE, Challenge, loginMessage, seal, SESSION_COOKIE, unseal, verifyWalletSignature } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const challenge = unseal<Challenge>(request.cookies.get(CHALLENGE_COOKIE)?.value);
  if (!challenge || challenge.expiresAt < Date.now() || challenge.domain !== request.nextUrl.host) {
    return NextResponse.json({ error: "登录请求已过期，请重试" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as { wallet?: string; signature?: string } | null;
  if (!body?.wallet || !body.signature) return NextResponse.json({ error: "登录参数不完整" }, { status: 400 });

  const message = loginMessage(challenge, body.wallet);
  let valid = false;
  try {
    valid = verifyWalletSignature(body.wallet, message, body.signature);
  } catch {
    valid = false;
  }
  if (!valid) return NextResponse.json({ error: "钱包签名验证失败" }, { status: 401 });

  const response = NextResponse.json({ wallet: body.wallet });
  response.cookies.set(SESSION_COOKIE, seal({ wallet: body.wallet, expiresAt: Date.now() + 24 * 60 * 60_000 }), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 24 * 60 * 60,
    path: "/",
  });
  response.cookies.delete(CHALLENGE_COOKIE);
  return response;
}
