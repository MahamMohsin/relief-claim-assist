import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { Theme } from "@astryxdesign/core/theme";
import { themes, defaultThemeSlug } from "../src/astryx-themes";

export const metadata: Metadata = {
  title: "Relief Claim Assist",
  description: "Emergency cash assistance on simulated Pakistani public rails.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Theme theme={themes[defaultThemeSlug]} mode="light">
          {children}
        </Theme>
      </body>
    </html>
  );
}
