/** Broadcasts Yjs deltas between tabs on this origin.
 *
 *  Tabs already share one IndexedDB, so they agree on what is stored — but each
 *  holds its own Y.Doc in memory. Without this, two open tabs showing the same
 *  page drift apart until a reload, which to a user is indistinguishable from
 *  broken sync. Deltas are tiny, so the channel stays cheap. */

type PeerMessage = { pageId: string; update: Uint8Array }
type PeerListener = (message: PeerMessage) => void

let channel: BroadcastChannel | null = null
const listeners = new Set<PeerListener>()

export function openPeerChannel(userId: string) {
  closePeerChannel()
  if (typeof BroadcastChannel === 'undefined') return
  channel = new BroadcastChannel(`jottr:peers:${userId}`)
  channel.onmessage = (event: MessageEvent<PeerMessage>) => {
    const message = event.data
    if (!message?.pageId || !message.update) return
    for (const listener of listeners) listener(message)
  }
}

export function closePeerChannel() {
  channel?.close()
  channel = null
}

export function broadcastUpdate(pageId: string, update: Uint8Array) {
  channel?.postMessage({ pageId, update })
}

export function onPeerUpdate(listener: PeerListener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
