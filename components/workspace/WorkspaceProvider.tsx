'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { storedSession, supabaseClient } from '@/lib/supabase/client'
import { activeDatabase, closeDatabase, eraseDatabase, openDatabase } from '@/lib/db/dexie'
import { releaseAll } from '@/lib/db/ydoc'
import { SyncEngine } from '@/lib/sync/engine'
import { initialStatus, type SyncStatus } from '@/lib/sync/types'

interface WorkspaceValue {
  session: Session | null
  userId: string | null
  /** True once we know whether there is a session and, if so, the local
   *  database is open. Everything downstream can assume storage is ready. */
  ready: boolean
  status: SyncStatus
  /** Both resolve once the sync they start has finished, with how it went —
   *  or null when there is no engine to ask. */
  retrySync: () => Promise<SyncStatus | null>
  syncNow: () => Promise<SyncStatus | null>
  /** Abandons the sync in progress, for a network that never answers. */
  cancelSync: () => void
  signOut: () => Promise<void>
  /** Unsynced pages, for the confirmation shown before signing out. */
  pendingCount: number
}

const WorkspaceContext = createContext<WorkspaceValue | null>(null)

export function useWorkspace() {
  const value = useContext(WorkspaceContext)
  if (!value) throw new Error('useWorkspace must be used inside WorkspaceProvider')
  return value
}

export function useSyncStatus() {
  return useWorkspace().status
}

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [ready, setReady] = useState(false)
  const [engineStatus, setEngineStatus] = useState<SyncStatus>(initialStatus)
  const engineRef = useRef<SyncEngine | null>(null)

  useEffect(() => {
    const supabase = supabaseClient()
    let cancelled = false

    // Open straight from storage rather than waiting on Supabase, which with an
    // expired token spends half a minute trying to refresh it when offline
    // and then reports no session at all.
    queueMicrotask(() => {
      const stored = storedSession()
      if (cancelled || !stored) return
      setSession((current) => current ?? stored)
      setReady(true)
    })

    // A null from Supabase is only believed once it has also cleared storage:
    // that is a real sign-out, not an unreachable server.
    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return
      setSession(data.session ?? storedSession())
      setReady(true)
    })

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next ?? storedSession())
      setReady(true)
    })

    return () => {
      cancelled = true
      subscription.subscription.unsubscribe()
    }
  }, [])

  const userId = session?.user.id ?? null

  useEffect(() => {
    if (!userId) {
      engineRef.current?.stop()
      engineRef.current = null
      releaseAll()
      closeDatabase()
      return
    }

    openDatabase(userId)
    const engine = new SyncEngine(supabaseClient(), userId)
    engineRef.current = engine
    const unsubscribe = engine.subscribe(setEngineStatus)
    void engine.start()

    return () => {
      unsubscribe()
      engine.stop()
      engineRef.current = null
      releaseAll()
    }
  }, [userId])

  // Signed out is a fact about the session, not a value the engine reports, so
  // it is derived rather than pushed into state from an effect.
  const status: SyncStatus = useMemo(
    () => (userId ? engineStatus : { ...initialStatus, phase: 'signedOut' }),
    [userId, engineStatus],
  )

  const signOut = useCallback(async () => {
    const id = userId
    engineRef.current?.stop()
    engineRef.current = null
    releaseAll()
    // Local scope: a server-side revoke needs the network, and being unable to
    // reach Supabase is not a reason to leave someone signed in on a device they
    // are trying to hand back.
    await supabaseClient()
      .auth.signOut({ scope: 'local' })
      .catch(() => undefined)

    // Notes are cloud-backed; leaving a copy in IndexedDB on a device that may
    // be shared is not a trade worth making. Another tab holding the database
    // open would make the delete wait, so it is given a deadline rather than
    // being allowed to hang the sign-out.
    if (id) {
      await Promise.race([
        eraseDatabase(id),
        new Promise((resolve) => setTimeout(resolve, 3000)),
      ])
    }
  }, [userId])

  const value = useMemo<WorkspaceValue>(
    () => ({
      session,
      userId,
      ready: ready && (!userId || activeDatabase() !== null),
      status,
      pendingCount: status.pending,
      retrySync: async () => (await engineRef.current?.retryNow()) ?? null,
      syncNow: async () => (await engineRef.current?.syncNow()) ?? null,
      cancelSync: () => engineRef.current?.cancelSync(),
      signOut,
    }),
    [session, userId, ready, status, signOut],
  )

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>
}
