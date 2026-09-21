import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { BrandMark } from "@/components/BrandMark";

export const dynamic = "force-dynamic";

// There's no self-serve signup path today (see middleware.ts's approval
// gate), so "Request access" has to reach a person, not a form.
const CONTACT_EMAIL = "imran@alaiahome.com";

interface Feature {
  icon: string;
  title: string;
  body: string;
}

const FEATURES: Feature[] = [
  {
    icon: "📐",
    title: "Plans & rooms",
    body: "Upload the architect's plan set and AI detects every room automatically. Track tasks room by room, with free-text styles, colors, and AI-generated design renderings.",
  },
  {
    icon: "💵",
    title: "Budget, bids & payments",
    body: "Compare contractor bids side by side, track spend against budget, run payment schedules, and reconcile bank transactions — all tied to the same construction.",
  },
  {
    icon: "🔧",
    title: "Warranty, the way homeowners actually use it",
    body: "Once a home is done, the owner gets their own portal to file warranty requests — grouped by trade, with photos and notes. You approve, assign a subcontractor, schedule the visit, and generate a job report to hand them.",
  },
  {
    icon: "🧰",
    title: "Subcontractors & compliance",
    body: "One shared subcontractor directory across every construction, license checks, and AI-assisted Certificate of Occupancy status lookups.",
  },
  {
    icon: "✨",
    title: "AI where it actually saves time",
    body: "Construction cost estimates grounded in real web data, product matching from a photo (Finish ID), and an AI-assembled House Book to hand the homeowner at closing.",
  },
  {
    icon: "💬",
    title: "One calendar, one chat, per construction",
    body: "Every open task, scheduled warranty visit, and team message lives with its construction — no digging through email threads to find what's due this week.",
  },
];

const ROLES = [
  { role: "Owner / Developer", body: "Full visibility across every construction you're running, budget to warranty." },
  { role: "Project Manager", body: "Run the day-to-day — tasks, bids, subcontractors, schedules." },
  { role: "Contractor", body: "Track your scope, submit bids, manage payments, close out warranty items." },
  { role: "Homeowner (Warranty)", body: "A simple portal to file and track warranty requests after move-in — nothing else to learn." },
];

export default async function Home() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // An existing account landing on "/" goes straight to their work, same as
  // always — this page is only ever the first thing a signed-out visitor sees.
  if (user) redirect("/projects");

  return (
    <div className="min-h-screen bg-concrete">
      <header className="border-b border-blueprint/10 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <BrandMark size="sm" />
          <nav className="flex items-center gap-3">
            <Link href="/login" className="text-sm font-medium text-blueprint/70 hover:text-blueprint-dark">
              Sign in
            </Link>
            <a href={`mailto:${CONTACT_EMAIL}?subject=Alaia%20Homes%20Dev%20access`} className="btn-amber text-sm">
              Request access
            </a>
          </nav>
        </div>
      </header>

      <main>
        {/* Hero */}
        <section className="relative overflow-hidden">
          <div aria-hidden className="pointer-events-none absolute inset-0">
            <div
              className="absolute left-1/2 top-[-15%] h-[560px] w-[560px] -translate-x-1/2 rounded-full opacity-30 blur-3xl"
              style={{ background: "radial-gradient(circle, rgba(29,99,196,0.20), transparent 70%)" }}
            />
          </div>
          <div className="relative mx-auto max-w-3xl px-6 py-20 text-center">
            <p className="animate-fade-in mb-3 text-sm font-semibold uppercase tracking-wide text-amber-dark">
              Construction project management
            </p>
            <h1 className="animate-fade-in-up text-4xl font-semibold leading-tight text-blueprint-dark sm:text-5xl">
              Run every construction from one place — plans to punch list to warranty.
            </h1>
            <p
              className="animate-fade-in-up mx-auto mt-5 max-w-xl text-lg text-blueprint/60"
              style={{ animationDelay: "80ms" }}
            >
              Alaia Homes Dev replaces the spreadsheets, group texts, and email threads a home build usually
              runs on — one shared system for the owner, PM, contractor, and eventually the homeowner
              themselves.
            </p>
            <div
              className="animate-fade-in-up mt-8 flex flex-wrap items-center justify-center gap-3"
              style={{ animationDelay: "140ms" }}
            >
              <a href={`mailto:${CONTACT_EMAIL}?subject=Alaia%20Homes%20Dev%20access`} className="btn-amber px-6 py-3 text-base">
                Request access
              </a>
              <Link href="/login" className="btn-outline px-6 py-3 text-base">
                Already have an account? Sign in
              </Link>
            </div>
          </div>
        </section>

        {/* Features */}
        <section className="mx-auto max-w-5xl px-6 pb-20">
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f, i) => (
              <div
                key={f.title}
                className="card animate-fade-in-up p-6"
                style={{ animationDelay: `${Math.min(i * 60, 300)}ms` }}
              >
                <div className="mb-3 text-2xl">{f.icon}</div>
                <h3 className="mb-1.5 font-semibold text-blueprint-dark">{f.title}</h3>
                <p className="text-sm leading-relaxed text-blueprint/60">{f.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Roles */}
        <section className="bg-white py-16">
          <div className="mx-auto max-w-5xl px-6">
            <h2 className="mb-2 text-center text-2xl font-semibold text-blueprint-dark">Built for everyone on the job</h2>
            <p className="mx-auto mb-10 max-w-xl text-center text-sm text-blueprint/60">
              Every role sees exactly what it needs — nothing more, nothing hidden that matters.
            </p>
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
              {ROLES.map((r) => (
                <div key={r.role} className="rounded-xl border border-blueprint/10 p-5">
                  <p className="mb-1.5 text-sm font-semibold text-blueprint-dark">{r.role}</p>
                  <p className="text-xs leading-relaxed text-blueprint/60">{r.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Closing CTA */}
        <section className="mx-auto max-w-3xl px-6 py-20 text-center">
          <h2 className="mb-3 text-2xl font-semibold text-blueprint-dark">Currently invite-only</h2>
          <p className="mb-8 text-sm text-blueprint/60">
            We&apos;re onboarding contractors and developers directly — reach out and we&apos;ll get your team set up.
          </p>
          <a href={`mailto:${CONTACT_EMAIL}?subject=Alaia%20Homes%20Dev%20access`} className="btn-amber px-6 py-3 text-base">
            Request access
          </a>
        </section>
      </main>

      <footer className="border-t border-blueprint/10 bg-white py-8">
        <div className="mx-auto max-w-5xl px-6 text-center text-xs text-blueprint/40">
          Alaia Homes Dev — construction project management.
        </div>
      </footer>
    </div>
  );
}
