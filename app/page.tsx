"use client";

import { getWallets as getStandardWallets } from "@wallet-standard/app";
import { Connection, PublicKey, Transaction } from "@solana/web3.js";
import { useCallback, useEffect, useMemo, useState } from "react";
import { counterAddress, counterInstruction, OPERATION_FEE_LAMPORTS, PROGRAM_ID, readCounter, RPC_URL } from "../lib/counter";

type StandardAccount = { address: string; features: readonly string[] };
type StandardWallet = {
  name: string; icon: string; accounts: readonly StandardAccount[];
  features: Record<string, unknown> & {
    "standard:connect"?: { connect(): Promise<{ accounts: readonly StandardAccount[] }> };
    "standard:disconnect"?: { disconnect(): Promise<void> };
    "standard:events"?: { on(event: "change", listener: (changes: { accounts?: readonly StandardAccount[] }) => void): () => void };
    "solana:signAndSendTransaction"?: { signAndSendTransaction(...inputs: { account: StandardAccount; chain: "solana:devnet"; transaction: Uint8Array; options?: { preflightCommitment?: "confirmed" } }[]): Promise<readonly { signature: Uint8Array }[]> };
  };
};

const connection = new Connection(RPC_URL, "confirmed");
const configuredBeneficiary = process.env.NEXT_PUBLIC_COUNTER_BENEFICIARY ?? "";
const shorten = (value: string) => `${value.slice(0, 4)}…${value.slice(-4)}`;

function toBase58(bytes: Uint8Array) {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  const digits = [0];
  for (const byte of bytes) {
    let carry = byte;
    for (let i = 0; i < digits.length; i++) {
      carry += digits[i] << 8; digits[i] = carry % 58; carry = Math.floor(carry / 58);
    }
    while (carry) { digits.push(carry % 58); carry = Math.floor(carry / 58); }
  }
  for (const byte of bytes) { if (byte === 0) digits.push(0); else break; }
  return digits.reverse().map((digit) => alphabet[digit]).join("");
}

function WalletIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 6.8A2.8 2.8 0 0 1 6.8 4H18a2 2 0 0 1 2 2v2H7.5a3.5 3.5 0 1 0 0 7H20v2a2 2 0 0 1-2 2H6.8A2.8 2.8 0 0 1 4 16.2V6.8Zm3.5 3.2H21v3H7.5a1.5 1.5 0 1 1 0-3Zm9.5 1v1h2v-1h-2Z" /></svg>;
}
function ArrowIcon({ direction }: { direction: "up" | "down" }) {
  return <svg aria-hidden="true" viewBox="0 0 24 24"><path d={direction === "up" ? "m7 14 5-5 5 5" : "m7 10 5 5 5-5"} /></svg>;
}

