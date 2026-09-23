'use client'

import { useEffect, useRef, useState } from 'react'
import { Icon } from '@/components/ui/Icon'
import { Logo } from '@/components/ui/Logo'
import { SetupNotice } from '@/components/SetupNotice'
import { isSupabaseConfigured, supabaseClient } from '@/lib/supabase/client'

type Stage = 'email' | 'code'

export default function LoginPage() {
  if (!isSupabaseConfigured) return <SetupNotice />
  return <SignIn />
}

function SignIn() {
  const [stage, setStage] = useState<Stage>('email')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [checking, setChecking] = useState(true)
  const codeRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    void supabaseClient()
      .auth.getSession()
      .then(({ data }) => {
        if (data.session) window.location.replace('/app')
        else setChecking(false)
      })
  }, [])

  useEffect(() => {
    if (stage === 'code') codeRef.current?.focus()
  }, [stage])

  const sendCode = async (event: React.FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    const { error: sendError } = await supabaseClient().auth.signInWithOtp({
      email: email.trim(),
      options: {
        shouldCreateUser: true,
        emailRedirectTo: `${window.location.origin}/app`,
      },
    })
    setBusy(false)
    if (sendError) setError(sendError.message)
    else setStage('code')
  }

  const verify = async (event: React.FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    const { error: verifyError } = await supabaseClient().auth.verifyOtp({
      email: email.trim(),
      token: code.trim(),
      type: 'email',
    })
    if (verifyError) {
      setBusy(false)
      setError(verifyError.message)
      return
    }
    window.location.replace('/app')
  }

  if (checking) {
    return (
      <main className="grid min-h-dvh place-items-center bg-surface">
        <Icon name="refresh" size={18} className="animate-spin text-faint" />
      </main>
    )
  }

  return (
    <main className="grid min-h-dvh place-items-center bg-sunken px-5 py-10">
      <div className="w-full max-w-[26rem]">
        {/* A real navigation, not a client transition: these are separate
            documents, which is what lets the service worker serve each of them
            offline without an RSC payload. */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a href="/" className="mb-7 flex items-center gap-2.5">
          <Logo className="size-8" />
          <span className="text-[15px] font-semibold text-ink">Jottr</span>
        </a>

        <div className="rounded-2xl border border-line bg-surface p-6 shadow-[var(--shadow-soft)]">
          {stage === 'email' ? (
            <form onSubmit={sendCode}>
              <h1 className="text-[19px] font-semibold tracking-[-0.01em] text-ink">Sign in</h1>
              <p className="mt-1.5 text-[13.5px] leading-relaxed text-muted pointer-coarse:text-[15px]">
                We&rsquo;ll email you a six-digit code. No password to forget.
              </p>

              <label htmlFor="email" className="mt-5 block text-[12.5px] font-medium text-muted pointer-coarse:text-[14px]">
                Email address
              </label>
              <input
                id="email"
                type="email"
                required
                autoFocus
                autoComplete="email"
                inputMode="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@example.com"
                className="mt-1.5 w-full rounded-lg border border-line bg-surface px-3 py-2.5 text-[14.5px] outline-none pointer-coarse:text-[16px] transition-colors placeholder:text-faint focus:border-[var(--accent)]"
              />

              <Submit busy={busy} label="Email me a code" icon="mail" />
              {error && <ErrorNote>{error}</ErrorNote>}
            </form>
          ) : (
            <form onSubmit={verify}>
              <h1 className="text-[19px] font-semibold tracking-[-0.01em] text-ink">Check your email</h1>
              <p className="mt-1.5 text-[13.5px] leading-relaxed text-muted pointer-coarse:text-[15px]">
                We sent a code to <span className="font-medium text-ink">{email}</span>.
              </p>

              <label htmlFor="code" className="mt-5 block text-[12.5px] font-medium text-muted pointer-coarse:text-[14px]">
                Six-digit code
              </label>
              <input
                id="code"
                ref={codeRef}
                required
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]*"
                maxLength={6}
                value={code}
                onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))}
                placeholder="000000"
                className="mt-1.5 w-full rounded-lg border border-line bg-surface px-3 py-2.5 text-center text-[20px] font-medium tracking-[0.35em] outline-none transition-colors placeholder:text-faint focus:border-[var(--accent)]"
              />

              <Submit busy={busy} label="Sign in" icon="check" />
              {error && <ErrorNote>{error}</ErrorNote>}

              {/* On iOS the emailed link opens in Safari, which does not share
                  storage with the installed app — so the code is the path that
                  always works, and the link is the convenience. */}
              <p className="mt-4 text-[12.5px] leading-relaxed text-faint">
                The email also contains a sign-in link. If you installed Jottr to your home
                screen, use the code here instead — the link would sign you in to your browser
                rather than the app.
              </p>

              <button
                type="button"
                onClick={() => {
                  setStage('email')
                  setCode('')
                  setError(null)
                }}
                className="mt-3 flex items-center gap-1.5 text-[12.5px] font-medium text-muted transition-colors hover:text-ink"
              >
                <Icon name="arrowLeft" size={13} />
                Use a different email
              </button>
            </form>
          )}
        </div>

        <p className="mt-5 text-center text-[12px] leading-relaxed text-faint">
          Your pages are private to your account and stored on your own device as you write.
        </p>
      </div>
    </main>
  )
}

function Submit({ busy, label, icon }: { busy: boolean; label: string; icon: 'mail' | 'check' }) {
  return (
    <button
      type="submit"
      disabled={busy}
      className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2.5 text-[14px] font-medium text-accent-contrast transition-opacity hover:opacity-90 disabled:opacity-60"
    >
      {busy ? (
        <Icon name="refresh" size={15} className="animate-spin" />
      ) : (
        <Icon name={icon} size={15} />
      )}
      {busy ? 'Working…' : label}
    </button>
  )
}

function ErrorNote({ children }: { children: React.ReactNode }) {
  return (
    <p role="alert" className="mt-3 flex items-start gap-1.5 text-[12.5px] leading-relaxed text-danger">
      <Icon name="alert" size={13} className="mt-0.5" />
      <span>{children}</span>
    </p>
  )
}
