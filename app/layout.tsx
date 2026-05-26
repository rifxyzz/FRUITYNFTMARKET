import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "FRUITY NFT Market",
  description: "Inventory, minting, and marketplace tools for FRUITY and SatsuMillion NFTs on Citrea.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
