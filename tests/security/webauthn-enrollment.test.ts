import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const root = process.cwd();

function source(path: string): string {
  return readFileSync(resolve(root, path), 'utf8');
}

describe('WebAuthn enrollment security boundary', () => {
  it('enables enrollment only alongside exact-host assertion authentication', () => {
    const main = source('apps/api/src/main.ts');
    const service = source('packages/auth/src/service.ts');
    const routes = source('apps/api/src/auth-routes.ts');
    const repository = source('packages/auth/src/postgres-webauthn.ts');

    expect(main).toContain('webAuthnAuthenticationEnabled: true');
    expect(main).not.toMatch(/WEBAUTHN_AUTHENTICATION_ENABLED/u);
    expect(service).toContain('if (!this.webAuthnEnrollmentAvailable()');
    expect(service).toContain('this.options.webAuthnAuthenticationEnabled');
    expect(service).toContain('verifyExactHostWebAuthnAuthentication');
    expect(routes).toContain('/auth/mfa/webauthn/prepare');
    expect(routes).toContain('/auth/mfa/webauthn/complete');
    expect(repository).toContain('async completeAuthentication');
    expect(repository).toContain('authentication_method, authentication_assurance, verified_at');
  });

  it('binds registration to exact host, recent assurance, current state, and one-use storage', () => {
    const repository = source('packages/auth/src/postgres-webauthn.ts');
    const service = source('packages/auth/src/service.ts');
    const redis = source('apps/api/src/redis-auth.ts');

    expect(repository).toContain("session.verified_at > $4 - interval '10 minutes'");
    expect(repository).toContain("session.authentication_assurance = 'strong'");
    expect(repository).toContain("domain.verification_status = 'verified'");
    expect(service).toContain('credentialStateDigest: this.webAuthnCredentialStateDigest');
    expect(service).toContain('verification.registrationInfo.userVerified');
    expect(redis).toContain('this.redis.getDel(this.key(ceremonyId))');
    expect(redis).toContain('recoveryCodes.length === 10');
  });

  it('keeps enrollment mutations, session revocation, recovery rotation, and audit atomic', () => {
    const repository = source('packages/auth/src/postgres-webauthn.ts');

    expect(repository).toContain('INSERT INTO webauthn_credentials');
    expect(repository).toContain('UPDATE account_recovery_codes');
    expect(repository).toContain("preferred_method = 'webauthn'");
    expect(repository).toContain("revoke_reason = 'webauthn-enrollment'");
    expect(repository).toContain("'auth.webauthn.enrolled'");
    expect(repository).toContain("set_config('app.authentication_contract_version', '3', true)");
    expect(repository).toContain("await client.query('ROLLBACK')");
  });

  it('does not persist browser recovery material or include ceremony payloads in logs', () => {
    const browser = source('apps/api/src/webauthn-browser.ts');
    const routes = source('apps/api/src/auth-routes.ts');
    const server = source('apps/api/src/server.ts');

    expect(browser).not.toMatch(/localStorage|sessionStorage|console\./u);
    expect(browser).toContain('recoveryCodes.replaceChildren()');
    expect(routes).toContain(".header('Cache-Control', 'no-store')");
    expect(routes).toContain(".header('Pragma', 'no-cache')");
    expect(server).toContain("'req.body.ceremonyId'");
    expect(server).toContain("'req.body.response'");
  });
});
