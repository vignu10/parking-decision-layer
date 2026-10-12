"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "./ui";

const LINKS = [
  { href: "/", label: "Triage" },
  { href: "/queue", label: "Queue", badge: true },
  { href: "/audit", label: "Audit log" },
  { href: "/evaluate", label: "Evaluate" },
  { href: "/settings", label: "Settings" },
];

export function Nav() {
  const path = usePathname();
  const [open, setOpen] = useState(0);

  useEffect(() => {
    let alive = true;
    const load = () =>
      api<{ decisions: unknown[] }>("/api/decisions?status=open")
        .then((d) => alive && setOpen(d.decisions.length))
        .catch(() => {});
    load();
    const t = setInterval(load, 4000);
    window.addEventListener("pdl:changed", load);
    return () => {
      alive = false;
      clearInterval(t);
      window.removeEventListener("pdl:changed", load);
    };
  }, []);

  return (
    <nav className="nav">
      {LINKS.map((l) => (
        <Link key={l.href} href={l.href} className={path === l.href ? "active" : ""}>
          {l.label}
          {l.badge && open > 0 && <span className="pill pill-warn">{open}</span>}
        </Link>
      ))}
    </nav>
  );
}
