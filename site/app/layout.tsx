import type { Metadata } from "next";
import { Fraunces, Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { SiteNav } from "@/components/SiteNav";
import { SiteFooter } from "@/components/SiteFooter";
import { Reveal } from "@/components/Reveal";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  axes: ["opsz"],
  style: ["normal", "italic"],
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://joist.dev"),
  title: {
    default: "Joist — the open-source backbone for AI-edited Elementor sites",
    template: "%s · Joist",
  },
  description:
    "A WordPress plugin + Claude Code skill that gives an AI agent safe, schema-validated, audit-logged read/write access to any Elementor site.",
  openGraph: {
    title: "Joist — the open-source backbone for AI-edited Elementor sites",
    description:
      "Safe, schema-validated, audit-logged AI editing for Elementor. Open source. Round-trip safe with human editors.",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Joist — open-source backbone for AI-edited Elementor sites",
    description:
      "Safe, schema-validated, audit-logged AI editing for Elementor. Open source.",
  },
  robots: { index: true, follow: true },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${fraunces.variable} ${jetbrainsMono.variable}`}
    >
      <body>
        <Reveal />
        <SiteNav />
        {children}
        <SiteFooter />
      </body>
    </html>
  );
}
