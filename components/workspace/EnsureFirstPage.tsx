'use client'

import { useEffect } from 'react'
import { useSyncStatus, useWorkspace } from './WorkspaceProvider'
import { ensureFirstPage } from '@/lib/db/welcome'
import type { PageRow } from '@/lib/db/schema'

/** A brand new account gets one page to land on rather than an empty screen.
 *  A component rather than a hook in the workspace, so the sync status it
 *  waits on re-renders nothing but this. */
export function EnsureFirstPage({
  pages,
  onCreated,
}: {
  pages: PageRow[]
  onCreated: (id: string) => void
}) {
  const { userId } = useWorkspace()
  const { lastSyncedAt } = useSyncStatus()

  useEffect(() => {
    if (!userId || pages.length > 0) return
    // Only once the server has confirmed the account really is empty. A device
    // that first opens offline would otherwise write a duplicate page.
    if (lastSyncedAt === null) return
    void ensureFirstPage().then((id) => {
      if (id) onCreated(id)
    })
  }, [userId, pages, lastSyncedAt, onCreated])

  return null
}
