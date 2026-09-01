# Solana SaaS Control Plane

Pinocchio 0.11 链上 SaaS 控制器与 Next.js 钱包控制台。身份来源是 Wallet Standard 钱包，成员角色、资源最低角色与数据哈希均存储在 Solana PDA，不使用中心化数据库。

## 链上控制器

程序位于 `programs/saas-controller`，提供 `initialize_tenant`、`upsert_member`、`upsert_resource`、`set_paused` 和 `assert_access`。账户采用 1 字节类型标识 + 1 字节版本号，所有写入均验证 signer、owner、PDA、账户长度和租户权限。

```bash
cargo test
NO_DNA=1 cargo build-sbf --manifest-path programs/saas-controller/Cargo.toml
```

devnet 程序地址为 `HzZSNAsacNF61tfNDa8sr9PS8fVzfxfunh7A6yVRmaFp`。可配置 `NEXT_PUBLIC_SAAS_PROGRAM_ID` 和 `SOLANA_RPC_URL`。

## 本地运行

```bash
npm install
npm run dev
```

打开 `http://localhost:3000`。登录卡片通过 Solana Wallet Standard 动态发现浏览器钱包，内置 Phantom、Solflare、Backpack、Coinbase Wallet 和 Glow 入口，也会自动展示其他支持 Wallet Standard 消息签名的钱包。

## 登录流程

1. 请求连接浏览器钱包。
2. 服务端生成一个 5 分钟有效、绑定当前域名的随机 nonce。
3. 创建包含钱包地址、域名、nonce 和签发时间的登录声明。
4. 请求用户签名（不会创建或发送交易）。
5. 服务端使用钱包公钥执行 Ed25519 验签，并签发 24 小时有效的 HttpOnly 会话 Cookie。

生产部署必须配置至少 32 字节的随机环境变量 `SOLANA_AUTH_SECRET`；未配置时仅使用适合本地开发的默认值。

## Agent SPL Token Vault

`programs/token-vault` 是 Pinocchio 实现的通用代币金库。每个 owner 对应一个 `['vault', owner]` PDA；该 PDA 同时作为 vault ATA 的 authority。支持原版 SPL Token 与 Token-2022 的 `TransferChecked`，并提供：

- `initialize`：创建 vault 并指定 agent；
- `deposit` / `withdraw`：owner 或 agent 操作任意 mint；
- `set_agent`：owner 轮换自动化 agent；
- `set_paused`：owner 一键停止自动化。

TypeScript 构造器位于 `sdk/vault.ts`。调用方应先用 `getOrCreateAssociatedTokenAccount(..., vaultPda, true, tokenProgram)` 创建对应 mint 的 vault ATA。`automation/run.ts` 执行带单笔上限的 JSON 订单策略，签名器必须由调用方注入（推荐硬件或 KMS signer，不在策略/Notebook 中保存私钥）。Jupyter 示例位于 `notebooks/vault-orders.ipynb`。

```bash
cargo test
npm run typecheck
cp automation/policy.example.json automation/policy.json
# 编辑公钥和订单；适用于 cron、GitHub Actions 或 Multica 定时任务
npm run vault:run -- automation/policy.json
```

生产运行时应在每次触发中调用 `executePolicy(policy, signer, false)`。建议使用最小余额 agent、严格 `maxAmount`、独立 RPC、交易模拟与告警；暂停或轮换 agent 只能由 owner 签名。

## 部署到 Vercel

导入仓库后选择 Next.js 框架预设，并配置 `SOLANA_AUTH_SECRET`。
