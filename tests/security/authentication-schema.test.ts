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
const webAuthnMigration = readFileSync(
  resolve(
    root,
    'packages/database/prisma/migrations/20261011013000_g05_webauthn_credentials/migration.sql',
  ),
  'utf8',
);
const schema = readFileSync(resolve(root, 'packages/database/prisma/schema.prisma'), 'utf8');
const repositorySource = readFileSync(
  resolve(root, 'packages/auth/src/postgres-webauthn.ts'),
  'utf8',
).replaceAll('\r\n', '\n');
const authenticationRepositorySource = readFileSync(
  resolve(root, 'packages/auth/src/postgres.ts'),
  'utf8',
);

describe('account authentication database boundary', () => {
  it('requires locked-password proof and removes every customer lockout factor atomically', () => {
    expect(authenticationRepositorySource).toMatch(
      /SELECT user_id, password_hash[\s\S]*FROM credentials[\s\S]*FOR UPDATE/u,
    );
    expect(authenticationRepositorySource).toContain(
      'await input.verifyCurrentPassword(credentialLock.rows[0].password_hash)',
    );
    expect(authenticationRepositorySource).toContain("second_step_requirement = 'optional'");
    expect(authenticationRepositorySource).toContain('email_code_enabled = false');
    expect(authenticationRepositorySource).toContain('preferred_method = NULL');
    expect(authenticationRepositorySource).toContain('auth_state_version = auth_state_version + 1');
    expect(authenticationRepositorySource).toMatch(/UPDATE mfa_factors[\s\S]*revoked_at = \$1/u);
    expect(authenticationRepositorySource).toMatch(
      /UPDATE webauthn_credentials credential[\s\S]*scope\.user_id = \$2/u,
    );
    expect(authenticationRepositorySource).toMatch(
      /UPDATE password_recovery_tokens[\s\S]*used_at = \$1/u,
    );
    expect(authenticationRepositorySource).toContain(
      "revoke_reason = 'account-recovery-completed'",
    );
    expect(authenticationRepositorySource).toContain("reason: 'customer-recovery-lockout-reset'");
    expect(authenticationRepositorySource).toContain('accountWide: true');
  });

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
    expect(webAuthnMigration).toContain('DROP POLICY authentication_contract_v2_sessions');
    expect(webAuthnMigration).toContain('authentication_contract_v3_sessions');
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
    expect(webAuthnMigration).toContain('DROP POLICY authentication_contract_v2_password_recovery');
    expect(webAuthnMigration).toContain('authentication_contract_v3_password_recovery');
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

  it('stores WebAuthn credentials in immutable exact-RP and tenant/site scopes', () => {
    expect(webAuthnMigration).toContain('CREATE TABLE webauthn_scopes');
    expect(webAuthnMigration).toContain('CREATE TABLE webauthn_credentials');
    expect(webAuthnMigration).toContain('MATCH FULL');
    expect(webAuthnMigration).toContain(
      'user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT',
    );
    expect(webAuthnMigration).toContain('NULLS NOT DISTINCT');
    expect(webAuthnMigration).toContain('octet_length(user_handle) = 64');
    expect(webAuthnMigration).toContain('octet_length(credential_id) BETWEEN 1 AND 1023');
    expect(webAuthnMigration).toContain('sign_count BETWEEN 0 AND 4294967295');
    expect(webAuthnMigration).toContain('webauthn_credentials_backup_flags_check');
    expect(webAuthnMigration).toContain('webauthn_scopes_protect_identity');
    expect(webAuthnMigration).toContain('webauthn_credentials_protect_identity');
    expect(webAuthnMigration).toContain('WebAuthn credential revocation evidence is immutable');
    expect(webAuthnMigration).toMatch(
      /OLD\.revoked_at IS NOT NULL[\s\S]+NEW\.revoked_at IS DISTINCT FROM OLD\.revoked_at[\s\S]+NEW\.revoke_reason IS DISTINCT FROM OLD\.revoke_reason/u,
    );
    expect(schema).toContain('model WebAuthnScope');
    expect(schema).toContain('model WebAuthnCredential');
  });

  it('keeps WebAuthn material auth-role only and requires Auth Contract v3', () => {
    expect(webAuthnMigration).toContain('ALTER TABLE webauthn_scopes FORCE ROW LEVEL SECURITY');
    expect(webAuthnMigration).toContain(
      'ALTER TABLE webauthn_credentials FORCE ROW LEVEL SECURITY',
    );
    expect(webAuthnMigration).toContain('auth_contract_v3_webauthn_scopes');
    expect(webAuthnMigration).toContain('auth_contract_v3_webauthn_credentials');
    expect(webAuthnMigration).toContain(
      "current_setting('app.authentication_contract_version', true) = '3'",
    );
    expect(webAuthnMigration).toMatch(
      /REVOKE ALL ON webauthn_scopes, webauthn_credentials\s+FROM omnireach_app, omnireach_platform, omnireach_worker;/u,
    );
    expect(webAuthnMigration).toContain(
      'GRANT SELECT, INSERT ON webauthn_credentials TO omnireach_auth',
    );
    expect(webAuthnMigration).not.toMatch(
      /GRANT[^;]*DELETE[^;]*webauthn_(?:scopes|credentials)[^;]*TO omnireach_auth/isu,
    );
    expect(webAuthnMigration).not.toMatch(
      /GRANT[^;]*webauthn_(?:scopes|credentials)[^;]*TO omnireach_(?:app|platform|worker)/isu,
    );
  });

  it('versions enrollment and revocation without treating counter updates as factor changes', () => {
    expect(webAuthnMigration).toContain('bump_webauthn_account_authentication_state');
    expect(webAuthnMigration).toContain(
      'AFTER INSERT OR UPDATE OF revoked_at ON webauthn_credentials',
    );
    expect(webAuthnMigration).not.toMatch(
      /AFTER[^;]*UPDATE OF[^;]*(?:sign_count|backed_up|last_used_at)[^;]*ON webauthn_credentials/isu,
    );
    expect(repositorySource).not.toContain('async updateCredentialUsage(');
    expect(repositorySource).not.toContain('async createCredential(');
    expect(repositorySource).toContain('async revokeCredential(');
    expect(repositorySource).toContain("revoke_reason = 'webauthn-credential-revoked'");
    expect(repositorySource).toContain("'auth.webauthn.revoked'");
    expect(repositorySource).toContain(
      'assertion counter updates\n * must commit in the same transaction as session issuance',
    );
  });
});
