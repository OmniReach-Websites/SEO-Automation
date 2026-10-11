import { ResendAuthenticationNotifier, ResendUrgentEmailAdapter } from '@omnireach/integrations';
import { describe, expect, it, vi } from 'vitest';

describe('Resend authentication and alert adapters', () => {
  it('builds an exact-host one-time invitation link without exposing credentials elsewhere', async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ id: 'auth-message-a' }));
    const notifier = new ResendAuthenticationNotifier({
      apiKey: 'fictional-resend-key',
      fetchImplementation,
      from: 'access@updates.omnireach.cloud',
      kind: 'invitation',
    });
    await notifier.send({
      host: 'admin.customer.example',
      normalizedEmail: 'owner@example.test',
      token: 'A'.repeat(43),
    });
    const request = JSON.parse(String(fetchImplementation.mock.calls[0]?.[1]?.body)) as {
      text: string;
      to: string[];
    };
    expect(request.to).toEqual(['owner@example.test']);
    expect(request.text).toContain(
      `https://admin.customer.example/auth/invitations/accept?token=${'A'.repeat(43)}`,
    );
  });

  it('rejects untrusted authentication hosts before provider delivery', async () => {
    const fetchImplementation = vi.fn<typeof fetch>();
    const notifier = new ResendAuthenticationNotifier({
      apiKey: 'fictional-resend-key',
      fetchImplementation,
      from: 'access@updates.omnireach.cloud',
      kind: 'password-recovery',
    });
    await expect(
      notifier.send({
        host: 'attacker.test/path',
        normalizedEmail: 'owner@example.test',
        token: 'B'.repeat(43),
      }),
    ).rejects.toThrow(/host/u);
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it('retries transient alert failures with exponential backoff and dedupe metadata', async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({}, { status: 503 }))
      .mockResolvedValueOnce(Response.json({}, { status: 429 }))
      .mockResolvedValueOnce(Response.json({ id: 'alert-message-a' }));
    const sleep = vi.fn(async (milliseconds: number) => {
      void milliseconds;
    });
    const adapter = new ResendUrgentEmailAdapter({
      apiKey: 'fictional-resend-key',
      fetchImplementation,
      from: 'alerts@updates.omnireach.cloud',
      maxAttempts: 4,
      recipient: 'owner@example.test',
      sleep,
    });
    await expect(
      adapter.send({
        alertFingerprint: 'fingerprint-a',
        safeBody: 'Worker unavailable\nScope: site-a',
        subject: '[OmniReach CRITICAL] Worker',
      }),
    ).resolves.toEqual({ providerReference: 'alert-message-a' });
    expect(fetchImplementation).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls.map(([milliseconds]) => milliseconds)).toEqual([250, 500]);
    expect(JSON.parse(String(fetchImplementation.mock.calls[0]?.[1]?.body))).toMatchObject({
      headers: { 'X-Entity-Ref-ID': 'fingerprint-a' },
    });
  });
});
