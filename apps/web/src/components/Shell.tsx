"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { AlertTriangle, Bot, BookOpen, Gauge, History, Menu, Settings, ShieldCheck, X } from "lucide-react";
import { OwnerAuthButton } from "@/components/OwnerAuthButton";
import { SetupAccessLink } from "@/components/SetupAccessLink";
import { useOwnerSession } from "@/components/OwnerSessionProvider";
import { PublicTransitionLink } from "@/components/PublicTransitionLink";

const publicNav = [
  { href: "/setup", label: "Setup", icon: ShieldCheck },
  { href: "/agent", label: "Agent API", icon: Bot },
  { href: "/docs", label: "Docs", icon: BookOpen },
];

const ownerNav = [
  { href: "/dashboard", label: "Dashboard", icon: Gauge },
  { href: "/history", label: "History", icon: History },
  { href: "/policy", label: "Policy", icon: Settings },
];

export function LogoMark({ size = 38 }: { size?: number }) {
  return <img src="/logo.svg" alt="" width={size} height={size} className="shrink-0" aria-hidden="true" />;
}

export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { authenticated, dismissUnlockNotice, unlockNoticeVisible } = useOwnerSession();
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 18);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const nav = authenticated
    ? [publicNav[0], ...ownerNav, ...publicNav.slice(1)]
    : publicNav;

  return (
    <div className="min-h-screen bg-paper text-ink">
      <header className={`site-header sticky top-0 z-30 ${scrolled || pathname !== "/" ? "site-header-scrolled" : "site-header-hero"}`}>
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <Link href="/" className="flex min-w-0 items-center gap-3" onClick={() => setOpen(false)}>
            <LogoMark />
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold">Treasury Copilot</span>
              <span className="block truncate text-[11px] text-neutral-500">Policy gated execution</span>
            </span>
          </Link>

          <div className="hidden items-center gap-1 lg:flex">
            <nav className="flex items-center gap-1">
              {nav.map((item) => {
                const active = pathname === item.href;
                const NavLink = item.href === "/setup"
                  ? SetupAccessLink
                  : ["/agent", "/docs"].includes(item.href) ? PublicTransitionLink : Link;
                return (
                  <NavLink
                    key={item.href}
                    href={item.href}
                    className={`flex h-10 items-center gap-2 border-b-2 px-3 text-sm font-medium transition ${
                      active
                        ? "border-purple text-purple"
                        : "border-transparent text-neutral-400 hover:text-ink"
                    }`}
                  >
                    <item.icon size={15} />
                    {item.label}
                  </NavLink>
                );
              })}
            </nav>
            <div className="ml-2 border-l border-outline pl-3">
              <OwnerAuthButton />
            </div>
          </div>

          <button
            type="button"
            className="icon-button lg:hidden"
            aria-label={open ? "Close navigation" : "Open navigation"}
            onClick={() => setOpen((value) => !value)}
          >
            {open ? <X size={19} /> : <Menu size={19} />}
          </button>
        </div>

        {open && (
          <div className="border-t border-outline bg-surface-low px-4 py-3 lg:hidden">
            <nav className="grid gap-1">
              {nav.map((item) => {
                if (item.href === "/setup") {
                  return (
                    <SetupAccessLink
                      key={item.href}
                      href={item.href}
                      className={`flex items-center gap-3 rounded-md px-3 py-3 text-sm ${
                        pathname === item.href ? "bg-surface-high text-purple" : "text-neutral-300"
                      }`}
                      onClick={() => setOpen(false)}
                    >
                      <item.icon size={17} />
                      {item.label}
                    </SetupAccessLink>
                  );
                }
                const NavLink = ["/agent", "/docs"].includes(item.href) ? PublicTransitionLink : Link;
                return (
                  <NavLink
                    key={item.href}
                    href={item.href}
                    className={`flex items-center gap-3 rounded-md px-3 py-3 text-sm ${
                      pathname === item.href ? "bg-surface-high text-purple" : "text-neutral-300"
                    }`}
                    onClick={() => setOpen(false)}
                  >
                    <item.icon size={17} />
                    {item.label}
                  </NavLink>
                );
              })}
            </nav>
            <div className="mt-3 border-t border-outline pt-3">
              <OwnerAuthButton />
            </div>
          </div>
        )}
        {unlockNoticeVisible && (
          <div className="border-t border-warning/30 bg-warning/10" role="alert">
            <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3 text-sm text-warning sm:px-6 lg:px-8">
              <AlertTriangle size={17} className="shrink-0" />
              <p className="flex-1">Please unlock Treasury Copilot by clicking the Unlock button and signing with your wallet.</p>
              <button type="button" className="icon-button h-8 w-8" aria-label="Dismiss unlock notice" onClick={dismissUnlockNotice}>
                <X size={15} />
              </button>
            </div>
          </div>
        )}
      </header>
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">{children}</main>
    </div>
  );
}
