-- 200: RLS for SaaS team membership and immutable audit history.
-- Access is scoped by authenticated user + active business profile. Pending
-- invitees can only see/accept their own invitation; managers can administer
-- team members in the selected profile. No hard deletion is allowed.
BEGIN;

CREATE OR REPLACE FUNCTION public.app_saas_current_business_profile_id()
RETURNS text
LANGUAGE sql STABLE
SET search_path = public, pg_temp
AS $$
  SELECT NULLIF(current_setting('app.business_profile_id', true), '')
$$;

CREATE OR REPLACE FUNCTION public.app_saas_is_member(p_business_profile_id text, p_user_id integer DEFAULT NULL)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.memberships m
     WHERE m.business_profile_id = p_business_profile_id
       AND (p_user_id IS NULL OR p_user_id = NULLIF(current_setting('app.user_id', true), '')::integer)
       AND m.user_id = NULLIF(current_setting('app.user_id', true), '')::integer
       AND m.status = 'ACTIVE'
  )
$$;

CREATE OR REPLACE FUNCTION public.app_saas_can_manage_members(p_business_profile_id text, p_user_id integer DEFAULT NULL)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.memberships m
     WHERE m.business_profile_id = p_business_profile_id
       AND (p_user_id IS NULL OR p_user_id = NULLIF(current_setting('app.user_id', true), '')::integer)
       AND m.user_id = NULLIF(current_setting('app.user_id', true), '')::integer
       AND m.status = 'ACTIVE' AND m.role IN ('OWNER','ADMIN')
  )
$$;

CREATE OR REPLACE FUNCTION public.app_saas_is_owner(p_business_profile_id text, p_user_id integer DEFAULT NULL)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.memberships m
     WHERE m.business_profile_id = p_business_profile_id
       AND (p_user_id IS NULL OR p_user_id = NULLIF(current_setting('app.user_id', true), '')::integer)
       AND m.user_id = NULLIF(current_setting('app.user_id', true), '')::integer
       AND m.status = 'ACTIVE' AND m.role = 'OWNER'
  )
$$;

CREATE OR REPLACE FUNCTION public.app_saas_has_any_membership(p_business_profile_id text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.business_profiles bp
      JOIN public.memberships m ON m.business_profile_id = bp.id
     WHERE bp.id = p_business_profile_id
       AND bp.provider_id = NULLIF(current_setting('app.user_id', true), '')::integer
  )
$$;

