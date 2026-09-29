const configuredApiBase = (import.meta.env.VITE_API_URL || "").replace(/\/$/, "");
const browserIsLocal = ["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname);
const configuredApiIsLocal = /^(https?:\/\/)(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(configuredApiBase);

// A localhost URL points at the visitor's machine when the frontend is
// opened through ngrok, so use the same-origin Vite proxy in that case.
const API_BASE = configuredApiBase && (!configuredApiIsLocal || browserIsLocal) ? configuredApiBase : "";

if (!API_BASE && !browserIsLocal && !configuredApiIsLocal) {
  throw new Error("VITE_API_URL is not configured");
}

export type Role = "therapist" | "caregiver" | "child" | "admin";
export type UserProfile = { id: string; name: string; email: string; role: Role; organization_id: string; child_id?: string | null };
export type AuthSession = { access_token: string; token_type: string; user: UserProfile };

const ACCESS_KEY = "sound-buddy-access-token";
const PROFILE_KEY = "sound-buddy-profile";

export async function signIn(email: string, password: string): Promise<UserProfile> {
  const response = await fetch(`${API_BASE}/api/auth/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "ngrok-skip-browser-warning": "true",
    },
    body: JSON.stringify({ email, password }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.detail || "Unable to sign in");
  const session = body as AuthSession;
  sessionStorage.setItem(ACCESS_KEY, session.access_token);
  sessionStorage.setItem(PROFILE_KEY, JSON.stringify(session.user));
  window.dispatchEvent(new Event("sound-buddy-auth-change"));
  return session.user;
}

export async function signUp({ name, email, password, role, username }: { name: string; email: string; password: string; role: Role; username?: string }): Promise<UserProfile> {
  const response = await fetch(`${API_BASE}/api/auth/register`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "ngrok-skip-browser-warning": "true",
    },
    body: JSON.stringify({ name, email, password, role, username }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.detail || "Unable to create account");
  const session = body as AuthSession;
  sessionStorage.setItem(ACCESS_KEY, session.access_token);
  sessionStorage.setItem(PROFILE_KEY, JSON.stringify(session.user));
  window.dispatchEvent(new Event("sound-buddy-auth-change"));
  return session.user;
}

export function getAccessToken() { return sessionStorage.getItem(ACCESS_KEY); }

export function clearSession() {
  sessionStorage.removeItem(ACCESS_KEY);
  sessionStorage.removeItem(PROFILE_KEY);
  window.dispatchEvent(new Event("sound-buddy-auth-change"));
}

export async function signOut() {
  clearSession();
}

export async function loadProfile(force = false): Promise<UserProfile> {
  if (!force) {
    try { const cached = sessionStorage.getItem(PROFILE_KEY); if (cached) return JSON.parse(cached) as UserProfile; } catch { /* ignore */ }
  }
  const profile = await apiFetch<UserProfile>("/api/auth/profile");
  sessionStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
  return profile;
}

export async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getAccessToken();
  if (!token) throw new Error("Please sign in again.");
  const headers = new Headers(options.headers);
  if (options.body && !(options.body instanceof FormData) && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  headers.set("ngrok-skip-browser-warning", "true");
  headers.set("Authorization", `Bearer ${token}`);
  const response = await fetch(`${API_BASE}${path}`, { ...options, headers });
  if (response.status === 401) {
    clearSession();
    throw new Error("Your session has expired. Please sign in again.");
  }
  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try { const body = await response.json() as { detail?: string }; if (body.detail) message = body.detail; } catch { /* ignore */ }
    throw new Error(message);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export async function apiFetchForm<T>(path: string, formData: FormData): Promise<T> {
  return apiFetch<T>(path, { method: "POST", body: formData });
}

export function getStoredProfile(): UserProfile | null {
  try { const value = sessionStorage.getItem(PROFILE_KEY); return value ? JSON.parse(value) as UserProfile : null; } catch { return null; }
}

export function roleDestination(role: Role) {
  if (role === "therapist" || role === "admin") return "/app/therapist/dashboard";
  if (role === "child") return "/app/child/practice";
  return "/app/caregiver/dashboard";
}

export function apiWebSocketUrl() {
  if (!API_BASE) {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${protocol}//${window.location.host}/ws`;
  }
  const base = API_BASE.replace(/^http:/, "ws:").replace(/^https:/, "wss:");
  return `${base}/ws`;
}
