import { isIP } from 'node:net';
import { randomBytes } from 'node:crypto';
import { domainToASCII } from 'node:url';

import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type Base64URLString,
  type CredentialDeviceType,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
  type VerifiedAuthenticationResponse,
  type VerifiedRegistrationResponse,
  type WebAuthnCredential,
} from '@simplewebauthn/server';

export const webAuthnCeremonyTtlSeconds = 300;
export const webAuthnSupportedAlgorithmIds = [-7, -257] as const;

export type WebAuthnCeremonyPurpose =
  'authentication' | 'owner_bootstrap' | 'registration' | 'step_up';

export interface WebAuthnRelyingParty {
  id: string;
  name: string;
  origin: string;
}

export interface WebAuthnScopeRecord {
  createdAt: Date;
  id: string;
  rpId: string;
  siteId?: string;
  tenantId?: string;
  userHandle: Uint8Array;
  userId: string;
}

export interface WebAuthnCredentialRecord {
  backedUp: boolean;
  backupEligible: boolean;
  createdAt: Date;
  credentialId: Uint8Array;
  deviceType: CredentialDeviceType;
  id: string;
  lastUsedAt?: Date;
  name: string;
  publicKey: Uint8Array;
  revokedAt?: Date;
  signCount: number;
  transports: string[];
  verifiedAt: Date;
}

interface WebAuthnCeremonyBinding {
  authStateVersion: string;
  challenge: string;
  host: string;
  origin: string;
  rpId: string;
  scopeId: string;
  siteId?: string;
  tenantId?: string;
  traceId: string;
  userHandle: string;
  userId: string;
}

export type WebAuthnCeremony = WebAuthnCeremonyBinding &
  (
    | {
        baseChallengeDigest: string;
        bootstrapBindingDigest?: never;
        purpose: 'authentication';
        sessionTokenHash?: never;
      }
    | {
        baseChallengeDigest?: never;
        bootstrapBindingDigest: string;
        purpose: 'owner_bootstrap';
        sessionTokenHash?: never;
      }
    | {
        baseChallengeDigest?: never;
        bootstrapBindingDigest?: never;
        purpose: 'registration' | 'step_up';
        sessionTokenHash: string;
      }
  );

export interface WebAuthnCeremonyStore {
  consume(ceremonyId: string): Promise<WebAuthnCeremony | undefined>;
  create(ceremony: WebAuthnCeremony, ttlSeconds?: number): Promise<string>;
}

export function createWebAuthnUserHandle(): Uint8Array {
  return new Uint8Array(randomBytes(64));
}

export function resolveWebAuthnRelyingParty(
  host: string,
  name = 'OmniReach',
): WebAuthnRelyingParty {
  const id = normalizeWebAuthnHost(host);
  const normalizedName = name.trim();
  if (!normalizedName || normalizedName.length > 100) {
    throw new Error('Invalid WebAuthn relying-party name');
  }
  return { id, name: normalizedName, origin: `https://${id}` };
}

export async function createWebAuthnRegistrationOptions(input: {
  credentials: Pick<WebAuthnCredentialRecord, 'credentialId' | 'transports'>[];
  displayName: string;
  relyingParty: WebAuthnRelyingParty;
  userHandle: Uint8Array;
  userName: string;
}): Promise<PublicKeyCredentialCreationOptionsJSON> {
  assertExactRelyingParty(input.relyingParty);
  if (input.userHandle.byteLength !== 64) throw new Error('Invalid WebAuthn user handle');
  return generateRegistrationOptions({
    attestationType: 'none',
    authenticatorSelection: {
      residentKey: 'preferred',
      userVerification: 'required',
    },
    excludeCredentials: input.credentials.map((credential) => ({
      id: toBase64Url(credential.credentialId),
      transports: [...credential.transports],
    })),
    preferredAuthenticatorType: 'localDevice',
    rpID: input.relyingParty.id,
    rpName: input.relyingParty.name,
    supportedAlgorithmIDs: [...webAuthnSupportedAlgorithmIds],
    timeout: webAuthnCeremonyTtlSeconds * 1000,
    userDisplayName: input.displayName,
    userID: copyBytes(input.userHandle),
    userName: input.userName,
  });
}

