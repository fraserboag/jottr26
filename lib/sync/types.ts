export type SyncPhase =
  /** No account yet — nothing to sync. */
  | 'signedOut'
  /** No network. Edits are saved locally and queued. */
  | 'offline'
  /** A push or pull has been in flight long enough to be worth showing. Quick
   *  syncs never reach this state, so the indicator does not blink as you type. */
  | 'syncing'
  /** Everything on this device is on the server. */
  | 'synced'
  /** The last attempt failed; a retry is scheduled. */
  | 'error'

export interface SyncStatus {
  phase: SyncPhase
  /** Pages with changes the server has not acknowledged. */
  pending: number
  lastSyncedAt: number | null
  error: string | null
  /** Epoch ms of the next automatic retry, when phase is 'error'. */
  retryAt: number | null
}

export const initialStatus: SyncStatus = {
  phase: 'signedOut',
  pending: 0,
  lastSyncedAt: null,
  error: null,
  retryAt: null,
}
