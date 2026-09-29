import { type ReactNode, useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { loadLiveContext, getLiveProfile } from "@/lib/live-store";
import { clearSession, getAccessToken, loadProfile, roleDestination, type Role } from "@/lib/api";
import { startRealtime } from "@/lib/realtime";

const allowed: Record<string, Role[]> = {
  therapist: ["therapist", "admin"],
  caregiver: ["caregiver"],
  child: ["child", "caregiver"],
};

export function RoleGuard({ role, children }: { role: keyof typeof allowed; children: ReactNode }) {
  const [location, setLocation] = useLocation();
  const [profile, setProfile] = useState(getLiveProfile());
  const [loading, setLoading] = useState(!profile);
  const [error, setError] = useState("");
  const ok = !!profile && allowed[role].includes(profile.role);

  useEffect(() => {
    let active = true;
    const token = getAccessToken();
    if (!token) {
      clearSession();
      if (active) setError("Please sign in again.");
      if (active) setLoading(false);
      window.location.replace("/login");
      return;
    }

    (async () => {
      try {
        const loaded = await loadProfile(true);
        await loadLiveContext(loaded);
        if (active) setProfile(loaded);

        if (loaded.role && !allowed[role].includes(loaded.role)) {
          const destination = roleDestination(loaded.role);
          if (window.location.pathname !== destination) {
            window.location.replace(destination);
          }
          return;
        }

        const stopRealtime = startRealtime();
        if (active) (window as Window & { __soundBuddyStopRealtime?: () => void }).__soundBuddyStopRealtime = stopRealtime;
      } catch (err) {
        clearSession();
        if (active) setError(err instanceof Error ? err.message : "Unable to load your account.");
        window.location.replace("/login");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; (window as Window & { __soundBuddyStopRealtime?: () => void }).__soundBuddyStopRealtime?.(); delete (window as Window & { __soundBuddyStopRealtime?: () => void }).__soundBuddyStopRealtime; };
  }, [location]);

  useEffect(() => {
    if (!loading && profile && !ok && !error && location !== "/login") {
      const destination = roleDestination(profile.role);
      if (window.location.pathname !== destination) {
        window.location.replace(destination);
      }
    }
  }, [loading, ok, error, location, profile]);

  if (loading) return <div className="sb-page grid min-h-dvh place-items-center p-6"><div className="sb-card p-8 text-center"><div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-[#d8634f] border-t-transparent" /><p className="mt-4 text-sm text-[hsl(var(--muted-foreground))]">Loading your care workspace…</p></div></div>;
  if (error || !ok) return <div className="sb-page grid min-h-dvh place-items-center p-6"><div className="sb-card max-w-md p-8 text-center"><h1 className="sb-display text-3xl font-semibold">That workspace is restricted.</h1><p className="mt-3 text-sm leading-6 text-[hsl(var(--muted-foreground))]">{error || "Your account does not have access to this area."}</p><button onClick={() => { clearSession(); setLocation("/login"); }} className="sb-button sb-button-primary mt-6">Sign in</button><Link href="/" className="ml-2 sb-button sb-button-outline">Home</Link></div></div>;
  return children;
}
