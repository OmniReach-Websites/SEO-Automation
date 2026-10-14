import type { GoogleProviderClient } from '@omnireach/integrations';
import type { AdminActor, TenantTransactionClient, TenantTransactionPool } from '@omnireach/tenant';
import { describe, expect, it, vi } from 'vitest';
import { PostgresGoogleIntegrationService } from '../../apps/api/src/postgres-google.ts';

const actor: AdminActor = {
  id: '40000000-0000-4000-8000-000000000001',
  role: 'platform_owner',
  traceId: 'trace-google-postgres',
};

describe('PostgreSQL Google connection persistence', () => {
  it('binds a credential identifier as UUID before storing its text reference', async () => {
    const query = vi.fn(async (sql: string, values?: unknown[]) => {
      void values;
      return sql.includes('INSERT INTO integration_connections')
        ? { rows: [{ id: '70000000-0000-4000-8000-000000000001' }] }
        : { rows: [] };
    });
    const client = { query } as unknown as TenantTransactionClient;
    const pool = { connect: vi.fn() } as unknown as TenantTransactionPool;
    const provider = {} as GoogleProviderClient;
    const service = new PostgresGoogleIntegrationService(pool, {
      allowedRedirectUris: ['https://admin.omnireach.test/v1/orap/integrations/google/callback'],
      encryptionKeyHex: '11'.repeat(32),
      provider,
    });
    const persist = service as unknown as {
      connectProperty(
        callbackActor: AdminActor,
        input: {
          credentialId: string;
          property: { id: string; kind: 'search_console'; siteUrl: string };
          scopes: readonly string[];
          siteId: string;
          tenantId: string;
        },
        existingClient: TenantTransactionClient,
      ): Promise<unknown>;
    };

    await expect(
      persist.connectProperty(
        actor,
        {
          credentialId: '80000000-0000-4000-8000-000000000001',
          property: {
            id: 'sc-domain:example.test',
            kind: 'search_console',
            siteUrl: 'sc-domain:example.test',
          },
          scopes: ['https://www.googleapis.com/auth/webmasters.readonly'],
          siteId: '20000000-0000-4000-8000-000000000001',
          tenantId: '10000000-0000-4000-8000-000000000001',
        },
        client,
      ),
    ).resolves.toMatchObject({ status: 'connected' });

    const connectionSql = String(
      query.mock.calls.find(([sql]) => sql.includes('INSERT INTO integration_connections'))?.[0],
    );
    expect(connectionSql).toContain(
      '(SELECT id::text FROM integration_credentials WHERE id = $6::uuid)',
    );
    expect(connectionSql).not.toMatch(/property_mapping,\s*credential_ref[\s\S]*\$5,\s*\$6,/u);
    const scheduleCall = query.mock.calls.find(([sql]) => sql.includes('INSERT INTO schedules'));
    expect(scheduleCall?.[0]).toContain("'metrics_sync'");
    expect(scheduleCall?.[0]).toContain("'Etc/UTC', 4, 0, 30");
    expect(scheduleCall?.[0]).toContain('SET enabled = true');
    expect(scheduleCall?.[1]).toEqual([
      '10000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001',
      expect.any(Date),
    ]);
  });

  it('removes observations and sync diagnostics when an authorized property is remapped', async () => {
    const query = vi.fn(async (sql: string, values?: unknown[]) => {
      void values;
      if (sql.includes('SELECT id, property_id')) {
        return {
          rows: [
            {
              id: '70000000-0000-4000-8000-000000000001',
              property_id: 'sc-domain:old.example.test',
            },
          ],
        };
      }
      if (sql.includes('INSERT INTO integration_connections')) {
        return { rows: [{ id: '70000000-0000-4000-8000-000000000001' }] };
      }
      return { rows: [] };
    });
    const client = { query } as unknown as TenantTransactionClient;
    const service = new PostgresGoogleIntegrationService(
      { connect: vi.fn() } as unknown as TenantTransactionPool,
      {
        allowedRedirectUris: ['https://admin.omnireach.test/v1/orap/integrations/google/callback'],
        encryptionKeyHex: '11'.repeat(32),
        provider: {} as GoogleProviderClient,
      },
    );
    const persist = service as unknown as {
      connectProperty(
        callbackActor: AdminActor,
        input: {
          credentialId: string;
          property: { id: string; kind: 'search_console'; siteUrl: string };
          scopes: readonly string[];
          siteId: string;
          tenantId: string;
        },
        existingClient: TenantTransactionClient,
      ): Promise<unknown>;
    };

    await persist.connectProperty(
      actor,
      {
        credentialId: '80000000-0000-4000-8000-000000000001',
        property: {
          id: 'sc-domain:new.example.test',
          kind: 'search_console',
          siteUrl: 'sc-domain:new.example.test',
        },
        scopes: ['https://www.googleapis.com/auth/webmasters.readonly'],
        siteId: '20000000-0000-4000-8000-000000000001',
        tenantId: '10000000-0000-4000-8000-000000000001',
      },
      client,
    );

    const deletion = query.mock.calls.find(([sql]) => sql.includes('DELETE FROM metric_snapshots'));
    expect(deletion?.[1]).toEqual([
      '10000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001',
      '70000000-0000-4000-8000-000000000001',
    ]);
    expect(
      query.mock.calls.find(([sql]) => sql.includes('SET last_synced_at = NULL'))?.[0],
    ).toContain('last_attempted_at = NULL');
  });
});
