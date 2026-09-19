import { fromBase64, toBase64 } from 'lib0/buffer'

/** Yjs blobs travel to Postgres as base64 text: PostgREST handles `bytea`
 *  awkwardly, and a text column is predictable in every client. */
export const bytesToBase64 = (bytes: Uint8Array): string => toBase64(bytes)

export const base64ToBytes = (value: string): Uint8Array =>
  value ? fromBase64(value) : new Uint8Array()
