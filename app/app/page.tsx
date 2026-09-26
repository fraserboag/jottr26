'use client'

import { useEffect } from 'react'
import { WorkspaceProvider, useWorkspace } from '@/components/workspace/WorkspaceProvider'
import { Workspace } from '@/components/workspace/Workspace'
import { ServiceWorkerManager } from '@/components/ServiceWorkerManager'
import { SetupNotice } from '@/components/SetupNotice'
import { LoadingScreen } from '@/components/ui/LoadingScreen'
import { isSupabaseConfigured } from '@/lib/supabase/client'

/** The workspace is client-rendered on purpose.
 *
 *  Nothing here is server-gated, so the installed app can open this page from
 *  the service worker cache with no network at all, check the stored session
 *  locally, and render your notes from IndexedDB. A server-rendered, middleware
 *  protected route would be a blank screen on a plane. */
export default function AppPage() {
  if (!isSupabaseConfigured) return <SetupNotice />

  return (
    <WorkspaceProvider>
      <ServiceWorkerManager />
      <Gate />
    </WorkspaceProvider>
  )
}

function Gate() {
  const { ready, session } = useWorkspace()

  useEffect(() => {
    if (ready && !session) window.location.replace('/login')
  }, [ready, session])

  if (!ready || !session) {
    return <LoadingScreen label={ready ? 'Taking you to sign in…' : 'Opening Jottr…'} />
  }

  return <Workspace />
}
