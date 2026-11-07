import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "BTC RADAR | رادار البيتكوين",
  description: "منصة عربية لمراقبة وتحليل BTCUSDT ببيانات Binance المباشرة.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ar" dir="rtl">
      <body>{children}</body>
    </html>
  );
}