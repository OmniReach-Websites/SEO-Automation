-- Consuming a pending invitation changes it into a row that is intentionally no
-- longer visible through the authentication role's SELECT policy. Perform that
-- one transition through a guarded function instead of widening post-acceptance
-- invitation visibility.

CREATE OR REPLACE FUNCTION accept_orap_staff_invitation(
  requested_invitation_id uuid,
  requested_user_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  invitation_record record;
BEGIN
  SELECT invitation.id,
         invitation.normalized_email,
         invitation.role_id,
         invitation.role_version_id,
         invitation.created_by
    INTO invitation_record
    FROM public.staff_invitations invitation
   WHERE invitation.id = requested_invitation_id
     AND invitation.state = 'pending'
     AND invitation.expires_at > now()
   FOR UPDATE;

  IF invitation_record.id IS NULL THEN
    RAISE EXCEPTION 'pending staff invitation was not found' USING ERRCODE = 'P0002';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM public.users account
      JOIN public.platform_memberships legacy
        ON legacy.user_id = account.id
       AND legacy.active
       AND legacy.role IN ('platform_admin', 'staff')
      JOIN public.orap_staff_memberships membership
        ON membership.user_id = account.id
       AND membership.identity_kind = legacy.role
       AND membership.status = 'active'
       AND membership.created_by = invitation_record.created_by
      JOIN public.staff_role_assignments assignment
        ON assignment.staff_membership_id = membership.id
       AND assignment.role_id = invitation_record.role_id
       AND assignment.role_version_id = invitation_record.role_version_id
       AND assignment.active
       AND assignment.primary_role
      JOIN public.staff_resource_scopes scope
        ON scope.assignment_id = assignment.id
       AND scope.scope_type = 'platform'
       AND scope.tenant_id IS NULL
       AND scope.site_id IS NULL
     WHERE account.id = requested_user_id
       AND account.status = 'active'
       AND account.normalized_email = invitation_record.normalized_email
  ) THEN
    RAISE EXCEPTION 'staff invitation acceptance state is incomplete'
      USING ERRCODE = '23514';
  END IF;

  UPDATE public.staff_invitations
     SET state = 'accepted',
         accepted_at = now(),
         accepted_user_id = requested_user_id
   WHERE id = requested_invitation_id;
END
$$;

REVOKE ALL ON FUNCTION accept_orap_staff_invitation(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION accept_orap_staff_invitation(uuid, uuid)
  TO omnireach_auth;

REVOKE UPDATE (state, accepted_at, accepted_user_id) ON staff_invitations
  FROM omnireach_auth;
DROP POLICY staff_invitations_auth_update_policy ON staff_invitations;

INSERT INTO schema_metadata (key, value)
VALUES ('orap_staff_invitation_consumption_guard', to_jsonb('1-guarded-transition'::text))
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
