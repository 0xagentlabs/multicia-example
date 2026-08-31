"use client";

import { getWallets as getStandardWallets } from "@wallet-standard/app";
import { useEffect, useMemo, useState } from "react";

type StandardAccount = { address: string; features: readonly string[] };
type StandardWallet = {
  name: string;
  icon: string;
  accounts: readonly StandardAccount[];
  features: Record<string, unknown> & {
    "standard:connect"?: { connect(): Promise<{ accounts: readonly StandardAccount[] }> };
    "standard:disconnect"?: { disconnect(): Promise<void> };
    "standard:events"?: {
      on(event: "change", listener: (changes: { accounts?: readonly StandardAccount[] }) => void): () => void;
    };
    "solana:signMessage"?: {
      signMessage(...inputs: { account: StandardAccount; message: Uint8Array }[]): Promise<readonly { signature: Uint8Array }[]>;
    };
  };
};

type WalletOption = {
  id: string;
  name: string;
  icon: string;
  wallet: StandardWallet | null;
  installUrl: string;
};

type Challenge = { nonce: string; domain: string; issuedAt: string };
type Access = { cluster: string; programId: string; memberships: { account: string; tenant: string; role: string; expiresAt: number | null }[] };

const toBase64 = (bytes: Uint8Array) => {
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary);
};

const compact = (address: string) => `${address.slice(0, 5)}…${address.slice(-5)}`;

const walletCatalog = [
  { id: "phantom", name: "Phantom", icon: "👻", installUrl: "https://phantom.com/download" },
  { id: "solflare", name: "Solflare", icon: "☀️", installUrl: "https://www.solflare.com/download" },
  { id: "backpack", name: "Backpack", icon: "🎒", installUrl: "https://backpack.app/downloads" },
  { id: "coinbase", name: "Coinbase Wallet", icon: "🔵", installUrl: "https://www.coinbase.com/wallet/downloads" },
  { id: "glow", name: "Glow", icon: "🌈", installUrl: "https://glow.app" },
] as const;

const supportsLogin = (wallet: StandardWallet) =>
  Boolean(wallet.features["standard:connect"] && wallet.features["solana:signMessage"]);

const listWallets = (): WalletOption[] => {
  const detected = (getStandardWallets().get() as readonly unknown[])
    .filter((wallet): wallet is StandardWallet => supportsLogin(wallet as StandardWallet));
  const used = new Set<StandardWallet>();
  const common = walletCatalog.map((entry) => {
    const wallet = detected.find((candidate) => candidate.name.toLowerCase().includes(entry.name.toLowerCase()));
    if (wallet) used.add(wallet);
    return { ...entry, wallet: wallet ?? null };
  });
  const additional = detected.filter((wallet) => !used.has(wallet)).map((wallet) => ({
    id: `standard:${wallet.name}`,
    name: wallet.name,
    icon: wallet.icon,
    wallet,
    installUrl: "https://solana.com/solana-wallets",
  }));
  return [...common, ...additional];
};

