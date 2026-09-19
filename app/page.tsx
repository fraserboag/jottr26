import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Jottr — a notebook that never waits',
}

const features = [
  {
    title: 'Instant, always',
    body: 'Pages are read from and written to your device first. Opening a page is a render, not a request, so nothing ever spins.',
  },
  {
    title: 'Sync you can see',
    body: "A single indicator tells you exactly where your changes are: on this device, on their way, or safely in your account. No guessing.",
  },
  {
    title: 'Conflicts that resolve themselves',
    body: 'Write on your laptop and your phone while both are offline. When they reconnect, the edits merge — nothing is overwritten.',
  },
  {
    title: 'Just enough formatting',
    body: 'Headings, lists, to-dos, quotes and code. Press / for blocks, or use the Markdown shortcuts you already know.',
  },
]

export default function LandingPage() {
  return (
    <div className="min-h-dvh bg-surface">
      <header className="mx-auto flex max-w-5xl items-center justify-between px-5 py-5 sm:px-8">
        <div className="flex items-center gap-2.5">
          <span className="grid size-7 place-items-center rounded-lg bg-[#1a1a19] text-[12px] font-bold text-white">
            J
          </span>
          <span className="text-[15px] font-semibold text-ink">Jottr</span>
        </div>
        <a
          href="/login"
          className="rounded-lg px-3 py-1.5 text-[13.5px] font-medium text-muted transition-colors hover:bg-[var(--hover)] hover:text-ink"
        >
          Sign in
        </a>
      </header>

      <main className="mx-auto max-w-5xl px-5 sm:px-8">
        <section className="py-16 sm:py-24">
          <h1 className="max-w-[16ch] text-[clamp(2.25rem,7vw,3.75rem)] font-bold leading-[1.05] tracking-[-0.03em] text-ink">
            A notebook that never waits.
          </h1>
          <p className="mt-5 max-w-[52ch] text-[clamp(1rem,2.2vw,1.175rem)] leading-relaxed text-muted">
            Jottr keeps your pages on your device and syncs them to your account in the
            background. Writing stays instant whether you have signal or not — and you can always
            tell what has made it across.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <a
              href="/app"
              className="rounded-lg bg-accent px-5 py-2.5 text-[14.5px] font-medium text-accent-contrast transition-opacity hover:opacity-90"
            >
              Start writing
            </a>
            <span className="text-[13px] text-faint">
              Free · works offline · installs to your home screen
            </span>
          </div>
        </section>

        <section className="grid gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-2">
          {features.map((feature) => (
            <div key={feature.title} className="bg-surface p-6 sm:p-7">
              <h2 className="text-[15px] font-semibold text-ink">{feature.title}</h2>
              <p className="mt-2 text-[13.5px] leading-relaxed text-muted">{feature.body}</p>
            </div>
          ))}
        </section>

        <footer className="py-12 text-[12.5px] text-faint">
          Built with Next.js, Supabase and Yjs.
        </footer>
      </main>
    </div>
  )
}
