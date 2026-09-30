import type { Metadata } from 'next'
import { STARTUP_TIMING_SCRIPT } from '@/lib/util/startupTiming'

// A passive pointer, not a preload: only the service worker fetches this list.
export const metadata: Metadata = process.env.NODE_ENV === 'production'
  ? { other: { 'jottr-offline-manifest': process.env.JOTTR_OFFLINE_MANIFEST! } }
  : {}

export default function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: STARTUP_TIMING_SCRIPT }} />
      {children}
    </>
  )
}
