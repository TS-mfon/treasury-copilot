"use client";

import Link, { type LinkProps } from "next/link";
import type { AnchorHTMLAttributes, MouseEvent } from "react";
import { useOwnerSession } from "@/components/OwnerSessionProvider";

type SetupAccessLinkProps = LinkProps
  & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, keyof LinkProps>
  & { children: React.ReactNode };

export function SetupAccessLink({ children, onClick, ...props }: SetupAccessLinkProps) {
  const { setupBlocked, showUnlockNotice } = useOwnerSession();

  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    onClick?.(event);
    if (event.defaultPrevented) return;
    if (setupBlocked) {
      event.preventDefault();
      showUnlockNotice();
    }
  }

  return <Link {...props} onClick={handleClick}>{children}</Link>;
}
