import { NextRequest, NextResponse } from "next/server";
import { Session, SESSION_COOKIE, unseal } from "@/lib/auth";

export async function GET(request: NextRequest) {
  const session = unseal<Session>(request.cookies.get(SESSION_COOKIE)?.value);
  if (!session || session.expiresAt < Date.now()) return NextResponse.json({ wallet: null }, { status: 401 });
  return NextResponse.json({ wallet: session.wallet });
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.delete(SESSION_COOKIE);
  return response;
}
