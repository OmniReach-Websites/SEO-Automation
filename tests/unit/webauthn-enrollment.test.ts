import {
  AuthenticationService,
  digestToken,
  hashPassword,
  type AuthenticationRepository,
  type MfaChallengeStore,
  type WebAuthnCeremony,
  type WebAuthnCeremonyStore,
  type WebAuthnEnrollmentRepository,
  type WebAuthnEnrollmentTarget,
  type WebAuthnRegistrationResponse,
} from '@omnireach/auth';
import { beforeAll, describe, expect, it, vi } from 'vitest';

const now = new Date('2026-10-11T12:00:00.000Z');
const userId = '10000000-0000-4000-8000-000000000001';
const scopeId = '20000000-0000-4000-8000-000000000001';
const tenantId = '30000000-0000-4000-8000-000000000001';
const siteId = '40000000-0000-4000-8000-000000000001';
const host = 'admin.customer.example';
const sessionToken = 'fictional-customer-session-token';
let passwordHash = '';

beforeAll(async () => {
  passwordHash = await hashPassword('fictional-current-password');
});

function ceremonyStore(): WebAuthnCeremonyStore & { values: Map<string, WebAuthnCeremony> } {
  const values = new Map<string, WebAuthnCeremony>();
  return {
    consume: vi.fn(async (id) => {
      const value = values.get(id);
      values.delete(id);
      return value;
    }),
    create: vi.fn(async (ceremony) => {
      values.set('ceremony-1', structuredClone(ceremony));
      return 'ceremony-1';
    }),
    values,
  };
}

function enrollmentTarget(
  overrides: Partial<WebAuthnEnrollmentTarget> = {},
): WebAuthnEnrollmentTarget {
  return {
    activeCredentialCount: 0,
    authStateVersion: '7',
    createdAt: now,
    credentials: [],
    displayName: 'Customer Owner',
    emailCodeEnabled: true,
    hasTotp: false,
    hasWebAuthn: false,
    host,
    id: scopeId,
    normalizedEmail: 'owner@example.test',
    passwordHash,
    role: 'customer_owner',
    rpId: host,
    secondStepRequired: false,
    siteId,
    tenantId,
    userHandle: new Uint8Array(64).fill(7),
    userId,
    ...overrides,
  };
}

function enrollmentRepository(target = enrollmentTarget()): WebAuthnEnrollmentRepository & {
  completeEnrollment: ReturnType<typeof vi.fn<WebAuthnEnrollmentRepository['completeEnrollment']>>;
  findEnrollmentTarget: ReturnType<
    typeof vi.fn<WebAuthnEnrollmentRepository['findEnrollmentTarget']>
  >;
} {
  return {
    completeEnrollment: vi.fn(async () => true),
    findEnrollmentTarget: vi.fn(async () => target),
  };
}

function challenges(): MfaChallengeStore {
  return {
    consume: vi.fn(async () => undefined),
    create: vi.fn(async () => 'unused'),
    read: vi.fn(async () => undefined),
    refresh: vi.fn(async () => false),
  };
}

function baseRepository(): AuthenticationRepository {
  return {
    acceptInvitation: vi.fn(async () => undefined),
    checkRecoveryCode: vi.fn(async () => false),
    clearLoginFailures: vi.fn(async () => undefined),
    completeCustomerRecovery: vi.fn(async () => false),
    completeOwnerBootstrap: vi.fn(async () => false),
    completePasswordRecovery: vi.fn(async () => false),
    consumeTotpCounter: vi.fn(async () => false),
    createPasswordRecovery: vi.fn(async () => undefined),
    createSession: vi.fn(async () => false),
    findAccountSecurityTarget: vi.fn(async () => undefined),
    findLoginTarget: vi.fn(async () => undefined),
    findMfaFactor: vi.fn(async () => undefined),
    findSessionOwner: vi.fn(async () => undefined),
    listSessions: vi.fn(async () => []),
    recordLoginFailure: vi.fn(async () => undefined),
    revokeSession: vi.fn(async () => false),
    revokeSessionByToken: vi.fn(async () => undefined),
    updateCustomerEmailCodePolicy: vi.fn(async () => false),
    verifyOwnerBootstrap: vi.fn(async () => false),
  };
}

