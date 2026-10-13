# Customer Security and Factor UX

Customers are password-only by default. Email code, TOTP and passkeys are voluntary unless a later audited site policy says otherwise. Platform accounts keep their separate mandatory second-step policy.

The **Account security** page shows active methods, registered passkeys and active sessions. TOTP setup requires the current password, displays the authenticator URI and recovery codes once, requires a valid code plus explicit recovery-code acknowledgment, then revokes all sessions. Disabling TOTP requires the current password and confirmation and also revokes all sessions.

Passkey enrollment requires the current password, a credential name, an exact HTTPS admin host and a browser WebAuthn ceremony. The recovery codes appear once. Renaming requires current-password proof. Revoking a passkey requires current-password proof, recent verified session context and another usable factor/passkey; a successful revoke closes all sessions. Passkey sign-in begins only after the password has identified an exact account/site and returned a challenge that permits WebAuthn.

Users can revoke any listed session. After a factor or password change they must sign in again. Errors intentionally avoid identity enumeration and never return secret material after the one-time setup response.

If every factor is lost, use the normal password-recovery path when eligible. Platform-owner loss or an account with no safe customer fallback follows the audited break-glass procedure in `key-rotation-break-glass.md`; support must never disable verification directly in SQL or ask for a password, recovery code, token, or authenticator secret.