export default function Home() {
  const [wallets, setWallets] = useState<WalletOption[]>([]);
  const [selectedWallet, setSelectedWallet] = useState("phantom");
  const [address, setAddress] = useState("");
  const [authenticated, setAuthenticated] = useState(false);
  const [status, setStatus] = useState("连接钱包以继续");
  const [busy, setBusy] = useState(false);
  const [access, setAccess] = useState<Access | null>(null);

  useEffect(() => {
    const registry = getStandardWallets();
    const refreshWallets = () => setWallets(listWallets());
    refreshWallets();
    const offRegister = registry.on("register", refreshWallets);
    const offUnregister = registry.on("unregister", refreshWallets);
    fetch("/api/auth/session")
      .then(async (response) => response.ok ? response.json() as Promise<{ wallet: string }> : null)
      .then((session) => {
        if (session?.wallet) {
          setAddress(session.wallet);
          setAuthenticated(true);
          setStatus("已通过签名验证");
          void fetch("/api/controller/access").then((r) => r.ok ? r.json() : null).then(setAccess);
        }
      })
      .catch(() => undefined);
    return () => {
      offRegister();
      offUnregister();
    };
  }, []);

  const wallet = wallets.find(({ id }) => id === selectedWallet) ?? null;
  const standardWallet = wallet?.wallet ?? null;

  useEffect(() => {
    const accountChanged = ({ accounts }: { accounts?: readonly StandardAccount[] }) => {
      const next = accounts?.[0]?.address ?? "";
      setAddress(next);
      setAuthenticated(false);
      void fetch("/api/auth/session", { method: "DELETE" });
      setStatus(next ? "账户已切换，请重新签名" : "钱包已断开");
    };
    return standardWallet?.features["standard:events"]?.on("change", accountChanged);
  }, [standardWallet]);

  const avatar = useMemo(() => address.slice(0, 2).toUpperCase() || "◎", [address]);

  async function login() {
    if (!standardWallet) {
      window.open(wallet?.installUrl ?? "https://solana.com/wallets", "_blank", "noopener,noreferrer");
      setStatus(`请先安装 ${wallet?.name ?? "Solana 钱包"}`);
      return;
    }
    setBusy(true);
    try {
      const connect = standardWallet.features["standard:connect"];
      const signMessage = standardWallet.features["solana:signMessage"];
      if (!connect || !signMessage) throw new Error("该钱包不支持消息签名登录");
      const connection = await connect.connect();
      const account = connection.accounts[0] ?? standardWallet.accounts[0];
      if (!account) throw new Error("钱包未返回可用账户");
      const walletAddress = account.address;
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
      const [{ signature }] = await signMessage.signMessage({ account, message: new TextEncoder().encode(statement) });
      const verification = await fetch("/api/auth/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ wallet: walletAddress, signature: toBase64(signature) }),
      });
      const result = await verification.json() as { error?: string };
      if (!verification.ok) throw new Error(result.error ?? "钱包签名验证失败");
      setAuthenticated(true);
      setStatus("已通过签名验证");
      const accessResponse = await fetch("/api/controller/access", { cache: "no-store" });
      if (accessResponse.ok) setAccess(await accessResponse.json() as Access);
    } catch (error) {
      const message = error instanceof Error ? error.message : "操作已取消";
      setStatus(message.includes("User rejected") ? "你取消了钱包操作" : message);
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    await Promise.all([
      standardWallet?.features["standard:disconnect"]?.disconnect().catch(() => undefined),
      fetch("/api/auth/session", { method: "DELETE" }).catch(() => undefined),
    ]);
    setAddress("");
    setAuthenticated(false);
    setAccess(null);
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
              <section className="accessPanel" aria-labelledby="access-title">
                <div className="accessHeading"><span id="access-title">链上权限</span><small>DEVNET</small></div>
                {access?.memberships.length ? access.memberships.map((member) => (
                  <div className="membership" key={member.account}>
                    <span><strong>{member.role}</strong><small>租户 {compact(member.tenant)}</small></span>
                    <i className="verified">已验证</i>
                  </div>
                )) : <p className="emptyAccess">该钱包暂无链上租户权限</p>}
                <a className="programLink" href={`https://explorer.solana.com/address/${access?.programId ?? "HzZSNAsacNF61tfNDa8sr9PS8fVzfxfunh7A6yVRmaFp"}?cluster=devnet`} target="_blank" rel="noreferrer">查看控制器程序</a>
              </section>
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
                      setStatus(option.wallet ? `已选择 ${option.name}` : `${option.name} 尚未安装`);
                    }}
                    type="button"
                  >
                    <span>{option.icon.startsWith("data:") ? <i className="walletLogo" style={{ backgroundImage: `url(${option.icon})` }} /> : option.icon} {option.name}</span>
                    <small>{option.wallet ? "已检测" : "未安装"}</small>
                  </button>
                ))}
              </div>
              <button className="primary" onClick={login} disabled={busy}>{busy ? "正在连接…" : standardWallet ? `使用 ${wallet?.name} 连接并签名` : `安装 ${wallet?.name ?? "钱包"}`}<span>→</span></button>
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