-- Team listings may show only the minimal user fields already displayed in
-- the staff UI, and only to an active member of that same selected profile.
CREATE OR REPLACE FUNCTION public.app_saas_team_user_info(p_business_profile_id text)
RETURNS TABLE(user_id integer, email text, nombre text, foto_url text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT u.id, u.email::text, u.nombre::text, u.foto_url::text
    FROM public.memberships m
    JOIN public.usuarios u ON u.id = m.user_id
   WHERE m.business_profile_id = p_business_profile_id
     AND m.status IN ('ACTIVE','PENDING','INVITED','SUSPENDED','EXPIRED')
     AND p_business_profile_id = public.app_saas_current_business_profile_id()
     AND public.app_saas_is_member(p_business_profile_id)
$$;

-- Email lookup is a narrowly scoped capability needed by the invite flow.
CREATE OR REPLACE FUNCTION public.app_saas_find_user_by_email(p_email text)
RETURNS TABLE(user_id integer, email text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT u.id, u.email::text
    FROM public.usuarios u
   WHERE lower(u.email) = lower(trim(p_email))
     AND public.app_saas_can_manage_members(public.app_saas_current_business_profile_id())
   LIMIT 1
$$;

REVOKE ALL ON FUNCTION public.app_saas_current_business_profile_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_saas_is_member(text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_saas_can_manage_members(text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_saas_is_owner(text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_saas_has_any_membership(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_saas_team_user_info(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_saas_find_user_by_email(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_saas_current_business_profile_id() TO app_rls_user;
GRANT EXECUTE ON FUNCTION public.app_saas_is_member(text, integer) TO app_rls_user;
GRANT EXECUTE ON FUNCTION public.app_saas_can_manage_members(text, integer) TO app_rls_user;
GRANT EXECUTE ON FUNCTION public.app_saas_is_owner(text, integer) TO app_rls_user;
GRANT EXECUTE ON FUNCTION public.app_saas_has_any_membership(text) TO app_rls_user;
GRANT EXECUTE ON FUNCTION public.app_saas_team_user_info(text) TO app_rls_user;
GRANT EXECUTE ON FUNCTION public.app_saas_find_user_by_email(text) TO app_rls_user;

-- The definer helpers inspect membership rows to make policy decisions. Own
-- them with the dedicated BYPASSRLS system role; otherwise FORCE RLS would
-- recursively apply the memberships policy while the helper evaluates it.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = 'app_system' AND rolbypassrls
  ) THEN
    RAISE EXCEPTION 'Se requiere app_system con BYPASSRLS para proteger helpers de membresías';
  END IF;
END $$;
GRANT SELECT ON public.memberships, public.usuarios, public.business_profiles TO app_system;
GRANT CREATE ON SCHEMA public TO app_system;
ALTER FUNCTION public.app_saas_is_member(text, integer) OWNER TO app_system;
ALTER FUNCTION public.app_saas_can_manage_members(text, integer) OWNER TO app_system;
ALTER FUNCTION public.app_saas_is_owner(text, integer) OWNER TO app_system;
ALTER FUNCTION public.app_saas_has_any_membership(text) OWNER TO app_system;
ALTER FUNCTION public.app_saas_team_user_info(text) OWNER TO app_system;
ALTER FUNCTION public.app_saas_find_user_by_email(text) OWNER TO app_system;
REVOKE CREATE ON SCHEMA public FROM app_system;

-- Migrations run under the backend's admin connection, which may not own the
-- default privileges established for app_rls_user. Grant only the table
-- operations required by the team API explicitly.
GRANT SELECT, INSERT, UPDATE ON public.memberships TO app_rls_user;
GRANT SELECT, INSERT ON public.membership_audit_logs TO app_rls_user;
GRANT USAGE, SELECT ON SEQUENCE public.membership_audit_logs_id_seq TO app_rls_user;

ALTER TABLE public.memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.memberships FORCE ROW LEVEL SECURITY;
ALTER TABLE public.membership_audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.membership_audit_logs FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS saas_memberships_select_scoped ON public.memberships;
CREATE POLICY saas_memberships_select_scoped ON public.memberships
  FOR SELECT TO app_rls_user
  USING (
    user_id = NULLIF(current_setting('app.user_id', true), '')::integer
    OR (
      business_profile_id = public.app_saas_current_business_profile_id()
      AND public.app_saas_is_member(business_profile_id)
    )
  );

DROP POLICY IF EXISTS saas_memberships_insert_scoped ON public.memberships;
CREATE POLICY saas_memberships_insert_scoped ON public.memberships
  FOR INSERT TO app_rls_user
  WITH CHECK (
    (
      business_profile_id = public.app_saas_current_business_profile_id()
      AND public.app_saas_can_manage_members(business_profile_id)
      AND role <> 'OWNER'
      AND status IN ('PENDING','INVITED')
      AND invite_email IS NOT NULL
      AND invite_token_hash IS NOT NULL
      AND invite_expires_at IS NOT NULL
    )
    OR (
      user_id = NULLIF(current_setting('app.user_id', true), '')::integer
      AND role = 'OWNER' AND status = 'ACTIVE'
      AND EXISTS (
        SELECT 1 FROM public.business_profiles bp
         WHERE bp.id = memberships.business_profile_id
           AND bp.provider_id = NULLIF(current_setting('app.user_id', true), '')::integer
      )
      AND (
        (
          NOT EXISTS (
            SELECT 1 FROM public.memberships existing
             WHERE existing.user_id = memberships.user_id
               AND existing.business_profile_id = memberships.business_profile_id
          )
          AND NOT public.app_saas_has_any_membership(business_profile_id)
        )
        OR EXISTS (
          SELECT 1 FROM public.memberships existing
           WHERE existing.user_id = memberships.user_id
             AND existing.business_profile_id = memberships.business_profile_id
             AND existing.role = 'OWNER' AND existing.status = 'ACTIVE'
        )
      )
    )
  );

DROP POLICY IF EXISTS saas_memberships_update_scoped ON public.memberships;
CREATE POLICY saas_memberships_update_scoped ON public.memberships
  FOR UPDATE TO app_rls_user
  USING (
    business_profile_id = public.app_saas_current_business_profile_id()
    AND public.app_saas_can_manage_members(business_profile_id)
  )
  WITH CHECK (
    business_profile_id = public.app_saas_current_business_profile_id()
    AND public.app_saas_can_manage_members(business_profile_id)
  );

DROP POLICY IF EXISTS saas_memberships_self_accept ON public.memberships;
CREATE POLICY saas_memberships_self_accept ON public.memberships
  FOR UPDATE TO app_rls_user
  USING (
    user_id = NULLIF(current_setting('app.user_id', true), '')::integer
    AND status IN ('PENDING','INVITED')
  )
  WITH CHECK (
    user_id = NULLIF(current_setting('app.user_id', true), '')::integer
    AND business_profile_id = public.app_saas_current_business_profile_id()
    AND status = 'ACTIVE'
    AND id::text = NULLIF(current_setting('app.membership_accepting_id', true), '')
  );

DROP POLICY IF EXISTS saas_memberships_no_delete ON public.memberships;
CREATE POLICY saas_memberships_no_delete ON public.memberships
  FOR DELETE TO app_rls_user USING (false);

DROP POLICY IF EXISTS saas_membership_audit_select_scoped ON public.membership_audit_logs;
CREATE POLICY saas_membership_audit_select_scoped ON public.membership_audit_logs
  FOR SELECT TO app_rls_user
  USING (
    business_profile_id = public.app_saas_current_business_profile_id()
    AND public.app_saas_is_member(business_profile_id)
  );

DROP POLICY IF EXISTS saas_membership_audit_insert_scoped ON public.membership_audit_logs;
CREATE POLICY saas_membership_audit_insert_scoped ON public.membership_audit_logs
  FOR INSERT TO app_rls_user
  WITH CHECK (
    business_profile_id = public.app_saas_current_business_profile_id()
    AND actor_user_id = NULLIF(current_setting('app.user_id', true), '')::integer
    AND (membership_id IS NULL OR EXISTS (
      SELECT 1 FROM public.memberships m
       WHERE m.id = membership_audit_logs.membership_id
         AND m.business_profile_id = membership_audit_logs.business_profile_id
    ))
    AND (
      public.app_saas_can_manage_members(business_profile_id)
      OR (
        event_type = 'INVITATION_ACCEPTED'
        AND actor_user_id = NULLIF(current_setting('app.user_id', true), '')::integer
        AND membership_id::text = NULLIF(current_setting('app.membership_accepting_id', true), '')
      )
    )
  );

DROP POLICY IF EXISTS saas_membership_audit_no_update ON public.membership_audit_logs;
CREATE POLICY saas_membership_audit_no_update ON public.membership_audit_logs
  FOR UPDATE TO app_rls_user USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS saas_membership_audit_no_delete ON public.membership_audit_logs;
CREATE POLICY saas_membership_audit_no_delete ON public.membership_audit_logs
  FOR DELETE TO app_rls_user USING (false);

CREATE OR REPLACE FUNCTION public.prevent_unsafe_membership_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id integer := NULLIF(current_setting('app.user_id', true), '')::integer;
  v_accept_id text := NULLIF(current_setting('app.membership_accepting_id', true), '');
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Las membresías se retiran mediante cambio de estado';
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.business_profile_id <> OLD.business_profile_id THEN
    RAISE EXCEPTION 'No se puede mover una membresía entre negocios';
  END IF;

  IF TG_OP = 'UPDATE'
     AND OLD.user_id = v_user_id
     AND OLD.status IN ('PENDING','INVITED')
     AND NEW.status = 'ACTIVE'
     AND v_accept_id = OLD.id::text THEN
    IF NEW.user_id <> OLD.user_id
       OR NEW.business_profile_id <> OLD.business_profile_id
       OR NEW.role <> OLD.role
       OR COALESCE(NEW.sub_rol, '') <> COALESCE(OLD.sub_rol, '')
       OR lower(COALESCE(NEW.invite_email, '')) <> lower(COALESCE(OLD.invite_email, ''))
       OR NEW.invited_by IS DISTINCT FROM OLD.invited_by
       OR NEW.created_by_user_id IS DISTINCT FROM OLD.created_by_user_id
       OR NEW.invited_at IS DISTINCT FROM OLD.invited_at
       OR NEW.removed_at IS DISTINCT FROM OLD.removed_at
       OR NEW.removed_by IS DISTINCT FROM OLD.removed_by
       OR NEW.invite_token IS NOT NULL
       OR NEW.invite_token_hash IS NOT NULL
       OR NEW.invite_expires_at IS NOT NULL
       OR NEW.accepted_at IS NULL THEN
      RAISE EXCEPTION 'La aceptación solo puede activar la invitación propia sin alterar su alcance';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.role = 'OWNER'
     AND (NEW.role <> OLD.role OR NEW.status <> OLD.status) THEN
    RAISE EXCEPTION 'No se puede cambiar el rol o estado del propietario';
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.user_id = v_user_id
     AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'No puedes cambiar el estado de tu propia membresía';
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.role IS DISTINCT FROM OLD.role
     AND NOT public.app_saas_is_owner(OLD.business_profile_id, v_user_id) THEN
    RAISE EXCEPTION 'Solo el propietario puede cambiar roles';
  END IF;

  IF TG_OP = 'INSERT' AND NEW.role = 'OWNER'
     AND NOT (
       NEW.user_id = v_user_id AND NEW.status = 'ACTIVE'
       AND EXISTS (SELECT 1 FROM public.business_profiles bp
                    WHERE bp.id = NEW.business_profile_id AND bp.provider_id = v_user_id)
       AND (
         NOT public.app_saas_has_any_membership(NEW.business_profile_id)
         OR EXISTS (
           SELECT 1 FROM public.memberships existing
            WHERE existing.user_id = NEW.user_id
              AND existing.business_profile_id = NEW.business_profile_id
              AND existing.role = 'OWNER' AND existing.status = 'ACTIVE'
         )
       )
     ) THEN
    RAISE EXCEPTION 'No se puede asignar un propietario adicional';
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.role = 'OWNER' AND OLD.role <> 'OWNER' THEN
    RAISE EXCEPTION 'No se puede promover una membresía existente a propietario';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_unsafe_membership_change ON public.memberships;
CREATE TRIGGER trg_prevent_unsafe_membership_change
  BEFORE INSERT OR UPDATE OR DELETE ON public.memberships
  FOR EACH ROW EXECUTE FUNCTION public.prevent_unsafe_membership_change();

COMMIT;
