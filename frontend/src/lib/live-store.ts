import { apiFetch, type Role, type UserProfile } from "./api";

export type LiveChild = {
  id: string;
  name: string;
  age: number;
  organization_id: string;
  therapist_id: string;
  caregiver_ids: string[];
  mastery: number;
  adherence: number;
  last_practice?: string | null;
  slug: string;
  initials: string;
  color: string;
};

const palette = ["#f5b65f", "#8fbfc0", "#dca1b7", "#9dbb9b", "#c6a5d8"];
let children: LiveChild[] = [];
let profile: UserProfile | null = null;
let selectedChildId: string | null = null;

const slugify = (name: string) => name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const initials = (name: string) => name.split(/\s+/).map(p => p[0]).join("").slice(0, 2).toUpperCase();
export const normalizeLiveChild = (child: Omit<LiveChild, "slug" | "initials" | "color">, index = 0): LiveChild => ({ ...child, caregiver_ids: child.caregiver_ids || [], slug: slugify(child.name), initials: initials(child.name), color: palette[index % palette.length] });

export async function loadLiveContext(nextProfile?: UserProfile) {
  profile = nextProfile || await apiFetch<UserProfile>("/api/auth/profile");
  if (profile.role === "therapist" || profile.role === "admin") {
    children = await apiFetch<LiveChild[]>("/api/therapists/me/caseload").then(rows => rows.map(normalizeLiveChild));
  } else if (profile.role === "caregiver") {
    children = await apiFetch<LiveChild[]>("/api/caregivers/me/children").then(rows => rows.map(normalizeLiveChild));
  } else if (profile.child_id) {
    const child = await apiFetch<LiveChild>(`/api/children/${profile.child_id}`);
    children = [normalizeLiveChild(child)];
  }
  selectedChildId = children[0]?.id || profile.child_id || null;
  window.dispatchEvent(new Event("sound-buddy-data-change"));
  return profile;
}

export function getLiveProfile() { return profile; }
export function getLiveChildren() { return children; }
export function setLiveChildren(next: LiveChild[]) { children = next; if (!selectedChildId || !children.some(child => child.id === selectedChildId)) selectedChildId = children[0]?.id || null; window.dispatchEvent(new Event("sound-buddy-data-change")); }
export function getSelectedLiveChild() { return children.find(c => c.id === selectedChildId) || children[0] || null; }
export function setSelectedLiveChild(id: string) { selectedChildId = id; window.dispatchEvent(new Event("sound-buddy-data-change")); }
export function findLiveChild(slugOrId: string) { return children.find(c => c.id === slugOrId || c.slug === slugOrId) || null; }
export function subscribeLiveData(listener: () => void) { window.addEventListener("sound-buddy-data-change", listener); return () => window.removeEventListener("sound-buddy-data-change", listener); }

export function clearLiveContext() { children = []; profile = null; selectedChildId = null; }
