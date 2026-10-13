import { PostgresPlatformInquiryService } from '@omnireach/api';
import { MockTurnstileVerifier } from '@omnireach/integrations';
import type { TenantTransactionPool } from '@omnireach/tenant';
import { describe, expect, it, vi } from 'vitest';

describe('PostgreSQL platform inquiry service', () => {
  it('resolves active platform owners at delivery time without returning their addresses', async () => {
    const query = vi.fn(async (text: string) =>
      text.includes('FROM users')
        ? {
            rows: [
              { normalized_email: 'owner-one@example.test' },
              { normalized_email: 'owner-two@example.test' },
            ],
          }
        : { rows: [] },
    );
    const pool: TenantTransactionPool = {
      connect: vi.fn(async () => ({ query, release: vi.fn() })),
    };
    const deliver = vi.fn(async () => ({ providerReference: 'provider-a' }));
    const service = new PostgresPlatformInquiryService(
      pool,
      { deliver },
      {
        allowedOrigin: 'https://omnireach.cloud',
        turnstile: new MockTurnstileVerifier(),
        turnstileSiteKey: 'fictional-public-key',
      },
    );

    await expect(service.publicConfig()).resolves.toEqual({
      enabled: true,
      turnstileSiteKey: 'fictional-public-key',
    });
    await expect(
      service.submit({
        email: 'visitor@example.test',
        message: 'We need a dependable new business website.',
        name: 'Visitor',
        origin: 'https://omnireach.cloud',
        remoteIp: '127.0.0.1',
        turnstileToken: 'test-token',
      }),
    ).resolves.toBeUndefined();
    expect(query).toHaveBeenCalledWith('SET LOCAL ROLE omnireach_auth');
    expect(deliver).toHaveBeenCalledWith(
      expect.objectContaining({
        recipients: ['owner-one@example.test', 'owner-two@example.test'],
      }),
    );
  });

  it('rejects a wrong origin, honeypot, or missing active owner without delivery', async () => {
    const query = vi.fn(async () => ({ rows: [] }));
    const deliver = vi.fn(async () => ({ providerReference: 'provider-a' }));
    const service = new PostgresPlatformInquiryService(
      { connect: vi.fn(async () => ({ query, release: vi.fn() })) },
      { deliver },
      { turnstile: new MockTurnstileVerifier() },
    );
    const base = {
      email: 'visitor@example.test',
      message: 'We need a dependable new business website.',
      name: 'Visitor',
      origin: 'https://omnireach.cloud',
      remoteIp: '127.0.0.1',
      turnstileToken: 'test-token',
    };
    await expect(service.submit({ ...base, origin: 'https://attacker.test' })).rejects.toThrow(
      'rejected',
    );
    await expect(service.submit({ ...base, website: 'spam.example' })).rejects.toThrow('rejected');
    await expect(service.submit(base)).rejects.toThrow('No active platform owner');
    expect(deliver).not.toHaveBeenCalled();
  });

  it('keeps delivery available without a Turnstile widget while retaining route defenses', async () => {
    const query = vi.fn(async (text: string) =>
      text.includes('FROM users')
        ? { rows: [{ normalized_email: 'owner@example.test' }] }
        : { rows: [] },
    );
    const deliver = vi.fn(async () => ({ providerReference: 'provider-a' }));
    const turnstile = { verify: vi.fn(async () => false) };
    const service = new PostgresPlatformInquiryService(
      { connect: vi.fn(async () => ({ query, release: vi.fn() })) },
      { deliver },
      { deliveryEnabled: true, turnstile },
    );
    await expect(service.publicConfig()).resolves.toEqual({ enabled: true });
    await expect(
      service.submit({
        email: 'visitor@example.test',
        message: 'We need a dependable new business website.',
        name: 'Visitor',
        origin: 'https://omnireach.cloud',
        remoteIp: '127.0.0.1',
        turnstileToken: '',
      }),
    ).resolves.toBeUndefined();
    expect(turnstile.verify).not.toHaveBeenCalled();
    expect(deliver).toHaveBeenCalledOnce();
  });
});
