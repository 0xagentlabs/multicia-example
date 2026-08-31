"use client";

import { useEffect, useMemo, useState } from "react";

type PublicKey = { toString(): string };
type SignatureResult = { signature: Uint8Array };
type SolanaProvider = {
  isPhantom?: boolean;
  isBackpack?: boolean;
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
    backpack?: SolanaProvider | { solana?: SolanaProvider };
  }
}

type WalletOption = {
  id: "phantom" | "backpack";
  name: string;
  provider: SolanaProvider | null;
  installUrl: string;
};

type Challenge = { nonce: string; domain: string; issuedAt: string };

const toBase64 = (bytes: Uint8Array) => {
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary);
};

const compact = (address: string) => `${address.slice(0, 5)}…${address.slice(-5)}`;

const getWallets = (): WalletOption[] => {
  const injected = window.solana;
  const backpack = window.backpack;
  const backpackProvider = backpack && "solana" in backpack ? backpack.solana : backpack;

  return [
    {
      id: "phantom",
      name: "Phantom",
      provider: window.phantom?.solana ?? (injected?.isPhantom ? injected : null),
      installUrl: "https://phantom.app/",
    },
    {
      id: "backpack",
      name: "Backpack",
      provider: backpackProvider ?? (injected?.isBackpack ? injected : null),
      installUrl: "https://backpack.app/downloads/",
    },
  ];
};

export default function Home() {
  const [wallets, setWallets] = useState<WalletOption[]>([]);
  const [selectedWallet, setSelectedWallet] = useState<WalletOption["id"]>("phantom");
  const [address, setAddress] = useState("");
  const [authenticated, setAuthenticated] = useState(false);
  const [status, setStatus] = useState("连接钱包以继续");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setWallets(getWallets());
    fetch("/api/auth/session")
      .then(async (response) => response.ok ? response.json() as Promise<{ wallet: string }> : null)
      .then((session) => {
        if (session?.wallet) {
          setAddress(session.wallet);
          setAuthenticated(true);
          setStatus("已通过签名验证");
        }
      })
      .catch(() => undefined);
  }, []);

  const wallet = wallets.find(({ id }) => id === selectedWallet) ?? null;
  const provider = wallet?.provider ?? null;

  useEffect(() => {
    const accountChanged = (key: PublicKey | null) => {
      const next = key?.toString() ?? "";
      setAddress(next);
      setAuthenticated(false);
      void fetch("/api/auth/session", { method: "DELETE" });
      setStatus(next ? "账户已切换，请重新签名" : "钱包已断开");
    };
    provider?.on?.("accountChanged", accountChanged);
    return () => provider?.removeListener?.("accountChanged", accountChanged);
  }, [provider]);

  const avatar = useMemo(() => address.slice(0, 2).toUpperCase() || "◎", [address]);

  async function login() {
    if (!provider) {
      window.open(wallet?.installUrl ?? "https://solana.com/wallets", "_blank", "noopener,noreferrer");
      setStatus(`请先安装 ${wallet?.name ?? "Solana 钱包"}`);
      return;
    }
    setBusy(true);
    try {
      const connection = await provider.connect();
      const walletAddress = connection.publicKey.toString();
      setAddress(walletAddress);
      setStatus("等待钱包签名…");
      const challengeResponse = await fetch("/api/auth/challenge", { cache: "no-store" });
      if (!challengeResponse.ok) throw new Error("无法创建登录请求");
      const challenge = await challengeResponse.json() as Challenge;
      const statement = [
        "登录 Solana Portal",
        "",
        `Wallet: ${walletAddress}`,
        `Domain: ${challenge.domain}`,
        `Nonce: ${challenge.nonce}`,
        `Issued At: ${challenge.issuedAt}`,
        "",
        "此签名不会发起交易或产生费用。",
      ].join("\n");
      const { signature } = await provider.signMessage(new TextEncoder().encode(statement), "utf8");
      const verification = await fetch("/api/auth/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ wallet: walletAddress, signature: toBase64(signature) }),
      });
      const result = await verification.json() as { error?: string };
      if (!verification.ok) throw new Error(result.error ?? "钱包签名验证失败");
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
    await Promise.all([
      provider?.disconnect().catch(() => undefined),
      fetch("/api/auth/session", { method: "DELETE" }).catch(() => undefined),
    ]);
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
              <div className="walletChoices" aria-label="选择钱包">
                {wallets.map((option) => (
                  <button
                    className={option.id === selectedWallet ? "walletChoice active" : "walletChoice"}
                    key={option.id}
                    onClick={() => {
                      setSelectedWallet(option.id);
                      setStatus(option.provider ? `已选择 ${option.name}` : `${option.name} 尚未安装`);
                    }}
                    type="button"
                  >
                    <span>{option.id === "phantom" ? "👻" : "🎒"} {option.name}</span>
                    <small>{option.provider ? "已检测" : "未安装"}</small>
                  </button>
                ))}
              </div>
              <button className="primary" onClick={login} disabled={busy}>{busy ? "正在连接…" : provider ? `使用 ${wallet?.name} 连接并签名` : `安装 ${wallet?.name ?? "钱包"}`}<span>→</span></button>
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
