"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export function ProtectedOwnerPage({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    void fetch("/api/auth/session")
      .then((response) => {
        if (!response.ok) {
          router.replace("/");
          return;
        }
        setReady(true);
      })
      .catch(() => router.replace("/"));
  }, [router]);

  if (!ready) {
    return <div className="py-20 text-center text-sm text-neutral-500">Checking owner session...</div>;
  }
  return children;
}
