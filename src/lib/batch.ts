import { writeBatch } from 'firebase/firestore';
import { db } from '@/lib/firebase';

// Firestore caps a batched write at 500 operations.
const BATCH_LIMIT = 500;

// Spreads an unbounded run of writes across as many batches as it takes.
// commit() fires them together rather than in sequence so a caller that doesn't
// await stays responsive offline.
export function batchWriter() {
  const batches = [writeBatch(db)];
  let room = BATCH_LIMIT;
  return {
    next() {
      if (room === 0) {
        batches.push(writeBatch(db));
        room = BATCH_LIMIT;
      }
      room -= 1;
      return batches[batches.length - 1];
    },
    async commit() {
      await Promise.all(batches.map((batch) => batch.commit()));
    },
  };
}