function verifiedRegistration(
  overrides: {
    origin?: string;
    rpID?: string;
    userVerified?: boolean;
  } = {},
) {
  return vi.fn(async () => ({
    registrationInfo: {
      aaguid: '00000000-0000-0000-0000-000000000000',
      attestationObject: new Uint8Array([1]),
      authenticatorExtensionResults: {},
      credential: {
        counter: 0,
        id: 'AQID',
        publicKey: new Uint8Array([1, 2, 3]),
        transports: ['internal'],
      },
      credentialBackedUp: false,
      credentialDeviceType: 'singleDevice' as const,
      credentialType: 'public-key' as const,
      fmt: 'none' as const,
      origin: overrides.origin ?? `https://${host}`,
      rpID: overrides.rpID ?? host,
      userVerified: overrides.userVerified ?? true,
    },
    verified: true as const,
  }));
}

function registrationResponse(): WebAuthnRegistrationResponse {
  return {
    clientExtensionResults: {},
    id: 'AQID',
    rawId: 'AQID',
    response: {
      attestationObject: 'AQ',
      clientDataJSON: 'AQ',
      transports: ['internal'],
    },
    type: 'public-key',
  };
}

function service(
  input: {
    enabled?: boolean;
    repository?: ReturnType<typeof enrollmentRepository>;
    store?: ReturnType<typeof ceremonyStore>;
    verify?: ReturnType<typeof verifiedRegistration>;
  } = {},
) {
  const repository = input.repository ?? enrollmentRepository();
  const store = input.store ?? ceremonyStore();
  return {
    auth: new AuthenticationService(
      baseRepository(),
      challenges(),
      { send: vi.fn(async () => undefined) },
      {
        authenticationPepper: 'fictional-authentication-pepper-material-0001',
        mfaEncryptionKey: 'fictional-mfa-encryption-key-material-0001',
        now: () => now,
        orapHostname: 'admin.omnireach.cloud',
        verifyWebAuthnRegistration: input.verify ?? verifiedRegistration(),
        webAuthnAuthenticationEnabled: input.enabled ?? true,
        webAuthnCeremonies: store,
        webAuthnRepository: repository,
      },
    ),
    repository,
    store,
  };
}

async function prepare(auth: AuthenticationService) {
  return auth.prepareWebAuthnEnrollment({
    credentialName: 'Windows Hello',
    currentPassword: 'fictional-current-password',
    host,
    sessionToken,
    traceId: 'trace-enrollment',
  });
}

