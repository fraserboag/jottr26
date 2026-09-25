import type { Metadata } from "next";
import { SignedInRedirect } from "@/components/SignedInRedirect";
import { TAGLINE } from "@/lib/util/site";

const title = `Jottr – ${TAGLINE.toLowerCase()}`;
const description =
  "A notes app with the quality of life features of your favourite editor and none of the bloat: a streamlined feature set, fast performance and reliable syncing with offline support. Installable on desktop and mobile.";

export const metadata: Metadata = {
  title: { absolute: title },
  description,
  alternates: { canonical: "/" },
  openGraph: { type: "website", url: "/", siteName: "Jottr", title, description },
};

export default function LandingPage() {
  return (
    <div className="flex min-h-dvh items-start justify-center bg-surface px-5 pt-8 pb-16 sm:items-center sm:pt-10 sm:pb-16">
      <SignedInRedirect />
      <main className="w-full max-w-[34rem]">
        <h1 className="text-[1.75rem] font-semibold tracking-[-0.02em] text-ink">Jottr</h1>
        {/* Pre-encoded at 2x and 3x the column width and served as-is: running it through
            next/image re-encodes and rescales it, which visibly softens the UI text. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/screenshot-1632.webp"
          srcSet="/screenshot-1088.webp 1088w, /screenshot-1632.webp 1632w"
          sizes="(min-width: 34rem) 34rem, 100vw"
          alt="Jottr open on a desktop, showing the page sidebar and a note with subpages, a checklist and a callout"
          width={1632}
          height={1060}
          className="mt-4 h-auto w-full rounded-xl"
        />
        <p className="mt-6 text-[15px] leading-relaxed text-muted">
          A notes app with the quality of life features of your favourite editor, and none of the
          bloat. Jottr is focused on providing a clean UI, streamlined feature set, fast performance
          and reliable syncing with offline support.
        </p>
        <p className="mt-3 text-[15px] leading-relaxed text-muted">
          Jottr is a PWA, so even though it&apos;s only deployed as a web app it can be installed
          and function like a native app on your computer, tablet or phone.
        </p>
        <p className="mt-3 text-[15px] leading-relaxed text-muted">
          This is a project by{" "}
          <a
            href="https://www.boag.online"
            target="_blank"
            className="font-medium text-accent underline decoration-accent/30 underline-offset-[3px] transition-colors hover:decoration-accent"
          >
            Fraser Boag
          </a>
          , a software developer living in Glasgow, Scotland. As a huge Notion user for many years I
          created this for one simple reason - Notion has become a bloated mess of pointless (to me)
          features, and I knew I could do better. I created this entirely for personal use, but
          it&apos;s secure and production ready so if you&apos;ve come across this and want to give
          it a go yourself - be my guest.
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
