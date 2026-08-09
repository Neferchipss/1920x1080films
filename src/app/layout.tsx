import type { Metadata } from "next";
import { Bodoni_Moda, Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import AppShell from "@/components/AppShell";

// Bodoni Moda echoes the logo's dramatic Didone thick/thin contrast used
// throughout the refs for headlines and the facade counters.
const display = Bodoni_Moda({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

// The refs' nav/body copy is a neutral geometric grotesque, not a condensed
// face — plain Inter reads much closer than Inter Tight did.
const body = Inter({
  variable: "--font-body",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600"],
});

const mono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "1920 x 1080 Films — Luxury Interior Photography & Films",
  description:
    "Umesh Pednekar / 1920 x 1080 Films — luxury interior photography and cinematic films, Mumbai.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${display.variable} ${body.variable} ${mono.variable}`}
    >
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