export default function Home() {
  const [wallet, setWallet] = useState<StandardWallet | null>(null);
  const [account, setAccount] = useState<StandardAccount | null>(null);
  const [value, setValue] = useState<bigint | null>(null);
  const [beneficiary, setBeneficiary] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("连接钱包后读取你的链上计数器");
  const [signature, setSignature] = useState("");

  const refresh = useCallback(async (address: string) => {
    const authority = new PublicKey(address);
    const state = await readCounter(connection, authority);
    setValue(state?.value ?? null);
    setBeneficiary(state?.beneficiary.toBase58() ?? configuredBeneficiary);
    setStatus(state ? "计数器已同步至 confirmed 状态" : "尚未初始化，首次操作将创建计数器");
  }, []);

  useEffect(() => { if (account) void refresh(account.address).catch((error: unknown) => setStatus(error instanceof Error ? error.message : "读取计数器失败")); }, [account, refresh]);
  useEffect(() => wallet?.features["standard:events"]?.on("change", ({ accounts }) => {
    const next = accounts?.[0] ?? null; setAccount(next); setValue(null); setSignature("");
    setStatus(next ? "钱包账户已切换，正在读取…" : "钱包已断开");
  }), [wallet]);

  const displayValue = useMemo(() => value?.toLocaleString("zh-CN") ?? "—", [value]);

  async function connect() {
    setBusy(true); setSignature("");
    try {
      const candidates = (getStandardWallets().get() as readonly unknown[]).filter((item): item is StandardWallet => Boolean((item as StandardWallet).features["standard:connect"]));
      const selected = candidates.find((item) => item.features["solana:signAndSendTransaction"]);
      if (!selected) throw new Error("未检测到支持 Solana 交易的钱包，请安装 Phantom、Solflare 或 Backpack");
      const result = await selected.features["standard:connect"]!.connect();
      const selectedAccount = result.accounts[0] ?? selected.accounts[0];
      if (!selectedAccount) throw new Error("钱包未返回可用账户");
      setWallet(selected); setAccount(selectedAccount); setStatus(`已连接 ${selected.name}`);
    } catch (error) { setStatus(error instanceof Error ? error.message : "连接已取消"); }
    finally { setBusy(false); }
  }

  async function disconnect() {
    await wallet?.features["standard:disconnect"]?.disconnect().catch(() => undefined);
    setWallet(null); setAccount(null); setValue(null); setSignature(""); setStatus("钱包已安全断开");
  }

  async function operate(tag: 1 | 2) {
    if (!wallet || !account) return;
    const sender = wallet.features["solana:signAndSendTransaction"];
    if (!sender) return setStatus("当前钱包不支持发送 Solana 交易");
    if (!beneficiary) return setStatus("部署者尚未配置收费地址，交易已阻止");
    setBusy(true); setSignature("");
    try {
      const authority = new PublicKey(account.address);
      const recipient = new PublicKey(beneficiary);
      const instructionTag: 0 | 1 | 2 = value === null ? 0 : tag;
      const transaction = new Transaction().add(counterInstruction(instructionTag, authority, recipient));
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
      transaction.feePayer = authority; transaction.recentBlockhash = blockhash;
      setStatus("正在模拟交易，不会签名或扣费…");
      const simulation = await connection.simulateTransaction(transaction);
      if (simulation.value.err) throw new Error(`模拟失败：${JSON.stringify(simulation.value.err)}`);
      setStatus(`模拟通过。请在钱包确认${instructionTag === 0 ? "初始化" : tag === 1 ? "递增" : "递减"}，固定费用 0.001 SOL`);
      const [{ signature: signatureBytes }] = await sender.signAndSendTransaction({ account, chain: "solana:devnet", transaction: transaction.serialize({ requireAllSignatures: false, verifySignatures: false }), options: { preflightCommitment: "confirmed" } });
      const txid = toBase58(signatureBytes);
      await connection.confirmTransaction({ signature: txid, blockhash, lastValidBlockHeight }, "confirmed");
      setSignature(txid); await refresh(account.address); setStatus("操作已确认，0.001 SOL 已支付");
    } catch (error) {
      const message = error instanceof Error ? error.message : "交易失败";
      setStatus(message.toLowerCase().includes("rejected") ? "你取消了钱包确认，未产生链上操作" : message);
    } finally { setBusy(false); }
  }

  return <main id="main-content">
    <header><a className="brand" href="#main-content" aria-label="Paid Counter 首页"><span aria-hidden="true">PC</span> Paid Counter</a><div className="network"><i aria-hidden="true" />Solana Devnet</div></header>
    <section className="intro" aria-labelledby="page-title"><p className="kicker">ON-CHAIN · TRANSPARENT FEE</p><h1 id="page-title">每一次点击，<br /><em>都真实上链。</em></h1><p className="lede">一个极简的 Solana 计数器。递增、递减或首次初始化，每次操作固定支付 <strong>0.001 SOL</strong>，费用在签名前清晰展示。</p></section>
    <section className="counterCard" aria-label="链上计数器">
      <div className="cardTop"><span>你的计数</span><span className="live"><i aria-hidden="true" />CONFIRMED</span></div>
      <output className="count" aria-live="polite" aria-label={`当前计数 ${displayValue}`}>{displayValue}</output>
      {account ? <><div className="actions"><button className="secondary" onClick={() => operate(2)} disabled={busy || value === null} aria-label="计数减一，费用 0.001 SOL"><ArrowIcon direction="down" />减一</button><button className="primary" onClick={() => operate(1)} disabled={busy} aria-label={`${value === null ? "初始化计数器" : "计数加一"}，费用 0.001 SOL`}><ArrowIcon direction="up" />{value === null ? "初始化" : "加一"}</button></div><button className="walletButton" onClick={disconnect}><WalletIcon />{wallet?.name} · {shorten(account.address)}<span>断开</span></button></> : <button className="primary connect" onClick={connect} disabled={busy}><WalletIcon />{busy ? "正在连接…" : "连接钱包"}</button>}
      <div className="status" role="status" aria-live="polite"><span aria-hidden="true">{busy ? "···" : "i"}</span>{status}</div>
      {signature && <a className="txLink" href={`https://explorer.solana.com/tx/${signature}?cluster=devnet`} target="_blank" rel="noreferrer">在 Explorer 查看交易 ↗</a>}
    </section>
    <section className="details" aria-label="交易详情"><div><span>固定操作费</span><strong>0.001 SOL</strong><small>{OPERATION_FEE_LAMPORTS.toLocaleString()} lamports</small></div><div><span>计数器账户</span><strong>{account ? shorten(counterAddress(new PublicKey(account.address)).toBase58()) : "连接后生成"}</strong><small>Authority-scoped PDA</small></div><div><span>程序</span><strong>{shorten(PROGRAM_ID.toBase58())}</strong><small>Solana Devnet</small></div></section>
    <footer>费用不含 Solana 网络交易费 · 所有交易提交前均先模拟</footer>
  </main>;
}
