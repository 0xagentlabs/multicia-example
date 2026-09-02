import { Connection, PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";

export const PROGRAM_ID = new PublicKey(process.env.NEXT_PUBLIC_COUNTER_PROGRAM_ID ?? "cnnYUKJ22WztyAumbtrdmrQTW49jPtpWQA6dFnTTa13");
export const RPC_URL = process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? "https://api.devnet.solana.com";
export const OPERATION_FEE_LAMPORTS = 1_000_000;
export const COUNTER_ACCOUNT_SIZE = 43;
export const CONFIG_ACCOUNT_SIZE = 35;
export const VAULT_ACCOUNT_SIZE = 2;

export type CounterState = { value: bigint; authority: PublicKey };
export type ProgramState = { owner: PublicKey | null; vaultBalance: number; availableFees: number };

export function counterAddress(authority: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("counter"), authority.toBuffer()], PROGRAM_ID)[0];
}
export function configAddress(): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("config")], PROGRAM_ID)[0];
}
export function vaultAddress(): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("vault")], PROGRAM_ID)[0];
}

export function counterInstruction(tag: 0 | 1 | 2, authority: PublicKey): TransactionInstruction {
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: authority, isSigner: true, isWritable: true },
      { pubkey: counterAddress(authority), isSigner: false, isWritable: true },
      { pubkey: vaultAddress(), isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.from([tag]),
  });
}

export function setOwnerInstruction(candidate: PublicKey): TransactionInstruction {
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: candidate, isSigner: true, isWritable: true },
      { pubkey: configAddress(), isSigner: false, isWritable: true },
      { pubkey: vaultAddress(), isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.from([3]),
  });
}

export function withdrawInstruction(owner: PublicKey, amount = 0n, destination = owner): TransactionInstruction {
  const data = Buffer.alloc(9);
  data[0] = 4;
  data.writeBigUInt64LE(amount, 1);
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: owner, isSigner: true, isWritable: true },
      { pubkey: configAddress(), isSigner: false, isWritable: false },
      { pubkey: vaultAddress(), isSigner: false, isWritable: true },
      { pubkey: destination, isSigner: false, isWritable: true },
    ],
    data,
  });
}

export async function readCounter(connection: Connection, authority: PublicKey): Promise<CounterState | null> {
  const account = await connection.getAccountInfo(counterAddress(authority), "confirmed");
  if (!account) return null;
  if (!account.owner.equals(PROGRAM_ID) || account.data.length !== COUNTER_ACCOUNT_SIZE) throw new Error("计数器账户的所有者或数据长度无效");
  if (account.data[0] !== 1 || account.data[1] !== 1) throw new Error("计数器账户版本无效");
  const storedAuthority = new PublicKey(account.data.subarray(10, 42));
  if (!storedAuthority.equals(authority)) throw new Error("计数器权限校验失败");
  return { value: account.data.readBigInt64LE(2), authority: storedAuthority };
}

export async function readProgramState(connection: Connection): Promise<ProgramState> {
  const [config, vault, vaultReserve] = await Promise.all([
    connection.getAccountInfo(configAddress(), "confirmed"),
    connection.getAccountInfo(vaultAddress(), "confirmed"),
    connection.getMinimumBalanceForRentExemption(VAULT_ACCOUNT_SIZE, "confirmed"),
  ]);
  if (!config && !vault) return { owner: null, vaultBalance: 0, availableFees: 0 };
  if (!config || !vault || !config.owner.equals(PROGRAM_ID) || !vault.owner.equals(PROGRAM_ID)) throw new Error("合约配置不完整或账户 owner 无效");
  if (config.data.length !== CONFIG_ACCOUNT_SIZE || config.data[0] !== 2 || config.data[1] !== 1) throw new Error("Owner 配置账户无效");
  if (vault.data.length !== VAULT_ACCOUNT_SIZE || vault.data[0] !== 3) throw new Error("金库账户无效");
  return { owner: new PublicKey(config.data.subarray(2, 34)), vaultBalance: vault.lamports, availableFees: Math.max(0, vault.lamports - vaultReserve) };
}
