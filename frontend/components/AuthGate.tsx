"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { onUnauthorized } from "@/lib/api";
import { Spinner } from "@/components/ui";

const PUBLIC_PATHS = ["/login"];

/**
 * The app is private: every page except sign-in needs an account. Also signs
 * the user out when the API rejects their token (expired, or account removed).
 */
export function AuthGate({ children }: { children: React.ReactNode }) {
  const { user, loading, logout } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const isPublic = PUBLIC_PATHS.includes(pathname);

  useEffect(() => onUnauthorized(logout), [logout]);

  useEffect(() => {
    if (!loading && !user && !isPublic) {
      router.replace(`/login?next=${encodeURIComponent(pathname)}`);
    }
  }, [loading, user, isPublic, pathname, router]);

  if (isPublic) return <>{children}</>;
  if (loading || !user) return <Spinner />;
  return <>{children}</>;
}
