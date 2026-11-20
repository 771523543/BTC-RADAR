import type { Metadata, Viewport } from "next";
import "./globals.css";
import PwaRegister from "./pwa-register";
import InstallApp from "./install-app";

export const metadata: Metadata = {
  title: "BTC RADAR | رادار البيتكوين",
  description: "منصة عربية لمراقبة وتحليل BTCUSDT ببيانات Binance المباشرة.",
  applicationName: "BTC RADAR",
  manifest: "/BTC-RADAR/manifest.json",
  appleWebApp: {
    capable: true,
    title: "BTC RADAR",
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: "/BTC-RADAR/icons/icon.svg",
    shortcut: "/BTC-RADAR/icons/icon.svg",
    apple: "/BTC-RADAR/icons/icon.svg",
  },
};

export const viewport: Viewport = {
  themeColor: "#080d18",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ar" dir="rtl">
      <body>
        <PwaRegister />
        <InstallApp />
        {children}
      </body>
    </html>
  );
}
