import type { Metadata } from "next";
import { Nav } from "@/components/Nav";
import "./globals.css";

export const metadata: Metadata = {
  title: "Parking Decision Layer",
  description: "Jev-powered triage for parking support and agent actions — AI sorts and suggests, rules and people keep control.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="shell">
          <aside className="side">
            <div className="brand">
              <div className="brand-mark">P</div>
              <div>
                <div className="brand-name">Decision Layer</div>
                <div className="brand-sub">Parking ops · powered by Jev</div>
              </div>
            </div>
            <Nav />
            <div className="side-foot">
              AI sorts and suggests.
              <br />
              Rules and people keep control of money and safety.
            </div>
          </aside>
          <main className="main">{children}</main>
        </div>
      </body>
    </html>
  );
}
