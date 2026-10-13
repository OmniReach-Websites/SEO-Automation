# Encryption-Key Rotation and Break-Glass Runbook

## Versioned MFA key rotation

Production uses `MFA_ENCRYPTION_KEYRING_JSON` with one `activeVersion` and independently generated 32-byte keys. Never print or commit the JSON.

1. Freeze security-method changes and take a verified preservation backup.
2. Generate a new random key outside Git/chat/logs. Add it under a new integer version while retaining every version still referenced by `mfa_factors`.
3. Run `npm run auth:key-rotation -- --dry-run` against a disposable/restored environment. The report may contain versions/counts, never key material.
4. Install the expanded keyring through the approved secret mount. Deploy a compatible release and prove both old and new ciphertext decrypt.
5. Make the new version active. New writes now use it; old records remain readable.
6. Run the bounded re-encryption command in an authorized maintenance window. Stop on any decrypt/authentication failure.
7. Repeat dry-run until the old-version reference count is zero; verify authentication and rollback compatibility from an isolated restore.
8. Retire the old key only after backup retention, rollback release compatibility and owner approval are recorded.

Rollback means restoring the prior expanded keyring and compatible application release. Never retire the old key first and never edit ciphertext manually.

## Lost owner factor

1. Confirm the requester through the approved out-of-band identity checklist. Do not accept email possession alone for a platform owner.
2. Require the named break-glass approver and a second reviewer once staff access exists. The current single-owner dependency remains a recorded risk.
3. Freeze privileged mutations, preserve authentication/audit evidence and revoke suspected sessions.
4. Use only the short-lived, one-use audited recovery path. Never expose hashes, reset MFA flags directly, or create an untracked session.
5. Enroll a new strong factor, generate new recovery codes, revoke sibling sessions and close the authorization.
6. Review all privileged events from the suspected-loss window and rotate any exposed provider/deploy credentials.

## Compromised encryption/provider key

Disable the affected feature, revoke the provider credential, stop relevant queued/running work, preserve evidence and rotate using the two-version process. If old ciphertext cannot be trusted, keep the provider disabled and restore from the last verified pre-compromise recovery point only under an incident decision. Public static artifacts remain served.

## Emergency freeze

Use platform/site emergency controls to stop automation and publishing, then drain or cancel only the affected jobs. Do not stop static site serving. Record scope, reason, actor, trace, start time and recovery criteria. Re-enable only after credentials, audits, tenant boundaries and a known-good artifact are verified.

Production execution of any procedure above is **Waiting** on a named window and explicit authorization.
