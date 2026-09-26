'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { storedSession, supabaseClient } from '@/lib/supabase/client'
import { closeDatabase, eraseDatabase, openDatabase } from '@/lib/db/dexie'
import { moveSearchTexts } from '@/lib/db/searchText'
import { releaseAll } from '@/lib/db/ydoc'
import { SyncEngine } from '@/lib/sync/engine'
import { initialStatus, type SyncStatus } from '@/lib/sync/types'

/** What rarely changes: who is signed in, and the actions. Kept apart from the
 *  sync status, which moves with every keystroke, so that most of the app does
 *  not re-render each time the pending count does. */
interface WorkspaceValue {
  session: Session | null
  userId: string | null
  /** True once we know whether there is a session and, if so, the local
   *  database is open. Everything downstream can assume storage is ready. */
  ready: boolean
  /** Syncs now, or retries at once if the last attempt failed. Resolves once
   *  that sync has finished, with how it went — or null when there is no
   *  engine to ask. */
  forceSync: () => Promise<SyncStatus | null>
  /** Abandons the sync in progress, for a network that never answers. */
  cancelSync: () => void
  signOut: () => Promise<void>
}

const WorkspaceContext = createContext<WorkspaceValue | null>(null)
const SyncStatusContext = createContext<SyncStatus>(initialStatus)

export function useWorkspace() {
  const value = useContext(WorkspaceContext)
  if (!value) throw new Error('useWorkspace must be used inside WorkspaceProvider')
  return value
}

export function useSyncStatus() {
  return useContext(SyncStatusContext)
}

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [ready, setReady] = useState(false)
  const [engineStatus, setEngineStatus] = useState<SyncStatus>(initialStatus)
  // Which account's database is open, so readiness can wait for it.
  const [openFor, setOpenFor] = useState<string | null>(null)
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

    const db = openDatabase(userId)
    const engine = new SyncEngine(supabaseClient(), userId)
    engineRef.current = engine
    // subscribe() hands over the current status straight away, so this is
    // also the signal that the database is open for this account.
    const unsubscribe = engine.subscribe((next) => {
      setOpenFor(userId)
      setEngineStatus(next)
    })
    // The engine waits for the search text to move off the page rows: a pull
    // rewrites a row whole, and would drop the text before it was copied.
    let stopped = false
    void moveSearchTexts(db)
      .catch(() => undefined)
      .then(() => {
        if (!stopped) void engine.start()
      })

    return () => {
      stopped = true
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

  // Read when a sync is forced, to choose between syncing and retrying,
  // without the actions having to change with every status.
  const statusRef = useRef(status)
  useEffect(() => {
    statusRef.current = status
  }, [status])

  const forceSync = useCallback(async () => {
    const engine = engineRef.current
    if (!engine) return null
    return statusRef.current.phase === 'error' ? engine.retryNow() : engine.syncNow()
  }, [])
  const cancelSync = useCallback(() => engineRef.current?.cancelSync(), [])

  const value = useMemo<WorkspaceValue>(
    () => ({
      session,
      userId,
      ready: ready && (!userId || openFor === userId),
      forceSync,
      cancelSync,
      signOut,
    }),
    [session, userId, ready, openFor, forceSync, cancelSync, signOut],
  )

  return (
    <WorkspaceContext.Provider value={value}>
      <SyncStatusContext.Provider value={status}>{children}</SyncStatusContext.Provider>
    </WorkspaceContext.Provider>
  )
}
