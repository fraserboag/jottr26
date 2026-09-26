'use client'

import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

export const isSupabaseConfigured = Boolean(url && anonKey)

const STORAGE_KEY = 'jottr.auth'

let client: SupabaseClient | null = null

/** A single browser client for the whole app.
 *
 *  There is no server-rendered view of a user's notes — the workspace is a
 *  client shell reading IndexedDB — so sessions live in localStorage and no
 *  cookie/SSR bridge is needed. That is also what lets the installed PWA open
 *  straight into your notes with no network round trip. */
export function supabaseClient(): SupabaseClient {
  if (!isSupabaseConfigured) {
    throw new Error(
      'Supabase is not configured. Copy .env.example to .env.local and fill in NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.',
    )
  }
  client ??= createClient(url!, anonKey!, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storageKey: STORAGE_KEY,
    },
    realtime: { params: { eventsPerSecond: 5 } },
  })
  return client
}

/** The session as last saved on this device, read without the network.
 *
 *  Its access token may well have expired. Supabase will not hand such a
 *  session back while it cannot reach the server to refresh it, but it does
 *  keep it in storage, and only removes it when you sign out or the refresh is
 *  actually refused. So a stored session is still yours, and enough to open
 *  your notes offline. */
export function storedSession(): Session | null {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as Session | null
    return stored?.access_token && stored.refresh_token && stored.user?.id ? stored : null
  } catch {
    return null
  }
}
