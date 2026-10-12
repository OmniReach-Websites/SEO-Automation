import {
  ResendAuthenticationNotifier,
  ResendUrgentEmailAdapter,
  ResendVerificationCodeNotifier,
} from '@omnireach/integrations';
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

  it('delivers an eight-digit verification code only in the message body', async () => {
    const code = '31415926';
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ id: 'verification-message-a' }));
    const notifier = new ResendVerificationCodeNotifier({
      apiKey: 'fictional-resend-key',
      fetchImplementation,
      from: 'auth@updates.omnireach.cloud',
    });

    await notifier.send({ code, normalizedEmail: 'owner@example.test' });

    expect(fetchImplementation).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImplementation.mock.calls[0] ?? [];
    const request = JSON.parse(String(init?.body)) as {
      from: string;
      subject: string;
      text: string;
      to: string[];
    };
    expect(url).toBe('https://api.resend.com/emails');
    expect(request).toMatchObject({
      from: 'auth@updates.omnireach.cloud',
      subject: 'Verify your OmniReach sign-in',
      to: ['owner@example.test'],
    });
    expect(request.text).toContain(code);
    expect(request.text).toContain('expires in 5 minutes');
    expect(request.subject).not.toContain(code);
    expect(String(url)).not.toContain(code);
    expect(JSON.stringify(init?.headers)).not.toContain(code);
  });

  it('rejects invalid verification codes and recipients before provider delivery', async () => {
    const fetchImplementation = vi.fn<typeof fetch>();
    const notifier = new ResendVerificationCodeNotifier({
      apiKey: 'fictional-resend-key',
      fetchImplementation,
      from: 'auth@updates.omnireach.cloud',
    });

    await expect(
      notifier.send({ code: '1234567', normalizedEmail: 'owner@example.test' }),
    ).rejects.toThrow('Verification code is invalid');
    await expect(
      notifier.send({ code: '12345678', normalizedEmail: 'not-an-email' }),
    ).rejects.toThrow('Verification-code recipient is invalid');
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it('does not expose the verification code through provider failure errors', async () => {
    const code = '27182818';
    const networkFailure = new ResendVerificationCodeNotifier({
      apiKey: 'fictional-resend-key',
      fetchImplementation: vi.fn<typeof fetch>().mockRejectedValue(new Error(`failed ${code}`)),
      from: 'auth@updates.omnireach.cloud',
    });
    const providerFailure = new ResendVerificationCodeNotifier({
      apiKey: 'fictional-resend-key',
      fetchImplementation: vi
        .fn<typeof fetch>()
        .mockResolvedValue(Response.json({ message: code }, { status: 503 })),
      from: 'auth@updates.omnireach.cloud',
    });

    await expect(
      networkFailure.send({ code, normalizedEmail: 'owner@example.test' }),
    ).rejects.toThrow('Resend verification-code delivery failed (network)');
    await expect(
      providerFailure.send({ code, normalizedEmail: 'owner@example.test' }),
    ).rejects.toThrow('Resend verification-code delivery failed (503)');
    await networkFailure
      .send({ code, normalizedEmail: 'owner@example.test' })
      .catch((error: unknown) => expect(String(error)).not.toContain(code));
    await providerFailure
      .send({ code, normalizedEmail: 'owner@example.test' })
      .catch((error: unknown) => expect(String(error)).not.toContain(code));
  });

  it('rejects malformed provider success responses without exposing their content', async () => {
    const code = '16180339';
    const notifier = new ResendVerificationCodeNotifier({
      apiKey: 'fictional-resend-key',
      fetchImplementation: vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response(`not-json-${code}`, { status: 200 })),
      from: 'auth@updates.omnireach.cloud',
    });

    await notifier
      .send({ code, normalizedEmail: 'owner@example.test' })
      .then(() => {
        throw new Error('Expected malformed response to fail');
      })
      .catch((error: unknown) => {
        expect(String(error)).toContain('delivery returned no reference');
        expect(String(error)).not.toContain(code);
      });
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
