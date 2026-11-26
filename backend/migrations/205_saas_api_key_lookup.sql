-- Resolve only an active API key by its one-way SHA-256 hash. RLS cannot be
-- set before the tenant is known, so this narrow SECURITY DEFINER function
-- returns only the fields required to establish the request's tenant context.
CREATE OR REPLACE FUNCTION public.saas_api_key_lookup(p_key_hash text)
RETURNS TABLE (
  id uuid,
  tenant_id varchar,
  provider_id integer,
  tenant_name varchar,
  saas_plan varchar,
  scopes text[]
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT ak.id, ak.tenant_id, bp.provider_id, bp.name, bp.saas_plan, ak.scopes
    FROM public.api_keys ak
    JOIN public.business_profiles bp ON bp.id = ak.tenant_id
   WHERE ak.key_hash = p_key_hash
     AND ak.revoked_at IS NULL
     AND (ak.expires_at IS NULL OR ak.expires_at > NOW())
   LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.saas_api_key_lookup(text) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_rls_user') THEN
    GRANT EXECUTE ON FUNCTION public.saas_api_key_lookup(text) TO app_rls_user;
  END IF;
END
$$;