describe('WebAuthn enrollment service', () => {
  it('fails closed without the assertion-capability gate and performs no durable work', async () => {
    const { auth, repository, store } = service({ enabled: false });

    await expect(prepare(auth)).resolves.toBeUndefined();
    await expect(
      auth.completeWebAuthnEnrollment({
        ceremonyId: 'ceremony-1',
        host,
        recoveryCodesAcknowledged: true,
        response: registrationResponse(),
        sessionToken,
        traceId: 'trace-enrollment',
      }),
    ).resolves.toBeUndefined();
    expect(repository.findEnrollmentTarget).not.toHaveBeenCalled();
    expect(repository.completeEnrollment).not.toHaveBeenCalled();
    expect(store.create).not.toHaveBeenCalled();
    expect(store.consume).not.toHaveBeenCalled();
  });

  it('binds exact-host registration and hashed recovery state, then completes once atomically', async () => {
    const { auth, repository, store } = service();
    const prepared = await prepare(auth);

    expect(prepared?.options.rp.id).toBe(host);
    expect(prepared?.options.authenticatorSelection?.userVerification).toBe('required');
    expect(prepared?.recoveryCodes).toHaveLength(10);
    expect(prepared?.recoveryCodes[0]).toMatch(/^[A-F0-9]{4}(?:-[A-F0-9]{4}){3}$/u);
    const pending = store.values.get('ceremony-1');
    expect(pending).toMatchObject({
      credentialName: 'Windows Hello',
      host,
      origin: `https://${host}`,
      purpose: 'registration',
      rpId: host,
      sessionTokenHash: digestToken(sessionToken),
    });
    expect(pending?.purpose === 'registration' ? pending.recoveryCodeHashes : []).toHaveLength(10);
    expect(JSON.stringify(pending)).not.toContain(prepared?.recoveryCodes[0] ?? 'missing');

    await expect(
      auth.completeWebAuthnEnrollment({
        ceremonyId: prepared?.ceremonyId ?? '',
        host,
        recoveryCodesAcknowledged: true,
        response: registrationResponse(),
        sessionToken,
        traceId: 'trace-completion',
      }),
    ).resolves.toEqual({ sessionsRevoked: true });
    expect(repository.completeEnrollment).toHaveBeenCalledWith(
      expect.objectContaining({
        credentialName: 'Windows Hello',
        expectedAuthStateVersion: '7',
        host,
        recoveryCodeHashes: expect.arrayContaining([expect.stringMatching(/^[a-f0-9]{64}$/u)]),
        sessionTokenHash: digestToken(sessionToken),
        siteId,
        tenantId,
        userId,
      }),
    );
    await expect(
      auth.completeWebAuthnEnrollment({
        ceremonyId: prepared?.ceremonyId ?? '',
        host,
        recoveryCodesAcknowledged: true,
        response: registrationResponse(),
        sessionToken,
        traceId: 'trace-replay',
      }),
    ).resolves.toBeUndefined();
    expect(repository.completeEnrollment).toHaveBeenCalledTimes(1);
  });

  it('consumes a ceremony once across concurrent completion attempts', async () => {
    const { auth, repository } = service();
    const prepared = await prepare(auth);
    const completion = () =>
      auth.completeWebAuthnEnrollment({
        ceremonyId: prepared?.ceremonyId ?? '',
        host,
        recoveryCodesAcknowledged: true,
        response: registrationResponse(),
        sessionToken,
        traceId: 'trace-race',
      });

    const results = await Promise.all([completion(), completion()]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(repository.completeEnrollment).toHaveBeenCalledTimes(1);
  });

  it('requires saved-code acknowledgment and rejects a different host or session', async () => {
    const acknowledgment = service();
    const prepared = await prepare(acknowledgment.auth);
    await expect(
      acknowledgment.auth.completeWebAuthnEnrollment({
        ceremonyId: prepared?.ceremonyId ?? '',
        host,
        recoveryCodesAcknowledged: false,
        response: registrationResponse(),
        sessionToken,
        traceId: 'trace-no-acknowledgment',
      }),
    ).resolves.toBeUndefined();
    expect(acknowledgment.store.consume).not.toHaveBeenCalled();

    const wrongHost = service();
    const wrongHostPrepared = await prepare(wrongHost.auth);
    await expect(
      wrongHost.auth.completeWebAuthnEnrollment({
        ceremonyId: wrongHostPrepared?.ceremonyId ?? '',
        host: 'admin.other.example',
        recoveryCodesAcknowledged: true,
        response: registrationResponse(),
        sessionToken,
        traceId: 'trace-wrong-host',
      }),
    ).resolves.toBeUndefined();
    expect(wrongHost.repository.completeEnrollment).not.toHaveBeenCalled();

    const wrongSession = service();
    const wrongSessionPrepared = await prepare(wrongSession.auth);
    await expect(
      wrongSession.auth.completeWebAuthnEnrollment({
        ceremonyId: wrongSessionPrepared?.ceremonyId ?? '',
        host,
        recoveryCodesAcknowledged: true,
        response: registrationResponse(),
        sessionToken: 'different-session-token',
        traceId: 'trace-wrong-session',
      }),
    ).resolves.toBeUndefined();
    expect(wrongSession.repository.completeEnrollment).not.toHaveBeenCalled();
  });

  it.each([
    ['wrong origin', { origin: 'https://customer.example' }],
    ['wrong RP ID', { rpID: 'customer.example' }],
    ['missing user verification', { userVerified: false }],
  ])('rejects %s before persistence', async (_label, verification) => {
    const { auth, repository } = service({ verify: verifiedRegistration(verification) });
    const prepared = await prepare(auth);

    await expect(
      auth.completeWebAuthnEnrollment({
        ceremonyId: prepared?.ceremonyId ?? '',
        host,
        recoveryCodesAcknowledged: true,
        response: registrationResponse(),
        sessionToken,
        traceId: 'trace-invalid-verification',
      }),
    ).resolves.toBeUndefined();
    expect(repository.completeEnrollment).not.toHaveBeenCalled();
  });

  it('requires a fallback for the first passkey, permits an existing passkey, and enforces the limit', async () => {
    const noFallback = enrollmentRepository(
      enrollmentTarget({ emailCodeEnabled: false, hasTotp: false }),
    );
    const existingPasskey = enrollmentRepository(
      enrollmentTarget({ emailCodeEnabled: false, hasTotp: false, hasWebAuthn: true }),
    );
    const atLimit = enrollmentRepository(enrollmentTarget({ activeCredentialCount: 10 }));

    await expect(prepare(service({ repository: noFallback }).auth)).resolves.toBeUndefined();
    await expect(prepare(service({ repository: existingPasskey }).auth)).resolves.toBeDefined();
    await expect(prepare(service({ repository: atLimit }).auth)).resolves.toBeUndefined();
    expect(noFallback.completeEnrollment).not.toHaveBeenCalled();
    expect(atLimit.completeEnrollment).not.toHaveBeenCalled();
  });
});
