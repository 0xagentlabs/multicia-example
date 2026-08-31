import { createHmac, timingSafeEqual, verify } from "node:crypto";

export const CHALLENGE_COOKIE = "solana_challenge";
export const SESSION_COOKIE = "solana_session";

type Challenge = { nonce: string; domain: string; issuedAt: string; expiresAt: number };
type Session = { wallet: string; expiresAt: number };

const secret = () => {
  if (process.env.SOLANA_AUTH_SECRET && process.env.SOLANA_AUTH_SECRET.length >= 32) return process.env.SOLANA_AUTH_SECRET;
  if (process.env.NODE_ENV === "production") throw new Error("SOLANA_AUTH_SECRET is required in production");
  return "local-development-secret-change-me";
};
const encode = (value: string) => Buffer.from(value).toString("base64url");
const decode = (value: string) => Buffer.from(value, "base64url").toString();
const mac = (value: string) => createHmac("sha256", secret()).update(value).digest("base64url");

export function seal(value: Challenge | Session) {
  const payload = encode(JSON.stringify(value));
  return `${payload}.${mac(payload)}`;
}

export function unseal<T>(token?: string): T | null {
  if (!token) return null;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;
  const expected = Buffer.from(mac(payload));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  try {
    return JSON.parse(decode(payload)) as T;
  } catch {
    return null;
  }
}

export function loginMessage(challenge: Challenge, wallet: string) {
  return [
    "登录 Solana Portal",
    "",
    `Wallet: ${wallet}`,
    `Domain: ${challenge.domain}`,
    `Nonce: ${challenge.nonce}`,
    `Issued At: ${challenge.issuedAt}`,
    "",
    "此签名不会发起交易或产生费用。",
  ].join("\n");
}

export function decodeBase58(value: string) {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let bytes = [0];
  for (const character of value) {
    const digit = alphabet.indexOf(character);
    if (digit < 0) throw new Error("Invalid base58 value");
    let carry = digit;
    for (let index = 0; index < bytes.length; index += 1) {
      carry += bytes[index] * 58;
      bytes[index] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  for (let index = 0; value[index] === "1" && index < value.length - 1; index += 1) bytes.push(0);
  return Buffer.from(bytes.reverse());
}

export function verifyWalletSignature(wallet: string, message: string, signature: string) {
  const publicKey = decodeBase58(wallet);
  if (publicKey.length !== 32) return false;
  const spkiPrefix = Buffer.from("302a300506032b6570032100", "hex");
  return verify(null, Buffer.from(message), { key: Buffer.concat([spkiPrefix, publicKey]), format: "der", type: "spki" }, Buffer.from(signature, "base64"));
}

export type { Challenge, Session };
