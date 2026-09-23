export function SetupNotice() {
  return (
    <main className="mx-auto grid min-h-dvh max-w-xl place-items-center px-6">
      <div>
        <h1 className="text-xl font-semibold text-ink">Jottr needs a Supabase project</h1>
        <p className="mt-2 leading-relaxed text-muted">
          Copy <code className="rounded bg-sunken px-1 py-0.5 text-[13px]">.env.example</code> to{' '}
          <code className="rounded bg-sunken px-1 py-0.5 text-[13px]">.env.local</code>, fill in your
          project URL and anon key, then run the SQL in{' '}
          <code className="rounded bg-sunken px-1 py-0.5 text-[13px]">supabase/schema.sql</code>.
        </p>
        <p className="mt-3 leading-relaxed text-faint">
          The full walkthrough is in the README.
        </p>
      </div>
    </main>
  )
}
