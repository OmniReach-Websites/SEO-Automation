import { MemoryUrgentEmailAdapter } from '@omnireach/observability';
import type { TenantTransactionPool } from '@omnireach/tenant';
import { PostgresAlertCenter } from '@omnireach/worker-monitoring';
import { describe, expect, it, vi } from 'vitest';

const scope = {
  jobId: 'monitor:site-a',
  siteId: '20000000-0000-4000-8000-000000000001',
  tenantId: '10000000-0000-4000-8000-000000000001',
};

describe('PostgreSQL alert lifecycle', () => {
  it('deduplicates incidents and durably records every email attempt', async () => {
    const deliveries: { attempt: number; id: string; state: string }[] = [];
    let occurrences = 0;
    const query = vi.fn(async (text: string, values?: unknown[]) => {
      if (text.includes('INSERT INTO alerts')) {
        occurrences += 1;
        return {
          rows: [
            {
              email_escalation: 1,
              fingerprint: String(values?.[2]),
              first_seen_at: new Date('2026-10-11T00:00:00.000Z'),
              id: 'alert-a',
              last_seen_at: new Date('2026-10-11T00:00:01.000Z'),
              occurrences,
              remediation_url: null,
              safe_message: String(values?.[5]),
              severity: values?.[3],
              source: String(values?.[4]),
              state: 'open',
            },
          ],
        };
      }
      if (text.includes('SELECT attempt, state FROM alert_deliveries')) {
        return { rows: [...deliveries].sort((left, right) => right.attempt - left.attempt) };
      }
      if (text.includes('INSERT INTO alert_deliveries')) {
        const delivery = {
          attempt: Number(values?.[2]),
          id: `delivery-${String(values?.[2])}`,
          state: 'pending',
        };
        deliveries.push(delivery);
        return { rows: [delivery] };
      }
      if (text.includes('UPDATE alert_deliveries')) {
        const delivery = deliveries.find(({ id }) => id === values?.[0]);
        if (delivery) delivery.state = String(values?.[1]);
      }
      return { rows: [] };
    });
    const pool: TenantTransactionPool = {
      connect: vi.fn(async () => ({ query, release: vi.fn() })),
    };
    const sleep = vi.fn(async (milliseconds: number) => void milliseconds);
    const center = new PostgresAlertCenter(pool, { sleep });
    const email = new MemoryUrgentEmailAdapter({ failuresBeforeSuccess: 1 });
    const input = {
      message: 'worker unavailable',
      scope: 'site-a',
      severity: 'critical' as const,
      source: 'monitor',
    };
    await expect(center.report(scope, input, email)).resolves.toMatchObject({ occurrences: 1 });
    expect(deliveries).toEqual([
      { attempt: 1, id: 'delivery-1', state: 'failed' },
      { attempt: 2, id: 'delivery-2', state: 'sent' },
    ]);
    expect(sleep).toHaveBeenCalledWith(250);
    expect(email.delivered).toHaveLength(1);

    await expect(center.report(scope, input, email)).resolves.toMatchObject({ occurrences: 2 });
    expect(deliveries).toHaveLength(2);
    expect(email.delivered).toHaveLength(1);
    expect(query.mock.calls.some(([text]) => text === 'SET LOCAL ROLE omnireach_worker')).toBe(
      true,
    );
  });
});
