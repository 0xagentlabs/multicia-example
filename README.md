# Solana Login DApp

一个基于 Next.js App Router 的 Solana 钱包签名登录界面，可直接部署至 Vercel。

## 本地运行

```bash
npm install
npm run dev
```

打开 `http://localhost:3000`，并确保浏览器已安装 Phantom 或 Backpack。登录卡片会分别检测钱包扩展，让用户明确选择使用哪个钱包。

## 登录流程

1. 请求连接浏览器钱包。
2. 服务端生成一个 5 分钟有效、绑定当前域名的随机 nonce。
3. 创建包含钱包地址、域名、nonce 和签发时间的登录声明。
4. 请求用户签名（不会创建或发送交易）。
5. 服务端使用钱包公钥执行 Ed25519 验签，并签发 24 小时有效的 HttpOnly 会话 Cookie。

生产部署必须配置至少 32 字节的随机环境变量 `SOLANA_AUTH_SECRET`；未配置时仅使用适合本地开发的默认值。

## 部署到 Vercel

导入仓库后选择 Next.js 框架预设，并配置 `SOLANA_AUTH_SECRET`。
