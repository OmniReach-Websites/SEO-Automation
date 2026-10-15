import { PostgresEmailDeliveryQuota } from '@omnireach/database';
import {
  ResendAccountUsageProvider,
  ResendContactDelivery,
  ResendVerificationCodeNotifier,
  type EmailDeliveryQuota,
} from '@omnireach/integrations';
import { describe, expect, it, vi } from 'vitest';

describe('email delivery quota', () => {
  const usage = {
    read: vi.fn(async () => ({
      daily: { limit: 100, resetsAt: '2026-10-16T00:00:00.000Z', used: 7 },
      monthly: { limit: 3000, resetsAt: '2026-11-01T00:00:00.000Z', used: 28 },
    })),
  };

  it('reserves and finalizes one atomic provider send without message or recipient data', async () => {
    const query = vi
      .fn()
      .mockResolvedValue({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: '90000000-0000-4000-8000-000000000001' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ finalized: true }] })
      .mockResolvedValueOnce({ rows: [] });
    const release = vi.fn();
    const quota = new PostgresEmailDeliveryQuota(
      {
        connect: vi.fn(async () => ({ query, release })),
      },
      'omnireach_app',
      usage,
    );
    const reservation = await quota.reserve('authentication');
    await quota.finalize(reservation, { providerReference: 'provider-a', state: 'sent' });

    expect(query.mock.calls[0]?.[0]).toBe('BEGIN');
    expect(query.mock.calls[1]?.[0]).toBe('SET LOCAL ROLE omnireach_app');
    expect(query.mock.calls[2]?.[0]).toContain('reserve_email_delivery');
    expect(query.mock.calls[2]?.[1]).toEqual(['authentication', 7, 100, 28, 3000]);
    expect(query.mock.calls[6]?.[0]).toContain('finalize_email_delivery');
    expect(query.mock.calls[6]?.[1]).toEqual([
      '90000000-0000-4000-8000-000000000001',
      'sent',
      'provider-a',
      null,
    ]);
    expect(release).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(query.mock.calls)).not.toContain('recipient@example.test');
  });

  it('uses the worker role transactionally and releases the client after rollback', async () => {
    const failure = new Error('fixture database failure');
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockRejectedValueOnce(failure)
      .mockResolvedValueOnce({ rows: [] });
    const release = vi.fn();
    const quota = new PostgresEmailDeliveryQuota(
      { connect: vi.fn(async () => ({ query, release })) },
      'omnireach_worker',
      usage,
    );

    await expect(quota.reserve('alert')).rejects.toBe(failure);
    expect(query.mock.calls.map(([text]) => text)).toEqual([
      'BEGIN',
      'SET LOCAL ROLE omnireach_worker',
      expect.stringContaining('reserve_email_delivery'),
      'ROLLBACK',
    ]);
    expect(release).toHaveBeenCalledOnce();
  });

  it('fails closed before opening a transaction when account-wide usage is unavailable', async () => {
    const connect = vi.fn();
    const quota = new PostgresEmailDeliveryQuota({ connect });
    await expect(quota.reserve('authentication')).rejects.toThrow(
      'Account-wide email usage guard is not configured',
    );
    expect(connect).not.toHaveBeenCalled();
  });

  it('reads only bounded account-wide quota metadata from Resend', async () => {
    const provider = new ResendAccountUsageProvider({
      apiKey: 'fictional-resend-key',
      fetchImplementation: vi.fn<typeof fetch>().mockResolvedValue(
        Response.json({
          emails: {
            daily: { limit: 100, resets_at: '2026-10-16T00:00:00.000Z', used: 9 },
            monthly: { limit: 3000, resets_at: '2026-11-01T00:00:00.000Z', used: 31 },
          },
        }),
      ),
    });
    await expect(provider.read()).resolves.toEqual({
      daily: { limit: 100, resetsAt: '2026-10-16T00:00:00.000Z', used: 9 },
      monthly: { limit: 3000, resetsAt: '2026-11-01T00:00:00.000Z', used: 31 },
    });
  });

  it('fails closed when Resend usage metadata is malformed', async () => {
    const provider = new ResendAccountUsageProvider({
      apiKey: 'fictional-resend-key',
      fetchImplementation: vi
        .fn<typeof fetch>()
        .mockResolvedValue(Response.json({ emails: { daily: {}, monthly: {} } })),
    });
    await expect(provider.read()).rejects.toThrow('invalid response');
  });

  it('uses the reservation as a provider idempotency key and records safe failures', async () => {
    const outcomes: unknown[] = [];
    const quota: EmailDeliveryQuota = {
      finalize: vi.fn(async (_reservation, outcome) => void outcomes.push(outcome)),
      reserve: vi.fn(async () => ({ id: '90000000-0000-4000-8000-000000000002' })),
    };
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({}, { status: 429 }));
    const delivery = new ResendContactDelivery({
      apiKey: 'fictional-resend-key',
      fetchImplementation,
      from: 'forms@updates.omnireach.cloud',
      quota,
    });

    await expect(
      delivery.deliver({
        confirmationEnabled: false,
        fields: { message: 'Fictional message' },
        formId: 'contact',
        recipientEmail: 'recipient@example.test',
        siteId: '20000000-0000-4000-8000-000000000001',
      }),
    ).rejects.toThrow('(429)');
    expect(fetchImplementation.mock.calls[0]?.[1]?.headers).toMatchObject({
      'Idempotency-Key': '90000000-0000-4000-8000-000000000002',
    });
    expect(outcomes).toEqual([{ errorCode: 'provider_429', state: 'failed' }]);
  });

  it('meters authentication messages without storing the verification code in quota calls', async () => {
    const quota: EmailDeliveryQuota = {
      finalize: vi.fn(async () => undefined),
      reserve: vi.fn(async () => ({ id: '90000000-0000-4000-8000-000000000003' })),
    };
    const notifier = new ResendVerificationCodeNotifier({
      apiKey: 'fictional-resend-key',
      fetchImplementation: vi
        .fn<typeof fetch>()
        .mockResolvedValue(Response.json({ id: 'provider-auth-a' })),
      from: 'auth@updates.omnireach.cloud',
      quota,
    });
    await notifier.send({ code: '12345678', normalizedEmail: 'recipient@example.test' });
    expect(quota.reserve).toHaveBeenCalledWith('authentication');
    expect(quota.reserve).toHaveBeenCalledTimes(1);
  });
});
