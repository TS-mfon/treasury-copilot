"use client";

import Link, { type LinkProps } from "next/link";
import { useRouter } from "next/navigation";
import type { MouseEvent, ReactNode } from "react";

type PublicTransitionLinkProps = LinkProps & {
  children: ReactNode;
  className?: string;
};

export function PublicTransitionLink({ href, children, onClick, ...props }: PublicTransitionLinkProps & { onClick?: (event: MouseEvent<HTMLAnchorElement>) => void }) {
  const router = useRouter();

  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    onClick?.(event);
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    const destination = typeof href === "string" ? href : href.toString();
    const documentWithTransition = document as Document & { startViewTransition?: (update: () => void) => unknown };
    if (documentWithTransition.startViewTransition) {
      documentWithTransition.startViewTransition(() => router.push(destination));
    } else {
      router.push(destination);
    }
  }

  return <Link href={href} {...props} onClick={handleClick}>{children}</Link>;
}
