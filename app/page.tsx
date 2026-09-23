import { SignedInRedirect } from '@/components/SignedInRedirect'

export default function LandingPage() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-surface px-5 py-16">
      <SignedInRedirect />
      <main className="w-full max-w-[34rem] text-center">
        <h1 className="text-[1.75rem] font-semibold tracking-[-0.02em] text-ink">Jottr</h1>
        <p className="mt-3 text-[15px] leading-relaxed text-muted">
          A notes app with the quality of life features of Notion, and none of the bloat. Jottr is
          focused on providing a super streamlined feature set, lighting fast performance and
          reliable syncing with offline support.
        </p>
        <p className="mt-3 text-[15px] leading-relaxed text-muted">
          Jottr is a PWA, so even though it only exists as a website it can be installed and
          functions like an app on your computer or mobile devices.
        </p>
        <p className="mt-3 text-[15px] leading-relaxed text-muted">
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
      </main>
    </div>
  );
}
