import { readFileSync } from 'node:fs';

import { PostgresContactService, decryptContactPayload } from '@omnireach/api/postgres-contact';
import { contractHash, validateSiteContract } from '@omnireach/contracts';
import { MockContactDelivery } from '@omnireach/content';
import { MockTurnstileVerifier } from '@omnireach/integrations';
import type { TenantTransactionPool } from '@omnireach/tenant';
import { describe, expect, it, vi } from 'vitest';

const contract = validateSiteContract(
  JSON.parse(readFileSync('sites/_starter/site.manifest.json', 'utf8')),
);
const context = {
  allowedOrigin: 'https://fictional.example.test',
  siteId: '20000000-0000-4000-8000-000000000001',
  tenantId: '10000000-0000-4000-8000-000000000001',
};

describe('PostgreSQL contact service', () => {
  it('exposes only enabled state and the public Turnstile key for verified forms', async () => {
    const query = vi.fn(async (text: string) =>
      text.includes('FROM site_contact_forms')
        ? { rows: [{ enabled: true, recipient_verified_at: new Date() }] }
        : { rows: [] },
    );
    const service = new PostgresContactService(
      { connect: vi.fn(async () => ({ query, release: vi.fn() })) },
      new MockContactDelivery(),
      {
        contracts: new Map(),
        encryptionKey: new Uint8Array(32).fill(7),
        turnstile: new MockTurnstileVerifier(),
        turnstileSiteKey: 'fictional-public-key',
      },
    );
    await expect(service.publicConfig(context, 'general-inquiry')).resolves.toEqual({
      enabled: true,
      turnstileSiteKey: 'fictional-public-key',
    });
  });

  it('encrypts the minimal payload and records mock delivery without logging plaintext', async () => {
    let encrypted: Buffer | undefined;
    const query = vi.fn(async (text: string, values?: unknown[]) => {
      if (text.includes('SELECT source_path')) {
        return {
          rows: [
            {
              contract_hash: contractHash(contract),
              source_path: 'sites/_starter',
            },
          ],
        };
      }
      if (text.includes('INSERT INTO contact_submissions')) {
        encrypted = values?.[3] as Buffer;
        return { rows: [{ id: '90000000-0000-4000-8000-000000000001' }] };
      }
      if (text.includes('FROM site_contact_forms')) {
        return {
          rows: [
            {
              enabled: true,
              enabled_field_ids: ['name', 'email', 'message', 'consent'],
              confirmation_enabled: false,
              recipient_email: 'inbox@fictional.example.test',
              recipient_verified_at: new Date('2026-10-01T00:00:00.000Z'),
              retention_days: 30,
            },
          ],
        };
      }
      return { rows: [] };
    });
    const pool: TenantTransactionPool = {
      connect: vi.fn(async () => ({ query, release: vi.fn() })),
    };
    const delivery = new MockContactDelivery();
    const service = new PostgresContactService(pool, delivery, {
      contracts: new Map([['sites/_starter', contract]]),
      encryptionKey: new Uint8Array(32).fill(7),
      turnstile: new MockTurnstileVerifier(),
    });
    await expect(
      service.submit(context, {
        fields: {
          consent: true,
          email: 'person@example.test',
          message: 'A fictional inquiry',
          name: 'Fictional Person',
        },
        formId: 'general-inquiry',
        origin: context.allowedOrigin,
        remoteIp: '127.0.0.1',
        turnstileToken: 'test-token',
      }),
    ).resolves.toEqual({ submissionId: '90000000-0000-4000-8000-000000000001' });
    expect(encrypted?.toString('utf8')).not.toContain('person@example.test');
    expect(encrypted?.byteLength).toBeGreaterThan(28);
    expect(
      decryptContactPayload(
        new Uint8Array(32).fill(7),
        `${context.tenantId}:${context.siteId}:general-inquiry`,
        encrypted ?? new Uint8Array(),
      ),
    ).toMatchObject({
      email: 'person@example.test',
      recipientEmail: 'inbox@fictional.example.test',
    });
    expect(delivery.deliveries).toHaveLength(1);
    expect(delivery.deliveries[0]?.confirmationEnabled).toBe(false);
    expect(query.mock.calls.some(([text]) => text.includes('UPDATE contact_submissions'))).toBe(
      true,
    );
  });

  it('rejects undeclared forms before persistence or delivery', async () => {
    const query = vi.fn(async (text: string) =>
      text.includes('SELECT source_path')
        ? {
            rows: [
              {
                contract_hash: contractHash(contract),
                source_path: 'sites/_starter',
              },
            ],
          }
        : { rows: [] },
    );
    const delivery = new MockContactDelivery();
    const service = new PostgresContactService(
      { connect: vi.fn(async () => ({ query, release: vi.fn() })) },
      delivery,
      {
        contracts: new Map([['sites/_starter', contract]]),
        encryptionKey: new Uint8Array(32).fill(7),
        turnstile: new MockTurnstileVerifier(),
      },
    );
    await expect(
      service.submit(context, {
        fields: {
          consent: true,
          email: 'person@example.test',
          message: 'A fictional inquiry',
          name: 'Fictional Person',
        },
        formId: 'undeclared',
        origin: context.allowedOrigin,
        remoteIp: '127.0.0.1',
        turnstileToken: 'test-token',
      }),
    ).rejects.toThrow('not declared');
    expect(delivery.deliveries).toHaveLength(0);
  });

  it('deletes only expired non-held submissions through the scoped retention job', async () => {
    const query = vi.fn(async (text: string) =>
      text.includes('DELETE FROM contact_submissions')
        ? { rows: [{ id: 'expired-a' }, { id: 'expired-b' }] }
        : { rows: [] },
    );
    const service = new PostgresContactService(
      { connect: vi.fn(async () => ({ query, release: vi.fn() })) },
      new MockContactDelivery(),
      {
        contracts: new Map(),
        encryptionKey: new Uint8Array(32).fill(7),
        turnstile: new MockTurnstileVerifier(),
      },
    );
    await expect(
      service.purgeExpired(context, new Date('2026-11-01T00:00:00.000Z')),
    ).resolves.toEqual({ deleted: 2 });
    const deletion = query.mock.calls.find(([text]) => text.includes('DELETE FROM'))?.[0];
    expect(deletion).toContain('NOT legal_hold');
    expect(query.mock.calls.some(([text]) => text.includes('contact.retention_deleted'))).toBe(
      true,
    );
  });
});
