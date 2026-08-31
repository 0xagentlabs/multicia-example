"use client";

import { useEffect, useMemo, useState } from "react";

type PublicKey = { toString(): string };
type SignatureResult = { signature: Uint8Array };
type SolanaProvider = {
  isConnected?: boolean;
  publicKey?: PublicKey | null;
  connect(): Promise<{ publicKey: PublicKey }>;
  disconnect(): Promise<void>;
  signMessage(message: Uint8Array, display?: "utf8"): Promise<SignatureResult>;
  on?(event: "accountChanged", handler: (key: PublicKey | null) => void): void;
  removeListener?(event: "accountChanged", handler: (key: PublicKey | null) => void): void;
};

declare global {
  interface Window {
    solana?: SolanaProvider;
    phantom?: { solana?: SolanaProvider };
  }
}

const compact = (address: string) => `${address.slice(0, 5)}…${address.slice(-5)}`;

export default function Home() {
  const [provider, setProvider] = useState<SolanaProvider | null>(null);
  const [address, setAddress] = useState("");
  const [authenticated, setAuthenticated] = useState(false);
  const [status, setStatus] = useState("连接钱包以继续");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const wallet = window.phantom?.solana ?? window.solana ?? null;
    setProvider(wallet);
    const saved = sessionStorage.getItem("solana-login-address");
    if (saved) {
      setAddress(saved);
      setAuthenticated(true);
      setStatus("已通过签名验证");
    }

    const accountChanged = (key: PublicKey | null) => {
      const next = key?.toString() ?? "";
      setAddress(next);
      setAuthenticated(false);
      sessionStorage.removeItem("solana-login-address");
      setStatus(next ? "账户已切换，请重新签名" : "钱包已断开");
    };
    wallet?.on?.("accountChanged", accountChanged);
    return () => wallet?.removeListener?.("accountChanged", accountChanged);
  }, []);

  const avatar = useMemo(() => address.slice(0, 2).toUpperCase() || "◎", [address]);

  async function login() {
    if (!provider) {
      window.open("https://phantom.app/", "_blank", "noopener,noreferrer");
      setStatus("请先安装兼容的 Solana 钱包");
      return;
    }
    setBusy(true);
    try {
      const connection = await provider.connect();
      const walletAddress = connection.publicKey.toString();
      setAddress(walletAddress);
      setStatus("等待钱包签名…");
      const statement = [
        "登录 Solana Portal",
        "",
        `Wallet: ${walletAddress}`,
        `Domain: ${window.location.host}`,
        `Issued At: ${new Date().toISOString()}`,
        "",
        "此签名不会发起交易或产生费用。",
      ].join("\n");
      await provider.signMessage(new TextEncoder().encode(statement), "utf8");
      sessionStorage.setItem("solana-login-address", walletAddress);
      setAuthenticated(true);
      setStatus("已通过签名验证");
    } catch (error) {
      const message = error instanceof Error ? error.message : "操作已取消";
      setStatus(message.includes("User rejected") ? "你取消了钱包操作" : message);
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    await provider?.disconnect().catch(() => undefined);
    sessionStorage.removeItem("solana-login-address");
    setAddress("");
    setAuthenticated(false);
    setStatus("已安全退出");
  }

  return (
    <main>
      <nav>
        <a className="brand" href="#" aria-label="Solana Portal 首页">
          <span className="brandMark">S</span>
          <span>Solana Portal</span>
        </a>
        <span className="network"><i /> Mainnet</span>
      </nav>

      <section className="hero">
        <div className="eyebrow"><span>✦</span> WEB3 ACCESS</div>
        <h1>你的钱包，<br /><em>就是通行证。</em></h1>
        <p className="lede">连接 Solana 钱包，通过一次安全签名进入你的链上世界。无需密码，不会产生任何交易费用。</p>

        <div className="card">
          <div className="glow" />
          {authenticated ? (
            <>
              <div className="walletAvatar">{avatar}</div>
              <div className="success">✓ 身份已验证</div>
              <h2>欢迎回来</h2>
              <div className="address">{compact(address)} <button onClick={() => navigator.clipboard.writeText(address)} aria-label="复制钱包地址">⧉</button></div>
              <button className="primary" onClick={logout}>断开连接</button>
            </>
          ) : (
            <>
              <div className="walletIcon">⌁</div>
              <h2>连接你的钱包</h2>
              <p>我们将请求一条消息签名来验证所有权。</p>
              <button className="primary" onClick={login} disabled={busy}>{busy ? "正在连接…" : provider ? "连接并签名" : "安装 Phantom 钱包"}<span>→</span></button>
              <div className="status" aria-live="polite"><i /> {status}</div>
            </>
          )}
        </div>

        <div className="trust">
          <span>◇ 无 Gas 费用</span><span>◈ 不发起交易</span><span>⌁ 本地会话</span>
        </div>
      </section>
      <footer>Built on <strong>Solana</strong><span>Secure · Fast · Decentralized</span></footer>
    </main>
  );
}
