import { Logo } from '@/components/ui/Logo'

export default function LandingPage() {
  return (
    <div className="min-h-dvh bg-surface">
      <header className="mx-auto flex max-w-5xl items-center justify-between px-5 py-5 sm:px-8">
        <div className="flex items-center gap-2.5">
          <Logo className="size-7" />
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
          <h1 className="text-[1.75rem] font-semibold tracking-[-0.02em] text-ink">Jottr</h1>
          <p className="mt-3 max-w-[56ch] text-[15px] leading-relaxed text-muted">
            A notes app with the quality of life features of Notion, and none of the bloat. Jottr is
            focused on providing a super streamlined feature set, lighting fast performance and
            reliable syncing with offline support.
          </p>
          <p className="mt-3 max-w-[56ch] text-[15px] leading-relaxed text-muted">
            Jottr is a PWA, so even though it only exists as a website it can be installed and
            functions like an app on your computer or mobile devices.
          </p>
          <p className="mt-3 max-w-[56ch] text-[15px] leading-relaxed text-muted">
            Jottr was created by Fraser Boag, a software developer living in Glasgow, Scotland. As a
            frequent Notion user for many years I created this for one simple reason - Notion has
            become a sluggish, bloated mess and I knew I could do better. I created this entirely
            for personal use, but it&apos;s set up with secure authentication so if anyone comes
            across this and wants to give it a go themselves - be my guest.
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
  );
}
