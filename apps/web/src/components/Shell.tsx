import Link from "next/link";
import { Bot, BookOpen, ClipboardList, Gauge, History, Settings, ShieldCheck } from "lucide-react";
import { OwnerAuthButton } from "@/components/OwnerAuthButton";

const nav = [
  { href: "/setup", label: "Setup", icon: ShieldCheck },
  { href: "/dashboard", label: "Dashboard", icon: Gauge },
  { href: "/history", label: "History", icon: History },
  { href: "/policy", label: "Policy", icon: Settings },
  { href: "/agent", label: "Agent", icon: Bot },
  { href: "/docs", label: "Docs", icon: BookOpen },
];

export function LogoMark({ size = 40 }: { size?: number }) {
  return (
    <span
      className="grid place-items-center rounded-lg border border-outline bg-surface-high text-purple"
      style={{ height: size, width: size }}
      aria-hidden="true"
    >
      <ClipboardList size={Math.max(18, Math.floor(size * 0.5))} />
    </span>
  );
}

export function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-paper text-ink">
      <header className="sticky top-0 z-20 border-b border-outline bg-surface-low/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
          <Link href="/" className="flex items-center gap-3">
            <LogoMark />
            <span>
              <span className="block text-base font-semibold">Treasury Copilot</span>
              <span className="block text-xs text-neutral-500">Policy-gated execution</span>
            </span>
          </Link>
          <nav className="flex items-center gap-1 overflow-x-auto">
            {nav.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-neutral-300 transition hover:bg-surface-high hover:text-purple"
              >
                <item.icon size={16} />
                <span className="hidden sm:inline">{item.label}</span>
              </Link>
            ))}
            <OwnerAuthButton />
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">{children}</main>
    </div>
  );
}
