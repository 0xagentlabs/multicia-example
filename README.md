# Solana Login DApp

一个基于 Next.js App Router 的 Solana 钱包签名登录界面，可直接部署至 Vercel。

## 本地运行

```bash
npm install
npm run dev
```

打开 `http://localhost:3000`，并确保浏览器已安装 Phantom 或其他注入 `window.solana` 的兼容钱包。

## 登录流程

1. 请求连接浏览器钱包。
2. 创建包含钱包地址、当前域名和签发时间的登录声明。
3. 请求用户签名（不会创建或发送交易）。
4. 成功后仅在当前浏览器标签页的 `sessionStorage` 保存会话状态。

此演示在前端完成钱包所有权确认。生产环境应将消息、签名和地址发送到后端，使用随机 nonce 验证签名，并签发 HttpOnly 会话 Cookie，以避免重放攻击。

## 部署到 Vercel

导入仓库即可，框架预设选择 Next.js；不需要环境变量。
