import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SatsuMillion Mint",
  description: "Yuzu-style minting and holder detection for SatsuMillion NFTs on Citrea.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}