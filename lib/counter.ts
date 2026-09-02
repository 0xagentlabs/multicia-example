import {
  Connection,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from "@solana/web3.js";

export const PROGRAM_ID = new PublicKey(
  process.env.NEXT_PUBLIC_COUNTER_PROGRAM_ID ?? "J9bueeoxMZ6davR8FcWeFEbQk9AEsLVk2wp2jvi2x3md",
);
export const RPC_URL = process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? "https://api.devnet.solana.com";
export const OPERATION_FEE_LAMPORTS = 1_000_000;
export const COUNTER_ACCOUNT_SIZE = 75;

export type CounterState = {
  value: bigint;
  authority: PublicKey;
  beneficiary: PublicKey;
};

export function counterAddress(authority: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("counter"), authority.toBuffer()],
    PROGRAM_ID,
  )[0];
}

export function counterInstruction(
  tag: 0 | 1 | 2,
  authority: PublicKey,
  beneficiary: PublicKey,
): TransactionInstruction {
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: authority, isSigner: true, isWritable: true },
      { pubkey: counterAddress(authority), isSigner: false, isWritable: true },
      { pubkey: beneficiary, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.from([tag]),
  });
}

export async function readCounter(
  connection: Connection,
  authority: PublicKey,
): Promise<CounterState | null> {
  const account = await connection.getAccountInfo(counterAddress(authority), "confirmed");
  if (!account) return null;
  if (!account.owner.equals(PROGRAM_ID) || account.data.length !== COUNTER_ACCOUNT_SIZE) {
    throw new Error("计数器账户的所有者或数据长度无效");
  }
  if (account.data[0] !== 1 || account.data[1] !== 1) {
    throw new Error("计数器账户版本无效");
  }
  const storedAuthority = new PublicKey(account.data.subarray(10, 42));
  if (!storedAuthority.equals(authority)) throw new Error("计数器权限校验失败");
  return {
    value: account.data.readBigInt64LE(2),
    authority: storedAuthority,
    beneficiary: new PublicKey(account.data.subarray(42, 74)),
  };
}