export async function createWebAuthnAuthenticationOptions(input: {
  credentials: Pick<WebAuthnCredentialRecord, 'credentialId' | 'transports'>[];
  relyingParty: WebAuthnRelyingParty;
}): Promise<PublicKeyCredentialRequestOptionsJSON> {
  assertExactRelyingParty(input.relyingParty);
  return generateAuthenticationOptions({
    allowCredentials: input.credentials.map((credential) => ({
      id: toBase64Url(credential.credentialId),
      transports: [...credential.transports],
    })),
    rpID: input.relyingParty.id,
    timeout: webAuthnCeremonyTtlSeconds * 1000,
    userVerification: 'required',
  });
}

export async function verifyExactHostWebAuthnRegistration(input: {
  challenge: string;
  relyingParty: WebAuthnRelyingParty;
  response: RegistrationResponseJSON;
}): Promise<VerifiedRegistrationResponse> {
  assertExactRelyingParty(input.relyingParty);
  rejectCrossOriginClientData(input.response.response.clientDataJSON);
  return verifyRegistrationResponse({
    expectedChallenge: input.challenge,
    expectedOrigin: input.relyingParty.origin,
    expectedRPID: input.relyingParty.id,
    requireUserPresence: true,
    requireUserVerification: true,
    response: input.response,
    supportedAlgorithmIDs: [...webAuthnSupportedAlgorithmIds],
  });
}

export async function verifyExactHostWebAuthnAuthentication(input: {
  challenge: string;
  credential: WebAuthnCredentialRecord;
  relyingParty: WebAuthnRelyingParty;
  response: AuthenticationResponseJSON;
}): Promise<VerifiedAuthenticationResponse> {
  assertExactRelyingParty(input.relyingParty);
  rejectCrossOriginClientData(input.response.response.clientDataJSON);
  const credential: WebAuthnCredential = {
    counter: input.credential.signCount,
    id: toBase64Url(input.credential.credentialId),
    publicKey: copyBytes(input.credential.publicKey),
    transports: [...input.credential.transports],
  };
  return verifyAuthenticationResponse({
    credential,
    expectedChallenge: input.challenge,
    expectedOrigin: input.relyingParty.origin,
    expectedRPID: input.relyingParty.id,
    requireUserVerification: true,
    response: input.response,
  });
}

export function normalizeWebAuthnHost(value: string): string {
  if (!value || value !== value.trim() || /[\s/@:#?\[\]]/u.test(value)) {
    throw new Error('Invalid WebAuthn host');
  }
  const hostname = new URL(`https://${value}`).hostname.replace(/\.$/u, '');
  const ascii = domainToASCII(hostname).toLowerCase();
  const labels = ascii.split('.');
  if (
    !ascii ||
    ascii.length > 253 ||
    isIP(ascii) !== 0 ||
    labels.some(
      (label) => !label || label.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/u.test(label),
    )
  ) {
    throw new Error('Invalid WebAuthn host');
  }
  return ascii;
}

function assertExactRelyingParty(relyingParty: WebAuthnRelyingParty): void {
  const normalized = normalizeWebAuthnHost(relyingParty.id);
  if (normalized !== relyingParty.id || relyingParty.origin !== `https://${normalized}`) {
    throw new Error('WebAuthn relying party is not exact-host bound');
  }
}

function rejectCrossOriginClientData(clientDataJson: string): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(clientDataJson, 'base64url').toString('utf8'));
  } catch {
    throw new Error('Invalid WebAuthn client data');
  }
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    ((parsed as { crossOrigin?: unknown }).crossOrigin !== undefined &&
      (parsed as { crossOrigin?: unknown }).crossOrigin !== false) ||
    (parsed as { topOrigin?: unknown }).topOrigin !== undefined
  ) {
    throw new Error('Cross-origin WebAuthn ceremonies are not allowed');
  }
}

function toBase64Url(value: Uint8Array): Base64URLString {
  return Buffer.from(value).toString('base64url') as Base64URLString;
}

function copyBytes(value: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(value.byteLength);
  copy.set(value);
  return copy;
}
