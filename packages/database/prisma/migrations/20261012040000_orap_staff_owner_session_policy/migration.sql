-- Owner-approved policy: internal staff-authority actions require a current Platform
-- Owner session and an audit reason, but no additional authenticator/passkey step-up.
-- Other owner-only capabilities retain the strong-step-up catalog invariant.
ALTER TABLE permission_definitions
  DROP CONSTRAINT owner_permission_safeguard;

ALTER TABLE permission_definitions
  ADD CONSTRAINT owner_permission_safeguard CHECK (
    NOT is_owner_only
    OR (
      requires_reason
      AND risk_level = 'critical'
      AND (requires_step_up OR module = 'staff')
    )
  );
