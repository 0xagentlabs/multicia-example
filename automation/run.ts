import { readFile } from "node:fs/promises";
import { Connection, PublicKey, Transaction, type Signer } from "@solana/web3.js";
import { deposit, parseTokenProgram, vaultTokenAccount, withdraw } from "../sdk/vault";

export type Order = {
  id: string; enabled: boolean; direction: "deposit" | "withdraw"; mint: string;
  source?: string; destination?: string; amount: string; maxAmount: string;
  decimals: number; tokenProgram?: "spl-token" | "token-2022";
};
export type Policy = { rpcUrl: string; authority: string; agent: string; orders: Order[] };

export async function executePolicy(policy: Policy, signer: Signer, dryRun = true) {
  if (signer.publicKey.toBase58() !== policy.agent) throw new Error("signer does not match policy agent");
  const connection = new Connection(policy.rpcUrl, "confirmed");
  const authority = new PublicKey(policy.authority);
  const signatures: string[] = [];
  for (const order of policy.orders.filter((item) => item.enabled)) {
    const amount = BigInt(order.amount), max = BigInt(order.maxAmount);
    if (amount <= BigInt(0) || max <= BigInt(0) || amount > max) throw new Error(`${order.id}: policy amount limit exceeded`);
    const mint = new PublicKey(order.mint), tokenProgram = parseTokenProgram(order.tokenProgram);
    const vaultAccount = vaultTokenAccount(authority, mint, tokenProgram);
    const common = { authority, actor: signer.publicKey, mint, amount, decimals: order.decimals, tokenProgram };
    const instruction = order.direction === "withdraw"
      ? withdraw({ ...common, source: vaultAccount, destination: new PublicKey(order.destination!) })
      : deposit({ ...common, source: new PublicKey(order.source!), destination: vaultAccount });
    const tx = new Transaction().add(instruction);
    tx.feePayer = signer.publicKey;
    tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
    tx.sign(signer);
    if (dryRun) await connection.simulateTransaction(tx);
    else signatures.push(await connection.sendRawTransaction(tx.serialize()));
  }
  return signatures;
}

async function main() {
  const path = process.argv[2] ?? "automation/policy.json";
  const policy = JSON.parse(await readFile(path, "utf8")) as Policy;
  console.log(`Loaded ${policy.orders.length} orders. Import executePolicy() and inject a Signer from your agent/key manager.`);
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((error) => { console.error(error); process.exitCode = 1; });
