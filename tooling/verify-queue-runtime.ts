import { randomUUID } from 'node:crypto';
import { BullQueueAdapter, createJobEnvelope } from '@omnireach/queue';

const redisUrl = process.env.REDIS_URL ?? 'redis://127.0.0.1:56379';
const queue = new BullQueueAdapter(`omnireach-fixture-${randomUUID()}`, redisUrl);
try {
  const envelope = createJobEnvelope({
    attemptLimit: 2,
    category: 'health_check',
    dedupeKey: 'fixture-window',
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    recordId: randomUUID(),
    siteId: randomUUID(),
    tenantId: randomUUID(),
    timeoutMs: 5_000,
  });
  const first = await queue.enqueue(envelope);
  const second = await queue.enqueue(envelope);
  const job = await queue.queue.getJob(first);
  const counts = await queue.queue.getJobCounts();
  if (first !== second || !job || job.data.recordId !== envelope.recordId || counts.waiting !== 1)
    throw new Error('BullMQ dedupe or opaque envelope verification failed');
  await queue.queue.obliterate({ force: true });
  console.log(
    JSON.stringify({
      check: 'queue-runtime',
      deduplicated: true,
      ok: true,
      redisPayloadKeys: Object.keys(job.data).sort(),
    }),
  );
} finally {
  await queue.close();
}
