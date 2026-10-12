import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../..');
const migration = readFileSync(
  resolve(
    root,
    'packages/database/prisma/migrations/20261010250000_g05_account_authentication_policy/migration.sql',
  ),
  'utf8',
);
const recoveryOutboxMigration = readFileSync(
  resolve(
    root,
    'packages/database/prisma/migrations/20261010250500_g05_password_recovery_outbox/migration.sql',
  ),
  'utf8',
);
const schema = readFileSync(resolve(root, 'packages/database/prisma/schema.prisma'), 'utf8');

describe('account authentication database boundary', () => {
  it('uses account-level policy and prevents optional policies for active platform users', () => {
    expect(migration).toContain('CREATE TABLE account_authentication_policies');
    expect(migration).toContain('platform_membership_requires_second_step');
    expect(migration).toContain('authentication_policy_protects_platform_membership');
    expect(migration).toContain("policy.second_step_requirement = 'required'");
    expect(migration).toContain('account_authentication_policies_email_requires_second_step');
    expect(
      migration.match(/PERFORM 1 FROM public\.users WHERE id = [^;]+ FOR UPDATE;/gu),
    ).toHaveLength(2);
    expect(migration).toContain(
      'Preserve TOTP as the only enabled second step for already-enrolled platform',
    );
    expect(migration).toMatch(
      /WHEN EXISTS \(\s+SELECT 1 FROM mfa_factors mf[\s\S]+?THEN false\s+WHEN EXISTS \(\s+SELECT 1 FROM platform_memberships pm[\s\S]+?THEN true/u,
    );
    expect(migration).toContain(
      'ALTER TABLE account_authentication_policies FORCE ROW LEVEL SECURITY',
    );
    expect(schema).toContain('model AccountAuthenticationPolicy');
    expect(migration).toContain('ADD COLUMN last_used_counter bigint');
    expect(schema).toContain('lastUsedCounter');
  });

  it('versions every challenge-relevant account state and blocks promotion during recovery', () => {
    expect(migration).toContain('auth_state_version bigint NOT NULL DEFAULT 1');
    expect(schema).toContain('authStateVersion');
    expect(migration).toContain('maintain_account_authentication_policy_version');
    expect(migration).toContain('credentials_bump_authentication_state');
    expect(migration).toContain('memberships_bump_authentication_state');
    expect(migration).toContain('platform_memberships_bump_authentication_state');
    expect(migration).toContain('mfa_factors_bump_authentication_state');
    expect(migration).toContain('users_bump_authentication_state');
    expect(migration).toContain(
      'active account recovery must finish before platform access is granted',
    );
  });

  it('copies legacy recovery codes without deleting rollback-compatible records', () => {
    expect(migration).toContain('CREATE TABLE account_recovery_codes');
    expect(migration).toContain('set_version integer NOT NULL DEFAULT 1 CHECK (set_version > 0)');
    expect(migration).toContain('(user_id, set_version, created_at)');
    expect(migration).toMatch(
      /INSERT INTO account_recovery_codes[\s\S]+FROM mfa_recovery_codes legacy/u,
    );
    expect(migration).not.toMatch(/DROP TABLE\s+mfa_recovery_codes/iu);
    expect(migration).toContain('legacy_mfa_recovery_codes_account_sync');
    expect(migration).toContain('account_recovery_codes_legacy_sync');
    expect(migration).toContain('sync_account_recovery_code_to_legacy');
    expect(migration).toContain('SET used_at = COALESCE(used_at, now())');
    expect(migration).toContain('mfa_factor_revocation_revokes_account_codes');
    expect(schema).toContain('model AccountRecoveryCode');
    expect(schema).toContain('setVersion');
  });

  it('allows only approved session method and assurance pairs', () => {
    for (const method of ['password', 'email_code', 'totp', 'webauthn', 'recovery_code']) {
      expect(migration).toContain(`'${method}'`);
    }
    for (const assurance of ['basic', 'baseline', 'strong', 'recovery']) {
      expect(migration).toContain(`'${assurance}'`);
    }
    expect(migration).toContain('sessions_authentication_method_assurance_check');
    expect(migration).toContain('ADD COLUMN verified_at timestamptz(3)');
    expect(migration).toContain('ADD COLUMN recovery_restricted boolean NOT NULL DEFAULT false');
    expect(migration).toContain('AND verified_at IS NOT NULL AND recovery_restricted');
    expect(migration).toContain('sessions_require_policy_assurance');
    expect(migration).toContain('authentication_contract_v2_sessions');
    expect(migration).toContain(
      "revoke_reason = COALESCE(session.revoke_reason, 'authentication-policy-upgrade')",
    );
    expect(schema).toContain('authenticationMethod');
    expect(schema).toContain('authenticationAssurance');
    expect(schema).toContain('verifiedAt');
    expect(schema).toContain('recoveryRestricted');
  });

  it('binds newly issued password recovery tokens to a normalized host', () => {
    expect(migration).toContain('ALTER TABLE password_recovery_tokens');
    expect(migration).toContain('password_recovery_tokens_host_check');
    expect(migration).toContain("host IS NULL OR (host = lower(host) AND host !~ '[:/]')");
    expect(schema).toMatch(/model PasswordRecoveryToken[\s\S]*host\s+String\?/u);
    expect(migration).toContain('active_password_recovery_tokens_require_host');
    expect(migration).toContain('authentication_contract_v2_password_recovery');
  });

  it('keeps account authentication tables behind the auth database role', () => {
    expect(migration).toMatch(
      /GRANT SELECT, INSERT, UPDATE ON account_authentication_policies, account_recovery_codes\s+TO omnireach_auth;/u,
    );
    expect(migration).not.toMatch(
      /GRANT[^;]*(?:account_authentication_policies|account_recovery_codes)[^;]*TO omnireach_(?:app|platform|worker)/isu,
    );
    expect(migration).toContain('ALTER TABLE account_recovery_codes FORCE ROW LEVEL SECURITY');
    expect(migration).toMatch(
      /REVOKE ALL ON credentials, password_recovery_tokens, mfa_factors,\s+mfa_recovery_codes, owner_bootstrap FROM omnireach_platform;/u,
    );
    expect(migration).toContain(
      'REVOKE ALL ON sessions FROM omnireach_app, omnireach_worker, omnireach_platform',
    );
    expect(migration).toContain('GRANT SELECT ON sessions TO omnireach_platform');
    expect(migration).toContain(
      'GRANT UPDATE (revoked_at, revoke_reason) ON sessions TO omnireach_platform',
    );
  });

  it('keeps recovery delivery durable, encrypted, leased, and auth-role only', () => {
    expect(recoveryOutboxMigration).toContain('CREATE TABLE password_recovery_delivery_outbox');
    expect(recoveryOutboxMigration).toContain('encrypted_token bytea');
    expect(recoveryOutboxMigration).toContain(
      'password_recovery_delivery_outbox_payload_lifecycle',
    );
    expect(recoveryOutboxMigration).toContain("status = 'processing' AND locked_until IS NOT NULL");
    expect(recoveryOutboxMigration).toContain(
      'ALTER TABLE password_recovery_delivery_outbox FORCE ROW LEVEL SECURITY',
    );
    expect(recoveryOutboxMigration).toContain(
      'GRANT SELECT, INSERT, UPDATE ON password_recovery_delivery_outbox TO omnireach_auth',
    );
    expect(recoveryOutboxMigration).not.toMatch(
      /GRANT[^;]*password_recovery_delivery_outbox[^;]*TO omnireach_(?:app|platform|worker)/isu,
    );
    expect(schema).toContain('model PasswordRecoveryDeliveryOutbox');
  });
});
