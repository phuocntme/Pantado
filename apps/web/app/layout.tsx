import type { ReactNode } from "react";
import { MaybePrivy } from "../src/lib/privy";
import { WalletProvider } from "../src/lib/wallet";
import "./globals.css";

export const metadata = { title: "Pantado", icons: { icon: "/mark.svg" } };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Inter+Tight:wght@500;600;700&display=swap" />
      </head>
      <body>
        <MaybePrivy>
          <WalletProvider>{children}</WalletProvider>
        </MaybePrivy>
      </body>
    </html>
  );
}
