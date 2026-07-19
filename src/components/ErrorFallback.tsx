import { isRouteErrorResponse } from 'react-router-dom';

type Props = {
  error: unknown;
  componentStack?: string | null;
};

function stringify(value: unknown) {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

function describe(error: unknown) {
  if (isRouteErrorResponse(error)) {
    const detail = error.data ? `: ${stringify(error.data)}` : '';
    return `${error.status} ${error.statusText}${detail}`;
  }
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }
  return `Unknown error: ${stringify(error)}`;
}

function ErrorFallback({ error, componentStack }: Props) {
  const details = [
    describe(error),
    window.location.href,
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
