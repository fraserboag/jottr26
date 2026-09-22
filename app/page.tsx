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
        <section className="py-16 sm:py-20">
          <h1 className="text-[1.75rem] font-semibold tracking-[-0.02em] text-ink">
            Jottr
          </h1>
          <p className="mt-3 max-w-[56ch] text-[15px] leading-relaxed text-muted">
            A notebook. Pages are stored on your device and synced to your account in the
            background, so it works with or without a connection. Sign in to keep your pages
            across devices.
          </p>
          <div className="mt-7">
            <a
              href="/app"
              className="inline-block rounded-lg bg-accent px-5 py-2.5 text-[14.5px] font-medium text-accent-contrast transition-opacity hover:opacity-90"
            >
              Open Jottr
            </a>
          </div>
        </section>

        <footer className="py-12 text-[12.5px] text-faint">
          Built with Next.js, Supabase and Yjs.
        </footer>
      </main>
    </div>
  )
}
