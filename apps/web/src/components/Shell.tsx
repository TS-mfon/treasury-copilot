import Link from "next/link";
import { Bot, ClipboardList, Gauge, Settings, ShieldCheck } from "lucide-react";

const nav = [
  { href: "/setup", label: "Setup", icon: ShieldCheck },
  { href: "/dashboard", label: "Dashboard", icon: Gauge },
  { href: "/policy", label: "Policy", icon: Settings },
  { href: "/agent-test", label: "Agent", icon: Bot },
];

export function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-900/10 bg-white/80 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
          <Link href="/" className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-lg bg-ink text-white">
              <ClipboardList size={20} />
            </span>
            <span>
              <span className="block text-base font-semibold">Treasury Copilot</span>
              <span className="block text-xs text-slate-500">GenLayer policy treasury</span>
            </span>
          </Link>
          <nav className="flex items-center gap-1">
            {nav.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-900 hover:text-white"
              >
                <item.icon size={16} />
                <span className="hidden sm:inline">{item.label}</span>
              </Link>
            ))}
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">{children}</main>
    </div>
  );
}

