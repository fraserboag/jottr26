"use client";

import { useEffect, useRef, useState } from "react";
import { Icon, type IconName } from "@/components/ui/Icon";
import { Popover } from "@/components/ui/Popover";
import { useWorkspace } from "./WorkspaceProvider";
import { SyncOverlay } from "./SyncOverlay";
import type { SyncPhase } from "@/lib/sync/types";

const relative = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

function timeAgo(timestamp: number | null) {
  if (!timestamp) return "not yet";
  const seconds = Math.round((timestamp - Date.now()) / 1000);
  if (seconds > -45) return "just now";
  if (seconds > -3600) return relative.format(Math.round(seconds / 60), "minute");
  if (seconds > -86400) return relative.format(Math.round(seconds / 3600), "hour");
  return relative.format(Math.round(seconds / 86400), "day");
}

const look: Record<SyncPhase, { icon: IconName; tone: string; label: string }> = {
  pending: { icon: "cloud", tone: "text-muted", label: "Not synced yet" },
  synced: { icon: "cloudCheck", tone: "text-muted", label: "Synced" },
  syncing: { icon: "refresh", tone: "text-muted", label: "Saving" },
  offline: { icon: "cloudOff", tone: "text-warn", label: "Offline" },
  error: { icon: "alert", tone: "text-danger", label: "Can't sync" },
  signedOut: { icon: "cloudOff", tone: "text-faint", label: "Signed out" },
};

/** A quick sync would otherwise flash the overlay up and away too fast to read. */
const OVERLAY_MIN_MS = 600;

type Overlay = { failure: string | null } | null;

export function SyncIndicator() {
  const { status, retrySync, syncNow, cancelSync } = useWorkspace();
  const [, forceTick] = useState(0);
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

  useEffect(() => {
    const timer = setInterval(() => forceTick((n) => n + 1), 30_000);
    return () => clearInterval(timer);
  }, []);

  // The engine only reports 'syncing' once a round trip is slow enough to be
  // worth mentioning, so there is no timing logic left to do here.
  const visual = look[status.phase];
  const saving = status.phase === "syncing";
  const waiting =
    status.pending > 0
      ? `${status.pending} ${status.pending === 1 ? "page" : "pages"} waiting to upload.`
      : null;

  const detail =
    status.phase === "error"
      ? (status.error ?? "Something went wrong.")
      : status.phase === "offline"
        ? (waiting ?? "Everything here was uploaded before you went offline.")
        : status.phase === "syncing"
          ? "Uploading your latest changes…"
          : status.phase === "pending"
            ? (waiting ?? "Waiting to upload.")
            : `Last synced ${timeAgo(status.lastSyncedAt)}.`;

  // Only the icon shows, so anything the old row carried in a badge — the
  // count of pages still waiting — has to reach the tooltip instead.
  const repeatsWaiting = status.phase === "offline" || status.phase === "pending";
  const summary = [saving ? "Saving…" : visual.label, detail, repeatsWaiting ? null : waiting]
    .filter(Boolean)
    .join(" — ");

  return (
    <>
      <Popover
        width={304}
        role="dialog"
        shadow="soft"
        trigger={({ ref, toggle, open }) => (
          <button
            type="button"
            ref={ref}
            onClick={toggle}
            title={summary}
            aria-expanded={open}
            aria-label={`Sync status: ${visual.label}`}
            className={`grid size-8 shrink-0 place-items-center rounded-md transition-colors hover:bg-[var(--hover)] pointer-coarse:size-9 ${visual.tone}`}
          >
            <Icon
              name={visual.icon}
              size={17}
              className={`pointer-coarse:size-[19px] ${saving ? "animate-spin" : ""}`}
            />
          </button>
        )}
      >
        {(close) => (
          <div className="p-3">
            <div className={`flex items-center gap-2 font-semibold ${visual.tone}`}>
              <Icon name={visual.icon} size={15} />
              {status.phase === "syncing" ? "Saving to your account" : visual.label}
            </div>

            <p className="mt-1.5 leading-relaxed text-muted">{detail}</p>

            {/* The one thing worth repeating in every state: nothing is at risk. */}
            <p className="mt-2.5 border-t border-line pt-2.5 text-[12px] leading-relaxed text-faint">
              Every keystroke is stored locally as you type. The synced state means it has been stored
              online and will be available on other devices.
            </p>

            {(status.phase === "error" ||
              status.phase === "offline" ||
              status.phase === "pending" ||
              status.phase === "synced") && (
              <button
                type="button"
                onClick={() => {
                  close();
                  void startSync(status.phase === "error");
                }}
                className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg border border-line px-3 py-1.5 font-medium transition-colors hover:bg-[var(--hover)]"
              >
                <Icon name="refresh" size={14} />
                {status.phase === "error" ? "Try again now" : "Sync now"}
              </button>
            )}
          </div>
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
