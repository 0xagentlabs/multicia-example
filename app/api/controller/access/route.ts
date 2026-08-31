import { NextRequest, NextResponse } from "next/server";
import { Session, SESSION_COOKIE, unseal } from "@/lib/auth";

const PROGRAM_ID = process.env.NEXT_PUBLIC_SAAS_PROGRAM_ID ?? "HzZSNAsacNF61tfNDa8sr9PS8fVzfxfunh7A6yVRmaFp";
const RPC_URL = process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com";
const roles = ["Viewer", "Editor", "Admin", "Owner"] as const;

const base58 = (bytes: Uint8Array) => {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  const digits = [0];
  for (let byteIndex = 0; byteIndex < bytes.length; byteIndex += 1) {
    const byte = bytes[byteIndex];
    let carry = byte;
    for (let i = 0; i < digits.length; i += 1) { carry += digits[i] << 8; digits[i] = carry % 58; carry = Math.floor(carry / 58); }
    while (carry) { digits.push(carry % 58); carry = Math.floor(carry / 58); }
  }
  for (let i = 0; i < bytes.length - 1 && bytes[i] === 0; i += 1) digits.push(0);
  return digits.reverse().map((digit) => alphabet[digit]).join("");
};

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const session = unseal<Session>(request.cookies.get(SESSION_COOKIE)?.value);
  if (!session || session.expiresAt < Date.now()) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const rpc = await fetch(RPC_URL, {
    method: "POST", headers: { "content-type": "application/json" }, cache: "no-store",
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getProgramAccounts", params: [PROGRAM_ID, { encoding: "base64", filters: [{ dataSize: 76 }, { memcmp: { offset: 34, bytes: session.wallet } }] }] }),
  });
  if (!rpc.ok) return NextResponse.json({ error: "devnet unavailable" }, { status: 503 });
  const payload = await rpc.json() as { result?: { pubkey: string; account: { owner: string; data: [string, string] } }[]; error?: unknown };
  if (!payload.result) return NextResponse.json({ error: "invalid rpc response" }, { status: 502 });
  const memberships = payload.result.flatMap(({ pubkey, account }) => {
    const data = Buffer.from(account.data[0], "base64");
    if (account.owner !== PROGRAM_ID || data.length !== 76 || data[0] !== 2 || data[1] !== 1 || data[74] > 3) return [];
    const expiresAt = Number(data.readBigInt64LE(66));
    return [{ account: pubkey, tenant: base58(data.subarray(2, 34)), role: roles[data[74]], expiresAt: expiresAt || null }];
  });
  return NextResponse.json({ cluster: "devnet", programId: PROGRAM_ID, wallet: session.wallet, memberships });
}
