import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/Providers";

const geist = Geist({ subsets: ["latin"], variable: "--font-geist-sans" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono" });

export const metadata: Metadata = {
  metadataBase: new URL("https://treasurycopilot.app"),
  title: {
    default: "Treasury Copilot",
    template: "%s | Treasury Copilot",
  },
  description: "The financial control plane for autonomous agents. Give agents a budget, not your private keys.",
  other: {
    "base:app_id": "69f271446d94c65125c04540",
    "ory-verify": "orynth-14ccbda6605f49dc867b4ea791f6f444",
   },
  alternates: {
    canonical: "/",
  },
  openGraph: {
    title: "Treasury Copilot",
    description: "Policy controlled payment infrastructure for autonomous AI agents.",
    url: "https://treasurycopilot.app",
    siteName: "Treasury Copilot",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Treasury Copilot",
    description: "Give agents a budget, not your private keys.",
  },
  icons: {
    icon: "/favicon.svg",
  },
  applicationName: "Treasury Copilot",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${geist.variable} ${geistMono.variable}`}>
        <Providers>
          {children}
        </Providers>
      </body>
    </html>
  );
}
