"use client";

import { useRef, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { useSyncStatus, useWorkspace } from "./WorkspaceProvider";
import { SyncOverlay } from "./SyncOverlay";
import type { SyncPhase } from "@/lib/sync/types";

// Three colours only: up to date, on its way, or not reaching the server.
const look: Record<SyncPhase, { dot: string; label: string }> = {
  synced: { dot: "bg-ok", label: "Synced" },
  syncing: { dot: "bg-warn", label: "Syncing" },
  pending: { dot: "bg-warn", label: "Syncing" },
  offline: { dot: "bg-danger", label: "Out of sync" },
  error: { dot: "bg-danger", label: "Out of sync" },
  signedOut: { dot: "bg-danger", label: "Out of sync" },
};

/** A quick sync would otherwise flash the overlay up and away too fast to read. */
const OVERLAY_MIN_MS = 600;

type Overlay = { failure: string | null } | null;

/** Retries a failed sync with its progress overlay, which is returned for the
 *  caller to render. */
export function useRetrySync() {
  const { retrySync, cancelSync } = useWorkspace();
  const [overlay, setOverlay] = useState<Overlay>(null);
  // Bumped on every start, cancel and close, so a sync that settles after its
  // overlay was dismissed cannot reopen it.
  const attempt = useRef(0);

  const startSync = async () => {
    const id = ++attempt.current;
    setOverlay({ failure: null });
    const [result] = await Promise.all([
      retrySync(),
      new Promise((resolve) => setTimeout(resolve, OVERLAY_MIN_MS)),
    ]);
    if (attempt.current !== id) return;

    if (result?.phase === "error") {
      setOverlay({ failure: result.error ?? "Something went wrong." });
    } else if (result?.phase === "offline") {
      setOverlay({
        failure: "You're offline. Your changes are saved on this device and will upload when you reconnect.",
      });
    } else {
      setOverlay(null);
    }
  };

  const element = overlay && (
    <SyncOverlay
      failure={overlay.failure}
      onCancel={() => {
        attempt.current += 1;
        cancelSync();
        setOverlay(null);
      }}
      onClose={() => {
        attempt.current += 1;
        setOverlay(null);
      }}
    />
  );

  return { startSync, overlay: element };
}

/** The sync row's value in the settings: how the sync stands, and after a
 *  failure a button to try again. */
export function SyncStatus({ onRetry }: { onRetry: () => void }) {
  const status = useSyncStatus();
  const visual = look[status.phase];

  return (
    <span className="flex items-center gap-2">
      <span aria-hidden="true" className={`size-2 shrink-0 rounded-full ${visual.dot}`} />
      <span className="text-muted">{visual.label}</span>
      {/* Syncing runs on its own; this is only for skipping the wait after a
          failure. Offline or signed out, a retry has nothing to reach. */}
      {status.phase === "error" && (
        <button
          type="button"
          onClick={onRetry}
          className="flex items-center gap-1.5 whitespace-nowrap rounded-md px-2 py-1 text-[13px] font-medium text-muted transition-colors hover:bg-[var(--hover)] hover:text-ink"
        >
          <Icon name="refresh" size={14} />
          Retry now
        </button>
      )}
    </span>
  );
}
