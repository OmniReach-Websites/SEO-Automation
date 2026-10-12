export {
  createMfaEnrollment,
  createRecoveryCodes,
  verifyTotp,
  type MfaEnrollment,
  type RecoveryCodeSet,
} from './mfa.ts';
export { createEmailVerificationCode, digestEmailVerificationCode } from './email-code.ts';
export { hashPassword, normalizeEmail, validatePassword, verifyPassword } from './passwords.ts';
export {
  hasPermission,
  platformRoles,
  requiresMfa,
  roles,
  type Action,
  type Role,
} from './roles.ts';
export {
  createOneTimeToken,
  digestToken,
  sessionCookieOptions,
  type OneTimeToken,
  type SessionCookieOptions,
} from './tokens.ts';
export {
  activeSecretKey,
  createVersionedSecretKeyring,
  decryptMfaSecret,
  decryptPasswordRecoveryDeliveryToken,
  encryptMfaSecret,
  encryptPasswordRecoveryDeliveryToken,
  maximumMfaKeyVersion,
  parseVersionedSecretKeyring,
  secretKeyForVersion,
  type ActiveSecretKey,
  type VersionedSecretKeyring,
  type VersionedSecretKeyringInput,
} from './secrets.ts';
export {
  PostgresPasswordRecoveryOutbox,
  type PasswordRecoveryOutboxClient,
  type PasswordRecoveryOutboxPool,
  type PasswordRecoveryOutboxResult,
} from './password-recovery-outbox.ts';
export {
  PostgresMfaKeyRotator,
  type MfaKeyRetirementReport,
  type MfaKeyRetirementResult,
  type MfaKeyRotationBatchResult,
  type MfaKeyRotationClient,
  type MfaKeyRotationPool,
} from './key-rotation.ts';
export {
  AuthenticationService,
  type AccountSecuritySettings,
  type AccountSecurityTarget,
  type AuthenticationAssurance,
  type AuthenticationRateLimiter,
  type AuthenticationRateLimitScope,
  type AuthenticationRepository,
  type AuthenticationResult,
  type EmailCodeChallengeStore,
  type EmailCodeResendResult,
  type EmailCodePolicyChangeResult,
  type EmailCodeVerificationResult,
  type LoginTarget,
  type MfaChallenge,
  type MfaChallengeStore,
  type MfaFactorRecord,
  type OwnerBootstrapPendingStore,
  type PendingOwnerBootstrap,
  type PasswordRecoveryNotifier,
  type SessionAuthenticationMethod,
  type SessionOwner,
  type SessionRecord,
  type VerificationCodeNotifier,
  type VerificationMethod,
} from './service.ts';
export {
  PostgresAuthenticationRepository,
  type AuthenticationTransactionClient,
  type AuthenticationTransactionPool,
} from './postgres.ts';
export { PostgresWebAuthnRepository, type WebAuthnScopeTarget } from './postgres-webauthn.ts';
export {
  createWebAuthnAuthenticationOptions,
  createWebAuthnRegistrationOptions,
  createWebAuthnUserHandle,
  normalizeWebAuthnHost,
  resolveWebAuthnRelyingParty,
  verifyExactHostWebAuthnAuthentication,
  verifyExactHostWebAuthnRegistration,
  webAuthnCeremonyTtlSeconds,
  webAuthnSupportedAlgorithmIds,
  type WebAuthnCeremony,
  type WebAuthnCeremonyPurpose,
  type WebAuthnCeremonyStore,
  type WebAuthnCredentialRecord,
  type WebAuthnRelyingParty,
  type WebAuthnScopeRecord,
} from './webauthn.ts';
