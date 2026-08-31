import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Solana Portal",
  description: "Sign in securely with your Solana wallet.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
