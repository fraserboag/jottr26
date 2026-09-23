"use client";

import { useRef, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { Popover } from "@/components/ui/Popover";
import { useWorkspace } from "./WorkspaceProvider";
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

export function SyncIndicator() {
  const { status, retrySync, syncNow, cancelSync } = useWorkspace();
  const [overlay, setOverlay] = useState<Overlay>(null);
  // Bumped on every start, cancel and close, so a sync that settles after its
  // overlay was dismissed cannot reopen it.
  const attempt = useRef(0);

  const startSync = async (retry: boolean) => {
    const id = ++attempt.current;
    setOverlay({ failure: null });
    const [result] = await Promise.all([
      retry ? retrySync() : syncNow(),
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

  const visual = look[status.phase];

  return (
    <>
      <Popover
        side="right"
        width={122}
        role="dialog"
        shadow="soft"
        className="rounded-md! p-0.5!"
        trigger={({ ref, toggle, open }) => (
          <button
            type="button"
            ref={ref}
            onClick={toggle}
            title={visual.label}
            aria-expanded={open}
            aria-label={`Sync: ${visual.label}`}
            className="flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2 text-[13px] font-medium text-muted transition-colors hover:bg-[var(--hover)] pointer-coarse:h-9 pointer-coarse:text-[14px]"
          >
            Sync
            <span aria-hidden="true" className={`size-1.5 rounded-full ${visual.dot}`} />
          </button>
        )}
      >
        {(close) => (
          <button
            type="button"
            onClick={() => {
              close();
              void startSync(status.phase === "error");
            }}
            className="flex h-[26px] w-full items-center justify-center gap-1.5 whitespace-nowrap rounded-[5px] px-2 text-[13px] font-medium text-ink transition-colors hover:bg-[var(--hover)] pointer-coarse:h-[30px] pointer-coarse:text-[14px]"
          >
            <Icon name="refresh" size={13} />
            Force sync
          </button>
        )}
      </Popover>

      {overlay && (
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
      )}
    </>
  );
}
