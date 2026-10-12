import {
  createWebAuthnAuthenticationOptions,
  createWebAuthnRegistrationOptions,
  createWebAuthnUserHandle,
  normalizeWebAuthnHost,
  resolveWebAuthnRelyingParty,
  verifyExactHostWebAuthnAuthentication,
  verifyExactHostWebAuthnRegistration,
  webAuthnCeremonyTtlSeconds,
  type WebAuthnCredentialRecord,
} from '@omnireach/auth';
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/server';
import { describe, expect, it } from 'vitest';

const credential: WebAuthnCredentialRecord = {
  backedUp: false,
  backupEligible: false,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  credentialId: new Uint8Array([1, 2, 3, 4]),
  deviceType: 'singleDevice',
  id: '10000000-0000-4000-8000-000000000001',
  name: 'Windows Hello',
  publicKey: new Uint8Array([5, 6, 7, 8]),
  signCount: 0,
  transports: ['internal'],
  verifiedAt: new Date('2026-01-01T00:00:00Z'),
};

describe('exact-host WebAuthn boundary', () => {
  it('derives one HTTPS origin and RP ID from a normalized exact host', () => {
    expect(resolveWebAuthnRelyingParty('ADMIN.OmniReach.Cloud.')).toEqual({
      id: 'admin.omnireach.cloud',
      name: 'OmniReach',
      origin: 'https://admin.omnireach.cloud',
    });
    expect(normalizeWebAuthnHost('bücher.example')).toBe('xn--bcher-kva.example');
    for (const invalid of [
      'admin.omnireach.cloud:443',
      'https://admin.omnireach.cloud',
      'admin.omnireach.cloud/path',
      '2.57.91.91',
      'bad..example',
    ]) {
      expect(() => normalizeWebAuthnHost(invalid)).toThrow('Invalid WebAuthn host');
    }
  });

  it('generates registration and assertion options with UV and the approved algorithms', async () => {
    const relyingParty = resolveWebAuthnRelyingParty('admin.omnireach.cloud');
    const userHandle = createWebAuthnUserHandle();
    expect(userHandle).toHaveLength(64);
    expect(createWebAuthnUserHandle()).not.toEqual(userHandle);

    const registration = await createWebAuthnRegistrationOptions({
      credentials: [credential],
      displayName: 'Fictional Owner',
      relyingParty,
      userHandle,
      userName: 'owner@example.invalid',
    });
    expect(registration.rp.id).toBe(relyingParty.id);
    expect(registration.attestation).toBe('none');
    expect(registration.timeout).toBe(webAuthnCeremonyTtlSeconds * 1000);
    expect(registration.authenticatorSelection).toMatchObject({
      residentKey: 'preferred',
      userVerification: 'required',
    });
    expect(registration.pubKeyCredParams.map(({ alg }) => alg)).toEqual([-7, -257]);
    expect(registration.excludeCredentials).toEqual([
      { id: 'AQIDBA', transports: ['internal'], type: 'public-key' },
    ]);

    const authentication = await createWebAuthnAuthenticationOptions({
      credentials: [credential],
      relyingParty,
    });
    expect(authentication.rpId).toBe(relyingParty.id);
    expect(authentication.userVerification).toBe('required');
    expect(authentication.timeout).toBe(webAuthnCeremonyTtlSeconds * 1000);
    expect(authentication.allowCredentials).toEqual([
      { id: 'AQIDBA', transports: ['internal'], type: 'public-key' },
    ]);
  });

  it('rejects cross-origin and top-origin client data before cryptographic verification', async () => {
    const relyingParty = resolveWebAuthnRelyingParty('admin.omnireach.cloud');
    const clientData = (value: Record<string, unknown>): string =>
      Buffer.from(JSON.stringify(value)).toString('base64url');
    const registration = {
      response: { clientDataJSON: clientData({ crossOrigin: true }) },
    } as unknown as RegistrationResponseJSON;
    await expect(
      verifyExactHostWebAuthnRegistration({
        challenge: 'test-challenge',
        relyingParty,
        response: registration,
      }),
    ).rejects.toThrow('Cross-origin WebAuthn ceremonies are not allowed');

    const authentication = {
      response: {
        clientDataJSON: clientData({ crossOrigin: false, topOrigin: 'https://example.invalid' }),
      },
    } as unknown as AuthenticationResponseJSON;
    await expect(
      verifyExactHostWebAuthnAuthentication({
        challenge: 'test-challenge',
        credential,
        relyingParty,
        response: authentication,
      }),
    ).rejects.toThrow('Cross-origin WebAuthn ceremonies are not allowed');

    const malformedCrossOrigin = {
      response: { clientDataJSON: clientData({ crossOrigin: 'false' }) },
    } as unknown as RegistrationResponseJSON;
    await expect(
      verifyExactHostWebAuthnRegistration({
        challenge: 'test-challenge',
        relyingParty,
        response: malformedCrossOrigin,
      }),
    ).rejects.toThrow('Cross-origin WebAuthn ceremonies are not allowed');
  });

  it('refuses a caller-constructed RP with a widened or mismatched origin', async () => {
    await expect(
      createWebAuthnAuthenticationOptions({
        credentials: [credential],
        relyingParty: {
          id: 'admin.customer.example',
          name: 'OmniReach',
          origin: 'https://customer.example',
        },
      }),
    ).rejects.toThrow('exact-host bound');
  });
});
