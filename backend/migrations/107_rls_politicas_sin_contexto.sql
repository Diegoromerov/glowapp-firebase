-- 107_rls_politicas_sin_contexto.sql
--
-- Las políticas de la 058 llaman current_setting('app.tenant_id') SIN el segundo
-- argumento. Con el contexto puesto eso funciona; sin él, Postgres lanza:
--
--   ERROR: unrecognized configuration parameter "app.tenant_id"
--
-- Una política de seguridad debe DENEGAR cuando falta el contexto, no reventar.
-- Hoy una petición que olvide fijar app.tenant_id no recibe 403: recibe 500, y
-- el error dice menos de lo que debería. Peor: en una ruta que atrape la
-- excepción y siga, el fallo se convierte en «no hay datos» sin dejar rastro.
--
-- current_setting(nombre, true) devuelve NULL en vez de lanzar. Con NULL, la
-- comparación `tenant_id = NULL` no es verdadera y la fila queda fuera: el
-- resultado es cero filas, que es exactamente lo que se quiere.
--
-- Idempotente: la segunda corrida no encuentra políticas por corregir.

DO $$
DECLARE
  r record;
  nuevo_qual text;
  nuevo_check text;
  corregidas int := 0;
BEGIN
  FOR r IN
    SELECT tablename, policyname, qual, with_check
      FROM pg_policies
     WHERE schemaname = 'public'
       AND (coalesce(qual, '')       LIKE '%current_setting(''app.tenant_id''::text)%'
         OR coalesce(with_check, '') LIKE '%current_setting(''app.tenant_id''::text)%')
       AND coalesce(qual, '') || coalesce(with_check, '') NOT LIKE '%app.tenant_id''::text, true%'
  LOOP
    nuevo_qual  := replace(r.qual,
                      'current_setting(''app.tenant_id''::text)',
                      'current_setting(''app.tenant_id''::text, true)');
    nuevo_check := replace(r.with_check,
                      'current_setting(''app.tenant_id''::text)',
                      'current_setting(''app.tenant_id''::text, true)');

    IF nuevo_qual IS NOT NULL AND nuevo_check IS NOT NULL THEN
      EXECUTE format('ALTER POLICY %I ON public.%I USING (%s) WITH CHECK (%s)',
                     r.policyname, r.tablename, nuevo_qual, nuevo_check);
    ELSIF nuevo_qual IS NOT NULL THEN
      EXECUTE format('ALTER POLICY %I ON public.%I USING (%s)',
                     r.policyname, r.tablename, nuevo_qual);
    ELSIF nuevo_check IS NOT NULL THEN
      EXECUTE format('ALTER POLICY %I ON public.%I WITH CHECK (%s)',
                     r.policyname, r.tablename, nuevo_check);
    ELSE
      CONTINUE;
    END IF;

    corregidas := corregidas + 1;
  END LOOP;

  RAISE NOTICE 'RLS: % políticas corregidas para devolver 0 filas sin contexto', corregidas;
END $$;

-- Comprobación dentro de la propia migración: si queda alguna política con la
-- forma antigua, se aborta. Un fallo silencioso aquí deja la base a medias.
DO $$
DECLARE
  restantes int;
BEGIN
  SELECT count(*) INTO restantes
    FROM pg_policies
   WHERE schemaname = 'public'
     AND (coalesce(qual, '')       LIKE '%current_setting(''app.tenant_id''::text)%'
       OR coalesce(with_check, '') LIKE '%current_setting(''app.tenant_id''::text)%')
     AND coalesce(qual, '') || coalesce(with_check, '') NOT LIKE '%app.tenant_id''::text, true%';

  IF restantes > 0 THEN
    RAISE EXCEPTION 'RLS: quedan % políticas con current_setting sin missing_ok', restantes;
  END IF;
END $$;
