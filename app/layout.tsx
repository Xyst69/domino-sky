import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, Inter } from "next/font/google";
import "./globals.css";

const display = Bricolage_Grotesque({ subsets: ["latin"], variable: "--font-display", weight: ["500", "700"] });
const body = Inter({ subsets: ["latin"], variable: "--font-body", weight: ["400", "500", "600"] });

export const metadata: Metadata = {
  title: "Domino Sky — airline disruption simulator",
  description: "Close an airport, watch the delay spread through one airline's day, and recover with a dispatcher whose every number comes from a deterministic engine.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#F5F7F6" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable}`}>
      <body>{children}</body>
    </html>
  );
}
