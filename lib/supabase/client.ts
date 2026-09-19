'use client'

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

export const isSupabaseConfigured = Boolean(url && anonKey)

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
      storageKey: 'jottr.auth',
    },
    realtime: { params: { eventsPerSecond: 5 } },
  })
  return client
}
