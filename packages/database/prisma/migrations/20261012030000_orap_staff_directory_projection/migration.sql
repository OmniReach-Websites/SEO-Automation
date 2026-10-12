-- O03: expose only non-secret authentication posture to the ORAP staff directory.
-- The platform role must never receive access to encrypted factor material, credential
-- identifiers, recovery codes, or session bearer hashes.

CREATE VIEW orap_staff_directory_auth_status
WITH (security_barrier = true)
AS
SELECT user_account.id AS user_id,
       COALESCE(policy.email_code_enabled, false) AS email_code_enabled,
       (
         EXISTS (
           SELECT 1
             FROM mfa_factors factor
            WHERE factor.user_id = user_account.id
              AND factor.verified_at IS NOT NULL
              AND factor.revoked_at IS NULL
         )
         OR EXISTS (
           SELECT 1
             FROM webauthn_credentials credential
             JOIN webauthn_scopes scope ON scope.id = credential.scope_id
            WHERE scope.user_id = user_account.id
              AND credential.revoked_at IS NULL
         )
       ) AS strong_factor_enrolled
  FROM users user_account
  LEFT JOIN account_authentication_policies policy
    ON policy.user_id = user_account.id;

REVOKE ALL ON orap_staff_directory_auth_status FROM PUBLIC;
GRANT SELECT ON orap_staff_directory_auth_status TO omnireach_platform;
