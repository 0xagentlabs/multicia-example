import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Paid Counter · Solana Devnet",
  description: "A transparent on-chain counter where every operation costs 0.001 SOL.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
