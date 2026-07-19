type Props = {
  error: unknown;
  componentStack?: string | null;
};

function ErrorFallback({ error, componentStack }: Props) {
  const summary =
    error instanceof Error
      ? `${error.name}: ${error.message}`
      : `Unknown error: ${String(error)}`;

  const details = [
    summary,
    error instanceof Error ? (error.stack ?? '') : '',
    componentStack ?? '',
  ]
    .filter(Boolean)
    .join('\n\n');

  return (
    <div role='alert'>
      <h1>Something went wrong</h1>
      <p>
        Jottr hit an error it couldn&rsquo;t recover from. Your saved notes are
        unaffected.
      </p>

      <pre>{details}</pre>

      <button type='button' onClick={() => window.location.reload()}>
        Reload
      </button>
      <button
        type='button'
        onClick={() => void navigator.clipboard?.writeText(details)}
      >
        Copy details
      </button>
    </div>
  );
}

export default ErrorFallback;
