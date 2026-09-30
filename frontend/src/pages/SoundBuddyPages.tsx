import { type ReactNode, useEffect, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { apiFetch, apiFetchForm, getStoredProfile, roleDestination, signIn, signUp, signOut } from "@/lib/api";
import { getLiveChildren, getSelectedLiveChild, normalizeLiveChild, setLiveChildren, setSelectedLiveChild } from "@/lib/live-store";
import {
  ArrowRight, Bell, BookOpen, CalendarDays, Check, ChevronRight,
  CircleHelp, ClipboardCheck, Ear, FileText, Heart,
  Home, LogIn, Menu, MessageCircle, Mic, MoreHorizontal, Pencil, Play,
  Plus, RotateCcw, Save, Send, Sparkles, Star, Target, TrendingUp,
  UserRound, Users, Volume2, X, Zap
} from "lucide-react";

type IconType = typeof Home;

type TonguePlacementGuidance = {
  id: string;
  target_sound: string;
  title: string;
  tongue_position: string;
  mouth_position: string;
  airflow: string;
  voice: string;
  cue: string;
  caution: string | null;
};

const defaultChildSlug = "maya";


const todayLabel = () => new Intl.DateTimeFormat("en-US", {
  weekday: "long",
  month: "long",
  day: "numeric",
}).format(new Date());

const dateInputValue = (daysFromNow = 0) => {
  const date = new Date();
  date.setDate(date.getDate() + daysFromNow);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

const parsePlanWords = (value: string) =>
  value.split(",").map(word => word.trim()).filter(Boolean).slice(0, 8);

const getWordEmoji = (value: string) => {
  const word = value.trim().toLowerCase().replace(/[^a-z0-9\s-]/g, "");
  const emojiMap: Record<string, string> = {
    sun: "☀️",
    snake: "🐍",
    sock: "🧦",
    soup: "🍲",
    soap: "🧼",
    seal: "🦭",
    sea: "🌊",
    star: "⭐",
    sheep: "🐑",
    ship: "🚢",
    shoe: "👟",
    shell: "🐚",
    shop: "🛍️",
    shark: "🦈",
    shirt: "👕",
    shovel: "🪏",
    spoon: "🥄",
    swing: "🛝",
    school: "🏫",
    bus: "🚌",
    house: "🏠",
    mouse: "🐭",
    rice: "🍚",
    red: "🔴",
    rabbit: "🐰",
    rain: "🌧️",
    rainbow: "🌈",
    rose: "🌹",
    ring: "💍",
    robot: "🤖",
    rocket: "🚀",
    car: "🚗",
    dog: "🐶",
    cat: "🐱",
    bird: "🐦",
    fish: "🐟",
    frog: "🐸",
    tree: "🌳",
    ball: "⚽",
    moon: "🌙",
    milk: "🥛",
    map: "🗺️",
    man: "👨",
    mom: "👩",
    mother: "👩",
    tea: "🍵",
    top: "🔝",
    toy: "🧸",
    turtle: "🐢",
    tiger: "🐯",
    table: "🪑",
    apple: "🍎",
    orange: "🍊",
    cake: "🍰",
    cookie: "🍪",
    banana: "🍌",
    book: "📖",
    bed: "🛏️",
    door: "🚪",
    flower: "🌸",
    fire: "🔥",
    starfish: "⭐",
  };

  if (emojiMap[word]) return emojiMap[word];

  // Helpful sound-based fallbacks for words not in the exact dictionary.
  if (word.includes("snake") || word.includes("snail")) return "🐍";
  if (word.includes("sun")) return "☀️";
  if (word.includes("rain")) return "🌧️";
  if (word.includes("fish")) return "🐟";
  if (word.includes("dog")) return "🐶";
  if (word.includes("cat")) return "🐱";
  if (word.includes("bird")) return "🐦";
  if (word.includes("ball")) return "⚽";
  if (word.includes("car")) return "🚗";

  return "🌟";
};

function Avatar({ initials, color, size = "md" }: { initials: string; color: string; size?: "sm" | "md" | "lg" }) {
  const sizes = { sm: "h-8 w-8 text-[11px]", md: "h-10 w-10 text-xs", lg: "h-16 w-16 text-lg" };
  return <div className={`sb-avatar ${sizes[size]}`} style={{ backgroundColor: color }} data-testid={`avatar-${initials}`}>{initials}</div>;
}


type LiveChildShape = { id: string; name: string; age: number; mastery: number; adherence: number; slug: string; initials: string; color: string; therapist_id: string; caregiver_ids: string[]; organization_id: string; last_practice?: string | null };
const getChildProfile = (slug?: string) => slug ? getLiveChildren().find(child => child.slug === slug) || getSelectedLiveChild() : getSelectedLiveChild();
const getSelectedChildFromLocation = () => {
  if (typeof window === "undefined") return "";
  return window.location.pathname.match(/\/app\/therapist\/children\/([^/?]+)/)?.[1]?.toLowerCase() || getSelectedLiveChild()?.slug || "";
};
const getSelectedChildProfile = () => getSelectedLiveChild();
const setSelectedChild = (slug: string) => { const child = getChildProfile(slug); if (child) setSelectedLiveChild(child.id); };

type CurriculumItem = { word: string; sound: string; position: string; age: string; difficulty: string };

function BrandMark({ light = false, textOnly = false }: { light?: boolean; textOnly?: boolean }) {
  return (
    <Link
      href="/"
      className={`inline-flex items-center ${textOnly ? "" : light ? "" : ""}`}
      data-testid="link-brand-home"
    >
      {textOnly ? (
        <span className="text-[18px] font-extrabold uppercase tracking-[.08em] text-[#fff8ec]">
          SOUND BUDDY
        </span>
      ) : (
        <img
          src="/sound-buddy-logo.png"
          alt="Sound Buddy"
          className="h-16 w-[300px] object-contain"
        />
      )}
    </Link>
  );
}

function Sidebar({ role = "therapist" }: { role?: "therapist" | "caregiver" | "child" }) {
  const [location] = useLocation();
  const [realtimeStatus, setRealtimeStatus] = useState("connecting");
  useEffect(() => { const onStatus = (event: Event) => setRealtimeStatus((event as CustomEvent<string>).detail); window.addEventListener("sound-buddy-realtime-status", onStatus); return () => window.removeEventListener("sound-buddy-realtime-status", onStatus); }, []);
     const profile = getStoredProfile();
     const profileRole = profile?.role;
  const profileName = profile?.name || "Sound Buddy user";
  const selectedChild = getSelectedChildProfile() || { name: "Child", slug: "", id: "" };
  const linkedChildren = role === "caregiver" ? getLiveChildren() : [];
  const roleLabel = role === "therapist" ? "Therapist workspace" : role === "child" ? "Child practice" : "Family space";
  const links: { label: string; href: string; icon: IconType }[] =
    role === "caregiver"
      ? [
          { label: "Home", href: "/app/caregiver/dashboard", icon: Home },
          { label: `${selectedChild.name.split(" ")[0]}'s practice`, href: "/app/child/practice", icon: Play },
          { label: "Messages", href: "/app/caregiver/messages", icon: MessageCircle },
        ]
      : role === "child"
        ? [
            { label: "Home", href: "/app/child/practice", icon: Home },
            { label: `${selectedChild.name.split(" ")[0]}'s practice`, href: "/app/child/practice", icon: Play },
            { label: "Tongue Placements", href: "/app/child/tongue-placement", icon: Ear },
            { label: "Messages", href: "/app/caregiver/messages", icon: MessageCircle },
          ]
        : [
          { label: "Overview", href: "/app/therapist/dashboard", icon: Home },
          { label: "My children", href: `/app/therapist/children/${selectedChild.slug}`, icon: Users },
          { label: "Practice plans", href: `/app/therapist/plans?child=${selectedChild.slug}`, icon: ClipboardCheck },
          { label: "Word library", href: `/app/therapist/library?child=${selectedChild.slug}`, icon: BookOpen },
           { label: "Review queue", href: `/app/therapist/review?child=${selectedChild.slug}`, icon: Ear },
        ];
  return (
    <aside className="sb-sidebar flex min-h-dvh flex-col py-6">
      <div className="px-6 pb-8"><BrandMark textOnly /></div>
      <div className="flex items-center justify-between px-6 pb-3"><div className="text-[10px] font-bold uppercase tracking-[.18em] text-[#f9edcf]/40">{roleLabel}</div><span className="rounded-full bg-[#f9edcf]/10 px-2 py-1 text-[9px] font-bold text-[#f9edcf]/60">{realtimeStatus === "connected" ? "Live" : realtimeStatus === "connecting" ? "Connecting" : "Offline"}</span></div>
      {linkedChildren.length > 1 && <div className="px-6 pb-4">
        <label className="mb-1.5 block text-[9px] font-bold uppercase tracking-[.14em] text-[#f9edcf]/40">Viewing</label>
        <select
          className="w-full rounded-xl border border-[#f9edcf]/15 bg-[#f9edcf]/[.06] px-3 py-2 text-xs font-bold text-[#f9edcf]"
          value={selectedChild.id}
          onChange={event => { setSelectedChild(linkedChildren.find(child => child.id === event.target.value)?.slug || ""); }}
          data-testid="select-switch-child"
        >
          {linkedChildren.map(child => <option key={child.id} value={child.id} className="text-[#203d3a]">{child.name}</option>)}
        </select>
      </div>}

      {/* Therapist/caregiver illustration panel. The existing logo above is untouched. */}
      {(role === "therapist" || role === "caregiver") && (
        <div className="mx-4 mt-4 h-[250px] shrink-0 overflow-hidden rounded-[26px] border border-[#f9edcf]/10 bg-[#245c55] shadow-inner">
          <img
            src={role === "therapist" ? "/therapist-dashboard-image.png" : "/caregiver-dashboard-image.png"}
            alt={role === "therapist" ? "Therapist helping a child practice speech" : "Caregiver and child practicing together"}
            className="h-full w-full object-cover object-top"
          />
        </div>
      )}

      <nav className="flex-1">
        {links.map(({ label, href, icon: Icon }) => {
          const active = location.startsWith(href.split("?")[0]);
          return <Link href={href} key={label} className={`sb-sidebar-link ${active ? "active" : ""}`} data-testid={`link-nav-${label.toLowerCase().replaceAll(" ", "-")}`}><Icon size={17} strokeWidth={1.8} /><span>{label}</span></Link>;
        })}
      </nav>
      <div className="mx-5 mt-6 rounded-2xl border border-[#f9edcf]/10 bg-[#f9edcf]/[.06] p-4">
        <div className="mb-3 flex items-center gap-2 text-[#f8c968]"><CircleHelp size={16} /><span className="text-xs font-semibold">Need a hand?</span></div>
        <p className="mb-3 text-[11px] leading-relaxed text-[#f9edcf]/55">Our care team is here when you need them.</p>
<button onClick={() => window.location.href = role === "therapist" ? "/app/therapist/review" : "/app/caregiver/dashboard"} className="text-xs font-bold text-[#f8c968]" data-testid="button-contact-support">{role === "therapist" ? "Open review queue" : "Open dashboard"} <ArrowRight className="ml-1 inline" size={13} /></button>
      </div>
      <div className="mt-6 border-t border-[#f9edcf]/10 px-5 pt-5">
        <div className="flex items-center gap-3"><Avatar initials={profileName.split(" ").map(part => part[0]).join("").slice(0, 2).toUpperCase() || "PP"} color="#dc937e" size="sm" /><div className="min-w-0"><p className="truncate text-xs font-bold text-[#f9edcf]">{profileName}</p><p className="text-[10px] text-[#f9edcf]/45">{role === "caregiver" ? "Caregiver" : role === "child" ? "Child" : "Speech team"}</p></div><button onClick={() => { signOut(); window.location.href = "/login"; }} className="ml-auto text-[#f9edcf]/45 hover:text-[#f9edcf]" aria-label="Sign out" title="Sign out" data-testid="button-account-menu"><LogIn size={17} /></button></div>
      </div>
    </aside>
  );
}

function MobileTop({ role = "therapist" }: { role?: "therapist" | "caregiver" | "child" }) {
  const [open, setOpen] = useState(false);
  const selectedChild = getSelectedChildProfile() || { name: "Child", slug: "", id: "" };
  const linkedChildren = role === "caregiver" ? getLiveChildren() : [];
  const links = role === "caregiver"
    ? [{ label: "Home", href: "/app/caregiver/dashboard" }, { label: `${selectedChild.name.split(" ")[0]}'s practice`, href: "/app/child/practice" }, { label: "Messages", href: "/app/caregiver/messages" }]
    : role === "child"
      ? [{ label: "Home", href: "/app/child/practice" }, { label: "Tongue Placements", href: "/app/child/tongue-placement" }, { label: "Messages", href: "/app/caregiver/messages" }]
      : [{ label: "Overview", href: "/app/therapist/dashboard" }, { label: "My children", href: `/app/therapist/children/${selectedChild.slug}` }, { label: "Practice plans", href: "/app/therapist/plans" }, { label: "Review queue", href: "/app/therapist/review" }];
  return <div className="sb-mobile-top relative items-center justify-between border-b border-[hsl(var(--border))] bg-[hsl(var(--card))] px-4 py-3"><BrandMark />{linkedChildren.length > 1 && <select className="mx-2 min-w-0 flex-1 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-2 py-1.5 text-xs font-bold" value={selectedChild.id} onChange={event => { const next = linkedChildren.find(child => child.id === event.target.value); if (next) setSelectedLiveChild(next.id); }} data-testid="select-switch-child-mobile">{linkedChildren.map(child => <option key={child.id} value={child.id}>{child.name}</option>)}</select>}<button onClick={() => setOpen(!open)} className="rounded-lg p-2 hover:bg-[hsl(var(--muted))]" aria-label="Open navigation" data-testid="button-mobile-menu">{open ? <X size={20} /> : <Menu size={20} />}</button>{open && <nav className="absolute left-3 right-3 top-[calc(100%+8px)] z-30 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-2 shadow-xl">{links.map(link => <Link key={link.label} href={link.href} onClick={() => setOpen(false)} className="block rounded-xl px-4 py-3 text-sm font-semibold hover:bg-[hsl(var(--muted))]">{link.label}</Link>)}<button onClick={() => { signOut(); setOpen(false); window.location.href = "/login"; }} className="mt-1 w-full rounded-xl px-4 py-3 text-left text-sm font-semibold text-[#bf5b49] hover:bg-[hsl(var(--muted))]" data-testid="button-mobile-signout">Sign out</button></nav>}</div>;
}

function GuidanceBubble() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [guidance, setGuidance] = useState("");
  const [source, setSource] = useState("");
  const ask = async () => {
    const child = getSelectedChildProfile();
    setOpen(true);
    setLoading(true);
    try {
      const plan = child ? await apiFetch<{ targets?: Array<{ sound?: string; words?: string[] }>; cue?: string }>(`/api/children/${child.id}/plan`) : null;
      const words = plan?.targets?.[0]?.words ?? [];
      const data = await apiFetch<{ guidance?: string; source?: string }>("/api/ai-guidance", {
        method: "POST",
        body: JSON.stringify({
          childId: child?.id,
          selectedWords: words,
          language: "en",
          difficulty: "steady",
          therapyGoal: plan?.cue || "keep practice calm and encouraging",
          attemptResult: "the current practice session",
        }),
      });
      setGuidance(data.guidance || "Keep practice short, familiar, and encouraging.");
      setSource(data.source || "deterministic-fallback");
    } catch {
      setGuidance("Keep three familiar words for confidence, then add one gentle challenge word. Your therapist remains the decision-maker.");
      setSource("deterministic-fallback");
    } finally {
      setLoading(false);
    }
  };
  return <div className="fixed bottom-5 right-5 z-40">{open && <div className="sb-card mb-3 w-[min(360px,calc(100vw-40px))] bg-[#245c55] p-5 text-[#fff8ec] shadow-2xl"><div className="flex items-center justify-between"><div className="flex items-center gap-2 text-[#f8c968]"><Sparkles size={16} /><span className="sb-kicker text-[#fff8ec]/60">AI-guided learning</span></div><button onClick={() => setOpen(false)} aria-label="Close guidance"><X size={16} /></button></div>{loading ? <p className="mt-4 text-sm text-[#fff8ec]/70">Buddy is looking at the latest practice...</p> : <><p className="sb-display mt-4 text-xl leading-tight">{guidance}</p><p className="mt-4 text-[10px] font-semibold uppercase tracking-wider text-[#fff8ec]/45">{source === "gemini" ? "Gemini guidance" : "Built-in fallback guidance"} · therapist remains in control</p></>}</div>}<button onClick={ask} className="sb-button sb-button-warm ml-auto shadow-lg" data-testid="button-open-ai-guidance"><Sparkles size={15} /> {open ? "Refresh guidance" : "Ask Buddy"}</button></div>;
}

function AppShell({ children, role = "therapist" }: { children: ReactNode; role?: "therapist" | "caregiver" | "child" }) {
  const [, refresh] = useState(0);
  useEffect(() => { const sync = () => refresh(v => v + 1); window.addEventListener("sound-buddy-data-change", sync); window.addEventListener("sound-buddy-realtime", sync); return () => { window.removeEventListener("sound-buddy-data-change", sync); window.removeEventListener("sound-buddy-realtime", sync); }; }, []);
  return <div className="sb-app-shell"><Sidebar role={role} /><div className="sb-main"><MobileTop role={role} />{children}</div><GuidanceBubble /></div>;
}

function TopBar({ eyebrow, title, action }: { eyebrow?: string; title: string; action?: React.ReactNode }) {
  return <header className="mb-8 flex items-end justify-between gap-4"><div><div className="sb-kicker mb-2">{eyebrow}</div><h1 className="sb-display text-3xl font-semibold tracking-tight text-[hsl(var(--foreground))] sm:text-[38px]">{title}</h1></div>{action}</header>;
}

function StatCard({ label, value, hint, color = "coral", icon: Icon }: { label: string; value: string; hint: string; color?: "coral" | "teal" | "gold"; icon: IconType }) {
  const bg = { coral: "#fcede7", teal: "#e0efeb", gold: "#fbf0d2" }[color];
  const fg = { coral: "#bf5b49", teal: "#286b62", gold: "#a27020" }[color];
  return <div className="sb-card sb-card-lift p-5" data-testid={`card-stat-${label.toLowerCase().replaceAll(" ", "-")}`}><div className="flex items-start justify-between"><span className="sb-kicker">{label}</span><span className="grid h-8 w-8 place-items-center rounded-lg" style={{ backgroundColor: bg, color: fg }}><Icon size={16} /></span></div><div className="mt-4 flex items-end gap-2"><strong className="sb-display text-3xl font-semibold">{value}</strong><span className="mb-1 text-xs font-medium text-[hsl(var(--muted-foreground))]">{hint}</span></div></div>;
}

function ProgressRing({ value, label }: { value: number; label: string }) {
  const r = 38; const c = 2 * Math.PI * r; const offset = c - (value / 100) * c;
  return <div className="relative h-[104px] w-[104px]"><svg className="-rotate-90" width="104" height="104"><circle cx="52" cy="52" r={r} fill="none" stroke="hsl(var(--muted))" strokeWidth="8" /><circle cx="52" cy="52" r={r} fill="none" stroke="#ef765b" strokeLinecap="round" strokeWidth="8" strokeDasharray={c} strokeDashoffset={offset} /></svg><div className="absolute inset-0 grid place-items-center text-center"><strong className="sb-display text-xl">{value}%</strong><span className="absolute bottom-2 text-[9px] font-bold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">{label}</span></div></div>;
}

function PublicLanding() {
  return <div className="sb-page sb-noise overflow-hidden">
    <nav className="mx-auto flex max-w-7xl items-center justify-between px-6 py-6 lg:px-10"><BrandMark /><div className="hidden items-center gap-8 text-sm font-semibold text-[#36504b] md:flex"><a href="#how-it-works" data-testid="link-how-it-works">How it works</a><a href="#for-care-teams" data-testid="link-for-care-teams">For care teams</a><a href="#small-wins" data-testid="link-small-wins">Small wins</a></div><Link href="/login" className="sb-button sb-button-outline" data-testid="link-landing-sign-in"><LogIn size={15} /> Sign in</Link></nav>
    <main>
      <section className="relative mx-auto grid max-w-7xl items-center gap-12 px-6 pb-20 pt-12 lg:grid-cols-[1.02fr_.98fr] lg:px-10 lg:pb-32 lg:pt-20">
        <div className="sb-enter relative z-10"><div className="mb-6 inline-flex items-center gap-2 rounded-full border border-[#e2cfad] bg-[#fffaf0] px-3 py-1.5 text-xs font-bold text-[#a27020]"><span className="h-2 w-2 rounded-full bg-[#ef765b]" /> Built around real care</div><h1 className="sb-display max-w-xl text-[54px] font-semibold leading-[.98] text-[#203d3a] sm:text-[74px]">Every sound has a <em className="text-[#d8634f]">story.</em></h1><p className="mt-7 max-w-md text-[17px] leading-7 text-[#52635e]">Sound Buddy gives children a safe place to practice, therapists a clearer picture, and families a reason to celebrate the little things.</p><div className="mt-9 flex flex-wrap items-center gap-3"><Link href="/login" className="sb-button sb-button-primary px-5 py-3.5" data-testid="link-start-practicing">Sign in <ArrowRight size={16} /></Link><a href="#how-it-works" className="sb-button sb-button-outline px-5 py-3.5" data-testid="link-learn-more">Take a look</a></div><div className="mt-10 flex items-center gap-4"><div className="flex -space-x-2"><Avatar initials="MC" color="#f5b65f" size="sm" /><Avatar initials="AR" color="#8fbfc0" size="sm" /><Avatar initials="SK" color="#dca1b7" size="sm" /></div><p className="text-xs leading-5 text-[#66746f]"><strong className="text-[#36504b]">Small steps, noticed.</strong><br />Made for the whole care circle.</p></div></div>
        <div className="sb-enter sb-enter-2 relative min-h-[430px]">
          <div className="sb-blob right-0 top-0 h-[360px] w-[360px] rotate-12 bg-[#f7d990] opacity-80 sm:h-[480px] sm:w-[480px]" /><div className="sb-dotted-ring absolute right-8 top-8 h-[330px] w-[330px] sm:h-[430px] sm:w-[430px]" />
          <div className="sb-shadow absolute left-4 top-14 z-10 w-[270px] rotate-[-4deg] rounded-[26px] border border-[#ead8b6] bg-[#fffdf7] p-5 sm:left-14 sm:w-[330px]"><div className="mb-5 flex items-center justify-between"><span className="sb-kicker">Today’s practice</span><span className="rounded-full bg-[#e0efeb] px-2 py-1 text-[10px] font-bold text-[#286b62]">today</span></div><div className="mb-3 text-5xl font-semibold text-[#203d3a]">sun</div><div className="mb-5 flex items-center gap-2 text-xs text-[#75817d]"><Volume2 size={15} className="text-[#d8634f]" /> Listen, then try it</div><div className="sb-wave rounded-xl bg-[#fcede7]"><div className="absolute left-5 top-6 flex items-center gap-1.5">{[16,27,38,20,32,24,42,25,36,18].map((h, i) => <span key={i} className="w-1 rounded-full bg-[#ef765b]" style={{ height: h }} />)}</div></div><div className="mt-5 flex items-center justify-between"><span className="text-xs font-semibold text-[#52635e]">Word 2 of 5</span><span className="text-xs font-bold text-[#d8634f]">+1 win</span></div></div>
          <div className="absolute bottom-3 right-0 z-20 w-[230px] rotate-[5deg] rounded-[22px] bg-[#245c55] p-5 text-[#fff8ec] shadow-xl sm:right-2"><div className="flex items-center gap-2 text-xs font-bold text-[#f8c968]"><Sparkles size={15} /> Care team note</div><p className="sb-display mt-3 text-xl leading-tight">"Small steps can become confident practice."</p><div className="mt-4 text-[10px] text-[#fff8ec]/60">Live care workspace · today</div></div>
        </div>
      </section>
      <section id="how-it-works" className="border-y border-[#dfd4c1] bg-[#fffaf1] px-6 py-20 lg:px-10 lg:py-28"><div className="mx-auto max-w-7xl"><div className="max-w-xl"><div className="sb-kicker text-[#d8634f]">One connected loop</div><h2 className="sb-display mt-3 text-4xl font-semibold leading-tight text-[#203d3a] sm:text-5xl">Practice feels better when everyone can see the why.</h2></div><div className="mt-14 grid gap-4 md:grid-cols-3"><div className="rounded-[22px] bg-[#e0efeb] p-7 md:mt-8"><span className="sb-mono text-xs text-[#286b62]">01 / SHAPE</span><div className="mt-10 grid h-12 w-12 place-items-center rounded-xl bg-[#245c55] text-[#f8c968]"><Target size={21} /></div><h3 className="sb-display mt-5 text-2xl font-semibold">Therapists shape the path.</h3><p className="mt-3 text-sm leading-6 text-[#52635e]">Turn a clinical goal into a few focused words, a cadence that fits, and feedback that feels like you.</p></div><div className="rounded-[22px] bg-[#fcede7] p-7"><span className="sb-mono text-xs text-[#bf5b49]">02 / TRY</span><div className="mt-10 grid h-12 w-12 place-items-center rounded-xl bg-[#ef765b] text-[#fff8ec]"><Mic size={21} /></div><h3 className="sb-display mt-5 text-2xl font-semibold">Children find their voice.</h3><p className="mt-3 text-sm leading-6 text-[#52635e]">Short, friendly practice that celebrates effort first — with just enough challenge to keep growing.</p></div><div className="rounded-[22px] bg-[#fbf0d2] p-7 md:mt-8"><span className="sb-mono text-xs text-[#a27020]">03 / NOTICE</span><div className="mt-10 grid h-12 w-12 place-items-center rounded-xl bg-[#f5b65f] text-[#203d3a]"><Heart size={21} /></div><h3 className="sb-display mt-5 text-2xl font-semibold">Caregivers see the wins.</h3><p className="mt-3 text-sm leading-6 text-[#52635e]">A calm view of consistency, confidence, and what to try next at home.</p></div></div></div></section>
      <section id="small-wins" className="mx-auto grid max-w-7xl items-center gap-12 px-6 py-20 lg:grid-cols-[.8fr_1.2fr] lg:px-10 lg:py-28"><div><div className="sb-kicker text-[#d8634f]">The feeling of progress</div><h2 className="sb-display mt-3 text-4xl font-semibold leading-tight text-[#203d3a] sm:text-5xl">Less pressure.<br /><span className="text-[#d8634f]">More “I did it.”</span></h2><p className="mt-6 max-w-sm text-[16px] leading-7 text-[#66746f]">Not every practice is perfect. Sound Buddy keeps the picture honest and hopeful, so a hard day is just part of the story.</p><Link href="/login" className="sb-button sb-button-warm mt-8" data-testid="link-try-signin">Sign in <ArrowRight size={16} /></Link></div><div className="grid gap-3 sm:grid-cols-2"><div className="sb-card sb-shadow bg-[#245c55] p-6 text-[#fff8ec] sm:translate-y-8"><div className="flex items-center justify-between"><span className="sb-kicker text-[#fff8ec]/55">Built for continuity</span><TrendingUp size={18} className="text-[#f8c968]" /></div><div className="mt-10"><span className="sb-display text-4xl">Plan → Practice → Progress</span></div><p className="mt-5 text-xs leading-5 text-[#fff8ec]/65">One connected workflow keeps therapist guidance and home practice aligned.</p></div><div className="sb-card bg-[#fffaf1] p-6"><Star className="text-[#ef765b]" size={20} fill="currentColor" /><p className="sb-display mt-10 text-3xl leading-tight text-[#203d3a]">“Small steps are easier to notice.”</p><p className="mt-6 text-xs font-semibold text-[#66746f]">Designed for the whole care circle.</p></div></div></section>
      <footer className="border-t border-[#dfd4c1] px-6 py-8 lg:px-10"><div className="mx-auto flex max-w-7xl flex-col gap-4 text-xs text-[#66746f] sm:flex-row sm:items-center sm:justify-between"><BrandMark /><span>Thoughtful practice for growing voices.</span></div></footer>
    </main>
  </div>;
}

function LoginPage() {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [registrationRole, setRegistrationRole] = useState<"caregiver" | "therapist">("caregiver");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [location, setLocation] = useLocation();

  useEffect(() => {
    const profile = getStoredProfile();
    const token = sessionStorage.getItem("sound-buddy-access-token");
    if (token && profile?.role && location === "/login") {
      window.location.replace(roleDestination(profile.role));
    }
  }, [location]);

  const submit = async () => {
    setError("");
    if (mode === "register") {
      if (!name.trim() || !email.trim() || !password) {
        setError("Please fill in your name, email, and password.");
        return;
      }
      if (password !== confirmPassword) {
        setError("Passwords do not match.");
        return;
      }
    }

    setLoading(true);
    try {
      const profile = mode === "register"
        ? await signUp({ name: name.trim(), email: email.trim(), password, role: registrationRole, username: username.trim() || undefined })
        : await signIn(email.trim(), password);
      window.location.replace(roleDestination(profile.role));
    } catch (err) {
      setError(err instanceof Error ? err.message : (mode === "register" ? "Unable to create account" : "Unable to sign in"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="sb-page sb-noise grid min-h-dvh lg:grid-cols-[.9fr_1.1fr]">
      <div className="relative hidden min-h-dvh overflow-hidden p-10 text-[#fff8ec] lg:block">
        <img
          src="/login-background.png"
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
        />
        <div className="absolute inset-0 bg-[#245c55]/55" />
        <div className="sb-blob -left-24 bottom-[-50px] h-[400px] w-[500px] bg-[#f8c968]/20" />

        <div className="relative z-10 flex h-full flex-col">
          <BrandMark light />
          <div className="mt-auto max-w-md pb-16">
            <div className="mb-5 grid h-12 w-12 place-items-center rounded-xl bg-[#f8c968] text-[#203d3a]">
              <Sparkles size={22} />
            </div>
            <h1 className="sb-display text-5xl font-semibold leading-[1.05]">
              A kinder way to practice the sounds that matter.
            </h1>
            <p className="mt-6 text-[16px] leading-7 text-[#fff8ec]/80">
              Create your own Sound Buddy workspace or sign in with an existing role-based account.
            </p>
            <div className="mt-10 flex items-center gap-3 border-t border-[#fff8ec]/20 pt-5 text-xs text-[#fff8ec]/75">
              <Check size={15} className="text-[#f8c968]" /> Live local workspace
            </div>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-center px-6 py-10">
        <div className="w-full max-w-[480px]">
          <div className="mb-10 lg:hidden"><BrandMark /></div>
          <div className="sb-kicker mb-3 text-[#d8634f]">Sound Buddy · account access</div>
          <div className="mb-6 flex rounded-full bg-[#f5f1e9] p-1">
            <button type="button" onClick={() => setMode("login")} className={`flex-1 rounded-full px-4 py-2 text-sm font-semibold ${mode === "login" ? "bg-[#245c55] text-[#fff8ec]" : "text-[#3b4d49]"}`}>Sign in</button>
            <button type="button" onClick={() => setMode("register")} className={`flex-1 rounded-full px-4 py-2 text-sm font-semibold ${mode === "register" ? "bg-[#245c55] text-[#fff8ec]" : "text-[#3b4d49]"}`}>Create account</button>
          </div>
          <h2 className="sb-display text-4xl font-semibold text-[#203d3a]">{mode === "login" ? "Welcome back." : "Create your space."}</h2>
          <p className="mt-3 text-sm leading-6 text-[#66746f]">{mode === "login" ? "Use your Sound Buddy account email and password." : "Create a username, choose a role, and start practicing with your care team."}</p>
          <div className="mt-8 space-y-4">
            {mode === "register" && <>
              <label className="block"><span className="sb-kicker mb-2 block">Full name</span><input className="sb-input" type="text" value={name} onChange={event => setName(event.target.value)} /></label>
              <label className="block"><span className="sb-kicker mb-2 block">Username</span><input className="sb-input" type="text" value={username} onChange={event => setUsername(event.target.value)} placeholder="Optional - defaults to your email prefix" /></label>
              <label className="block"><span className="sb-kicker mb-2 block">Account type</span><select className="sb-input" value={registrationRole} onChange={event => setRegistrationRole(event.target.value as "caregiver" | "therapist")}><option value="caregiver">Caregiver</option><option value="therapist">Therapist</option></select></label>
            </>}
            <label className="block"><span className="sb-kicker mb-2 block">Email</span><input className="sb-input" type="email" autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} /></label>
            <label className="block"><span className="sb-kicker mb-2 block">Password</span><input className="sb-input" type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} value={password} onChange={event => setPassword(event.target.value)} onKeyDown={event => { if (event.key === "Enter") submit(); }} /></label>
            {mode === "register" && <label className="block"><span className="sb-kicker mb-2 block">Confirm password</span><input className="sb-input" type="password" autoComplete="new-password" value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} onKeyDown={event => { if (event.key === "Enter") submit(); }} /></label>}
          </div>
          {error && <div role="alert" className="mt-4 rounded-xl bg-[#fcede7] p-3 text-sm font-semibold text-[#a44f40]">{error}</div>}
          <button onClick={submit} disabled={loading || !email || !password || (mode === "register" && (!name || !password || !confirmPassword))} className="sb-button sb-button-primary mt-6 w-full py-3.5" data-testid="button-live-signin">{loading ? (mode === "register" ? "Creating account…" : "Signing in…") : (mode === "register" ? "Create account" : "Sign in")} <ArrowRight size={16} /></button>
          <p className="mt-6 text-center text-[11px] leading-5 text-[#8a918c]">Accounts are stored securely in the local Sound Buddy database for this build.</p>
        </div>
      </div>
    </div>
  );
}

function TherapistDashboard() {
  const [children, setChildren] = useState<LiveChildShape[]>([]);
  const [review, setReview] = useState<Array<{ child: LiveChildShape; priority: string; reviewDate?: string | null }>>([]);
  const [loading, setLoading] = useState(true);
  const [showChildForm, setShowChildForm] = useState(false);
  const [childName, setChildName] = useState("");
  const [childAge, setChildAge] = useState("7");
  const [caregiverEmail, setCaregiverEmail] = useState("");
  const [childUsername, setChildUsername] = useState("");
  const [childPassword, setChildPassword] = useState("");
  const [savingChild, setSavingChild] = useState(false);
  const [error, setError] = useState("");
  const load = async () => {
    try {
      const [caseload, queue] = await Promise.all([
        apiFetch<LiveChildShape[]>("/api/therapists/me/caseload"),
        apiFetch<Array<{ child: LiveChildShape; priority: string; reviewDate?: string | null }>>("/api/review-queue"),
      ]);
      setChildren(caseload.map(normalizeLiveChild)); setReview(queue.map((item, index) => ({ ...item, child: normalizeLiveChild(item.child, index) }))); setError("");
    } catch (err) { setError(err instanceof Error ? err.message : "Unable to load your caseload."); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); const sync = () => void load(); window.addEventListener("sound-buddy-realtime", sync); return () => window.removeEventListener("sound-buddy-realtime", sync); }, []);
  const createChild = async () => {
    const name = childName.trim();
    const age = Number(childAge);
    if (name.length < 2 || age < 1 || age > 18) { setError("Enter a child name and an age from 1 to 18."); return; }
    setSavingChild(true); setError("");
    try {
      await apiFetch("/api/children", { method: "POST", body: JSON.stringify({ name, age, caregiver_ids: [], caregiver_email: caregiverEmail.trim() || undefined, child_username: childUsername.trim() || undefined, child_password: childPassword || undefined }) });
      setChildName(""); setChildAge("7"); setCaregiverEmail(""); setChildUsername(""); setChildPassword(""); setShowChildForm(false); await load();
    } catch (err) { setError(err instanceof Error ? err.message : "Child could not be created."); }
    finally { setSavingChild(false); }
  };
  const avg = children.length ? Math.round(children.reduce((sum, c) => sum + c.mastery, 0) / children.length) : 0;
  const avgAdherence = children.length ? Math.round(children.reduce((sum, c) => sum + c.adherence, 0) / children.length) : 0;
  return <AppShell><main className="sb-content"><TopBar eyebrow={`${todayLabel()} · live care workspace`} title="Good morning." action={<div className="flex gap-2"><button onClick={() => setShowChildForm(current => !current)} className="sb-button sb-button-outline"><Plus size={16} /> <span className="hidden sm:inline">Add child</span></button><Link href="/app/therapist/plans" className="sb-button sb-button-primary"><Plus size={16} /> <span className="hidden sm:inline">New plan</span></Link></div>} />
    {showChildForm && <section className="sb-card mb-6 p-5 sm:p-6"><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5 lg:items-end"><label><span className="sb-kicker mb-2 block">Child name</span><input className="sb-input" value={childName} onChange={event => setChildName(event.target.value)} autoFocus /></label><label><span className="sb-kicker mb-2 block">Age</span><input className="sb-input" type="number" min="1" max="18" value={childAge} onChange={event => setChildAge(event.target.value)} /></label><label><span className="sb-kicker mb-2 block">Caregiver email</span><input className="sb-input" type="email" value={caregiverEmail} onChange={event => setCaregiverEmail(event.target.value)} /></label><label><span className="sb-kicker mb-2 block">Child username</span><input className="sb-input" value={childUsername} onChange={event => setChildUsername(event.target.value)} /></label><label><span className="sb-kicker mb-2 block">Child password</span><input className="sb-input" type="password" minLength={8} value={childPassword} onChange={event => setChildPassword(event.target.value)} /></label><button onClick={() => void createChild()} disabled={savingChild} className="sb-button sb-button-primary lg:col-span-5">{savingChild ? "Saving…" : "Create child"}</button></div></section>}
    {error && <div role="alert" className="mb-6 rounded-xl bg-[#fcede7] p-4 text-sm font-semibold text-[#a44f40]">{error}</div>}
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"><StatCard label="Active children" value={loading ? "—" : String(children.length)} hint="live caseload" color="teal" icon={Users} /><StatCard label="To review" value={loading ? "—" : String(review.length)} hint="backend priority" color="coral" icon={Ear} /><StatCard label="Avg. mastery" value={loading ? "—" : `${avg}%`} hint="current" color="gold" icon={TrendingUp} /><StatCard label="Practice rhythm" value={loading ? "—" : `${avgAdherence}%`} hint="this week" color="teal" icon={Zap} /></div>
    <div className="mt-10 grid gap-6 xl:grid-cols-[1.25fr_.75fr]"><section><div className="mb-4 flex items-end justify-between"><div><div className="sb-kicker">Your attention, in order</div><h2 className="sb-display mt-1 text-2xl font-semibold">Caseload priorities</h2></div><Link href="/app/therapist/review" className="text-xs font-bold text-[#bf5b49]">See all <ArrowRight className="ml-1 inline" size={13} /></Link></div>{review.length ? <div className="space-y-3">{review.slice(0,5).map((item, i) => <Link key={item.child.id} href={`/app/therapist/children/${item.child.slug}`} className="sb-card sb-card-lift flex items-center gap-4 p-4"><Avatar initials={item.child.initials} color={item.child.color} size="sm" /><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><strong className="text-sm">{item.child.name}</strong><span className="rounded-full bg-[#fcede7] px-2 py-1 text-[10px] font-bold text-[#bf5b49]">{item.priority}</span></div><p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">Mastery {Math.round(item.child.mastery)}% · adherence {Math.round(item.child.adherence)}%</p></div><ChevronRight size={16} /></Link>)}</div> : <div className="sb-card p-8 text-center"><Check className="mx-auto text-[#286b62]"/><p className="mt-3 text-sm font-semibold">Nothing needs review right now.</p></div>}</section>
    <aside className="sb-card p-6"><div className="sb-kicker">Live caseload</div><h2 className="sb-display mt-1 text-2xl font-semibold">Children</h2><div className="mt-6 space-y-3">{children.slice(0,6).map(child => <Link key={child.id} href={`/app/therapist/children/${child.slug}`} onClick={() => setSelectedChild(child.slug)} className="flex items-center gap-3 rounded-xl p-2 hover:bg-[#f5f1e9]"><Avatar initials={child.initials} color={child.color} size="sm"/><div className="min-w-0 flex-1"><p className="truncate text-sm font-bold">{child.name}</p><p className="text-xs text-[hsl(var(--muted-foreground))]">{Math.round(child.mastery)}% mastery</p></div><ChevronRight size={14}/></Link>)}{!children.length && !loading && <p className="text-sm text-[hsl(var(--muted-foreground))]">No children are assigned to this account.</p>}</div></aside></div>
  </main></AppShell>;
}


function ChildProfile() {
  const [location, setLocation] = useLocation();
  const childSlug = (location.match(/\/app\/therapist\/children\/([^/?]+)/)?.[1] || defaultChildSlug).toLowerCase();
  const [child, setChild] = useState<LiveChildShape | undefined>(() => getChildProfile(childSlug));
  const [profileProgress, setProfileProgress] = useState<{ mastery: number; adherence: number } | null>(null);
  const queryTab = location.split("tab=")[1];
  const [tab, setTab] = useState(queryTab || "overview");
  useEffect(() => {
    const refresh = async () => {
      const current = getChildProfile(childSlug);
      const resolved = current || (await apiFetch<LiveChildShape[]>("/api/therapists/me/caseload").then(rows => { const liveRows = rows.map(normalizeLiveChild); setLiveChildren(liveRows); return liveRows.find(item => item.slug === childSlug); }).catch(() => undefined));
      if (resolved) {
        void apiFetch<Partial<LiveChildShape>>(`/api/children/${resolved.id}`).then(next => setChild({ ...resolved, ...next })).catch(() => setChild(resolved));
        void apiFetch<{ mastery: number; adherence: number }>(`/api/children/${resolved.id}/progress`).then(setProfileProgress).catch(() => setProfileProgress(null));
      } else setChild(undefined);
    };
    void refresh();
    const sync = () => void refresh();
    window.addEventListener("sound-buddy-realtime", sync);
    return () => window.removeEventListener("sound-buddy-realtime", sync);
  }, [childSlug]);
  if (!child) return <AppShell><main className="sb-content"><div className="sb-card p-8">No child selected.</div></main></AppShell>;
  const currentMastery = Math.round(profileProgress?.mastery ?? child.mastery);
  const currentAdherence = Math.round(profileProgress?.adherence ?? child.adherence);
  const tabs = ["overview", "plan", "attempts", "progress", "notes", "messages", "care-team"];
  const tabLabels: Record<string, string> = { "care-team": "Care team" };
  const setTabAndUrl = (next: string) => { setTab(next); setLocation(`/app/therapist/children/${child.slug}?tab=${next}`); };
  return <AppShell><main className="sb-content"><div className="mb-7 flex items-center gap-2 text-xs font-semibold text-[hsl(var(--muted-foreground))]"><Link href="/app/therapist/dashboard" className="hover:text-[hsl(var(--foreground))]" data-testid="link-back-dashboard">Overview</Link><ChevronRight size={14} /><span>{child.name}</span></div><section className="sb-card overflow-hidden"><div className="bg-[#245c55] px-6 py-7 text-[#fff8ec] sm:px-8"><div className="flex flex-col justify-between gap-6 sm:flex-row sm:items-center"><div className="flex items-center gap-4"><Avatar initials={child.initials} color={child.color} size="lg" /><div><div className="flex flex-wrap items-center gap-2"><h1 className="sb-display text-3xl font-semibold">{child.name}</h1><span className="rounded-full bg-[#f8c968] px-2 py-1 text-[10px] font-bold text-[#203d3a]">Active plan</span></div><p className="mt-1 text-sm text-[#fff8ec]/60">Age {child.age} · Active therapist-guided plan</p></div></div><div className="flex gap-2"><Link href="/app/child/practice" className="sb-button bg-[#f8c968] text-[#203d3a]" data-testid="link-child-practice"><Play size={15} fill="currentColor" /> Practice mode</Link></div></div><div className="mt-7 grid max-w-xl grid-cols-3 gap-5 border-t border-[#fff8ec]/15 pt-5"><div><div className="text-2xl font-bold">{currentMastery}%</div><div className="mt-1 text-[10px] uppercase tracking-wider text-[#fff8ec]/50">Mastery</div></div><div><div className="text-2xl font-bold">{currentAdherence}%</div><div className="mt-1 text-[10px] uppercase tracking-wider text-[#fff8ec]/50">Adherence</div></div><div><div className="text-2xl font-bold">—</div><div className="mt-1 text-[10px] uppercase tracking-wider text-[#fff8ec]/50">Since start</div></div></div></div><div className="flex gap-1 overflow-x-auto border-b border-[hsl(var(--border))] px-4 py-2 sm:px-7">{tabs.map(t => <button key={t} onClick={() => setTabAndUrl(t)} className={`whitespace-nowrap rounded-lg px-3 py-2.5 text-xs font-bold capitalize ${tab === t ? "bg-[#e0efeb] text-[#286b62]" : "text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]"}`} data-testid={`button-tab-${t}`}>{tabLabels[t] || t}</button>)}</div><div className="p-6 sm:p-8">{tab === "overview" && <ChildOverview child={child} setTab={setTabAndUrl} />}{tab === "plan" && <PlanSnapshot />}{tab === "attempts" && <Attempts />}{tab === "progress" && <ProgressView />}{tab === "notes" && <Notes />}{tab === "messages" && <Messages />}{tab === "care-team" && <CareTeam />}</div></section></main></AppShell>;
}

function ChildOverview({ child, setTab }: { child: ReturnType<typeof getChildProfile>; setTab: (tab: string) => void }) {
  return <div className="grid gap-8 lg:grid-cols-[1.1fr_.9fr]"><div><div className="sb-kicker">Live practice data</div><h2 className="sb-display mt-1 text-2xl font-semibold">{child.name.split(" ")[0]} is building a practice rhythm.</h2><p className="mt-3 max-w-lg text-sm leading-6 text-[hsl(var(--muted-foreground))]">Progress and feedback update here after recorded practice.</p><div className="mt-7 grid grid-cols-2 gap-3"><div className="rounded-2xl bg-[#fbf0d2] p-4"><div className="flex items-center gap-2 text-[#a27020]"><Zap size={16} /><span className="text-xs font-bold">Practice status</span></div><p className="sb-display mt-4 text-2xl">Live updates</p><p className="mt-1 text-xs text-[#66746f]">Data comes from the care workspace.</p></div><div className="rounded-2xl bg-[#fcede7] p-4"><div className="flex items-center gap-2 text-[#bf5b49]"><Ear size={16} /><span className="text-xs font-bold">Review status</span></div><p className="sb-display mt-4 text-2xl">Care team</p><button onClick={() => setTab("attempts")} className="mt-1 text-xs font-bold text-[#bf5b49]" data-testid="button-review-maya-attempts">Listen to attempts <ArrowRight size={13} className="ml-1 inline" /></button></div></div></div><div className="rounded-2xl bg-[#f5f1e9] p-5"><div className="flex items-center justify-between"><div><div className="sb-kicker">Current goal</div><p className="sb-display mt-1 text-xl font-semibold">{child.mastery >= 75 ? "Current target" : "Target practice"}</p></div><span className="grid h-9 w-9 place-items-center rounded-xl bg-[#e0efeb] text-[#286b62]"><Target size={17} /></span></div><div className="mt-7 flex items-center gap-5"><ProgressRing value={Math.round(child.mastery)} label="mastery" /><div><p className="text-sm font-bold">Current mastery</p><p className="mt-1 text-xs leading-5 text-[hsl(var(--muted-foreground))]">Progress is updated after each recorded attempt.</p></div></div><button onClick={() => setTab("progress")} className="mt-6 text-xs font-bold text-[#286b62]" data-testid="button-see-progress">See progress details <ArrowRight size={13} className="ml-1 inline" /></button></div></div>;
}

function PlanSnapshot() {
  const selectedChild = getSelectedChildProfile();
  const [plan, setPlan] = useState<{ targets?: Array<{ sound: string; words: string[]; position: string }>; tier: string; cadence_per_week: number; review_date: string; cue: string } | null>(null);
  useEffect(() => { apiFetch<typeof plan>(`/api/children/${selectedChild.id}/plan`).then(setPlan).catch(() => setPlan(null)); }, [selectedChild.id]);
  const target = plan?.targets?.[0];
  const words = target?.words ?? [];
  const reviewDate = plan?.review_date ? new Date(`${plan.review_date}T00:00:00`).toLocaleDateString() : "Set in plan";
  if (!plan) return <div className="sb-card border-dashed p-8 text-center"><ClipboardCheck className="mx-auto text-[hsl(var(--muted-foreground))]" size={24} /><h2 className="sb-display mt-4 text-2xl font-semibold">No practice plan yet.</h2><p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">Create a therapist-approved plan before practice begins.</p><Link href="/app/therapist/plans" className="sb-button sb-button-primary mt-5"><Plus size={15} /> Create plan</Link></div>;
  return <div className="grid gap-5 md:grid-cols-2"><div><div className="sb-kicker">Current practice plan</div><h2 className="sb-display mt-1 text-2xl font-semibold">The {target?.sound ?? "speech"} sound, one brave word at a time.</h2><div className="mt-6 space-y-3">{[["Target sound", target?.sound ?? "/s/"], ["Position", target?.position ?? "Initial"], ["Word tier", plan?.tier ?? "Whole Word"], ["Cadence", plan ? `${words.length} words · ${plan.cadence_per_week}× a week` : `${words.length} words · 5× a week`], ["Review date", reviewDate]].map(([a, b]) => <div className="flex items-center justify-between border-b border-[hsl(var(--border))] py-3 text-sm" key={a}><span className="text-[hsl(var(--muted-foreground))]">{a}</span><strong>{b}</strong></div>)}</div><Link href="/app/therapist/plans" className="sb-button sb-button-outline mt-6" data-testid="link-edit-plan"><Pencil size={14} /> Edit plan</Link></div><div className="rounded-2xl bg-[#e0efeb] p-6"><div className="sb-kicker text-[#286b62]">Words in rotation</div><div className="mt-6 flex flex-wrap gap-2">{words.map(word => <span className="rounded-full bg-[#fffdf7] px-4 py-2 text-sm font-bold text-[#286b62]" key={word}>{word}</span>)}</div><div className="mt-10 border-t border-[#286b62]/15 pt-5"><p className="text-sm font-bold text-[#286b62]">Therapist note</p><p className="mt-2 text-sm leading-6 text-[#3b6861]">“{plan?.cue || "Keep the cue short and encouraging."}”</p></div></div></div>;
}

function Attempts() {
  const [location] = useLocation(); const child = getChildProfile((location.match(/\/app\/therapist\/children\/([^/?]+)/)?.[1] || getSelectedChildFromLocation()).toLowerCase());
  const [attempts, setAttempts] = useState<Array<{ id: string; word: string; score: number; created_at: string; duration_ms?: number | null }>>([]); const [error,setError]=useState("");
  const load=async()=>{ if(!child)return; try{setAttempts(await apiFetch<typeof attempts>(`/api/children/${child.id}/attempts`));setError("");}catch(err){setError(err instanceof Error?err.message:"Unable to load attempts.");}};
  useEffect(()=>{void load();const sync=()=>void load();window.addEventListener("sound-buddy-realtime",sync);return()=>window.removeEventListener("sound-buddy-realtime",sync);},[child?.id]);
  const play=(word:string)=>{if("speechSynthesis"in window){window.speechSynthesis.cancel();window.speechSynthesis.speak(new SpeechSynthesisUtterance(word));}};
  if(!child)return <div className="p-6 text-sm">No child selected.</div>;
  return <div><div className="flex items-end justify-between"><div><div className="sb-kicker">Recent recordings</div><h2 className="sb-display mt-1 text-2xl font-semibold">Listen with fresh ears.</h2></div><span className="text-xs text-[hsl(var(--muted-foreground))]">Live from the care workspace</span></div>{error&&<p className="mt-3 text-xs text-[#bf5b49]">{error}</p>}<div className="mt-6 divide-y divide-[hsl(var(--border))]">{attempts.slice(-10).reverse().map((a,i)=><div className="flex items-center gap-4 py-4" key={a.id}><button onClick={()=>play(a.word)} className="grid h-10 w-10 place-items-center rounded-full bg-[#fcede7] text-[#d8634f]" aria-label={`Play ${a.word}`}><Play size={15} fill="currentColor"/></button><div className="flex-1"><div className="flex items-center gap-2"><strong className="text-sm">{a.word}</strong><span className={`h-1.5 w-1.5 rounded-full ${a.score>=75?"bg-[#4d9186]":"bg-[#ef765b]"}`}/><span className="text-xs text-[hsl(var(--muted-foreground))]">{Math.round(a.score)}%</span></div><p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">{new Date(a.created_at).toLocaleString()} · {Math.round((a.duration_ms||0)/1000)} sec</p></div></div>)}{!attempts.length&&!error&&<div className="py-10 text-center text-sm text-[hsl(var(--muted-foreground))]">No attempts yet.</div>}</div></div>;
}

function ProgressView() {
  const selectedChild=getSelectedChildProfile(); const [progress,setProgress]=useState<{mastery:number;attempt_count:number;average_score:number;recent_average:number;current_tier:string;recommended_tier:string}|null>(null); const [history,setHistory]=useState<Array<{created_at:string;mastery:number}>>([]); const [error,setError]=useState("");
  const load=async()=>{if(!selectedChild)return;try{const[p,h]=await Promise.all([apiFetch<typeof progress>(`/api/children/${selectedChild.id}/progress`),apiFetch<typeof history>(`/api/children/${selectedChild.id}/progress/history`)]);setProgress(p);setHistory(h);setError("");}catch(err){setError(err instanceof Error?err.message:"Unable to load progress.");}};
  useEffect(()=>{void load();const sync=()=>void load();window.addEventListener("sound-buddy-realtime",sync);return()=>window.removeEventListener("sound-buddy-realtime",sync);},[selectedChild?.id]);
  if(!selectedChild)return <div className="p-6 text-sm">No child selected.</div>; const mastery=Math.round(progress?.mastery??selectedChild.mastery);
  return <div className="grid gap-8 lg:grid-cols-[.7fr_1.3fr]"><div><div className="sb-kicker">Live progress snapshot</div><h2 className="sb-display mt-1 text-2xl font-semibold">The line is moving up.</h2>{error&&<p className="mt-3 text-xs text-[#bf5b49]">{error}</p>}<div className="mt-7 flex items-center gap-5"><ProgressRing value={mastery} label="mastery"/><div><p className="text-sm font-bold text-[#286b62]">{progress?.attempt_count??0} attempts</p><p className="mt-1 text-xs leading-5 text-[hsl(var(--muted-foreground))]">Average {Math.round(progress?.average_score??0)}% · recent {Math.round(progress?.recent_average??0)}%</p></div></div></div><div className="rounded-2xl bg-[#f5f1e9] p-5"><div className="flex items-center justify-between"><span className="sb-kicker">Mastery history</span><span className="text-xs font-bold text-[#286b62]">Recommended: {progress?.recommended_tier||"—"}</span></div><div className="mt-7 flex min-h-36 items-end gap-3">{history.slice(-7).map((point,i)=><div className="flex flex-1 flex-col items-center gap-2" key={point.created_at}><div className="w-full rounded-t-md bg-[#ef765b]" style={{height:`${Math.max(10,point.mastery*1.2)}px`,opacity:.4+i*.08}}/><span className="text-[10px] text-[hsl(var(--muted-foreground))]">{new Date(point.created_at).toLocaleDateString(undefined,{weekday:"short"}).slice(0,1)}</span></div>)}{!history.length&&<p className="w-full py-12 text-center text-sm text-[hsl(var(--muted-foreground))]">History will appear after live practice.</p>}</div></div></div>;
}

function Notes() {
  const [location] = useLocation();
  const childSlug = (location.match(/\/app\/therapist\/children\/([^/?]+)/)?.[1] || defaultChildSlug).toLowerCase();
  const child = getChildProfile(childSlug);
  const [notes, setNotes] = useState<Array<{ id: string; note: string; created_at: string }>>([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const childId = child?.id;
  useEffect(() => { if (!childId) { setLoading(false); return; } apiFetch<typeof notes>(`/api/notes/${childId}`).then(setNotes).catch(() => {}).finally(() => setLoading(false)); }, [childId]);
  const addNote = async () => {
    const note = draft.trim();
    if (!note || !childId) return;
    try {
      const created = await apiFetch<{ id: string; note: string; created_at: string }>("/api/notes", { method: "POST", body: JSON.stringify({ child_id: childId, note }) });
      setNotes(current => [created, ...current]);
      setDraft("");
    } catch (err) { setError(err instanceof Error ? err.message : "Note could not be saved."); }
  };
  if (!child) return <div className="p-6 text-sm">No child selected.</div>;
  return <div className="max-w-2xl"><div className="flex items-end justify-between"><div><div className="sb-kicker">Private notes</div><h2 className="sb-display mt-1 text-2xl font-semibold">Keep the context close.</h2></div><button onClick={() => document.getElementById("note-draft")?.focus()} className="sb-button sb-button-outline" data-testid="button-add-note"><Plus size={14} /> Add note</button></div><div className="mt-5 flex gap-2"><textarea id="note-draft" value={draft} onChange={e => setDraft(e.target.value)} className="sb-input min-h-20 resize-none" placeholder="Add a private care-team note..." data-testid="textarea-add-note" /><button onClick={addNote} disabled={!draft.trim()} className="sb-button sb-button-primary self-end" data-testid="button-save-note"><Save size={14} /> Save</button></div><div className="mt-6 space-y-3">{loading ? <p className="text-sm text-[hsl(var(--muted-foreground))]">Loading notes…</p> : notes.length ? notes.map(n => <div className="rounded-2xl bg-[#fbf0d2] p-5" key={n.id}><div className="flex items-center justify-between text-xs"><strong>Care team</strong><span className="text-[#8e7441]">{new Date(n.created_at).toLocaleDateString()}</span></div><p className="mt-3 text-sm leading-6">{n.note}</p></div>) : <div className="rounded-2xl border border-dashed border-[hsl(var(--border))] p-5 text-center"><FileText className="mx-auto text-[hsl(var(--muted-foreground))]" size={20} /><p className="mt-2 text-xs text-[hsl(var(--muted-foreground))]">No notes yet.</p></div>}</div></div>;
}
function CareTeam() {
  const [location] = useLocation();
  const childSlug = (location.match(/\/app\/therapist\/children\/([^/?]+)/)?.[1] || defaultChildSlug).toLowerCase();
  const child = getChildProfile(childSlug);
  const [caregivers, setCaregivers] = useState<Array<{ id: string; name: string; email: string }>>([]);
  const [therapists, setTherapists] = useState<Array<{ id: string; name: string; email: string }>>([]);
  const [assignedCaregiverIds, setAssignedCaregiverIds] = useState<string[]>(child?.caregiver_ids || []);
  const [currentTherapistId, setCurrentTherapistId] = useState<string>(child?.therapist_id || "");
  const [addCaregiverId, setAddCaregiverId] = useState("");
  const [transferTherapistId, setTransferTherapistId] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = async () => {
    if (!child) return;
    try {
      const [caregiverList, therapistList, freshChild] = await Promise.all([
        apiFetch<Array<{ id: string; name: string; email: string }>>("/api/caregivers"),
        apiFetch<Array<{ id: string; name: string; email: string }>>("/api/therapists"),
        apiFetch<{ caregiver_ids: string[]; therapist_id: string }>(`/api/children/${child.id}`),
      ]);
      setCaregivers(caregiverList);
      setTherapists(therapistList);
      setAssignedCaregiverIds(freshChild.caregiver_ids);
      setCurrentTherapistId(freshChild.therapist_id);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load the care team.");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void load(); }, [child?.id]);

  if (!child) return <div className="p-6 text-sm">No child selected.</div>;

  const assignedCaregivers = caregivers.filter(item => assignedCaregiverIds.includes(item.id));
  const unassignedCaregivers = caregivers.filter(item => !assignedCaregiverIds.includes(item.id));
  const currentTherapist = therapists.find(item => item.id === currentTherapistId);
  const otherTherapists = therapists.filter(item => item.id !== currentTherapistId);

  const addCaregiver = async () => {
    if (!addCaregiverId) return;
    setBusy(true); setError(""); setNotice("");
    try {
      await apiFetch(`/api/children/${child.id}/caregivers/${addCaregiverId}`, { method: "POST" });
      setAddCaregiverId("");
      setNotice("Caregiver added to the care circle.");
      await load();
      window.dispatchEvent(new Event("sound-buddy-data-change"));
    } catch (err) { setError(err instanceof Error ? err.message : "Caregiver could not be added."); }
    finally { setBusy(false); }
  };

  const removeCaregiver = async (caregiverId: string) => {
    setBusy(true); setError(""); setNotice("");
    try {
      await apiFetch(`/api/children/${child.id}/caregivers/${caregiverId}`, { method: "DELETE" });
      setNotice("Caregiver removed from the care circle.");
      await load();
      window.dispatchEvent(new Event("sound-buddy-data-change"));
    } catch (err) { setError(err instanceof Error ? err.message : "Caregiver could not be removed."); }
    finally { setBusy(false); }
  };

  const transferTherapist = async () => {
    if (!transferTherapistId) return;
    const target = therapists.find(item => item.id === transferTherapistId);
    if (!target) return;
    setBusy(true); setError(""); setNotice("");
    try {
      await apiFetch(`/api/children/${child.id}/transfer-therapist`, { method: "POST", body: JSON.stringify({ therapist_id: transferTherapistId }) });
      setNotice(`${child.name.split(" ")[0]} was transferred to ${target.name}.`);
      setTransferTherapistId("");
      await load();
      window.dispatchEvent(new Event("sound-buddy-data-change"));
    } catch (err) { setError(err instanceof Error ? err.message : "Child could not be transferred."); }
    finally { setBusy(false); }
  };

  return <div className="grid max-w-3xl gap-8">
    <div>
      <div className="sb-kicker">Care circle</div>
      <h2 className="sb-display mt-1 text-2xl font-semibold">Who's caring for {child.name.split(" ")[0]}.</h2>
      <p className="mt-3 max-w-lg text-sm leading-6 text-[hsl(var(--muted-foreground))]">Manage which caregivers can see live progress, and which therapist owns this child's plan.</p>
    </div>
    {error && <div role="alert" className="rounded-xl bg-[#fcede7] p-3 text-sm font-semibold text-[#a44f40]">{error}</div>}
    {notice && <div className="rounded-xl bg-[#e0efeb] p-3 text-sm font-semibold text-[#286b62]">{notice}</div>}
    <section>
      <div className="sb-kicker text-[#d8634f]">Caregivers</div>
      <div className="mt-4 space-y-3">
        {loading ? <p className="text-sm text-[hsl(var(--muted-foreground))]">Loading caregivers…</p> : assignedCaregivers.length ? assignedCaregivers.map(item => <div key={item.id} className="flex items-center gap-3 rounded-2xl bg-[#fcede7] p-4"><Avatar initials={item.name.split(" ").map(p => p[0]).join("").slice(0, 2).toUpperCase()} color="#dc937e" size="sm" /><div className="min-w-0 flex-1"><p className="truncate text-sm font-bold">{item.name}</p><p className="truncate text-xs text-[hsl(var(--muted-foreground))]">{item.email}</p></div><button onClick={() => void removeCaregiver(item.id)} disabled={busy} className="text-xs font-bold text-[#bf5b49] disabled:opacity-40" data-testid={`button-remove-caregiver-${item.id}`}>Remove</button></div>) : <div className="rounded-2xl border border-dashed border-[hsl(var(--border))] p-5 text-center"><UserRound className="mx-auto text-[hsl(var(--muted-foreground))]" size={20} /><p className="mt-2 text-xs text-[hsl(var(--muted-foreground))]">No caregivers linked yet.</p></div>}
      </div>
      {!loading && <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <select className="sb-input flex-1" value={addCaregiverId} onChange={e => setAddCaregiverId(e.target.value)} data-testid="select-add-caregiver">
          <option value="">{unassignedCaregivers.length ? "Choose a caregiver to add..." : "No more caregivers in this organization"}</option>
          {unassignedCaregivers.map(item => <option key={item.id} value={item.id}>{item.name} · {item.email}</option>)}
        </select>
        <button onClick={() => void addCaregiver()} disabled={!addCaregiverId || busy} className="sb-button sb-button-outline" data-testid="button-add-caregiver"><Plus size={14} /> Add caregiver</button>
      </div>}
    </section>
    <section>
      <div className="sb-kicker text-[#286b62]">Therapist</div>
      <div className="mt-4 flex items-center gap-3 rounded-2xl bg-[#e0efeb] p-4">
        <Avatar initials={(currentTherapist?.name || "?").split(" ").map(p => p[0]).join("").slice(0, 2).toUpperCase()} color="#4d9186" size="sm" />
        <div className="min-w-0 flex-1"><p className="truncate text-sm font-bold">{currentTherapist?.name || "Loading…"}</p><p className="truncate text-xs text-[hsl(var(--muted-foreground))]">{currentTherapist?.email}</p></div>
        <span className="rounded-full bg-[#fff8ec] px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-[#286b62]">Currently assigned</span>
      </div>
      {!loading && <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <select className="sb-input flex-1" value={transferTherapistId} onChange={e => setTransferTherapistId(e.target.value)} data-testid="select-transfer-therapist">
          <option value="">{otherTherapists.length ? "Transfer to another therapist..." : "No other therapists in this organization"}</option>
          {otherTherapists.map(item => <option key={item.id} value={item.id}>{item.name} · {item.email}</option>)}
        </select>
        <button onClick={() => void transferTherapist()} disabled={!transferTherapistId || busy} className="sb-button sb-button-primary" data-testid="button-transfer-therapist">Transfer child</button>
      </div>}
      <p className="mt-3 text-xs leading-5 text-[hsl(var(--muted-foreground))]">Transferring moves ownership of {child.name.split(" ")[0]}'s plan, notes, and messages to the new therapist. The previous therapist loses access.</p>
    </section>
  </div>;
}
function Messages() {
  const [location] = useLocation();
  const childSlug = (location.match(/\/app\/therapist\/children\/([^/?]+)/)?.[1] || defaultChildSlug).toLowerCase();
  const child = getChildProfile(childSlug);
  const caregiverId = child?.caregiver_ids?.[0];
  const [messages, setMessages] = useState<Array<{ id: string; body: string; sender_user_id: string; created_at: string }>>([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  useEffect(() => { if (!child) return; const load = () => void apiFetch<typeof messages>(`/api/messages/${child.id}`).then(setMessages).catch(() => setMessages([])); load(); window.addEventListener("sound-buddy-realtime", load); return () => window.removeEventListener("sound-buddy-realtime", load); }, [child?.id]);
  const send = async () => {
    const body = draft.trim();
    if (!body || !caregiverId || !child) return;
    try {
      const message = await apiFetch<typeof messages[number]>("/api/messages", { method: "POST", body: JSON.stringify({ child_id: child.id, recipient_user_id: caregiverId, body }) });
      setMessages(current => [...current, message]); setDraft("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Message could not be sent.");
    }
  };
  if (!child) return <div className="p-6 text-sm">No child selected.</div>;
  return <div className="grid gap-8 lg:grid-cols-[.8fr_1.2fr]"><div><div className="sb-kicker">Care circle</div><h2 className="sb-display mt-1 text-2xl font-semibold">A little context goes a long way.</h2><p className="mt-3 text-sm leading-6 text-[hsl(var(--muted-foreground))]">Share a quick note with the child’s caregivers so home practice stays encouraging.</p></div><div className="rounded-2xl border border-[hsl(var(--border))] p-5"><div className="max-h-64 space-y-3 overflow-y-auto">{messages.map(message => <div key={message.id} className={`rounded-xl p-4 text-sm leading-6 ${message.sender_user_id === caregiverId ? "bg-[#f5f1e9]" : "bg-[#e0efeb]"}`}>{message.body}<p className="mt-2 text-[10px] text-[hsl(var(--muted-foreground))]">{new Date(message.created_at).toLocaleString()}</p></div>)}</div><div className="mt-4 flex gap-2"><input className="sb-input" value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === "Enter") send(); }} placeholder="Write a thoughtful reply..." data-testid="input-message-reply" /><button onClick={send} disabled={!draft.trim()} className="grid h-11 w-11 flex-none place-items-center rounded-xl bg-[#245c55] text-[#fff8ec] disabled:opacity-40" aria-label="Send message" data-testid="button-send-message"><Send size={16} /></button></div></div></div>;
}
function CurriculumPage() {
  const selectedChild=getSelectedChildProfile(); const [items,setItems]=useState<CurriculumItem[]>([]); const [selected,setSelected]=useState<string[]>([]); const [search,setSearch]=useState(""); const [sound,setSound]=useState("All sounds"); const [position,setPosition]=useState("All positions"); const [error,setError]=useState("");
  useEffect(()=>{apiFetch<Array<{word:string;target_sound:string;word_position:string;age_band:string;difficulty:string}>>("/api/curriculum").then(rows=>setItems(rows.map(r=>({word:r.word,sound:r.target_sound,position:r.word_position,age:r.age_band,difficulty:r.difficulty})))).catch(err=>setError(err instanceof Error?err.message:"Unable to load curriculum."));},[]);
  const filtered=items.filter(item=>item.word.toLowerCase().includes(search.toLowerCase())&&(sound==="All sounds"||item.sound===sound)&&(position==="All positions"||item.position===position)); const toggle=(word:string)=>setSelected(v=>v.includes(word)?v.filter(x=>x!==word):[...v,word]);
  if(!selectedChild)return <AppShell><main className="sb-content"><div className="sb-card p-8">No child selected.</div></main></AppShell>;
  return <AppShell><main className="sb-content"><TopBar eyebrow="Curriculum · live word bank" title="Find the right word." action={<Link href="/app/therapist/plans" className="sb-button sb-button-primary"><ClipboardCheck size={15}/> Open {selectedChild.name.split(" ")[0]}’s plan</Link>}/>{error&&<div role="alert" className="mb-4 rounded-xl bg-[#fcede7] p-3 text-sm font-semibold text-[#a44f40]">{error}</div>}<div className="grid gap-6 xl:grid-cols-[1.3fr_.7fr]"><section className="sb-card p-5 sm:p-7"><div className="flex flex-col gap-3 sm:flex-row"><input className="sb-input flex-1" placeholder="Search words..." value={search} onChange={e=>setSearch(e.target.value)}/><select className="sb-input sm:max-w-[150px]" value={sound} onChange={e=>setSound(e.target.value)}><option>All sounds</option>{Array.from(new Set(items.map(i=>i.sound))).map(i=><option key={i}>{i}</option>)}</select><select className="sb-input sm:max-w-[150px]" value={position} onChange={e=>setPosition(e.target.value)}><option>All positions</option><option>Initial</option><option>Medial</option><option>Final</option></select></div><div className="mt-6 flex items-center justify-between"><div><div className="sb-kicker">Curated word bank</div><p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">{filtered.length} live curriculum words</p></div><span className="rounded-full bg-[#e0efeb] px-3 py-1.5 text-xs font-bold text-[#286b62]">{selected.length} selected</span></div><div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{filtered.map(item=><button key={item.word} onClick={()=>toggle(item.word)} className={`rounded-2xl border p-4 text-left transition ${selected.includes(item.word)?"border-[#4d9186] bg-[#e0efeb]":"border-[hsl(var(--border))] bg-[#fffdf7] hover:border-[#d8b56b]"}`}><div className="flex items-start justify-between"><span className="sb-display text-2xl font-semibold text-[#245c55]">{item.word}</span>{selected.includes(item.word)&&<Check size={17} className="text-[#286b62]"/>}</div><div className="mt-3 flex flex-wrap gap-1.5 text-[10px] font-bold text-[hsl(var(--muted-foreground))]"><span className="rounded-full bg-[#f5f1e9] px-2 py-1">{item.sound} · {item.position}</span><span className="rounded-full bg-[#fbf0d2] px-2 py-1">{item.difficulty}</span></div><p className="mt-2 text-[11px] text-[hsl(var(--muted-foreground))]">Age {item.age}</p></button>)}</div></section><aside className="sb-card bg-[#245c55] p-6 text-[#fff8ec]"><div className="flex items-center gap-2 text-[#f8c968]"><Sparkles size={17}/><span className="sb-kicker text-[#fff8ec]/55">AI-guided learning</span></div><h2 className="sb-display mt-4 text-2xl leading-tight">Use the therapist plan as the source of truth.</h2><p className="mt-4 text-sm leading-6 text-[#fff8ec]/65">Select curriculum words, then save them through the plan builder. AI can help explain the plan, but it does not make the clinical decision.</p><Link href="/app/therapist/plans" className="sb-button sb-button-warm mt-6">Open plan builder <ArrowRight size={15}/></Link></aside></div></main></AppShell>;
}

function PlansPage() {
  const [location] = useLocation();
  const requestedSlug = location.match(/[?&]child=([^&]+)/)?.[1]?.toLowerCase();
  const [requestedChild, setRequestedChild] = useState<LiveChildShape | null>(null);
  const selectedChild = requestedChild || (requestedSlug ? getLiveChildren().find(child => child.slug === requestedSlug) : getSelectedChildProfile());
  type TargetGroup = { id: string; sound: string; position: string; words: string[] };
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [planId, setPlanId] = useState<string | null>(null);
  const [targets, setTargets] = useState<TargetGroup[]>([]);
  const [activeTargetId, setActiveTargetId] = useState<string | null>(null);
  const [tier, setTier] = useState("Whole Word");
  const [therapistOverrideTier, setTherapistOverrideTier] = useState<string>("");
  const [cadence, setCadence] = useState(5);
  const [reviewDate, setReviewDate] = useState(dateInputValue(7));
  const [cue, setCue] = useState("");
  const [library, setLibrary] = useState<CurriculumItem[]>([]);
  const [libraryWord, setLibraryWord] = useState("");

  useEffect(() => {
    if (!requestedSlug) return;
    const inStore = getLiveChildren().find(child => child.slug === requestedSlug);
    if (inStore) { setRequestedChild(inStore); return; }
    void apiFetch<LiveChildShape[]>("/api/therapists/me/caseload")
      .then(rows => setRequestedChild(rows.map(normalizeLiveChild).find(child => child.slug === requestedSlug) || null))
      .catch(() => setRequestedChild(null));
  }, [requestedSlug]);

  useEffect(() => {
    void apiFetch<Array<{ word: string; target_sound: string; word_position: string; age_band: string; difficulty: string }>>("/api/curriculum")
      .then(rows => setLibrary(rows.map(row => ({ word: row.word, sound: row.target_sound, position: row.word_position, age: row.age_band, difficulty: row.difficulty }))))
      .catch(err => setError(err instanceof Error ? err.message : "Unable to load the word library."));
  }, []);

  useEffect(() => {
    if (!selectedChild) return;
    setSaved(false); setError("");
    void apiFetch<any>(`/api/children/${selectedChild.id}/plan`).then(plan => {
      if (!plan) {
        setPlanId(null); setTargets([]); setActiveTargetId(null); setTier("Whole Word"); setTherapistOverrideTier(""); setCadence(5); setReviewDate(dateInputValue(7)); setCue(""); return;
      }
      setPlanId(plan.id);
      const loaded = (plan.targets || []).map((target: any, i: number) => ({ id: `${target.sound}-${target.position}-${i}`, sound: target.sound, position: target.position, words: target.words || [] }));
      setTargets(loaded);
      setActiveTargetId(loaded[0]?.id || null);
      setTier(plan.tier); setTherapistOverrideTier(plan.therapist_override_tier || ""); setCadence(plan.cadence_per_week); setReviewDate(plan.review_date); setCue(plan.cue || ""); setLibraryWord("");
    }).catch(err => setError(err instanceof Error ? err.message : "Unable to load the plan."));
  }, [selectedChild?.id]);

  const activeTarget = targets.find(target => target.id === activeTargetId) || targets[0] || null;
  const sound = activeTarget?.sound || (library[0]?.sound || "/s/");
  const position = activeTarget?.position || "Initial";
  const selectedWords = activeTarget?.words || [];
  const availableLibrary = library.filter(item => item.sound === sound && item.position === position && !selectedWords.some(word => word.toLowerCase() === item.word.toLowerCase()));

  const addTarget = () => {
    const soundForNew = library.find(item => item.sound === sound)?.sound || sound;
    const group = { id: `${Date.now()}-${Math.random()}`, sound: soundForNew, position: "Initial", words: [] };
    setTargets(current => [...current, group]); setActiveTargetId(group.id); setLibraryWord("");
  };
  const removeTarget = (id: string) => {
    setTargets(current => current.filter(target => target.id !== id));
    if (activeTargetId === id) setActiveTargetId(targets.find(target => target.id !== id)?.id || null);
  };
  const updateActive = (patch: Partial<TargetGroup>) => {
    if (!activeTargetId) return;
    setTargets(current => current.map(target => target.id === activeTargetId ? { ...target, ...patch } : target));
    setLibraryWord("");
  };
  const addLibraryWord = () => {
    if (!activeTarget || !libraryWord) return;
    if (activeTarget.words.length >= 8) { setError("Each target can contain up to 8 practice words."); return; }
    if (!activeTarget.words.some(word => word.toLowerCase() === libraryWord.toLowerCase())) updateActive({ words: [...activeTarget.words, libraryWord] });
    setLibraryWord(""); setError("");
  };
  const removeWord = (word: string) => updateActive({ words: selectedWords.filter(item => item !== word) });

  const savePlan = async () => {
    if (!selectedChild) return;
    const cleanedTargets = targets.map(target => ({ sound: target.sound.trim(), position: target.position.trim(), words: [...new Set(target.words.map(word => word.trim()).filter(Boolean))] })).filter(target => target.words.length);
    if (!cleanedTargets.length) { setError("Add at least one target with at least one word from the library."); return; }
    setError(""); setSaved(false);
    try {
      const payload = { targets: cleanedTargets, tier, therapist_override_tier: therapistOverrideTier || null, cadence_per_week: cadence, review_date: reviewDate, cue };
      const path = planId ? `/api/therapy-plans/${planId}` : `/api/children/${selectedChild.id}/plan`;
      const savedPlan = await apiFetch<{ id: string }>(path, { method: planId ? "PATCH" : "POST", body: JSON.stringify(payload) });
      setPlanId(savedPlan.id);
      setTargets(cleanedTargets.map((target, i) => ({ ...target, id: `${target.sound}-${target.position}-${i}` })));
      setActiveTargetId(prev => prev || `${cleanedTargets[0].sound}-${cleanedTargets[0].position}-0`);
      setSaved(true); window.dispatchEvent(new Event("sound-buddy-data-change"));
    } catch (err) { setError(err instanceof Error ? err.message : "Plan could not be saved."); }
  };

  if (!selectedChild) return <AppShell><main className="sb-content"><div className="sb-card p-8">No child selected.</div></main></AppShell>;
  return <AppShell>
    <main className="sb-content">
      <TopBar eyebrow={`Practice plans · ${selectedChild.name}`} title="Shape the next small step." action={<button onClick={() => void savePlan()} className="sb-button sb-button-primary" data-testid="button-save-plan"><Save size={15} /> Save plan</button>} />
      {saved && <div className="mb-5 rounded-xl bg-[#e0efeb] px-4 py-3 text-sm font-bold text-[#286b62]"><Check size={17} className="mr-2 inline" /> Live plan saved for {selectedChild.name}.</div>}
      {error && <div role="alert" className="mb-5 rounded-xl bg-[#fcede7] px-4 py-3 text-sm font-semibold text-[#a44f40]">{error}</div>}
      <div className="grid gap-6 xl:grid-cols-[1.25fr_.75fr]">
        <section className="sb-card p-6 sm:p-8">
          <div className="mb-6"><div className="sb-kicker">{selectedChild.name}’s active plan</div><h2 className="sb-display mt-1 text-2xl font-semibold">Assign targets and words from the library.</h2><p className="mt-2 text-sm leading-6 text-[hsl(var(--muted-foreground))]">Each target keeps its sound, word position, and assigned curriculum words.</p></div>
          <div className="mb-5 flex flex-wrap gap-2">{targets.map((target, i) => <button key={target.id} type="button" onClick={() => setActiveTargetId(target.id)} className={`rounded-xl border px-3 py-2 text-xs font-bold ${activeTarget?.id === target.id ? "border-[#286b62] bg-[#e0efeb] text-[#286b62]" : "border-[hsl(var(--border))]"}`}>{target.sound} · {target.position} · {target.words.length} words <span onClick={e => { e.stopPropagation(); removeTarget(target.id); }} className="ml-2 text-[#bf5b49]">×</span></button>)}<button type="button" onClick={addTarget} className="sb-button sb-button-outline"><Plus size={14}/> Add target</button></div>
          {activeTarget && <div className="grid gap-5 sm:grid-cols-2">
            <label><span className="sb-kicker mb-2 block">Target sound</span><select className="sb-input text-lg font-bold" value={activeTarget.sound} onChange={e => updateActive({ sound: e.target.value, words: [] })}>{Array.from(new Set(library.map(item => item.sound))).map(item => <option key={item}>{item}</option>)}</select></label>
            <label><span className="sb-kicker mb-2 block">Word position</span><select className="sb-input" value={activeTarget.position} onChange={e => updateActive({ position: e.target.value, words: [] })}><option>Initial</option><option>Medial</option><option>Final</option></select></label>
            <div className="sm:col-span-2"><span className="sb-kicker mb-2 block">Word library</span><div className="flex gap-2"><select className="sb-input min-w-0 flex-1" value={libraryWord} onChange={e => setLibraryWord(e.target.value)} data-testid="select-plan-word-library"><option value="">{availableLibrary.length ? "Choose a curriculum word…" : "No matching words available"}</option>{availableLibrary.map(item => <option key={`${item.sound}-${item.position}-${item.word}`} value={item.word}>{item.word} · {item.difficulty} · Age {item.age}</option>)}</select><button type="button" onClick={addLibraryWord} disabled={!libraryWord || selectedWords.length >= 8} className="sb-button sb-button-outline"><Plus size={14}/> Add</button></div></div>
            <div className="sm:col-span-2"><span className="sb-kicker mb-2 block">Words assigned to {selectedChild.name.split(" ")[0]}</span><div className="min-h-16 rounded-2xl border border-[hsl(var(--border))] bg-[#fffdf7] p-3">{selectedWords.length ? <div className="flex flex-wrap gap-2">{selectedWords.map(word => <span key={word} className="inline-flex items-center gap-2 rounded-full bg-[#e0efeb] px-3 py-2 text-xs font-bold text-[#286b62]">{word}<button type="button" onClick={() => removeWord(word)} aria-label={`Remove ${word}`} className="text-[#bf5b49]">×</button></span>)}</div> : <p className="text-sm text-[hsl(var(--muted-foreground))]">No words assigned yet.</p>}</div></div>
          </div>}
          <div className="mt-6 grid gap-5 sm:grid-cols-2"><label><span className="sb-kicker mb-2 block">Practice tier</span><select className="sb-input" value={tier} onChange={e => setTier(e.target.value)}><option>Whole Word</option><option>Isolation</option><option>Sentence</option></select></label><label><span className="sb-kicker mb-2 block">Therapist override</span><select className="sb-input" value={therapistOverrideTier} onChange={e => setTherapistOverrideTier(e.target.value)}><option value="">Use assigned tier</option><option>Isolation</option><option>Whole Word</option><option>Sentence</option></select></label><label><span className="sb-kicker mb-2 block">Practice cadence</span><select className="sb-input" value={cadence} onChange={e => setCadence(Number(e.target.value))}><option value={5}>5 times a week</option><option value={4}>4 times a week</option><option value={3}>3 times a week</option></select></label><label><span className="sb-kicker mb-2 block">Review date</span><input className="sb-input" type="date" value={reviewDate} onChange={e => setReviewDate(e.target.value)} /></label></div>
          <div className="mt-8 border-t border-[hsl(var(--border))] pt-6"><div className="flex items-center gap-3"><div className="grid h-9 w-9 place-items-center rounded-xl bg-[#fbf0d2] text-[#a27020]"><Sparkles size={17}/></div><div><p className="text-sm font-bold">A gentle cue for {selectedChild.name.split(" ")[0]}</p><p className="text-xs text-[hsl(var(--muted-foreground))]">This note appears before practice.</p></div></div><textarea className="sb-input mt-4 min-h-24 resize-none" value={cue} onChange={e => setCue(e.target.value)} /></div>
        </section>
        <aside className="sb-card overflow-hidden"><div className="bg-[#245c55] p-6 text-[#fff8ec]"><div className="sb-kicker text-[#fff8ec]/55">Child preview</div><h3 className="sb-display mt-1 text-2xl">{selectedChild.name.split(" ")[0]}’s practice</h3><p className="mt-5 text-sm text-[#fff8ec]/70">{targets.reduce((n, t) => n + t.words.length, 0)} words · {targets.length} targets</p></div><div className="p-5 space-y-4">{targets.map(target => <div key={target.id} className="rounded-2xl bg-[#fff8ec] p-4"><div className="text-xs font-extrabold text-[#286b62]">{target.sound} · {target.position}</div><div className="mt-2 flex flex-wrap gap-2">{target.words.map(word => <span key={word} className="rounded-lg bg-[#fcede7] px-3 py-1.5 text-xs font-bold text-[#bf5b49]">{word}</span>)}</div></div>)}<div className="rounded-2xl bg-[#e0efeb] p-4 text-sm leading-6 text-[#3b6861]">Saving replaces the child’s active plan. The next session uses every target and word shown here.</div></div></aside>
      </div>
    </main>
  </AppShell>;
}

function ReviewPage() {
  const [items,setItems]=useState<Array<{child:LiveChildShape;priority:string;reviewDate?:string|null}>>([]); const [error,setError]=useState("");
  const load=async()=>{try{setItems(await apiFetch<typeof items>("/api/review-queue"));setError("");}catch(err){setError(err instanceof Error?err.message:"Unable to load the review queue.");}};
  useEffect(()=>{void load();const sync=()=>void load();window.addEventListener("sound-buddy-realtime",sync);return()=>window.removeEventListener("sound-buddy-realtime",sync);},[]);
  return <AppShell><main className="sb-content"><TopBar eyebrow={`Review queue · ${items.length} live items`} title="Your ear makes the difference." action={<button onClick={()=>void load()} className="sb-button sb-button-outline">Refresh <ArrowRight size={14}/></button>}/>{error&&<div role="alert" className="mb-4 rounded-xl bg-[#fcede7] p-3 text-sm font-semibold text-[#a44f40]">{error}</div>}{items.length?<div className="space-y-3">{items.map((item,i)=><Link key={item.child.id} href={`/app/therapist/children/${item.child.slug}`} className="sb-card sb-card-lift flex items-center gap-4 p-5"><Avatar initials={item.child.initials} color={item.child.color}/><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><strong>{item.child.name}</strong><span className="rounded-full bg-[#fcede7] px-2 py-1 text-[10px] font-bold text-[#bf5b49]">{item.priority}</span></div><p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">Mastery {Math.round(item.child.mastery)}% · adherence {Math.round(item.child.adherence)}%{item.reviewDate?` · review ${new Date(item.reviewDate).toLocaleDateString()}`:""}</p></div><span className="text-xs font-bold text-[#bf5b49]">Priority {i+1}</span><ChevronRight size={16}/></Link>)}</div>:<div className="sb-card p-10 text-center"><Check className="mx-auto text-[#286b62]" size={26}/><h3 className="sb-display mt-4 text-2xl">Your queue is clear.</h3><p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">No live review items currently need attention.</p></div>}</main></AppShell>;
}

function ChildPractice() {
  const [location] = useLocation();
  const selected = getChildProfile(
    (location.match(/\/app\/therapist\/children\/([^/?]+)/)?.[1] || getSelectedChildFromLocation()).toLowerCase(),
  );
  const child = selected || getSelectedChildProfile();
  const [realtimeStatus, setRealtimeStatus] = useState("connecting");
  type PracticeItem = { word: string; targetSound: string; position: string };
  const [practiceItems, setPracticeItems] = useState<PracticeItem[]>([]);
  const [targetSound, setTargetSound] = useState("/s/");
  const [wordPosition, setWordPosition] = useState("Initial");
  const [index, setIndex] = useState(0);
  const [recording, setRecording] = useState(false);
  const [results, setResults] = useState<Record<number, number>>({});
  const [heard, setHeard] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [practiceMode, setPracticeMode] = useState<"slow" | "normal">("slow");
  const [feedback, setFeedback] = useState("");
  const [recordingSupported, setRecordingSupported] = useState(true);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [guidance, setGuidance] = useState<TonguePlacementGuidance | null>(null);
  const [guidanceView, setGuidanceView] = useState<"front" | "side">("front");
  const [completionConfirmed, setCompletionConfirmed] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const word = practiceItems[index]?.word;

  const getCoachingTip = (score: number, phrase: string) => {
    if (score >= 80) return `Nice work! Keep the same mouth shape and say "${phrase}" a little slower for an extra smooth finish.`;
    if (score >= 60) return `You’re close. Try making the sound a bit longer and keep your lips relaxed before the word.`;
    return `Try again: start with the sound by itself, then say "${phrase}" gently and match the same mouth position.`;
  };

  useEffect(() => {
    const onStatus = (event: Event) => setRealtimeStatus((event as CustomEvent<string>).detail);
    window.addEventListener("sound-buddy-realtime-status", onStatus);
    return () => window.removeEventListener("sound-buddy-realtime-status", onStatus);
  }, []);

  useEffect(() => {
    setRecordingSupported(
      typeof window !== "undefined" &&
        "MediaRecorder" in window &&
        !!navigator.mediaDevices?.getUserMedia,
    );
  }, []);

  useEffect(() => {
    if (!child) return;
    setBusy(true);
    setError("");
    setIndex(0);
    setResults({});
    setCompletionConfirmed(false);

    Promise.all([
      apiFetch<{ targets?: Array<{ sound?: string; words?: string[]; position?: string }> } | null>(`/api/children/${child.id}/plan`),
      apiFetch<{ id: string }>(`/api/sessions?child_id=${child.id}`, { method: "POST" }),
    ])
      .then(([plan, session]) => {
        if (!plan) {
          setPracticeItems([]);
          setSessionId(session.id);
          setError("Your therapist hasn't set up a practice plan yet. Check back soon!");
          return;
        }
        const items = (plan.targets || []).flatMap(target => (target.words || []).map(word => ({ word, targetSound: target.sound || "/s/", position: target.position || "Initial" })));
        setPracticeItems(items);
        setTargetSound(items[0]?.targetSound || "/s/");
        setWordPosition(items[0]?.position || "Initial");
        setSessionId(session.id);
      })
      .catch(err => setError(err instanceof Error ? err.message : "Unable to start practice."))
      .finally(() => setBusy(false));
  }, [child?.id]);

  useEffect(() => {
    const item = practiceItems[index];
    if (item) { setTargetSound(item.targetSound); setWordPosition(item.position); }
  }, [index, practiceItems]);

  useEffect(() => {
    if (!targetSound) {
      setGuidance(null);
      return;
    }
    let cancelled = false;
    apiFetch<TonguePlacementGuidance[]>(
      `/api/tongue-placement-guidance?target_sound=${encodeURIComponent(targetSound)}`,
    )
      .then(rows => {
        if (!cancelled) setGuidance(rows[0] || null);
      })
      .catch(() => {
        if (!cancelled) setGuidance(null);
      });
    return () => {
      cancelled = true;
    };
  }, [targetSound]);

  useEffect(() => {
    setHeard(false);
    setFeedback("");
    setAudioUrl(current => {
      if (current) URL.revokeObjectURL(current);
      return null;
    });
  }, [word]);

  useEffect(() => {
    return () => {
      if (recorderRef.current && recorderRef.current.state !== "inactive") {
        recorderRef.current.stop();
      }
      if (audioUrl) URL.revokeObjectURL(audioUrl);
      if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    };
  }, [audioUrl]);

  const hear = () => {
    setHeard(true);
    if ("speechSynthesis" in window && word) {
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(new SpeechSynthesisUtterance(word));
    }
  };

  const finishRecording = async (blob: Blob) => {
    if (!child || !sessionId || !word || blob.size === 0) return;
    setRecording(false);
    setError("");

    const url = URL.createObjectURL(blob);
    setAudioUrl(current => {
      if (current) URL.revokeObjectURL(current);
      return url;
    });

    try {
      const form = new FormData();
      form.append("child_id", child.id);
      form.append("session_id", sessionId);
      form.append("word", word);
      form.append("target_sound", targetSound);
      form.append("word_position", wordPosition);
      form.append("audio", blob, `${word}.wav`);

      const score = await apiFetchForm<{
        overallScore: number;
        scoringToken: string;
        clinicalStatus?: string;
      }>("/api/attempts/score-preview", form);

      const result = await apiFetch<{
        mastery: number;
        adherence: number;
        recommendedTier: string;
        effectiveTier: string;
      }>("/api/attempts", {
        method: "POST",
        body: JSON.stringify({
          child_id: child.id,
          session_id: sessionId,
          word,
          target_sound: targetSound,
          word_position: wordPosition,
          scoring_token: score.scoringToken,
          duration_ms: Math.round(blob.size / 20),
        }),
      });

      setResults(current => ({
        ...current,
        [index]: Math.round(score.overallScore),
      }));
      setFeedback(getCoachingTip(score.overallScore, word));
      window.dispatchEvent(new CustomEvent("sound-buddy-data-change", { detail: result }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "We couldn't score that recording. Please try again.");
    }
  };

  const record = async () => {
    if (recording) {
      recorderRef.current?.stop();
      return;
    }

    if (!recordingSupported) {
      setError("Microphone recording is unavailable on this device.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorderRef.current = recorder;

      recorder.ondataavailable = event => {
        if (event.data.size) chunksRef.current.push(event.data);
      };

      recorder.onstop = () => {
        stream.getTracks().forEach(track => track.stop());
        void finishRecording(
          new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" }),
        );
        recorderRef.current = null;
      };

      recorder.start();
      setRecording(true);
      setResults(current => {
        const nextResults = { ...current };
        delete nextResults[index];
        return nextResults;
      });
    } catch {
      setError("Microphone access was not granted. Please allow microphone access and try again.");
    }
  };

  const next = () => {
    if (!Object.prototype.hasOwnProperty.call(results, index)) {
      setError("Record this word first so Buddy can score it.");
      return;
    }
    if (index < practiceItems.length - 1) {
      setIndex(index + 1);
      setError("");
    }
  };

  const reset = async () => {
    if (!child) return;
    setBusy(true); setError("");
    try {
      const session = await apiFetch<{ id: string }>(`/api/sessions?child_id=${child.id}`, { method: "POST" });
      setSessionId(session.id); setIndex(0); setResults({}); setCompletionConfirmed(false); setHeard(false); setFeedback("");
      setAudioUrl(current => { if (current) URL.revokeObjectURL(current); return null; });
    } catch (err) { setError(err instanceof Error ? err.message : "Could not start a new session."); }
    finally { setBusy(false); }
  };

  const completedScores = Object.values(results).filter(score => Number.isFinite(score));
  const totalAttempts = completedScores.length;
  const highScoreAttempts = completedScores.filter(score => score >= 70).length;
  const matchedWords = completedScores.filter(score => score >= 75).length;
  const consistency = totalAttempts ? Math.round((highScoreAttempts / totalAttempts) * 100) : 0;
  const averageScore = totalAttempts
    ? Math.round(completedScores.reduce((a, b) => a + b, 0) / totalAttempts)
    : 0;
  const allWordsScored = practiceItems.length > 0 && Object.keys(results).length === practiceItems.length;

  useEffect(() => {
    if (allWordsScored && sessionId && !completionConfirmed) {
      apiFetch(`/api/sessions/${sessionId}/complete`, { method: "POST" })
        .then(() => { setCompletionConfirmed(true); setError(""); })
        .catch(err => setError(err instanceof Error ? err.message : "Session could not be completed. Score every assigned word before finishing."));
    }
  }, [allWordsScored, sessionId, completionConfirmed]);

  const finished = allWordsScored && completionConfirmed;

  if (!child) {
    return (
      <div className="sb-page grid min-h-dvh place-items-center p-6">
        <div className="sb-card p-8 text-center">
          <h1 className="sb-display text-3xl font-semibold">No child is assigned to this account.</h1>
        </div>
      </div>
    );
  }

  if (busy) {
    return (
      <div className="sb-child-page grid min-h-dvh place-items-center">
        <div className="text-center">
          <div className="mx-auto h-9 w-9 animate-spin rounded-full border-2 border-[#ef765b] border-t-transparent" />
          <p className="mt-4 text-sm font-semibold text-[#617873]">Preparing your practice…</p>
        </div>
      </div>
    );
  }

  if (error && !practiceItems.length) {
    return (
      <div className="sb-child-page grid min-h-dvh place-items-center p-6">
        <div className="sb-card max-w-md p-8 text-center">
          <h1 className="sb-display text-3xl font-semibold">Practice isn't ready yet.</h1>
          <p className="mt-3 text-sm leading-6 text-[#617873]">{error}</p>
          <button onClick={() => window.location.reload()} className="sb-button sb-button-primary mt-6">
            Try again
          </button>
        </div>
      </div>
    );
  }

  return (
    <AppShell role="child">
      <div className="sb-child-page min-h-dvh sb-noise">
        <header className="flex items-center justify-end px-5 py-4 sm:px-10">
          <div className="flex items-center gap-3">
            <span className="hidden text-xs font-bold text-[#617873] sm:inline">
              {child.name.split(" ")[0]}’s practice
            </span>
            <span className="inline-flex items-center gap-2 rounded-full bg-[#e0efeb] px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-[#286b62]">
              {realtimeStatus === "connected" ? "Live" : realtimeStatus === "connecting" ? "Connecting" : "Offline"}
            </span>
            <button
              onClick={() => {
                void signOut();
                window.location.href = "/login";
              }}
              className="grid h-9 w-9 place-items-center rounded-full bg-[#f7ead8] text-[#41635d]"
              aria-label="Sign out"
            >
              <LogIn size={16} />
            </button>
          </div>
        </header>

        <style>{`
          .sb-child-page main::before,
          .sb-child-page main::after {
            display: none !important;
          }
        `}</style>

        <main className="mx-auto max-w-4xl px-5 pb-16 pt-6 sm:pt-10">
          <div className="mx-auto mb-5 flex max-w-md items-center gap-3">
            <span className="text-xs font-bold text-[#617873]">
              {Math.min(index + 1, practiceItems.length)} of {practiceItems.length}
            </span>
            <div className="sb-progress flex-1">
              <span
                style={{
                  width: `${(Object.keys(results).length / Math.max(practiceItems.length, 1)) * 100}%`,
                }}
              />
            </div>
            <span className="text-xs font-bold text-[#ef765b]">
              +{Object.keys(results).length} win
            </span>
          </div>

          <div className="mb-8 text-center">
            <span className="inline-flex items-center gap-2 rounded-full bg-[#f9df9e] px-3 py-1.5 text-xs font-bold text-[#826322]">
              <Sparkles size={14} /> You’re doing brave work
            </span>
            <h1 className="sb-display mt-5 text-5xl font-semibold text-[#203d3a] sm:text-6xl">
              {finished ? "You did it!" : "Your turn."}
            </h1>
            <p className="mt-3 text-base text-[#617873]">
              {finished
                ? `You completed ${totalAttempts} attempts. Consistency ${consistency}% · average ${averageScore}%`
                : `Practise ${targetSound} in the ${wordPosition.toLowerCase()} position with one word at a time.`}
            </p>
            {error && (
              <div
                role="alert"
                className="mx-auto mt-4 max-w-md rounded-xl bg-[#fcede7] p-3 text-left text-sm font-semibold text-[#a44f40]"
              >
                {error}
              </div>
            )}
          </div>

          {finished ? (
            <div className="sb-enter rounded-[30px] border-2 border-[#f0c889] bg-[#fffdf7] px-6 py-12 text-center shadow-[0_10px_0_#f3d9af]">
              <div className="mx-auto grid h-20 w-20 place-items-center rounded-full bg-[#f9df9e] text-[#a27020]">
                <Star size={35} fill="currentColor" />
              </div>
              <h2 className="sb-display mt-5 text-3xl font-semibold text-[#203d3a]">
                Session complete
              </h2>
              <p className="mt-3 text-sm text-[#617873]">
                You met today’s practice goal with {totalAttempts} try
                {totalAttempts === 1 ? "" : "ies"}. Your progress is now live for your care team.
              </p>
              <div className="mt-6 grid gap-3 sm:grid-cols-3">
                <div className="rounded-2xl bg-[#e0efeb] p-3">
                  <div className="text-[10px] uppercase tracking-[.16em] text-[#286b62]">Goal</div>
                  <div className="sb-display mt-2 text-2xl text-[#203d3a]">
                    {Math.min(100, Math.round((totalAttempts / Math.max(practiceItems.length, 1)) * 100))}%
                  </div>
                </div>
                <div className="rounded-2xl bg-[#fcede7] p-3">
                  <div className="text-[10px] uppercase tracking-[.16em] text-[#bf5b49]">Strong words</div>
                  <div className="sb-display mt-2 text-2xl text-[#203d3a]">
                    {matchedWords}/{totalAttempts}
                  </div>
                </div>
                <div className="rounded-2xl bg-[#fbf0d2] p-3">
                  <div className="text-[10px] uppercase tracking-[.16em] text-[#a27020]">Average</div>
                  <div className="sb-display mt-2 text-2xl text-[#203d3a]">{averageScore}%</div>
                </div>
              </div>
              <div className="mt-6 rounded-2xl border border-[#e5d7bf] bg-[#fff8ec] p-5 text-left">
                <div className="sb-kicker text-[#286b62]">Today’s word report</div>
                <div className="mt-3 divide-y divide-[#eadfcd]">
                  {practiceItems.map((practiceWord, wordIndex) => (
                    <div key={`${practiceWord.word}-${practiceWord.position}-${wordIndex}`} className="flex items-center justify-between gap-4 py-3">
                      <div className="flex min-w-0 items-center gap-3">
                        <span className="grid h-8 w-8 flex-none place-items-center rounded-full bg-[#e0efeb] text-xs font-bold text-[#286b62]">{wordIndex + 1}</span>
                        <span className="min-w-0"><span className="block truncate text-sm font-bold text-[#203d3a]">{practiceWord.word}</span><span className="text-[10px] font-bold text-[#617873]">{practiceWord.targetSound} · {practiceWord.position}</span></span>
                      </div>
                      <span className={`rounded-full px-3 py-1 text-xs font-extrabold ${results[wordIndex] >= 80 ? "bg-[#e0efeb] text-[#286b62]" : results[wordIndex] >= 60 ? "bg-[#fbf0d2] text-[#a27020]" : "bg-[#fcede7] text-[#bf5b49]"}`}>
                        {results[wordIndex]}%
                      </span>
                    </div>
                  ))}
                </div>
                <div className="mt-4 rounded-xl bg-[#e0efeb] p-3 text-xs font-semibold leading-5 text-[#3b6861]">
                  {averageScore >= 80
                    ? "Strong session. Keep the same tongue and mouth placement as you move into harder words."
                    : averageScore >= 60
                      ? "Good progress. Repeat the lower-scoring words and keep the therapist’s cue consistent."
                      : "This was a learning session. Repeat the words gently and use the tongue-placement guide before the next attempt."}
                </div>
              </div>
              <button onClick={reset} className="sb-button sb-button-primary mt-6">
                Practice again
              </button>
            </div>
          ) : (
            <div className="sb-enter rounded-[30px] border border-[#efdcb5] bg-[#fffdf7] p-5 shadow-[0_12px_0_#f4ebdc] sm:p-7">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="sb-kicker text-[#d8634f]">Tongue placement</div>
                  <h2 className="sb-display mt-1 text-2xl font-semibold text-[#203d3a]">{targetSound}</h2>
                </div>
                <div className="flex items-center self-start rounded-full border border-[#e5d2a7] bg-[#f7f0e1] p-1 text-xs font-bold text-[#826322]">
                  <button
                    type="button"
                    onClick={() => setPracticeMode("slow")}
                    className={`rounded-full px-3 py-1.5 ${practiceMode === "slow" ? "bg-[#fff8ec] text-[#203d3a]" : "text-[#826322]"}`}
                  >
                    Slow
                  </button>
                  <button
                    type="button"
                    onClick={() => setPracticeMode("normal")}
                    className={`rounded-full px-3 py-1.5 ${practiceMode === "normal" ? "bg-[#fff8ec] text-[#203d3a]" : "text-[#826322]"}`}
                  >
                    Normal
                  </button>
                </div>
              </div>

              <div className="mt-5 grid gap-4 md:grid-cols-[1.1fr_.9fr]">
                <div className="rounded-2xl bg-[#e0efeb] p-4">
                  <div className="flex items-center justify-between">
                    <span className="sb-kicker text-[#286b62]">Visual guide</span>
                    <div className="flex items-center rounded-full border border-[#bcd8d1] bg-[#fff8ec] p-1 text-[10px] font-bold text-[#286b62]">
                      <button
                        type="button"
                        onClick={() => setGuidanceView("front")}
                        className={`rounded-full px-2.5 py-1 ${guidanceView === "front" ? "bg-[#e0efeb]" : ""}`}
                        data-testid="button-guide-view-front"
                      >
                        Front
                      </button>
                      <button
                        type="button"
                        onClick={() => setGuidanceView("side")}
                        className={`rounded-full px-2.5 py-1 ${guidanceView === "side" ? "bg-[#e0efeb]" : ""}`}
                        data-testid="button-guide-view-side"
                      >
                        Side
                      </button>
                    </div>
                  </div>

                  <div className="mt-5 flex h-44 items-center justify-center overflow-hidden rounded-2xl bg-[#fff8ec] p-2">
                    <img
                      src={guidanceView === "front" ? "/tongue-placement-front.svg" : "/tongue-placement-side.svg"}
                      alt={`Tongue placement diagram for ${targetSound}, ${guidanceView} view`}
                      className="h-full w-full object-contain"
                    />
                  </div>

                  <p className="mt-3 text-center text-2xl font-semibold text-[#203d3a]">{targetSound}</p>

                  {word && (
                    <div className="mt-5 flex flex-col items-center gap-2">
                      <div className="text-[11px] font-extrabold tracking-[.18em] text-[#617873]">
                        SAY THIS WORD
                      </div>
                      <div className="flex min-h-[92px] w-full items-center justify-center gap-4 rounded-[24px] border-2 border-[#eee1ca] bg-[#fffdf8] px-5 py-4 shadow-[0_8px_20px_rgba(55,76,70,.08)]">
                        <span className="text-4xl sm:text-5xl" aria-hidden="true">
                          {getWordEmoji(word)}
                        </span>
                        <span className="text-5xl font-black tracking-wide text-[#214d48]">{word}</span>
                        <button
                          type="button"
                          onClick={hear}
                          className="grid h-12 w-12 flex-none place-items-center rounded-full bg-[#fff1c9] text-2xl transition-transform hover:scale-105"
                          aria-label={`Hear ${word}`}
                        >
                          🔊
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                <div className="rounded-2xl bg-[#fff8ec] p-4">
                  <div className="sb-kicker text-[#d8634f]">How to say it</div>
                  <p className="mt-3 text-sm leading-6 text-[#617873]">
                    {guidance?.tongue_position ||
                      (practiceMode === "slow"
                        ? "Place the tip near the top teeth, let a gentle hiss out, and say the word slowly."
                        : "Keep the same mouth shape, but move a little more quickly and stay relaxed.")}
                  </p>
                  <p className="mt-3 text-xs font-semibold text-[#617873]">
                    {guidance
                      ? `Airflow: ${guidance.airflow} · Voice: ${guidance.voice}`
                      : "Lips stay soft and the sound stays clear."}
                  </p>
                </div>
              </div>

              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                <div className="rounded-2xl bg-[#fcede7] p-4">
                  <div className="sb-kicker text-[#bf5b49]">Mouth and lips</div>
                  <p className="mt-3 text-sm leading-6 text-[#617873]">
                    {guidance?.mouth_position ||
                      "Keep your lips relaxed and a little smiley while the sound stays gentle and steady."}
                  </p>
                </div>
                <div className="rounded-2xl bg-[#fbf0d2] p-4">
                  <div className="sb-kicker text-[#a27020]">Coach cue</div>
                  <p className="mt-3 text-sm leading-6 text-[#617873]">
                    {guidance?.cue ||
                      (practiceMode === "slow"
                        ? "Try the sound by itself first, then say the word slowly."
                        : "Keep the same mouth shape and say the word clearly.")}
                  </p>
                </div>
              </div>

              {feedback && (
                <div className="mt-5 rounded-2xl border border-[#bcd8d1] bg-[#e0efeb] p-4">
                  <div className="flex items-center gap-2 text-[#286b62]">
                    <Star size={17} fill="currentColor" />
                    <span className="text-xs font-extrabold uppercase tracking-[.16em]">Buddy says</span>
                  </div>
                  <p className="mt-2 text-sm font-semibold leading-6 text-[#365f59]">{feedback}</p>
                </div>
              )}

              <div className="mt-7 rounded-[28px] bg-[#fffaf0] px-3 py-7 sm:px-6">
                <div className="mb-5 text-center">
                  <div className="text-3xl">🌞</div>
                  <div className="sb-kicker mt-2 text-[#a27020]">Your little goal</div>
                  <p className="mt-1 text-sm font-semibold text-[#617873]">
                    {results[index] ? "You made this win! Ready for the next step?" : "Listen, try, and earn your win."}
                  </p>
                </div>

                <div className="mx-auto grid max-w-3xl grid-cols-3 items-start gap-2 sm:gap-8">
                  <button
                    type="button"
                    onClick={hear}
                    className="group flex min-w-0 flex-col items-center gap-2 text-center text-[#234d49] transition-transform hover:-translate-y-1"
                    data-testid="button-hear-word"
                  >
                    <span className="grid h-20 w-20 place-items-center rounded-full border-4 border-[#9bcde9] bg-[#e5f4ff] text-3xl shadow-[0_7px_0_#c7e5f5] transition-transform group-hover:scale-105 sm:h-24 sm:w-24 sm:text-4xl">
                      🔊
                    </span>
                    <strong className="text-sm font-extrabold sm:text-base">{heard ? "Heard it!" : "Hear it"}</strong>
                    <small className="text-[11px] leading-4 text-[#6c8581] sm:text-xs">Listen first</small>
                  </button>

                  <button
                    type="button"
                    onClick={record}
                    disabled={!recordingSupported}
                    className="group flex min-w-0 flex-col items-center gap-2 text-center text-[#234d49] disabled:cursor-not-allowed disabled:opacity-50"
                    data-testid="button-record-practice"
                  >
                    <span
                      className={`grid h-28 w-28 place-items-center rounded-full border-[7px] border-[#ffe0df] bg-[#ef6262] text-5xl shadow-[0_9px_0_#cf4e50,0_14px_25px_rgba(207,78,80,.18)] transition-transform group-hover:scale-105 sm:h-32 sm:w-32 sm:text-6xl ${recording ? "animate-pulse" : ""}`}
                    >
                      🎙️
                    </span>
                    <strong className="text-sm font-extrabold sm:text-base">
                      {recording ? "Tap to stop" : "Tap to record"}
                    </strong>
                    <small className="text-[11px] leading-4 text-[#6c8581] sm:text-xs">
                      {recording ? "Recording…" : practiceMode === "slow" ? "Say it slowly" : "Say it clearly"}
                    </small>
                  </button>

                  <button
                    type="button"
                    onClick={next}
                    disabled={!word || !Object.prototype.hasOwnProperty.call(results, index) || index >= practiceItems.length - 1}
                    className={`group flex min-w-0 flex-col items-center gap-2 text-center text-[#234d49] ${
                      !word || !Object.prototype.hasOwnProperty.call(results, index) || index >= practiceItems.length - 1
                        ? "cursor-not-allowed opacity-40"
                        : "cursor-pointer"
                    }`}
                    data-testid="button-next-word"
                  >
                    <span
                      className={`grid h-20 w-20 place-items-center rounded-full border-4 text-4xl shadow-[0_7px_0_#dedede] transition-transform sm:h-24 sm:w-24 ${
                        index >= practiceItems.length - 1
                          ? "border-[#d7d7d7] bg-[#f2f2f2] text-[#8a8a8a]"
                          : "border-[#a8d5c9] bg-[#e4f3ef] text-[#286b62] group-hover:scale-105"
                      }`}
                    >
                      ➜
                    </span>
                    <strong className="text-sm font-extrabold sm:text-base">Next word</strong>
                    <small className="text-[11px] leading-4 text-[#6c8581] sm:text-xs">
                      {index >= practiceItems.length - 1 ? "Practice complete!" : results[index] ? "Go to the next word" : "Score this word first"}
                    </small>
                  </button>
                </div>
              </div>

              {results[index] !== undefined && (
                <div className="mt-5 flex flex-col items-center justify-center gap-1 text-center text-sm font-bold text-[#286b62]">
                  <div className="flex items-center gap-2">
                    <span className="grid h-8 w-8 place-items-center rounded-full bg-[#f9df9e]">⭐</span>
                    <span>Word score: {results[index]}%</span>
                  </div>
                  <span className="text-xs font-semibold text-[#617873]">
                    {results[index] >= 80 ? "Excellent clarity!" : results[index] >= 60 ? "Nice effort — keep practising." : "Good try — listen and try again."}
                  </span>
                </div>
              )}

              {audioUrl && (
                <div className="mt-5 overflow-hidden rounded-2xl border border-[#d9d0c4] bg-[#fff8ec] p-3 text-left">
                  <div className="flex items-center justify-between">
                    <span className="sb-kicker text-[#617873]">Latest try</span>
                    <button
                      type="button"
                      onClick={() =>
                        setAudioUrl(current => {
                          if (current) URL.revokeObjectURL(current);
                          return null;
                        })
                      }
                      className="text-xs font-bold text-[#bf5b49]"
                    >
                      Clear
                    </button>
                  </div>
                  <audio controls src={audioUrl} className="mt-3 w-full" />
                </div>
              )}
            </div>
          )}
        </main>
      </div>
    </AppShell>
  );
}

function TonguePlacementPage() {
  const [selectedSound, setSelectedSound] = useState("s");

  const sounds: Record<
    string,
    {
      symbol: string;
      name: string;
      video: string;
      tongue: string;
      mouth: string;
      airflow: string;
      coach: string;
      caution: string;
    }
  > = {
    s: {
      symbol: "/s/",
      name: "S sound",
      video: "s.mp4",
      tongue:
        "Place the tongue tip close to the upper teeth without touching them.",
      mouth:
        "Keep the lips relaxed and slightly spread.",
      airflow:
        "Let a narrow stream of air flow over the center of the tongue.",
      coach:
        "Try the sound by itself first, then say the whole word slowly.",
      caution:
        "Avoid placing the tongue directly between the teeth.",
    },

    r: {
      symbol: "/r/",
      name: "R sound",
      video: "r.mp4",
      tongue:
        "Keep the tongue slightly raised and curled back without touching the roof of the mouth.",
      mouth:
        "Keep the lips relaxed and slightly rounded.",
      airflow:
        "Keep the airflow smooth while maintaining the tongue shape.",
      coach:
        "Hold the tongue position and gently stretch the sound.",
      caution:
        "Do not press the tongue tightly against the roof of the mouth.",
    },

    sh: {
      symbol: "/sh/",
      name: "SH sound",
      video: "sh.mp4",
      tongue:
        "Raise the front part of the tongue toward the roof of the mouth.",
      mouth:
        "Round the lips slightly.",
      airflow:
        "Send a smooth stream of air over the middle of the tongue.",
      coach:
        "Make a quiet, long sound before trying the word.",
      caution:
        "Avoid spreading the lips too widely.",
    },

    m: {
      symbol: "/m/",
      name: "M sound",
      video: "m.mp4",
      tongue:
        "The tongue can rest comfortably while the lips come together.",
      mouth:
        "Close both lips gently.",
      airflow:
        "Let the sound resonate through the nose.",
      coach:
        "Hum the sound first, then open your mouth into the word.",
      caution:
        "Do not force the lips together tightly.",
    },

    t: {
      symbol: "/t/",
      name: "T sound",
      video: "t.mp4",
      tongue:
        "Touch the tongue tip to the area just behind the upper front teeth.",
      mouth:
        "Keep the lips relaxed.",
      airflow:
        "Build a small amount of air pressure and release it quickly.",
      coach:
        "Touch, stop the air, then release the sound.",
      caution:
        "Do not let the tongue come between the teeth.",
    },

    d: {
      symbol: "/d/",
      name: "D sound",
      video: "d.mp4",
      tongue:
        "Place the tongue tip just behind the upper front teeth.",
      mouth:
        "Keep the jaw and lips relaxed.",
      airflow:
        "Release the air gently as the tongue moves away.",
      coach:
        "Say the sound clearly, then connect it smoothly to the word.",
      caution:
        "Avoid using too much force when releasing the sound.",
    },
  };

  const current = sounds[selectedSound];

  return (
    <AppShell role="child">
      <main className="sb-content sb-child-page min-h-dvh sb-noise">

        {/* Header */}

        <div className="mx-auto max-w-5xl px-5 pb-16 pt-8 sm:px-8">

          <div className="mb-8 text-center">
            <div className="sb-kicker text-[#d8634f]">
              Tongue Placement
            </div>

            <h1 className="sb-display mt-2 text-4xl font-semibold text-[#203d3a] sm:text-5xl">
              See how your tongue moves
            </h1>

            <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-[#617873]">
              Choose a sound and watch how your tongue, mouth and airflow
              should move.
            </p>
          </div>

          {/* Sound selector */}

          <div className="mb-7 flex flex-wrap justify-center gap-2">
            {Object.entries(sounds).map(([key, sound]) => (
              <button
                key={key}
                type="button"
                onClick={() => setSelectedSound(key)}
                className={`rounded-full border px-5 py-2.5 text-sm font-bold transition ${
                  selectedSound === key
                    ? "border-[#286b62] bg-[#286b62] text-white"
                    : "border-[#e2d5c3] bg-[#fffdf7] text-[#203d3a] hover:-translate-y-0.5"
                }`}
              >
                {sound.symbol}
              </button>
            ))}
          </div>

          {/* Main card */}

          <section className="sb-card overflow-hidden p-5 sm:p-7">

            {/* Sound heading */}

            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">

              <div>
                <div className="sb-kicker text-[#d8634f]">
                  Current sound
                </div>

                <h2 className="sb-display mt-1 text-5xl font-semibold text-[#203d3a]">
                  {current.symbol}
                </h2>

                <p className="mt-1 text-sm text-[#617873]">
                  {current.name}
                </p>
              </div>

              <div className="w-fit rounded-full bg-[#f9df9e] px-4 py-2 text-xs font-bold text-[#826322]">
                Sound {current.symbol}
              </div>

            </div>

            {/* Video */}

            <div className="mt-6 overflow-hidden rounded-3xl bg-[#e0efeb] p-4">

              <video
                key={current.video}
                src={`/tongue-placements/${current.video}`}
                autoPlay
                loop
                muted
                playsInline
                controls
                className="mx-auto max-h-[500px] w-full rounded-2xl bg-[#fff8ec] object-contain"
              />

            </div>

            {/* Information cards */}

            <div className="mt-6 grid gap-3 sm:grid-cols-2">

              <div className="rounded-2xl bg-[#e0efeb] p-5">
                <div className="text-xl">👅</div>

                <div className="sb-kicker mt-3 text-[#286b62]">
                  Tongue position
                </div>

                <p className="mt-2 text-sm leading-6 text-[#617873]">
                  {current.tongue}
                </p>
              </div>

              <div className="rounded-2xl bg-[#fcede7] p-5">
                <div className="text-xl">👄</div>

                <div className="sb-kicker mt-3 text-[#bf5b49]">
                  Mouth & lips
                </div>

                <p className="mt-2 text-sm leading-6 text-[#617873]">
                  {current.mouth}
                </p>
              </div>

              <div className="rounded-2xl bg-[#fbf0d2] p-5">
                <div className="text-xl">💨</div>

                <div className="sb-kicker mt-3 text-[#a27020]">
                  Airflow
                </div>

                <p className="mt-2 text-sm leading-6 text-[#617873]">
                  {current.airflow}
                </p>
              </div>

              <div className="rounded-2xl bg-[#fff8ec] p-5">
                <div className="text-xl">🎯</div>

                <div className="sb-kicker mt-3 text-[#d8634f]">
                  Coach cue
                </div>

                <p className="mt-2 text-sm leading-6 text-[#617873]">
                  {current.coach}
                </p>
              </div>

            </div>

            {/* Common mistake */}

            <div className="mt-3 rounded-2xl border border-[#f0c889] bg-[#fffaf0] p-5">

              <div className="sb-kicker text-[#a27020]">
                ⚠️ Common mistake
              </div>

              <p className="mt-2 text-sm leading-6 text-[#826322]">
                {current.caution}
              </p>

            </div>

            {/* Practice section */}

            <div className="mt-6 flex flex-col gap-4 rounded-2xl bg-[#203d3a] p-5 sm:flex-row sm:items-center sm:justify-between">

              <div>
                <div className="sb-kicker text-[#f9df9e]">
                  Ready?
                </div>

                <h3 className="mt-1 text-lg font-semibold text-white">
                  Now try {current.symbol} yourself.
                </h3>
              </div>

              <a
                href="/app/child/practice"
                className="sb-button sb-button-primary"
              >
                🎤 Practice {current.symbol}
              </a>

            </div>

          </section>

        </div>

      </main>
    </AppShell>
  );
}
function CaregiverMessages() {
  const selectedChild = getSelectedChildProfile();
  const [messages, setMessages] = useState<Array<{ id: string; body: string; sender_user_id: string; created_at: string }>>([]);
  const [draft, setDraft] = useState(""); const [error, setError] = useState(""); const [sending, setSending] = useState(false);
  const load = async () => { if (!selectedChild) return; try { setMessages(await apiFetch<typeof messages>(`/api/messages/${selectedChild.id}`)); setError(""); } catch (err) { setError(err instanceof Error ? err.message : "Unable to load messages."); } };
  useEffect(() => { void load(); const sync = () => void load(); window.addEventListener("sound-buddy-realtime", sync); return () => window.removeEventListener("sound-buddy-realtime", sync); }, [selectedChild?.id]);
  if (!selectedChild) return <AppShell role="caregiver"><main className="sb-content"><div className="sb-card p-8 text-center">No child is linked to this account.</div></main></AppShell>;
  const send = async () => { const body = draft.trim(); if (!body) return; setSending(true); setError(""); try { const message = await apiFetch<typeof messages[number]>("/api/messages", { method: "POST", body: JSON.stringify({ child_id: selectedChild.id, recipient_user_id: selectedChild.therapist_id, body }) }); setMessages(current => [...current, message]); setDraft(""); } catch (err) { setError(err instanceof Error ? err.message : "Message could not be sent."); } finally { setSending(false); } };
  return <AppShell role="caregiver"><main className="sb-content"><TopBar eyebrow={`${selectedChild.name.split(" ")[0]}’s care circle`} title="Messages with the care team." action={<Link href="/app/caregiver/dashboard" className="sb-button sb-button-outline"><Home size={15}/> Back home</Link>} />{error && <div role="alert" className="mb-4 rounded-xl bg-[#fcede7] p-3 text-sm font-semibold text-[#a44f40]">{error}</div>}<section className="sb-card max-w-3xl p-6 sm:p-8"><div className="max-h-[55vh] space-y-3 overflow-y-auto">{messages.map(message => <div key={message.id} className={`max-w-xl rounded-2xl p-4 text-sm leading-6 ${message.sender_user_id === selectedChild.therapist_id ? "bg-[#f5f1e9]" : "ml-auto bg-[#e0efeb]"}`}><p>{message.body}</p><p className="mt-2 text-[10px] text-[hsl(var(--muted-foreground))]">{new Date(message.created_at).toLocaleString()}</p></div>)}{!messages.length && <p className="py-10 text-center text-sm text-[hsl(var(--muted-foreground))]">No messages yet.</p>}</div><div className="mt-5 flex gap-2"><input className="sb-input" value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={e => { if(e.key === "Enter") void send(); }} placeholder="Send a message..."/><button onClick={() => void send()} disabled={!draft.trim() || sending} className="grid h-11 w-11 flex-none place-items-center rounded-xl bg-[#245c55] text-[#fff8ec] disabled:opacity-40"><Send size={16}/></button></div></section></main></AppShell>;
}

function CaregiverDashboard() {
  const selectedChild = getSelectedChildProfile();
  const [progress, setProgress] = useState<{ mastery: number; adherence: number; average_score: number; recent_average: number; current_tier: string } | null>(null);
  const [history, setHistory] = useState<Array<{ created_at: string; mastery: number }>>([]);
  const [messages, setMessages] = useState<Array<{ id: string; body: string; created_at: string; sender_user_id: string }>>([]);
  const [error, setError] = useState("");
  const load = async () => { if (!selectedChild) return; try { const [p,h,m] = await Promise.all([apiFetch<typeof progress>(`/api/children/${selectedChild.id}/progress`), apiFetch<typeof history>(`/api/children/${selectedChild.id}/progress/history`), apiFetch<typeof messages>(`/api/messages/${selectedChild.id}`)]); setProgress(p); setHistory(h); setMessages(m); setError(""); } catch(err) { setError(err instanceof Error ? err.message : "Unable to load your child's live data."); } };
  useEffect(() => { void load(); const sync = () => void load(); window.addEventListener("sound-buddy-realtime", sync); return () => window.removeEventListener("sound-buddy-realtime", sync); }, [selectedChild?.id]);
  if (!selectedChild) return <AppShell role="caregiver"><main className="sb-content"><div className="sb-card p-8 text-center">No child is linked to this account.</div></main></AppShell>;
  const mastery = Math.round(progress?.mastery ?? selectedChild.mastery); const adherence = Math.round(progress?.adherence ?? selectedChild.adherence); const latest = progress?.recent_average ? Math.round(progress.recent_average) : mastery;
  return <AppShell role="caregiver"><main className="sb-content"><TopBar eyebrow={`${selectedChild.name.split(" ")[0]}’s care circle · live`} title="A little practice. A lot of proud." action={<Link href="/app/caregiver/messages" className="sb-button sb-button-outline"><MessageCircle size={15}/> Messages</Link>} />{error && <div role="alert" className="mb-5 rounded-xl bg-[#fcede7] p-3 text-sm font-semibold text-[#a44f40]">{error}</div>}<section className="sb-card overflow-hidden bg-[#fffaf1]"><div className="grid items-center gap-8 bg-[#e0efeb] px-6 py-8 sm:px-9 lg:grid-cols-[1.2fr_.8fr]"><div><div className="flex items-center gap-3"><Avatar initials={selectedChild.initials} color={selectedChild.color}/><div><p className="text-sm font-bold text-[#245c55]">{selectedChild.name} · Age {selectedChild.age}</p><p className="text-xs text-[#617873]">{todayLabel()}</p></div></div><h2 className="sb-display mt-7 text-4xl font-semibold leading-tight text-[#203d3a]">Ready for one<br/><span className="text-[#d8634f]">small win?</span></h2><p className="mt-3 max-w-sm text-sm leading-6 text-[#48665f]">Latest practice signal: {latest}%. The active plan is ready for the next attempt.</p><Link href="/app/child/practice" className="sb-button sb-button-warm mt-6"><Play size={16} fill="currentColor"/> Start practice</Link></div><div className="relative hidden min-h-[230px] lg:block"><div className="sb-blob right-8 top-0 h-[220px] w-[250px] rotate-12 bg-[#f8c968]"/><div className="absolute right-14 top-8 grid h-[170px] w-[170px] place-items-center rounded-full border-2 border-dashed border-[#b68b3b]/40"><div className="grid h-24 w-24 place-items-center rounded-[32px] bg-[#ef765b] text-[#fff8ec] shadow-lg"><Volume2 size={40}/></div></div></div></div><div className="grid gap-6 p-6 sm:p-9 lg:grid-cols-[.75fr_1.25fr]"><div><div className="sb-kicker">This week</div><h3 className="sb-display mt-1 text-2xl font-semibold">Steady looks good.</h3><div className="mt-6 flex items-center gap-5"><ProgressRing value={adherence} label="adherence"/><div><p className="text-sm font-bold">{adherence}% adherence</p><p className="mt-1 text-xs leading-5 text-[hsl(var(--muted-foreground))]">Calculated from real practice days.</p></div></div></div><div className="rounded-2xl bg-[#f5f1e9] p-5"><div className="flex items-center justify-between"><div><div className="sb-kicker">Live progress</div><p className="sb-display mt-1 text-2xl font-semibold">Mastery {mastery}%</p></div><TrendingUp className="text-[#286b62]" size={20}/></div><div className="mt-7 flex items-end gap-2">{history.slice(-7).map((point,i)=><div className="flex flex-1 flex-col items-center gap-2" key={point.created_at}><div className="w-full rounded-t-md bg-[#4d9186]" style={{height:`${Math.max(8, point.mastery * .9)}px`, opacity:.45+i*.07}}/><span className="text-[9px] text-[hsl(var(--muted-foreground))]">{new Date(point.created_at).toLocaleDateString(undefined,{weekday:"short"}).slice(0,1)}</span></div>)}{!history.length && <p className="py-8 text-sm text-[hsl(var(--muted-foreground))]">Progress history will appear after the first live attempt.</p>}</div><p className="mt-4 text-xs text-[hsl(var(--muted-foreground))]">Current tier: <strong>{progress?.current_tier || "Not set"}</strong></p></div></div></section><div className="mt-6 grid gap-4 md:grid-cols-2"><div className="sb-card p-5"><div className="flex items-center gap-2 text-[#d8634f]"><MessageCircle size={17}/><span className="sb-kicker">Care team</span></div><p className="sb-display mt-5 text-xl leading-tight">{messages.at(-1)?.body || "No messages yet. Your therapist can leave guidance here."}</p>{messages.at(-1) && <p className="mt-4 text-xs text-[hsl(var(--muted-foreground))]">{new Date(messages.at(-1)!.created_at).toLocaleString()}</p>}<Link href="/app/caregiver/messages" className="mt-4 inline-block text-xs font-bold text-[#bf5b49]">Open messages <ArrowRight size={13} className="ml-1 inline"/></Link></div><div className="sb-card bg-[#245c55] p-5 text-[#fff8ec]"><div className="flex items-center gap-2 text-[#f8c968]"><Heart size={17} fill="currentColor"/><span className="sb-kicker text-[#fff8ec]/55">A note for you</span></div><p className="sb-display mt-5 text-2xl leading-tight">Notice the trying, not just the sound.</p><p className="mt-4 text-xs leading-6 text-[#fff8ec]/55">Your encouragement is part of the practice.</p></div></div></main></AppShell>;
}

export { PublicLanding, LoginPage, TherapistDashboard, ChildProfile, PlansPage, CurriculumPage, ReviewPage, ChildPractice, TonguePlacementPage, CaregiverDashboard, CaregiverMessages };