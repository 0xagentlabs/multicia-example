import {
  PublicKey, SystemProgram, TransactionInstruction, type AccountMeta,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID,
} from "@solana/spl-token";

export const VAULT_PROGRAM_ID = new PublicKey(Uint8Array.from([
  86, 65, 85, 76, 84, 1, 9, 37, 72, 91, 15, 211, 44, 101, 8, 193,
  17, 64, 201, 87, 39, 222, 14, 111, 92, 10, 198, 71, 25, 166, 4, 218,
]));

export function vaultPda(authority: PublicKey, programId = VAULT_PROGRAM_ID) {
  return PublicKey.findProgramAddressSync([Buffer.from("vault"), authority.toBuffer()], programId);
}

export function vaultTokenAccount(
  authority: PublicKey, mint: PublicKey, tokenProgram = TOKEN_PROGRAM_ID,
) {
  return getAssociatedTokenAddressSync(mint, vaultPda(authority)[0], true, tokenProgram);
}

function ix(tag: number, keys: AccountMeta[], payload = Buffer.alloc(0), programId = VAULT_PROGRAM_ID) {
  return new TransactionInstruction({ programId, keys, data: Buffer.concat([Buffer.from([tag]), payload]) });
}

export function initializeVault(authority: PublicKey, agent: PublicKey, payer = authority) {
  const [state] = vaultPda(authority);
  return ix(0, [
    { pubkey: payer, isSigner: true, isWritable: true },
    { pubkey: authority, isSigner: true, isWritable: false },
    { pubkey: agent, isSigner: false, isWritable: false },
    { pubkey: state, isSigner: false, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ]);
}

export type TransferArgs = {
  authority: PublicKey; actor: PublicKey; mint: PublicKey; source: PublicKey;
  destination: PublicKey; amount: bigint; decimals: number; tokenProgram?: PublicKey;
};

function amountData(amount: bigint, decimals: number) {
  if (amount <= BigInt(0) || amount > (BigInt(2) ** BigInt(64) - BigInt(1)) || decimals < 0 || decimals > 255) throw new RangeError("invalid token amount or decimals");
  const b = Buffer.alloc(9); b.writeBigUInt64LE(amount); b[8] = decimals; return b;
}

export function deposit(args: TransferArgs) {
  const tokenProgram = args.tokenProgram ?? TOKEN_PROGRAM_ID;
  return ix(1, [
    { pubkey: args.actor, isSigner: true, isWritable: false },
    { pubkey: vaultPda(args.authority)[0], isSigner: false, isWritable: false },
    { pubkey: args.source, isSigner: false, isWritable: true },
    { pubkey: args.mint, isSigner: false, isWritable: false },
    { pubkey: args.destination, isSigner: false, isWritable: true },
    { pubkey: tokenProgram, isSigner: false, isWritable: false },
  ], amountData(args.amount, args.decimals));
}

export function withdraw(args: TransferArgs) {
  const tokenProgram = args.tokenProgram ?? TOKEN_PROGRAM_ID;
  return ix(2, [
    { pubkey: args.actor, isSigner: true, isWritable: false },
    { pubkey: vaultPda(args.authority)[0], isSigner: false, isWritable: false },
    { pubkey: args.source, isSigner: false, isWritable: true },
    { pubkey: args.mint, isSigner: false, isWritable: false },
    { pubkey: args.destination, isSigner: false, isWritable: true },
    { pubkey: tokenProgram, isSigner: false, isWritable: false },
  ], amountData(args.amount, args.decimals));
}

export function setAgent(authority: PublicKey, agent: PublicKey) {
  return ix(3, [
    { pubkey: authority, isSigner: true, isWritable: false },
    { pubkey: vaultPda(authority)[0], isSigner: false, isWritable: true },
  ], agent.toBuffer());
}

export function setPaused(authority: PublicKey, paused: boolean) {
  return ix(4, [
    { pubkey: authority, isSigner: true, isWritable: false },
    { pubkey: vaultPda(authority)[0], isSigner: false, isWritable: true },
  ], Buffer.from([paused ? 1 : 0]));
}

export function parseTokenProgram(value?: string) {
  if (!value || value === "spl-token") return TOKEN_PROGRAM_ID;
  if (value === "token-2022") return TOKEN_2022_PROGRAM_ID;
  throw new Error("tokenProgram must be spl-token or token-2022");
}
