--
-- PostgreSQL database dump
--

\restrict r8nqwocbWXgJO9SMM8jnFp2TsKrq7OCLKBHRRaBuhsuRQvwdeZeAWieeoF6EnUl

-- Dumped from database version 16.15 (Debian 16.15-1.pgdg12+2)
-- Dumped by pg_dump version 16.15 (Debian 16.15-1.pgdg12+2)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: phi_vault; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA phi_vault;


--
-- Name: SCHEMA phi_vault; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA phi_vault IS 'Esquema aislado con políticas estrictas de privacidad para cumplimiento ARCO/GDPR/Ley 1581';


--
-- Name: btree_gist; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA public;


--
-- Name: EXTENSION btree_gist; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION btree_gist IS 'support for indexing common datatypes in GiST';


--
-- Name: pgcrypto; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;


--
-- Name: EXTENSION pgcrypto; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION pgcrypto IS 'cryptographic functions';


--
-- Name: postgis; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA public;


--
-- Name: EXTENSION postgis; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION postgis IS 'PostGIS geometry and geography spatial types and functions';


--
-- Name: estado_cita; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.estado_cita AS ENUM (
    'PENDIENTE_PAGO',
    'CONFIRMADA',
    'EN_PROGRESO',
    'FINALIZADA_PRESTADOR',
    'COMPLETADA',
    'CANCELADA',
    'CHECKIN_REALIZADO',
    'ESPERANDO_OTP',
    'EN_DISPUTA'
);


--
-- Name: estado_disputa; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.estado_disputa AS ENUM (
    'ABIERTA',
    'EN_REVISION',
    'RESUELTA',
    'CERRADA'
);


--
-- Name: estado_retiro; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.estado_retiro AS ENUM (
    'PENDIENTE',
    'PROCESANDO',
    'COMPLETADO',
    'FALLIDO'
);


--
-- Name: estado_verificacion; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.estado_verificacion AS ENUM (
    'PENDIENTE',
    'APROBADO',
    'RECHAZADO'
);


--
-- Name: modelo_retiro_enum; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.modelo_retiro_enum AS ENUM (
    'DEMANDA',
    'QUINCENA',
    'MENSUAL',
    'SEMANAL'
);


--
-- Name: resolucion_disputa; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.resolucion_disputa AS ENUM (
    'FAVOR_PRESTADOR',
    'REEMBOLSO_TOTAL',
    'DIVISION',
    'COMPENSACION_PLATAFORMA'
);


--
-- Name: tipo_auth_provider; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.tipo_auth_provider AS ENUM (
    'GOOGLE',
    'OUTLOOK',
    'LOCAL',
    'APPLE'
);


--
-- Name: tipo_disputa; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.tipo_disputa AS ENUM (
    'CALIDAD_SERVICIO',
    'NO_SHOW_PRESTADOR',
    'NO_SHOW_CLIENTE',
    'OTP_BLOQUEADO',
    'CARGO_NO_RECONOCIDO',
    'FRAUDE',
    'FALLA_TECNICA'
);


--
-- Name: tipo_metodo_retiro; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.tipo_metodo_retiro AS ENUM (
    'NEQUI',
    'BANCARIA'
);


--
-- Name: tipo_rol; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.tipo_rol AS ENUM (
    'CLIENTE',
    'PRESTADOR',
    'SALON',
    'ADMIN'
);


--
-- Name: tipo_trabajador; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.tipo_trabajador AS ENUM (
    'EMPLEADO',
    'PRESTADOR_SERVICIO',
    'ADMIN_SALON',
    'OTRO'
);


--
-- Name: tipo_wallet_tx; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.tipo_wallet_tx AS ENUM (
    'CREDITO_SERVICIO',
    'DEBITO_RETIRO',
    'RETENCION_DISPUTA',
    'LIBERACION_DISPUTA',
    'AJUSTE_ADMIN',
    'BONO_CANCELACION',
    'CREDITO_PRODUCTO',
    'PROPINA'
);


--
-- Name: admin_audit_logs_append_only(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_audit_logs_append_only() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  RAISE EXCEPTION 'admin_audit_logs es append-only: % no permitido', TG_OP
    USING ERRCODE = '55000';
END;
$$;


--
-- Name: anonymize_business_profile(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.anonymize_business_profile(p_profile_id text) RETURNS void
    LANGUAGE plpgsql
    AS $$
BEGIN
  -- Anonymize PII in business_profiles
  UPDATE business_profiles
  SET name = 'NEGOCIO_ANONIMIZADO_' || SUBSTR(MD5(id), 1, 8),
      city = 'ANONIMIZADO',
      country = 'ANONIMIZADO',
      updated_at = CURRENT_TIMESTAMP
  WHERE id = p_profile_id;

  -- Purge draft documents associated with profile
  DELETE FROM business_documents
  WHERE business_profile_id = p_profile_id AND status = 'DRAFT';

  -- Anonymize signed document metadata while keeping cryptographic hash proof for statutory legal holds
  UPDATE business_documents
  SET signed_by = 'PRESTADOR_ANONIMIZADO'
  WHERE business_profile_id = p_profile_id AND status = 'SIGNED';
END;
$$;


--
-- Name: app_assign_tenant_id(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.app_assign_tenant_id() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.tenant_id IS NULL THEN
    NEW.tenant_id := app_current_tenant_id();
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: app_current_tenant_id(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.app_current_tenant_id() RETURNS integer
    LANGUAGE sql STABLE
    AS $$
  SELECT NULLIF(current_setting('app.tenant_id', true), '')::integer
$$;


--
-- Name: FUNCTION app_current_tenant_id(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.app_current_tenant_id() IS 'Tenant activo de la sesión. NULL si no hay contexto fijado o si está vacío.';


--
-- Name: app_current_user_id(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.app_current_user_id() RETURNS integer
    LANGUAGE sql STABLE
    AS $$
  SELECT NULLIF(current_setting('app.user_id', true), '')::integer
$$;


--
-- Name: app_platform_tenant_id(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.app_platform_tenant_id() RETURNS integer
    LANGUAGE sql STABLE
    AS $$
  SELECT id FROM tenants WHERE es_plataforma ORDER BY id LIMIT 1
$$;


--
-- Name: app_precio_tenant_id(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.app_precio_tenant_id() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  tenant_lista integer;
BEGIN
  SELECT tenant_id INTO tenant_lista FROM listas_precios WHERE id = NEW.lista_id;
  IF tenant_lista IS NULL THEN
    RAISE EXCEPTION 'El precio apunta a una lista inexistente (lista_id=%).', NEW.lista_id;
  END IF;
  NEW.tenant_id := tenant_lista;
  RETURN NEW;
END $$;


--
-- Name: app_usuario_identidad(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.app_usuario_identidad(p_id integer) RETURNS TABLE(rol public.tipo_rol, tenant_id integer)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT u.rol, u.tenant_id FROM public.usuarios u WHERE u.id = p_id
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: usuarios; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.usuarios (
    id integer NOT NULL,
    email character varying(255) NOT NULL,
    nombre character varying(255) NOT NULL,
    foto_url text,
    auth_provider public.tipo_auth_provider NOT NULL,
    provider_id character varying(255) NOT NULL,
    password_hash character varying(255),
    phone character varying(20),
    rol public.tipo_rol,
    onboarding_completo boolean DEFAULT false,
    creado_en timestamp with time zone DEFAULT now(),
    habeas_data_accepted_at timestamp with time zone,
    habeas_data_ip character varying(45) DEFAULT NULL::character varying,
    terminos_accepted_at timestamp with time zone,
    terminos_ip character varying(45),
    glowai_plan character varying(20) DEFAULT 'free'::character varying,
    glowai_diagnosticos_mes integer DEFAULT 0,
    glowai_ciclo_reset_at timestamp with time zone DEFAULT now(),
    streak_actual integer DEFAULT 0,
    streak_maximo integer DEFAULT 0,
    streak_ultimo_registro date,
    colorimetria_diagnosticos_mes integer DEFAULT 0,
    colorimetria_mes_referencia timestamp with time zone DEFAULT now(),
    glowstyle_outfits_mes integer DEFAULT 0,
    glowstyle_mes_referencia timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    tenant_id integer,
    worker_type public.tipo_trabajador,
    responsable_iva boolean DEFAULT true NOT NULL,
    tarifa_iva numeric(5,4) DEFAULT 0.1900 NOT NULL,
    rut_numero character varying(20),
    rut_responsabilidad_codigo smallint,
    responsable_iva_override boolean,
    responsabilidad_iva_fuente character varying(10),
    responsabilidad_iva_actualizada_at timestamp with time zone,
    responsabilidad_iva_cambiada_por integer,
    is_active boolean DEFAULT true,
    CONSTRAINT chk_usuarios_responsabilidad_fuente CHECK (((responsabilidad_iva_fuente IS NULL) OR ((responsabilidad_iva_fuente)::text = ANY ((ARRAY['RUT'::character varying, 'MANUAL'::character varying])::text[])))),
    CONSTRAINT chk_usuarios_rut_responsabilidad CHECK (((rut_responsabilidad_codigo IS NULL) OR (rut_responsabilidad_codigo = ANY (ARRAY[48, 49])))),
    CONSTRAINT chk_usuarios_tarifa_iva_rango CHECK (((tarifa_iva >= (0)::numeric) AND (tarifa_iva <= (1)::numeric)))
);

ALTER TABLE ONLY public.usuarios FORCE ROW LEVEL SECURITY;


--
-- Name: COLUMN usuarios.responsable_iva; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.usuarios.responsable_iva IS 'Si el prestador es responsable de IVA (art. 437 par. 3 E.T.). La plataforma trata a todos como responsables (default true); un prestador que declare lo contrario se marca en false.';


--
-- Name: COLUMN usuarios.tarifa_iva; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.usuarios.tarifa_iva IS 'Tarifa de IVA aplicable al prestador. General 19% (art. 468 E.T.); se guarda por si cambia.';


--
-- Name: COLUMN usuarios.rut_numero; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.usuarios.rut_numero IS 'Número de RUT/NIT del prestador. Obligatorio para declarar la responsabilidad de IVA (D2).';


--
-- Name: COLUMN usuarios.rut_responsabilidad_codigo; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.usuarios.rut_responsabilidad_codigo IS 'Casilla de responsabilidades del RUT: 48 = responsable de IVA, 49 = no responsable. NULL = sin declarar.';


--
-- Name: COLUMN usuarios.responsable_iva_override; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.usuarios.responsable_iva_override IS 'Override manual auditado (D1). Cuando está definido manda sobre la derivación del RUT.';


--
-- Name: COLUMN usuarios.responsabilidad_iva_fuente; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.usuarios.responsabilidad_iva_fuente IS 'De dónde salió el valor vigente: RUT (derivado) o MANUAL (override). NULL = sin declarar.';


--
-- Name: COLUMN usuarios.responsabilidad_iva_actualizada_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.usuarios.responsabilidad_iva_actualizada_at IS 'Cuándo se declaró o cambió la responsabilidad de IVA.';


--
-- Name: COLUMN usuarios.responsabilidad_iva_cambiada_por; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.usuarios.responsabilidad_iva_cambiada_por IS 'Quién la declaró o cambió (usuario que hizo la petición).';


--
-- Name: app_usuario_por_email(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.app_usuario_por_email(p_email text) RETURNS SETOF public.usuarios
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT * FROM public.usuarios WHERE lower(email) = lower(p_email)
$$;


--
-- Name: app_usuario_por_id(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.app_usuario_por_id(p_id integer) RETURNS SETOF public.usuarios
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT * FROM public.usuarios WHERE id = p_id
$$;


--
-- Name: apply_provider_fraud_penalty(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.apply_provider_fraud_penalty() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  flag_count INTEGER;
BEGIN
  -- Count active fraud flags for this provider in the current calendar month
  SELECT COUNT(*) INTO flag_count
  FROM fraud_flags
  WHERE provider_id = NEW.provider_id
    AND is_active = TRUE
    AND created_at >= date_trunc('month', NOW())
    AND created_at < date_trunc('month', NOW()) + INTERVAL '1 month';

  IF flag_count >= 3 THEN
    -- Force tier demotion to Creative Edge and lock for 60 days
    INSERT INTO provider_loyalty (provider_id, tier, lock_until, updated_at)
    VALUES (NEW.provider_id, 'Creative Edge', NOW() + INTERVAL '60 days', NOW())
    ON CONFLICT (provider_id) DO UPDATE
    SET tier = 'Creative Edge',
        lock_until = NOW() + INTERVAL '60 days',
        updated_at = NOW();
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: calc_booking_split(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.calc_booking_split() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  comm_rate NUMERIC(5,2);
BEGIN
  SELECT COALESCE(NULLIF(value, '')::NUMERIC, 20)
    INTO comm_rate
    FROM platform_config
   WHERE key = 'comision_plataforma_pct';

  -- Una configuración corrupta no puede vaciar el pago del prestador.
  IF comm_rate IS NULL OR comm_rate < 0 OR comm_rate > 50 THEN
    comm_rate := 20;
  END IF;

  NEW.comision_plataforma := ROUND(NEW.valor_bruto * (comm_rate / 100.0), 2);
  NEW.impuestos_estado    := 0;
  NEW.pago_neto_prestador := NEW.valor_bruto - NEW.comision_plataforma;
  RETURN NEW;
END;
$$;


--
-- Name: calculate_glowapp_business_score(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.calculate_glowapp_business_score(p_profile_id text) RETURNS numeric
    LANGUAGE plpgsql STABLE PARALLEL SAFE
    AS $$
DECLARE
    v_task_score NUMERIC := 0;
    v_finding_penalty NUMERIC := 0;
    v_final_score NUMERIC := 0;
BEGIN
    SELECT COALESCE(ROUND((COUNT(CASE WHEN status = 'VERIFIED' THEN 1 END)::numeric / GREATEST(COUNT(*), 1)) * 80, 2), 0)
    INTO v_task_score
    FROM business_tasks
    WHERE business_profile_id = p_profile_id;

    SELECT COALESCE(COUNT(CASE WHEN status = 'OPEN' AND risk_level = 'HIGH' THEN 1 END) * 5.0, 0)
    INTO v_finding_penalty
    FROM business_findings
    WHERE business_profile_id = p_profile_id;

    v_final_score := GREATEST(0.00, LEAST(100.00, (v_task_score + 20.00) - v_finding_penalty));
    RETURN v_final_score;
END;
$$;


--
-- Name: crear_wallet_prestador(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.crear_wallet_prestador() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  INSERT INTO provider_wallet (provider_id)
  VALUES (NEW.id)
  ON CONFLICT (provider_id) DO NOTHING;
  RETURN NEW;
END;
$$;


--
-- Name: detect_circumvention_on_cancellation(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.detect_circumvention_on_cancellation() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  chat_exists BOOLEAN;
BEGIN
  IF NEW.estado = 'CANCELADA' AND OLD.estado IN ('CONFIRMADA', 'PENDIENTE_PAGO') THEN
    -- Check if there was any message sent in the preceding 30 minutes between these users
    SELECT EXISTS (
      SELECT 1 FROM messages
      WHERE (
        (sender_id = NEW.client_id AND receiver_id = NEW.provider_id)
        OR 
        (sender_id = NEW.provider_id AND receiver_id = NEW.client_id)
      )
      AND created_at >= NOW() - INTERVAL '30 minutes'
      AND created_at <= NOW()
    ) INTO chat_exists;

    IF chat_exists THEN
      INSERT INTO fraud_flags (booking_id, client_id, provider_id, created_at)
      VALUES (NEW.id, NEW.client_id, NEW.provider_id, NOW())
      ON CONFLICT (booking_id) DO NOTHING;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: enforce_append_only(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enforce_append_only() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  RAISE EXCEPTION
    'La tabla % es un ledger append-only: la operación % no está permitida. Registre el cambio como un nuevo evento (ver wallet_ledger_events).',
    TG_TABLE_NAME, TG_OP;
END;
$$;


--
-- Name: expirar_otps_vencidos(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.expirar_otps_vencidos() RETURNS integer
    LANGUAGE plpgsql
    AS $$
DECLARE
  filas_actualizadas INTEGER;
BEGIN
  UPDATE otp_validaciones
  SET estado = 'EXPIRADO'
  WHERE estado = 'ACTIVO'
    AND expira_at < NOW();
  GET DIAGNOSTICS filas_actualizadas = ROW_COUNT;
  RETURN filas_actualizadas;
END;
$$;


--
-- Name: prevent_kyc_audit_modification(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.prevent_kyc_audit_modification() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
BEGIN
    RAISE EXCEPTION 'KYC audit logs are immutable - modifications not allowed for legal compliance';
    RETURN NULL;
END;
$$;


--
-- Name: process_client_loyalty_reward(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.process_client_loyalty_reward() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  c_tier VARCHAR(30);
  reward_points NUMERIC(10,2);
BEGIN
  -- Triggered on transition of booking status to COMPLETADA and payment_status to 'paid'
  IF NEW.estado = 'COMPLETADA' AND NEW.payment_status = 'paid' 
     AND (OLD.estado IS NULL OR OLD.estado != 'COMPLETADA' OR OLD.payment_status != 'paid') THEN
    
    -- Get current client tier
    SELECT tier INTO c_tier FROM user_loyalty WHERE user_id = NEW.client_id;
    
    -- Tiers 'Glow Effect' (Tier 2) and 'Porcelain Radiance' (Tier 3) earn 5% cash-back in Brillo Points
    IF c_tier IN ('Glow Effect', 'Porcelain Radiance') THEN
      reward_points := ROUND(NEW.valor_bruto * 0.05, 2);
      
      IF reward_points > 0 THEN
        -- Insert ledger record
        INSERT INTO user_loyalty_ledger (user_id, booking_id, amount, description)
        VALUES (NEW.client_id, NEW.id, reward_points, 'Cash-back de 5% por cita finalizada en ' || c_tier);

        -- Upsert user wallet balance
        INSERT INTO user_loyalty (user_id, tier, brillo_points, updated_at)
        VALUES (NEW.client_id, 'Base Complexion', reward_points, NOW())
        ON CONFLICT (user_id) DO UPDATE
        SET brillo_points = user_loyalty.brillo_points + reward_points,
            updated_at = NOW();
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: purge_abandoned_draft_documents(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.purge_abandoned_draft_documents(p_days_old integer DEFAULT 90) RETURNS integer
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_deleted_count INT;
BEGIN
  DELETE FROM business_documents
  WHERE status = 'DRAFT'
    AND created_at < NOW() - (p_days_old || ' days')::INTERVAL;
  
  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
  RETURN v_deleted_count;
END;
$$;


--
-- Name: set_disputa_sla(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_disputa_sla() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
      BEGIN
        IF NEW.sla_limite_at IS NULL THEN
          NEW.sla_limite_at = NEW.creado_at + INTERVAL '48 hours';
        END IF;
        RETURN NEW;
      END;
      $$;


--
-- Name: sync_provider_elite_flag(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sync_provider_elite_flag() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  UPDATE perfiles_prestador
  SET is_avant_garde_elite = (NEW.tier = 'Avant-Garde Elite')
  WHERE id = NEW.provider_id;
  RETURN NEW;
END;
$$;


--
-- Name: update_consent_timestamp(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_consent_timestamp() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


--
-- Name: update_envios_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_envios_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.actualizado_en = NOW();
  RETURN NEW;
END;
$$;


--
-- Name: update_updated_at_column(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_updated_at_column() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


--
-- Name: update_user_delivery_addresses_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_user_delivery_addresses_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.actualizado_en = NOW();
  RETURN NEW;
END $$;


--
-- Name: update_user_preferences_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_user_preferences_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;


--
-- Name: biometric_vectors; Type: TABLE; Schema: phi_vault; Owner: -
--

CREATE TABLE phi_vault.biometric_vectors (
    id integer NOT NULL,
    user_id uuid NOT NULL,
    scan_date timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    face_mesh_encrypted text NOT NULL,
    skin_analysis_json jsonb,
    purged_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: biometric_vectors_id_seq; Type: SEQUENCE; Schema: phi_vault; Owner: -
--

CREATE SEQUENCE phi_vault.biometric_vectors_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: biometric_vectors_id_seq; Type: SEQUENCE OWNED BY; Schema: phi_vault; Owner: -
--

ALTER SEQUENCE phi_vault.biometric_vectors_id_seq OWNED BY phi_vault.biometric_vectors.id;


--
-- Name: academy_ai_discrepancy_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.academy_ai_discrepancy_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    provider_id integer NOT NULL,
    leccion_id uuid NOT NULL,
    diagnostico_ia jsonb NOT NULL,
    criterio_humano jsonb NOT NULL,
    comentarios text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: academy_certificates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.academy_certificates (
    provider_id integer NOT NULL,
    course_id uuid NOT NULL,
    obtained_at timestamp with time zone DEFAULT now(),
    id integer NOT NULL,
    code character varying(32) NOT NULL,
    revoked boolean DEFAULT false NOT NULL,
    revoked_reason text,
    revoked_at timestamp with time zone,
    curriculum_version character varying(20) DEFAULT 'v1'::character varying
);


--
-- Name: academy_certificates_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.academy_certificates_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: academy_certificates_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.academy_certificates_id_seq OWNED BY public.academy_certificates.id;


--
-- Name: academy_consentimientos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.academy_consentimientos (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    provider_id integer NOT NULL,
    aceptado boolean DEFAULT false NOT NULL,
    fecha_aceptacion timestamp with time zone DEFAULT now(),
    fecha_revocacion timestamp with time zone,
    texto_version character varying(20),
    texto_hash character(64),
    aceptado_ip character varying(45),
    aceptado_user_agent character varying(255)
);


--
-- Name: academy_courses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.academy_courses (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    title character varying(255) NOT NULL,
    description text NOT NULL,
    category character varying(100) NOT NULL,
    badge_name character varying(100) NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone
);


--
-- Name: academy_lessons; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.academy_lessons (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    module_id uuid NOT NULL,
    title character varying(255) NOT NULL,
    video_url character varying(255),
    content_text text,
    sort_order integer DEFAULT 1 NOT NULL
);


--
-- Name: academy_modules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.academy_modules (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    course_id uuid NOT NULL,
    title character varying(255) NOT NULL,
    sort_order integer DEFAULT 1 NOT NULL
);


--
-- Name: academy_progress; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.academy_progress (
    provider_id integer NOT NULL,
    lesson_id uuid NOT NULL,
    completed boolean DEFAULT true NOT NULL,
    completed_at timestamp with time zone DEFAULT now()
);


--
-- Name: academy_quiz_attempts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.academy_quiz_attempts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    provider_id integer NOT NULL,
    course_id uuid NOT NULL,
    score integer DEFAULT 0 NOT NULL,
    total integer DEFAULT 0 NOT NULL,
    correct_pct numeric(5,2) DEFAULT 0 NOT NULL,
    pass_pct integer DEFAULT 80 NOT NULL,
    passed boolean DEFAULT false NOT NULL,
    answers jsonb,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: academy_quizzes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.academy_quizzes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    course_id uuid NOT NULL,
    question text NOT NULL,
    options jsonb NOT NULL,
    correct_index integer NOT NULL
);


--
-- Name: academy_worksheet_submissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.academy_worksheet_submissions (
    provider_id integer NOT NULL,
    lesson_id uuid NOT NULL,
    respuestas_texto jsonb DEFAULT '{}'::jsonb NOT NULL,
    evidencia_foto_url character varying(500),
    consentimiento_id uuid,
    enviado_at timestamp with time zone DEFAULT now(),
    calificado boolean DEFAULT false NOT NULL,
    calificacion_nota character varying(50),
    retroalimentacion text
);


--
-- Name: admin_actions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.admin_actions (
    id integer NOT NULL,
    admin_id integer,
    accion character varying(100) NOT NULL,
    descripcion text,
    fecha_creacion timestamp with time zone DEFAULT now()
);


--
-- Name: admin_actions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.admin_actions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: admin_actions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.admin_actions_id_seq OWNED BY public.admin_actions.id;


--
-- Name: admin_audit_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.admin_audit_logs (
    id bigint NOT NULL,
    user_id character varying(64) NOT NULL,
    action character varying(100) NOT NULL,
    resource character varying(128) NOT NULL,
    resource_id character varying(128),
    method character varying(10),
    path text,
    status_code integer,
    ip character varying(64),
    user_agent text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: admin_audit_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.admin_audit_logs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: admin_audit_logs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.admin_audit_logs_id_seq OWNED BY public.admin_audit_logs.id;


--
-- Name: admin_mfa; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.admin_mfa (
    user_id integer NOT NULL,
    secret_key character varying(255) NOT NULL,
    is_enabled boolean DEFAULT false,
    backup_codes text[],
    created_at timestamp with time zone DEFAULT now(),
    tenant_id integer
);


--
-- Name: affiliate_products; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.affiliate_products (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    nombre character varying(200) NOT NULL,
    marca character varying(100),
    objetivo character varying(50),
    url_afiliado text NOT NULL,
    comision_pct numeric(5,2),
    activo boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: ai_diagnostics; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_diagnostics (
    id integer NOT NULL,
    user_id integer,
    tool_type character varying(50) NOT NULL,
    result_data jsonb NOT NULL,
    image_url text,
    created_at timestamp with time zone DEFAULT now(),
    comparison_photo_url text,
    comparison_delta jsonb,
    score_hidratacion integer,
    score_impurezas integer,
    score_luminosidad integer,
    track character varying(20) DEFAULT 'piel'::character varying,
    CONSTRAINT ai_diagnostics_track_check CHECK (((track)::text = ANY ((ARRAY['piel'::character varying, 'capilar'::character varying])::text[])))
);


--
-- Name: ai_diagnostics_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ai_diagnostics_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ai_diagnostics_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.ai_diagnostics_id_seq OWNED BY public.ai_diagnostics.id;


--
-- Name: analytics_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.analytics_events (
    id integer NOT NULL,
    user_id integer,
    event_type character varying(100) NOT NULL,
    metadata jsonb,
    occurred_at timestamp without time zone DEFAULT now()
);


--
-- Name: analytics_events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.analytics_events_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: analytics_events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.analytics_events_id_seq OWNED BY public.analytics_events.id;


--
-- Name: app_locales; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_locales (
    id integer NOT NULL,
    locale_code character varying(10) NOT NULL,
    language_name character varying(100) NOT NULL,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: app_locales_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.app_locales_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: app_locales_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.app_locales_id_seq OWNED BY public.app_locales.id;


--
-- Name: audit_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_log (
    id bigint NOT NULL,
    actor_id integer,
    accion character varying(100) NOT NULL,
    tabla character varying(100) NOT NULL,
    registro_id character varying(255),
    datos_antes jsonb,
    datos_despues jsonb,
    ip inet,
    creado_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: audit_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.audit_log_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: audit_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.audit_log_id_seq OWNED BY public.audit_log.id;


--
-- Name: auditoria_consentimiento_biometrico; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.auditoria_consentimiento_biometrico (
    id integer NOT NULL,
    user_id integer NOT NULL,
    consentimiento_otorgado boolean DEFAULT false,
    version_politica character varying(10) NOT NULL,
    ip_registro character varying(45) NOT NULL,
    dispositivo text,
    fecha_registro timestamp with time zone DEFAULT now()
);


--
-- Name: auditoria_consentimiento_biometrico_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.auditoria_consentimiento_biometrico_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: auditoria_consentimiento_biometrico_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.auditoria_consentimiento_biometrico_id_seq OWNED BY public.auditoria_consentimiento_biometrico.id;


--
-- Name: badges; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.badges (
    id integer NOT NULL,
    name character varying(255) NOT NULL,
    description text,
    icon_url character varying(500),
    criteria jsonb,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: badges_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.badges_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: badges_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.badges_id_seq OWNED BY public.badges.id;


--
-- Name: beauty_profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.beauty_profiles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id integer NOT NULL,
    face_scores jsonb NOT NULL,
    hands_diagnosis jsonb NOT NULL,
    recommendation text NOT NULL,
    recommended_products jsonb,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    entry_point character varying(50) DEFAULT 'ideas'::character varying
);


--
-- Name: biometric_access_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.biometric_access_log (
    id integer NOT NULL,
    user_id integer NOT NULL,
    accessed_at timestamp with time zone DEFAULT now(),
    ip_address inet,
    endpoint character varying(255),
    user_agent text,
    accessed_by character varying(50),
    access_type character varying(50),
    consent_id uuid,
    details jsonb
);


--
-- Name: biometric_access_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.biometric_access_log_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: biometric_access_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.biometric_access_log_id_seq OWNED BY public.biometric_access_log.id;


--
-- Name: biometric_consent_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.biometric_consent_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id integer NOT NULL,
    version character varying(20) DEFAULT '1.0'::character varying NOT NULL,
    action character varying(50) NOT NULL,
    ip_hash character varying(64) NOT NULL,
    user_agent text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: biometric_consents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.biometric_consents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id integer NOT NULL,
    user_agent text,
    revoked_at timestamp with time zone,
    granted boolean DEFAULT false,
    granted_at timestamp without time zone,
    purpose text,
    version_terms character varying(20) DEFAULT '1.0'::character varying,
    updated_at timestamp without time zone DEFAULT now(),
    consent_type character varying(50),
    ip_address inet,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: biometric_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.biometric_history (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id integer NOT NULL,
    profile_id text,
    face_scores jsonb,
    hands_diagnosis jsonb,
    recommendation text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: biometric_scan_comparisons; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.biometric_scan_comparisons (
    id bigint NOT NULL,
    user_id bigint NOT NULL,
    baseline_scan_id bigint NOT NULL,
    current_scan_id bigint NOT NULL,
    threshold numeric(5,2) NOT NULL,
    verdict character varying(24) NOT NULL,
    compared_count integer DEFAULT 0 NOT NULL,
    significant_count integer DEFAULT 0 NOT NULL,
    metrics_encrypted text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT biometric_scan_comparisons_distinct_scans CHECK ((baseline_scan_id <> current_scan_id))
);


--
-- Name: biometric_scan_comparisons_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.biometric_scan_comparisons_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: biometric_scan_comparisons_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.biometric_scan_comparisons_id_seq OWNED BY public.biometric_scan_comparisons.id;


--
-- Name: biometric_scan_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.biometric_scan_sessions (
    id bigint NOT NULL,
    user_id bigint NOT NULL,
    provider character varying(32) DEFAULT 'youcam'::character varying NOT NULL,
    provider_task_id text,
    metrics_encrypted text NOT NULL,
    metrics_count integer NOT NULL,
    requested_actions jsonb DEFAULT '[]'::jsonb NOT NULL,
    missing_metrics jsonb DEFAULT '[]'::jsonb NOT NULL,
    geometry jsonb,
    quality jsonb,
    captured_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    consent_version character varying(20),
    consent_outdated boolean DEFAULT false NOT NULL
);


--
-- Name: COLUMN biometric_scan_sessions.consent_version; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.biometric_scan_sessions.consent_version IS 'version_terms del consentimiento vigente al momento del escaneo (Y-F1b)';


--
-- Name: COLUMN biometric_scan_sessions.consent_outdated; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.biometric_scan_sessions.consent_outdated IS 'TRUE si el escaneo se autorizó con una versión anterior del texto de consentimiento';


--
-- Name: biometric_scan_sessions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.biometric_scan_sessions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: biometric_scan_sessions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.biometric_scan_sessions_id_seq OWNED BY public.biometric_scan_sessions.id;


--
-- Name: booking_productos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.booking_productos (
    booking_id uuid NOT NULL,
    producto_id integer NOT NULL,
    cantidad integer DEFAULT 1,
    tipo_comision character varying(20) DEFAULT 'ENTREGA'::character varying,
    comision_causada numeric(10,2) NOT NULL,
    tenant_id integer NOT NULL,
    CONSTRAINT booking_productos_tipo_comision_check CHECK (((tipo_comision)::text = ANY ((ARRAY['SUGERIDA'::character varying, 'ENTREGA'::character varying])::text[])))
);

ALTER TABLE ONLY public.booking_productos FORCE ROW LEVEL SECURITY;


--
-- Name: bookings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bookings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    client_id integer NOT NULL,
    provider_id integer NOT NULL,
    service_id uuid NOT NULL,
    scheduled_at timestamp with time zone NOT NULL,
    valor_bruto numeric(10,2) NOT NULL,
    comision_plataforma numeric(10,2) DEFAULT 0.00,
    impuestos_estado numeric(10,2) DEFAULT 0.00,
    pago_neto_prestador numeric(10,2) DEFAULT 0.00,
    estado public.estado_cita DEFAULT 'PENDIENTE_PAGO'::public.estado_cita,
    pin_verificacion character varying(4),
    payment_status character varying(20) DEFAULT 'unpaid'::character varying,
    service_address text,
    tipo_via text,
    numero_via text,
    numero_placa text,
    numero_complemento text,
    complemento_interior text,
    barrio text,
    localidad text,
    notes text,
    created_at timestamp with time zone DEFAULT now(),
    tarifa_reserva numeric(10,2) DEFAULT 0.00,
    tenant_id integer,
    business_profile_id character varying(36),
    subtotal_base numeric(12,2),
    iva_valor numeric(12,2),
    tarifa_iva_aplicada numeric(5,4),
    cufe character varying(96),
    qr_factura text,
    factura_emitida boolean DEFAULT false,
    factura_fecha timestamp with time zone,
    completed_at timestamp with time zone,
    reschedule_count integer DEFAULT 0 NOT NULL,
    propina numeric(10,2) DEFAULT 0 NOT NULL,
    cancelado_por character varying(20),
    credito_aplicado numeric(10,2) DEFAULT 0 NOT NULL,
    cancelado_at timestamp with time zone,
    service_lat numeric(10,7),
    service_lng numeric(10,7),
    checkin_lat numeric(10,7),
    checkin_lng numeric(10,7),
    checkin_at timestamp with time zone,
    productos_adicionales jsonb,
    cancelled_by character varying(20),
    provider_faulted_cancellation boolean DEFAULT false,
    CONSTRAINT bookings_cancelled_by_check CHECK (((cancelled_by)::text = ANY ((ARRAY['client'::character varying, 'provider'::character varying, 'system'::character varying])::text[]))),
    CONSTRAINT bookings_valor_bruto_check CHECK ((valor_bruto >= (0)::numeric))
);

ALTER TABLE ONLY public.bookings FORCE ROW LEVEL SECURITY;


--
-- Name: COLUMN bookings.subtotal_base; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.bookings.subtotal_base IS 'Base gravable de la reserva (valor_bruto menos iva_valor). Igual a valor_bruto si no hay IVA.';


--
-- Name: COLUMN bookings.iva_valor; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.bookings.iva_valor IS 'IVA discriminado del valor_bruto. No se suma: el precio al consumidor ya lo incluía.';


--
-- Name: COLUMN bookings.tarifa_iva_aplicada; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.bookings.tarifa_iva_aplicada IS 'Tarifa de IVA vigente al crear la reserva (0 si el prestador no era responsable).';


--
-- Name: COLUMN bookings.cufe; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.bookings.cufe IS 'Código Único de Factura Electrónica DIAN (SHA-384 hex, 96 chars)';


--
-- Name: COLUMN bookings.qr_factura; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.bookings.qr_factura IS 'Código QR de la factura electrónica (base64 o URL)';


--
-- Name: COLUMN bookings.factura_emitida; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.bookings.factura_emitida IS 'Indica si la factura fue emitida y aceptada por DIAN';


--
-- Name: COLUMN bookings.factura_fecha; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.bookings.factura_fecha IS 'Fecha y hora de emisión de la factura electrónica';


--
-- Name: COLUMN bookings.productos_adicionales; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.bookings.productos_adicionales IS 'Productos añadidos a la reserva: lista o {products: [], linked_booking_ids: []}. Se usa al cancelar para revertir stock.';


--
-- Name: brand_sponsorships; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.brand_sponsorships (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    marca character varying(100) NOT NULL,
    objetivo_target character varying(50) NOT NULL,
    nombre_rutina character varying(200),
    descripcion text,
    producto_destacado character varying(200),
    logo_url text,
    activo boolean DEFAULT true,
    fecha_inicio date,
    fecha_fin date
);


--
-- Name: business_documents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.business_documents (
    id character varying(64) NOT NULL,
    template_code character varying(50),
    business_profile_id character varying(36),
    provider_id integer,
    tenant_id character varying(64) DEFAULT 'default'::character varying NOT NULL,
    title character varying(200),
    category character varying(50),
    rendered_body text,
    watermark character varying(100),
    disclaimer text,
    version integer DEFAULT 1 NOT NULL,
    status character varying(30) DEFAULT 'DRAFT'::character varying NOT NULL,
    signed_by character varying(150),
    signature_hash character varying(128),
    signed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: business_evidences; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.business_evidences (
    id character varying(36) NOT NULL,
    task_id character varying(36) NOT NULL,
    file_path character varying(255),
    evidence_type character varying(30) DEFAULT 'DOCUMENT'::character varying NOT NULL,
    validation_state character varying(30) DEFAULT 'USER_DECLARED'::character varying NOT NULL,
    reviewer_notes text,
    verified_at timestamp with time zone,
    tenant_id character varying(64) DEFAULT 'default'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT business_evidences_evidence_type_check CHECK (((evidence_type)::text = ANY ((ARRAY['DOCUMENT'::character varying, 'PHOTO'::character varying, 'CONTRACT'::character varying, 'FORM'::character varying, 'DECLARATION'::character varying])::text[]))),
    CONSTRAINT business_evidences_validation_state_check CHECK (((validation_state)::text = ANY ((ARRAY['USER_DECLARED'::character varying, 'EVIDENCE_SUBMITTED'::character varying, 'EVIDENCE_VALIDATED'::character varying, 'REQUIREMENT_VERIFIED'::character varying])::text[])))
);


--
-- Name: business_findings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.business_findings (
    id character varying(36) NOT NULL,
    business_profile_id character varying(36) NOT NULL,
    title character varying(150) NOT NULL,
    description text,
    risk_level character varying(20) DEFAULT 'MEDIUM'::character varying NOT NULL,
    status character varying(20) DEFAULT 'OPEN'::character varying NOT NULL,
    mitigation_plan text,
    tenant_id character varying(64) DEFAULT 'default'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT business_findings_risk_level_check CHECK (((risk_level)::text = ANY ((ARRAY['LOW'::character varying, 'MEDIUM'::character varying, 'HIGH'::character varying, 'CRITICAL'::character varying])::text[]))),
    CONSTRAINT business_findings_status_check CHECK (((status)::text = ANY ((ARRAY['OPEN'::character varying, 'MITIGATED'::character varying, 'CLOSED'::character varying])::text[])))
);


--
-- Name: business_profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.business_profiles (
    id character varying(36) NOT NULL,
    provider_id integer NOT NULL,
    vertical_id character varying(36) NOT NULL,
    name character varying(150) NOT NULL,
    onboarding_mode character varying(30) DEFAULT 'NEW_BUSINESS'::character varying NOT NULL,
    lifecycle_stage character varying(30) DEFAULT 'IDEA'::character varying NOT NULL,
    compliance_score numeric(5,2) DEFAULT 0.00 NOT NULL,
    city character varying(100) DEFAULT 'Bogotá'::character varying,
    country character varying(100) DEFAULT 'Colombia'::character varying,
    metadata jsonb DEFAULT '{}'::jsonb,
    tenant_id character varying(64) DEFAULT 'default'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT business_profiles_lifecycle_stage_check CHECK (((lifecycle_stage)::text = ANY ((ARRAY['IDEA'::character varying, 'CONSTITUTION'::character varying, 'FORMALIZATION'::character varying, 'PREPARATION'::character varying, 'OPENING'::character varying, 'OPERATION'::character varying, 'AUDIT'::character varying, 'GROWTH'::character varying])::text[]))),
    CONSTRAINT business_profiles_onboarding_mode_check CHECK (((onboarding_mode)::text = ANY ((ARRAY['NEW_BUSINESS'::character varying, 'EXISTING_BUSINESS'::character varying])::text[]))),
    CONSTRAINT check_compliance_score_range CHECK (((compliance_score >= 0.00) AND (compliance_score <= 100.00)))
);


--
-- Name: business_requirements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.business_requirements (
    id character varying(36) NOT NULL,
    vertical_id character varying(36),
    code character varying(50) NOT NULL,
    title character varying(150) NOT NULL,
    description text,
    legal_basis text,
    jurisdiction character varying(50) DEFAULT 'NATIONAL'::character varying,
    domain_context character varying(30) NOT NULL,
    evidence_required character varying(50) DEFAULT 'DOCUMENT'::character varying,
    frequency_months integer DEFAULT 12,
    tenant_id character varying(64) DEFAULT 'default'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT business_requirements_domain_context_check CHECK (((domain_context)::text = ANY ((ARRAY['LEGAL'::character varying, 'LABOR'::character varying, 'SANITARY'::character varying, 'TAX'::character varying, 'SST'::character varying, 'OPERATIONS'::character varying])::text[])))
);


--
-- Name: business_tasks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.business_tasks (
    id character varying(36) NOT NULL,
    business_profile_id character varying(36) NOT NULL,
    requirement_id character varying(36),
    title character varying(150) NOT NULL,
    description text,
    stage character varying(20) DEFAULT 'ENTENDER'::character varying NOT NULL,
    status character varying(20) DEFAULT 'PENDING'::character varying NOT NULL,
    due_date timestamp with time zone,
    metadata jsonb DEFAULT '{}'::jsonb,
    tenant_id character varying(64) DEFAULT 'default'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT business_tasks_stage_check CHECK (((stage)::text = ANY ((ARRAY['ENTENDER'::character varying, 'EXPLICAR'::character varying, 'RECOMENDAR'::character varying, 'EJECUTAR'::character varying, 'VERIFICAR'::character varying])::text[]))),
    CONSTRAINT business_tasks_status_check CHECK (((status)::text = ANY ((ARRAY['PENDING'::character varying, 'IN_PROGRESS'::character varying, 'SUBMITTED'::character varying, 'VERIFIED'::character varying, 'EXPIRED'::character varying])::text[])))
);


--
-- Name: business_verticals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.business_verticals (
    id character varying(36) NOT NULL,
    code character varying(50) NOT NULL,
    name character varying(100) NOT NULL,
    description text,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: community_comments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.community_comments (
    id integer NOT NULL,
    post_id integer,
    user_id integer NOT NULL,
    content text NOT NULL,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: community_comments_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.community_comments_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: community_comments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.community_comments_id_seq OWNED BY public.community_comments.id;


--
-- Name: community_posts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.community_posts (
    id integer NOT NULL,
    user_id integer NOT NULL,
    title character varying(255) NOT NULL,
    content text NOT NULL,
    type character varying(20),
    created_at timestamp without time zone DEFAULT now(),
    CONSTRAINT community_posts_type_check CHECK (((type)::text = ANY ((ARRAY['post'::character varying, 'portfolio'::character varying, 'question'::character varying])::text[])))
);


--
-- Name: community_posts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.community_posts_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: community_posts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.community_posts_id_seq OWNED BY public.community_posts.id;


--
-- Name: corpus_ingest_manifest; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.corpus_ingest_manifest (
    filename text NOT NULL,
    file_hash text,
    status text,
    detail text,
    ingested_at timestamp with time zone DEFAULT now()
);


--
-- Name: creditos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.creditos (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    usuario_id integer NOT NULL,
    origen character varying(30) NOT NULL,
    referencia_id uuid,
    monto_inicial numeric(12,2) NOT NULL,
    saldo numeric(12,2) NOT NULL,
    vence_at timestamp with time zone DEFAULT (now() + '90 days'::interval) NOT NULL,
    creado_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT creditos_monto_inicial_check CHECK ((monto_inicial > (0)::numeric)),
    CONSTRAINT creditos_origen_check CHECK (((origen)::text = ANY ((ARRAY['NO_SHOW_PRESTADOR'::character varying, 'BONO_REEMBOLSO'::character varying, 'AJUSTE'::character varying, 'PROMOCION'::character varying])::text[]))),
    CONSTRAINT creditos_saldo_check CHECK ((saldo >= (0)::numeric))
);


--
-- Name: creditos_movimientos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.creditos_movimientos (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    credito_id uuid NOT NULL,
    usuario_id integer NOT NULL,
    tipo character varying(12) NOT NULL,
    monto numeric(12,2) NOT NULL,
    booking_id uuid,
    creado_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT creditos_movimientos_monto_check CHECK ((monto > (0)::numeric)),
    CONSTRAINT creditos_movimientos_tipo_check CHECK (((tipo)::text = ANY ((ARRAY['EMISION'::character varying, 'USO'::character varying, 'VENCIMIENTO'::character varying])::text[])))
);


--
-- Name: curated_collections; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.curated_collections (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    nombre character varying(255) NOT NULL,
    categoria character varying(50) NOT NULL,
    query_base character varying(255) NOT NULL,
    orden_visual integer DEFAULT 0,
    exclusiva_streak boolean DEFAULT false,
    activo boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: detalles_pedido_tienda; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.detalles_pedido_tienda (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    pedido_id uuid NOT NULL,
    producto_id integer NOT NULL,
    cantidad integer NOT NULL,
    precio_unitario_pagado numeric(10,2) NOT NULL,
    comision_unitaria_prestador numeric(10,2) DEFAULT 0.00,
    tenant_id integer NOT NULL,
    CONSTRAINT detalles_pedido_tienda_cantidad_check CHECK ((cantidad > 0)),
    CONSTRAINT detalles_pedido_tienda_comision_unitaria_prestador_check CHECK ((comision_unitaria_prestador >= (0)::numeric)),
    CONSTRAINT detalles_pedido_tienda_precio_unitario_pagado_check CHECK ((precio_unitario_pagado >= (0)::numeric))
);

ALTER TABLE ONLY public.detalles_pedido_tienda FORCE ROW LEVEL SECURITY;


--
-- Name: disputas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.disputas (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    booking_id uuid NOT NULL,
    iniciado_por integer NOT NULL,
    tipo_actor character varying(20) NOT NULL,
    tipo public.tipo_disputa NOT NULL,
    descripcion text,
    evidencia_urls text[] DEFAULT '{}'::text[],
    monto_disputado numeric(12,2) NOT NULL,
    estado public.estado_disputa DEFAULT 'ABIERTA'::public.estado_disputa NOT NULL,
    resuelto_por integer,
    resolucion public.resolucion_disputa,
    porcentaje_prestador numeric(5,2),
    nota_resolucion text,
    creado_at timestamp with time zone DEFAULT now() NOT NULL,
    actualizado_at timestamp with time zone DEFAULT now() NOT NULL,
    resuelto_at timestamp with time zone,
    sla_limite_at timestamp with time zone,
    tenant_id integer,
    CONSTRAINT disputas_tipo_actor_check CHECK (((tipo_actor)::text = ANY ((ARRAY['CLIENTE'::character varying, 'PRESTADOR'::character varying, 'SISTEMA'::character varying])::text[])))
);

ALTER TABLE ONLY public.disputas FORCE ROW LEVEL SECURITY;


--
-- Name: document_audit_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.document_audit_logs (
    id character varying(64) NOT NULL,
    document_id character varying(64) NOT NULL,
    tenant_id character varying(64) DEFAULT 'default'::character varying NOT NULL,
    provider_id character varying(64) DEFAULT 'system'::character varying NOT NULL,
    actor_id character varying(64) DEFAULT 'system'::character varying NOT NULL,
    action character varying(50) NOT NULL,
    metadata jsonb,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: document_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.document_templates (
    id character varying(36) NOT NULL,
    code character varying(50) NOT NULL,
    title character varying(150) NOT NULL,
    category character varying(50) NOT NULL,
    template_body text NOT NULL,
    disclaimer text NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: envios; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.envios (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    pedido_id uuid NOT NULL,
    transportadora character varying(100) NOT NULL,
    guia character varying(100) NOT NULL,
    url_rastreo text,
    estado character varying(30) DEFAULT 'CREADO'::character varying,
    creado_en timestamp with time zone DEFAULT now(),
    actualizado_en timestamp with time zone DEFAULT now(),
    entregado_en timestamp with time zone,
    observaciones text,
    CONSTRAINT envios_estado_check CHECK (((estado)::text = ANY ((ARRAY['CREADO'::character varying, 'RECOGIDO'::character varying, 'EN_TRANSITO'::character varying, 'EN_CENTRO_DESTINO'::character varying, 'SALIDA_ENTREGA'::character varying, 'ENTREGADO'::character varying, 'FALLIDO'::character varying, 'DEVUELTO'::character varying])::text[])))
);


--
-- Name: event_registrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.event_registrations (
    event_id integer NOT NULL,
    user_id integer NOT NULL,
    registration_time timestamp without time zone DEFAULT now()
);


--
-- Name: events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.events (
    id integer NOT NULL,
    title character varying(255) NOT NULL,
    description text,
    location character varying(255),
    start_time timestamp without time zone NOT NULL,
    end_time timestamp without time zone,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.events_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.events_id_seq OWNED BY public.events.id;


--
-- Name: fraud_flags; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fraud_flags (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    booking_id uuid NOT NULL,
    client_id integer NOT NULL,
    provider_id integer NOT NULL,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: glow_cycle_measurements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.glow_cycle_measurements (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    cycle_id uuid NOT NULL,
    user_id integer NOT NULL,
    measurement_type character varying(30) NOT NULL,
    day_number integer DEFAULT 1 NOT NULL,
    encrypted_scores text NOT NULL,
    score_delta jsonb DEFAULT '{}'::jsonb,
    ai_evaluation_notes text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: glow_cycles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.glow_cycles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id integer NOT NULL,
    cycle_type character varying(50) DEFAULT 'skin'::character varying NOT NULL,
    status character varying(30) DEFAULT 'active'::character varying NOT NULL,
    target_goal character varying(255) NOT NULL,
    target_metric_key character varying(50),
    baseline_value numeric(5,2),
    target_value numeric(5,2),
    current_value numeric(5,2),
    duration_days integer DEFAULT 30 NOT NULL,
    start_date timestamp with time zone DEFAULT now(),
    end_date timestamp with time zone,
    plan_summary text,
    am_routine jsonb DEFAULT '[]'::jsonb,
    pm_routine jsonb DEFAULT '[]'::jsonb,
    recommended_product_ids jsonb DEFAULT '[]'::jsonb,
    recommended_service_ids jsonb DEFAULT '[]'::jsonb,
    checkin_history jsonb DEFAULT '[]'::jsonb,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: guardarropa_outfits; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.guardarropa_outfits (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id integer NOT NULL,
    nombre character varying(100) NOT NULL,
    prendas_ids uuid[] NOT NULL,
    estilo character varying(50) NOT NULL,
    sugerencia_texto text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: guardarropa_prendas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.guardarropa_prendas (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id integer NOT NULL,
    nombre character varying(100) NOT NULL,
    categoria character varying(50) NOT NULL,
    color_predominante character varying(50),
    estilo_sugerido character varying(50),
    image_url text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: inventario_consignacion_prestador; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inventario_consignacion_prestador (
    id integer NOT NULL,
    provider_id integer NOT NULL,
    producto_id integer NOT NULL,
    cantidad_entregada integer NOT NULL,
    cantidad_vendida integer DEFAULT 0,
    lote character varying(50),
    fecha_vencimiento date,
    fecha_entrega timestamp with time zone DEFAULT now(),
    tenant_id integer NOT NULL,
    CONSTRAINT inventario_consignacion_prestador_cantidad_entregada_check CHECK ((cantidad_entregada >= 0)),
    CONSTRAINT inventario_consignacion_prestador_cantidad_vendida_check CHECK ((cantidad_vendida >= 0))
);

ALTER TABLE ONLY public.inventario_consignacion_prestador FORCE ROW LEVEL SECURITY;


--
-- Name: inventario_consignacion_prestador_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.inventario_consignacion_prestador_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: inventario_consignacion_prestador_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.inventario_consignacion_prestador_id_seq OWNED BY public.inventario_consignacion_prestador.id;


--
-- Name: kyc_audit_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.kyc_audit_logs (
    audit_id uuid DEFAULT gen_random_uuid() NOT NULL,
    provider_id character varying(100) NOT NULL,
    document_type character varying(20) NOT NULL,
    document_number_hash character(64) NOT NULL,
    provider_name character varying(50) NOT NULL,
    provider_response_hash character(64) NOT NULL,
    result character varying(20) NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    audit_hash character(64) NOT NULL,
    CONSTRAINT chk_document_type CHECK (((document_type)::text = ANY ((ARRAY['CC'::character varying, 'CE'::character varying, 'NIT'::character varying, 'PASAPORTE'::character varying, 'OTRO'::character varying])::text[]))),
    CONSTRAINT chk_kyc_result CHECK (((result)::text = ANY ((ARRAY['APROBADO'::character varying, 'RECHAZADO'::character varying, 'ERROR'::character varying])::text[])))
);


--
-- Name: learning_paths; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.learning_paths (
    id integer NOT NULL,
    name character varying(255) NOT NULL,
    description text,
    level character varying(20),
    estimated_hours integer,
    badge_id integer,
    created_at timestamp without time zone DEFAULT now(),
    CONSTRAINT learning_paths_level_check CHECK (((level)::text = ANY ((ARRAY['beginner'::character varying, 'intermediate'::character varying, 'advanced'::character varying])::text[])))
);


--
-- Name: learning_paths_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.learning_paths_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: learning_paths_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.learning_paths_id_seq OWNED BY public.learning_paths.id;


--
-- Name: legal_holds; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.legal_holds (
    id integer NOT NULL,
    knowledge_id integer NOT NULL,
    tenant_id integer,
    reason text NOT NULL,
    created_by character varying(100) NOT NULL,
    start_date timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    end_date timestamp with time zone,
    status character varying(20) DEFAULT 'ACTIVE'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: legal_holds_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.legal_holds_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: legal_holds_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.legal_holds_id_seq OWNED BY public.legal_holds.id;


--
-- Name: listas_precios; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.listas_precios (
    id integer NOT NULL,
    codigo character varying(40) NOT NULL,
    nombre character varying(120) NOT NULL,
    rol_destino character varying(20) NOT NULL,
    incluye_iva boolean DEFAULT true NOT NULL,
    vigente_desde date DEFAULT CURRENT_DATE NOT NULL,
    vigente_hasta date,
    estado character varying(20) DEFAULT 'ACTIVA'::character varying NOT NULL,
    tenant_id integer NOT NULL,
    creado_en timestamp with time zone DEFAULT now(),
    CONSTRAINT listas_precios_estado_check CHECK (((estado)::text = ANY ((ARRAY['ACTIVA'::character varying, 'INACTIVA'::character varying])::text[]))),
    CONSTRAINT listas_precios_rol_destino_check CHECK (((rol_destino)::text = ANY ((ARRAY['client'::character varying, 'provider'::character varying, 'salon'::character varying])::text[])))
);

ALTER TABLE ONLY public.listas_precios FORCE ROW LEVEL SECURITY;


--
-- Name: listas_precios_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.listas_precios_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: listas_precios_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.listas_precios_id_seq OWNED BY public.listas_precios.id;


--
-- Name: logs_debug_operacionales; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.logs_debug_operacionales (
    id integer NOT NULL,
    mensaje text NOT NULL,
    nivel character varying(20) DEFAULT 'INFO'::character varying,
    creado_en timestamp with time zone DEFAULT now(),
    metadata jsonb,
    CONSTRAINT logs_debug_operacionales_nivel_check CHECK (((nivel)::text = ANY ((ARRAY['DEBUG'::character varying, 'INFO'::character varying, 'WARN'::character varying, 'ERROR'::character varying])::text[])))
);


--
-- Name: logs_debug_operacionales_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.logs_debug_operacionales_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: logs_debug_operacionales_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.logs_debug_operacionales_id_seq OWNED BY public.logs_debug_operacionales.id;


--
-- Name: memberships; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.memberships (
    id character varying(36) NOT NULL,
    user_id integer NOT NULL,
    business_profile_id character varying(36) NOT NULL,
    role character varying(20) DEFAULT 'MEMBER'::character varying NOT NULL,
    status character varying(20) DEFAULT 'ACTIVE'::character varying NOT NULL,
    invited_at timestamp with time zone,
    accepted_at timestamp with time zone,
    created_by_user_id integer,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT memberships_role_check CHECK (((role)::text = ANY ((ARRAY['OWNER'::character varying, 'ADMIN'::character varying, 'MANAGER'::character varying, 'MEMBER'::character varying, 'VIEWER'::character varying])::text[]))),
    CONSTRAINT memberships_status_check CHECK (((status)::text = ANY ((ARRAY['INVITED'::character varying, 'ACTIVE'::character varying, 'SUSPENDED'::character varying, 'REVOKED'::character varying])::text[])))
);


--
-- Name: mentorship_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mentorship_sessions (
    id integer NOT NULL,
    mentor_id integer NOT NULL,
    mentee_id integer NOT NULL,
    scheduled_at timestamp without time zone NOT NULL,
    duration_minutes integer NOT NULL,
    meeting_link character varying(500),
    status character varying(20),
    created_at timestamp without time zone DEFAULT now(),
    CONSTRAINT mentorship_sessions_status_check CHECK (((status)::text = ANY ((ARRAY['scheduled'::character varying, 'completed'::character varying, 'canceled'::character varying])::text[])))
);


--
-- Name: mentorship_sessions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.mentorship_sessions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: mentorship_sessions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.mentorship_sessions_id_seq OWNED BY public.mentorship_sessions.id;


--
-- Name: messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    sender_id integer NOT NULL,
    receiver_id integer NOT NULL,
    message text NOT NULL,
    is_read boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now(),
    tenant_id integer
);

ALTER TABLE ONLY public.messages FORCE ROW LEVEL SECURITY;


--
-- Name: nail_tryon_jobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.nail_tryon_jobs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id integer NOT NULL,
    status character varying(20) DEFAULT 'pending'::character varying NOT NULL,
    color_hex character varying(7),
    shape character varying(50),
    finish character varying(50),
    decoration_style character varying(100),
    original_image_url text NOT NULL,
    preview_url text,
    error_message text,
    image_hash character varying(64),
    created_at timestamp with time zone DEFAULT now(),
    expires_at timestamp with time zone NOT NULL,
    tenant_id integer,
    CONSTRAINT nail_tryon_jobs_status_check CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'processing'::character varying, 'completed'::character varying, 'failed'::character varying])::text[])))
);

ALTER TABLE ONLY public.nail_tryon_jobs FORCE ROW LEVEL SECURITY;


--
-- Name: otp_validaciones; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.otp_validaciones (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    booking_id uuid NOT NULL,
    codigo_hash character varying(255) NOT NULL,
    generado_at timestamp with time zone DEFAULT now() NOT NULL,
    expira_at timestamp with time zone NOT NULL,
    usado_at timestamp with time zone,
    intentos_fallidos integer DEFAULT 0 NOT NULL,
    estado character varying(20) DEFAULT 'ACTIVO'::character varying NOT NULL,
    ip_generacion inet,
    CONSTRAINT otp_validaciones_estado_check CHECK (((estado)::text = ANY ((ARRAY['ACTIVO'::character varying, 'USADO'::character varying, 'EXPIRADO'::character varying, 'BLOQUEADO'::character varying])::text[])))
);


--
-- Name: path_courses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.path_courses (
    path_id integer NOT NULL,
    course_id uuid NOT NULL,
    "position" integer NOT NULL,
    prerequisite_course_id uuid
);


--
-- Name: pedidos_tienda; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pedidos_tienda (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    comprador_id integer NOT NULL,
    rol_comprador public.tipo_rol NOT NULL,
    booking_id uuid,
    prestador_comisionado_id integer,
    comision_total_prestador numeric(10,2) DEFAULT 0.00,
    subtotal numeric(10,2) NOT NULL,
    envio numeric(10,2) DEFAULT 0.00,
    iva numeric(10,2) DEFAULT 0.00,
    total numeric(10,2) NOT NULL,
    estado character varying(20) DEFAULT 'PENDIENTE_PAGO'::character varying,
    nombre_entrega character varying(255) NOT NULL,
    direccion_entrega text NOT NULL,
    creado_en timestamp with time zone DEFAULT now(),
    tenant_id integer NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb,
    cufe character varying(96),
    qr_factura text,
    factura_emitida boolean DEFAULT false,
    factura_fecha timestamp with time zone,
    pagado_en timestamp with time zone,
    despachado_en timestamp with time zone,
    entregado_en timestamp with time zone,
    cancelado_en timestamp with time zone,
    tipo_via character varying(30),
    numero_principal character varying(10),
    letra_principal character varying(5),
    numero_secundario character varying(10),
    letra_secundaria character varying(5),
    complemento character varying(100),
    barrio character varying(150),
    ciudad character varying(100),
    departamento character varying(100),
    codigo_postal character varying(10),
    referencia text,
    direccion_entrega_id uuid,
    CONSTRAINT pedidos_tienda_comision_total_prestador_check CHECK ((comision_total_prestador >= (0)::numeric)),
    CONSTRAINT pedidos_tienda_envio_check CHECK ((envio >= (0)::numeric)),
    CONSTRAINT pedidos_tienda_estado_check CHECK (((estado)::text = ANY ((ARRAY['PENDIENTE_PAGO'::character varying, 'PAGADO'::character varying, 'DESPACHADO'::character varying, 'ENTREGADO'::character varying, 'CANCELADO'::character varying])::text[]))),
    CONSTRAINT pedidos_tienda_iva_check CHECK ((iva >= (0)::numeric)),
    CONSTRAINT pedidos_tienda_subtotal_check CHECK ((subtotal >= (0)::numeric)),
    CONSTRAINT pedidos_tienda_total_check CHECK ((total >= (0)::numeric))
);

ALTER TABLE ONLY public.pedidos_tienda FORCE ROW LEVEL SECURITY;


--
-- Name: COLUMN pedidos_tienda.metadata; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.pedidos_tienda.metadata IS 'Metadatos del pedido: wompi_external_id para conciliación webhook, tracking de envío, etc.';


--
-- Name: COLUMN pedidos_tienda.cufe; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.pedidos_tienda.cufe IS 'Código Único de Factura Electrónica DIAN (SHA-384 hex, 96 chars)';


--
-- Name: COLUMN pedidos_tienda.qr_factura; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.pedidos_tienda.qr_factura IS 'Código QR de la factura electrónica (base64 o URL)';


--
-- Name: COLUMN pedidos_tienda.factura_emitida; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.pedidos_tienda.factura_emitida IS 'Indica si la factura fue emitida y aceptada por DIAN';


--
-- Name: COLUMN pedidos_tienda.factura_fecha; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.pedidos_tienda.factura_fecha IS 'Fecha y hora de emisión de la factura electrónica';


--
-- Name: COLUMN pedidos_tienda.tipo_via; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.pedidos_tienda.tipo_via IS 'Tipo de vía: Calle, Carrera, Avenida, Diagonal, Transversal, Circular, Vía, Autopista, etc.';


--
-- Name: COLUMN pedidos_tienda.numero_principal; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.pedidos_tienda.numero_principal IS 'Número principal de la vía';


--
-- Name: COLUMN pedidos_tienda.numero_secundario; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.pedidos_tienda.numero_secundario IS 'Número de la vía transversal/cruce';


--
-- Name: COLUMN pedidos_tienda.complemento; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.pedidos_tienda.complemento IS 'Apartamento, interior, oficina, casa, torre, bloque, local, etc.';


--
-- Name: COLUMN pedidos_tienda.barrio; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.pedidos_tienda.barrio IS 'Barrio / sector / urbanización';


--
-- Name: COLUMN pedidos_tienda.ciudad; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.pedidos_tienda.ciudad IS 'Ciudad / municipio';


--
-- Name: COLUMN pedidos_tienda.departamento; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.pedidos_tienda.departamento IS 'Departamento';


--
-- Name: COLUMN pedidos_tienda.codigo_postal; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.pedidos_tienda.codigo_postal IS 'Código postal (6 dígitos en Colombia)';


--
-- Name: COLUMN pedidos_tienda.referencia; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.pedidos_tienda.referencia IS 'Referencia adicional (ej: frente al parque, portería 2)';


--
-- Name: COLUMN pedidos_tienda.direccion_entrega_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.pedidos_tienda.direccion_entrega_id IS 'FK a user_delivery_addresses para trazabilidad';


--
-- Name: perfiles_prestador; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.perfiles_prestador (
    id integer NOT NULL,
    business_name character varying(255),
    description text,
    is_online boolean DEFAULT false,
    ubicacion public.geography(Point,4326),
    portafolio_servicios jsonb DEFAULT '[]'::jsonb,
    documento_id_url text,
    rut_url text,
    certificacion_url text,
    estatus_verificacion public.estado_verificacion DEFAULT 'PENDIENTE'::public.estado_verificacion,
    rating_avg numeric(3,2) DEFAULT 0.0,
    rating_count integer DEFAULT 0,
    is_active boolean DEFAULT true,
    metodo_retiro public.tipo_metodo_retiro DEFAULT 'NEQUI'::public.tipo_metodo_retiro,
    numero_cuenta_nequi character varying(20),
    documento_titular character varying(20),
    creado_en timestamp with time zone DEFAULT now(),
    ultimo_pago_pila_fecha date,
    pila_soporte_url text,
    pila_estado_verificacion character varying(20) DEFAULT 'PENDIENTE'::character varying,
    suspension_pila boolean DEFAULT false,
    tenant_id integer,
    contrato_version character varying(20),
    contrato_aceptado_at timestamp with time zone,
    contrato_aceptado_ip text,
    independencia_aceptada_at timestamp with time zone,
    cancelaciones_tardias integer DEFAULT 0 NOT NULL,
    weekly_schedule jsonb,
    active_start_hour integer DEFAULT 9,
    active_end_hour integer DEFAULT 19,
    is_avant_garde_elite boolean DEFAULT false,
    CONSTRAINT perfiles_prestador_pila_estado_verificacion_check CHECK (((pila_estado_verificacion)::text = ANY ((ARRAY['PENDIENTE'::character varying, 'APROBADO'::character varying, 'RECHAZADO'::character varying, 'VENCIDO'::character varying])::text[]))),
    CONSTRAINT perfiles_prestador_rating_avg_check CHECK (((rating_avg >= (0)::numeric) AND (rating_avg <= (5)::numeric)))
);

ALTER TABLE ONLY public.perfiles_prestador FORCE ROW LEVEL SECURITY;


--
-- Name: COLUMN perfiles_prestador.contrato_version; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.perfiles_prestador.contrato_version IS 'Versión del contrato de comisión aceptada. NULL = nunca aceptó.';


--
-- Name: COLUMN perfiles_prestador.independencia_aceptada_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.perfiles_prestador.independencia_aceptada_at IS 'Fecha de aceptación de la cláusula de independencia laboral (prestador, no empleado).';


--
-- Name: platform_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.platform_config (
    key character varying(100) NOT NULL,
    value text NOT NULL,
    descripcion text,
    updated_at timestamp with time zone DEFAULT now(),
    updated_by integer,
    tenant_id integer
);


--
-- Name: portfolio_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.portfolio_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    provider_id integer NOT NULL,
    image_url text NOT NULL,
    title character varying(255),
    category character varying(50),
    likes_count integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now(),
    tenant_id integer
);

ALTER TABLE ONLY public.portfolio_items FORCE ROW LEVEL SECURITY;


--
-- Name: portfolios; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.portfolios (
    id integer NOT NULL,
    user_id integer NOT NULL,
    title character varying(255) NOT NULL,
    description text,
    media_url character varying(500),
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: portfolios_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.portfolios_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: portfolios_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.portfolios_id_seq OWNED BY public.portfolios.id;


--
-- Name: precios_historial; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.precios_historial (
    id integer NOT NULL,
    lista_id integer NOT NULL,
    producto_id integer NOT NULL,
    precio_anterior numeric(10,2),
    precio_nuevo numeric(10,2) NOT NULL,
    actor_id integer,
    origen character varying(30) NOT NULL,
    motivo text,
    creado_en timestamp with time zone DEFAULT now(),
    tenant_id integer NOT NULL,
    CONSTRAINT precios_historial_origen_check CHECK (((origen)::text = ANY ((ARRAY['manual'::character varying, 'bulk_porcentaje'::character varying, 'bulk_fijar'::character varying, 'import_csv'::character varying, 'migracion'::character varying])::text[])))
);

ALTER TABLE ONLY public.precios_historial FORCE ROW LEVEL SECURITY;


--
-- Name: precios_historial_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.precios_historial_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: precios_historial_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.precios_historial_id_seq OWNED BY public.precios_historial.id;


--
-- Name: precios_producto; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.precios_producto (
    lista_id integer NOT NULL,
    producto_id integer NOT NULL,
    precio numeric(10,2) NOT NULL,
    unidad_minima integer DEFAULT 1 NOT NULL,
    vigente_desde date DEFAULT CURRENT_DATE NOT NULL,
    vigente_hasta date,
    tenant_id integer NOT NULL,
    CONSTRAINT precios_producto_precio_check CHECK ((precio >= (0)::numeric)),
    CONSTRAINT precios_producto_unidad_minima_check CHECK ((unidad_minima > 0))
);

ALTER TABLE ONLY public.precios_producto FORCE ROW LEVEL SECURITY;


--
-- Name: productos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.productos (
    id integer NOT NULL,
    nombre character varying(255) NOT NULL,
    descripcion text,
    precio numeric(10,2),
    stock integer DEFAULT 0,
    imagen_url text,
    tag_especialidad character varying(50) NOT NULL,
    creado_en timestamp with time zone DEFAULT now(),
    tipo_visibilidad character varying(20) DEFAULT 'PUBLICO'::character varying,
    precio_al_publico numeric(10,2) DEFAULT 0.00 NOT NULL,
    precio_con_reserva numeric(10,2) DEFAULT 0.00 NOT NULL,
    precio_prestador numeric(10,2) DEFAULT 0.00 NOT NULL,
    comision_prestador numeric(10,2) DEFAULT 0.00,
    tenant_id integer NOT NULL,
    costo numeric(10,2),
    sku character varying(40),
    CONSTRAINT productos_comision_prestador_check CHECK ((comision_prestador >= (0)::numeric)),
    CONSTRAINT productos_costo_no_negativo CHECK (((costo IS NULL) OR (costo >= (0)::numeric))),
    CONSTRAINT productos_precio_al_publico_check CHECK ((precio_al_publico >= (0)::numeric)),
    CONSTRAINT productos_precio_check CHECK ((precio >= (0)::numeric)),
    CONSTRAINT productos_precio_con_reserva_check CHECK ((precio_con_reserva >= (0)::numeric)),
    CONSTRAINT productos_precio_prestador_check CHECK ((precio_prestador >= (0)::numeric)),
    CONSTRAINT productos_stock_check CHECK ((stock >= 0)),
    CONSTRAINT productos_tipo_visibilidad_check CHECK (((tipo_visibilidad)::text = ANY ((ARRAY['PUBLICO'::character varying, 'INSUMO_PRESTADOR'::character varying])::text[])))
);

ALTER TABLE ONLY public.productos FORCE ROW LEVEL SECURITY;


--
-- Name: productos_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.productos_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: productos_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.productos_id_seq OWNED BY public.productos.id;


--
-- Name: profesionales_medicos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.profesionales_medicos (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    nombre character varying(200) NOT NULL,
    especialidad character varying(100) DEFAULT 'Dermatología'::character varying,
    registro_medico character varying(100),
    telefono character varying(20),
    email character varying(200),
    ciudad character varying(100) DEFAULT 'Bogotá'::character varying,
    foto_url text,
    membresia_activa boolean DEFAULT false,
    condiciones_tratadas text[],
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: propinas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.propinas (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    booking_id uuid NOT NULL,
    client_id integer NOT NULL,
    provider_id integer NOT NULL,
    monto numeric(12,2) NOT NULL,
    estado character varying(20) DEFAULT 'PENDIENTE'::character varying NOT NULL,
    referencia_wompi character varying(255),
    creado_at timestamp with time zone DEFAULT now() NOT NULL,
    pagado_at timestamp with time zone,
    CONSTRAINT propinas_estado_check CHECK (((estado)::text = ANY ((ARRAY['PENDIENTE'::character varying, 'PAGADA'::character varying, 'ANULADA'::character varying])::text[]))),
    CONSTRAINT propinas_monto_check CHECK ((monto > (0)::numeric))
);


--
-- Name: provider_loyalty; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.provider_loyalty (
    provider_id integer NOT NULL,
    tier character varying(30) DEFAULT 'Creative Edge'::character varying NOT NULL,
    lock_until timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT provider_loyalty_tier_check CHECK (((tier)::text = ANY ((ARRAY['Creative Edge'::character varying, 'Visage Pro'::character varying, 'Avant-Garde Elite'::character varying])::text[])))
);


--
-- Name: provider_wallet; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.provider_wallet (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    provider_id integer NOT NULL,
    saldo_disponible numeric(12,2) DEFAULT 0.00 NOT NULL,
    saldo_pendiente numeric(12,2) DEFAULT 0.00 NOT NULL,
    saldo_en_disputa numeric(12,2) DEFAULT 0.00 NOT NULL,
    total_ganado numeric(12,2) DEFAULT 0.00 NOT NULL,
    total_retirado numeric(12,2) DEFAULT 0.00 NOT NULL,
    modelo_retiro public.modelo_retiro_enum DEFAULT 'DEMANDA'::public.modelo_retiro_enum NOT NULL,
    ultimo_retiro_at timestamp with time zone,
    proximo_retiro_auto timestamp with time zone,
    risk_score integer DEFAULT 0 NOT NULL,
    retiros_pausados boolean DEFAULT false NOT NULL,
    tipo_cuenta character varying(20),
    banco character varying(100),
    numero_cuenta character varying(30),
    tipo_cuenta_bancaria character varying(20),
    cuenta_verificada boolean DEFAULT false NOT NULL,
    wompi_beneficiary_id character varying(255),
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    tenant_id integer,
    titular_nombre text,
    titular_documento_tipo text,
    titular_documento_num text,
    CONSTRAINT provider_wallet_risk_score_check CHECK ((risk_score >= 0)),
    CONSTRAINT provider_wallet_saldo_disponible_check CHECK ((saldo_disponible >= (0)::numeric)),
    CONSTRAINT provider_wallet_saldo_en_disputa_check CHECK ((saldo_en_disputa >= (0)::numeric)),
    CONSTRAINT provider_wallet_saldo_pendiente_check CHECK ((saldo_pendiente >= (0)::numeric))
);

ALTER TABLE ONLY public.provider_wallet FORCE ROW LEVEL SECURITY;


--
-- Name: COLUMN provider_wallet.titular_nombre; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.provider_wallet.titular_nombre IS 'Nombre del titular de la cuenta, tal como lo exige Wompi en dispersiones (campo `name`).';


--
-- Name: COLUMN provider_wallet.titular_documento_tipo; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.provider_wallet.titular_documento_tipo IS 'Tipo de documento del titular (CC, NIT, CE, PP, TI, DNI) — campo `legalIdType` de Wompi.';


--
-- Name: COLUMN provider_wallet.titular_documento_num; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.provider_wallet.titular_documento_num IS 'Número de documento del titular — campo `legalId` de Wompi.';


--
-- Name: qr_certificates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.qr_certificates (
    id integer NOT NULL,
    user_id integer NOT NULL,
    certificate_id integer,
    qr_code character varying(500) NOT NULL,
    verification_url character varying(500),
    issued_at timestamp without time zone DEFAULT now()
);


--
-- Name: qr_certificates_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.qr_certificates_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: qr_certificates_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.qr_certificates_id_seq OWNED BY public.qr_certificates.id;


--
-- Name: rag_query_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rag_query_logs (
    id integer NOT NULL,
    trace_id uuid NOT NULL,
    user_id_hash character varying(16),
    query_sanitized text,
    chunks_retrieved integer,
    top_score numeric(5,4),
    llm_used character varying(20),
    total_latency_ms integer,
    error text,
    created_at timestamp without time zone DEFAULT now(),
    category character varying(100),
    threshold_used numeric(4,3),
    filters_applied jsonb,
    all_scores numeric[],
    retrieval_mode character varying(20) DEFAULT 'hnsw'::character varying,
    fallback_triggered boolean DEFAULT false,
    breaker_state_at_query character varying(20)
);


--
-- Name: TABLE rag_query_logs; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.rag_query_logs IS 'Logs estructurados de consultas RAG para trazabilidad, evaluación y debug';


--
-- Name: COLUMN rag_query_logs.category; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.rag_query_logs.category IS 'Categoría de la query: skincare, cabello, cejas, general, etc. (desde qualityGates.js)';


--
-- Name: COLUMN rag_query_logs.threshold_used; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.rag_query_logs.threshold_used IS 'Threshold de similitud usado en la búsqueda vectorial (ej: 0.45, 0.70)';


--
-- Name: COLUMN rag_query_logs.filters_applied; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.rag_query_logs.filters_applied IS 'Filtros de metadata aplicados en la búsqueda (JSONB: {category: "skincare", sourceType: "manual"})';


--
-- Name: COLUMN rag_query_logs.all_scores; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.rag_query_logs.all_scores IS 'Array con TODOS los scores de similitud de chunks candidatos (para análisis recall/precision)';


--
-- Name: COLUMN rag_query_logs.retrieval_mode; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.rag_query_logs.retrieval_mode IS 'Modo de recuperación: hnsw (vector), fts (full-text), hybrid (ambos)';


--
-- Name: COLUMN rag_query_logs.fallback_triggered; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.rag_query_logs.fallback_triggered IS 'TRUE si se activó FTS fallback por error en embedding/HNSW';


--
-- Name: COLUMN rag_query_logs.breaker_state_at_query; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.rag_query_logs.breaker_state_at_query IS 'Estado del circuit breaker NVIDIA al momento: closed, open, half_open';


--
-- Name: rag_query_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.rag_query_logs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: rag_query_logs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.rag_query_logs_id_seq OWNED BY public.rag_query_logs.id;


--
-- Name: reembolsos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.reembolsos (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    booking_id uuid NOT NULL,
    client_id integer NOT NULL,
    monto numeric(12,2) NOT NULL,
    porcentaje_devolucion numeric(5,2) NOT NULL,
    tramo character varying(20) NOT NULL,
    motivo text,
    estado character varying(20) DEFAULT 'PENDIENTE'::character varying NOT NULL,
    referencia_pasarela character varying(255),
    creado_at timestamp with time zone DEFAULT now() NOT NULL,
    procesado_at timestamp with time zone,
    CONSTRAINT reembolsos_estado_check CHECK (((estado)::text = ANY ((ARRAY['PENDIENTE'::character varying, 'PROCESADO'::character varying, 'FALLIDO'::character varying])::text[]))),
    CONSTRAINT reembolsos_monto_check CHECK ((monto >= (0)::numeric)),
    CONSTRAINT reembolsos_porcentaje_devolucion_check CHECK (((porcentaje_devolucion >= (0)::numeric) AND (porcentaje_devolucion <= (100)::numeric))),
    CONSTRAINT reembolsos_tramo_check CHECK (((tramo)::text = ANY ((ARRAY['MAS_24H'::character varying, 'ENTRE_2_Y_24H'::character varying, 'MENOS_2H'::character varying, 'CANCELA_PRESTADOR'::character varying])::text[])))
);


--
-- Name: referidos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.referidos (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    referidor_user_id integer,
    codigo character varying(20) NOT NULL,
    clicks integer DEFAULT 0,
    conversiones integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: retention_policies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.retention_policies (
    id integer NOT NULL,
    name character varying(100) NOT NULL,
    category character varying(100),
    scope character varying(20),
    tenant_id integer,
    period integer NOT NULL,
    unit character varying(10) NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: retention_policies_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.retention_policies_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: retention_policies_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.retention_policies_id_seq OWNED BY public.retention_policies.id;


--
-- Name: retiros; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.retiros (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    provider_id integer NOT NULL,
    wallet_id uuid NOT NULL,
    monto numeric(12,2) NOT NULL,
    estado public.estado_retiro DEFAULT 'PENDIENTE'::public.estado_retiro NOT NULL,
    tipo_origen character varying(20) DEFAULT 'DEMANDA'::character varying NOT NULL,
    referencia_wompi character varying(255),
    error_wompi text,
    numero_cuenta character varying(30),
    banco character varying(100),
    solicitado_at timestamp with time zone DEFAULT now() NOT NULL,
    procesado_at timestamp with time zone,
    metadata jsonb DEFAULT '{}'::jsonb,
    tenant_id integer,
    CONSTRAINT retiros_monto_check CHECK ((monto > (0)::numeric)),
    CONSTRAINT retiros_tipo_origen_check CHECK (((tipo_origen)::text = ANY ((ARRAY['DEMANDA'::character varying, 'SEMANAL'::character varying, 'QUINCENA'::character varying, 'MENSUAL'::character varying])::text[])))
);

ALTER TABLE ONLY public.retiros FORCE ROW LEVEL SECURITY;


--
-- Name: reviews; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.reviews (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    booking_id uuid NOT NULL,
    client_id integer NOT NULL,
    provider_id integer NOT NULL,
    rating integer NOT NULL,
    comment text,
    created_at timestamp with time zone DEFAULT now(),
    tenant_id integer,
    CONSTRAINT reviews_rating_check CHECK (((rating >= 1) AND (rating <= 5)))
);

ALTER TABLE ONLY public.reviews FORCE ROW LEVEL SECURITY;


--
-- Name: salon_invitaciones; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.salon_invitaciones (
    id integer NOT NULL,
    salon_id integer NOT NULL,
    tenant_id integer,
    email character varying(150) NOT NULL,
    sub_rol character varying(50) NOT NULL,
    token_invitacion character varying(64) NOT NULL,
    usado boolean DEFAULT false NOT NULL,
    creado_por integer,
    expires_at timestamp with time zone NOT NULL,
    creado_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.salon_invitaciones FORCE ROW LEVEL SECURITY;


--
-- Name: salon_invitaciones_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.salon_invitaciones_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: salon_invitaciones_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.salon_invitaciones_id_seq OWNED BY public.salon_invitaciones.id;


--
-- Name: salon_miembros; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.salon_miembros (
    id integer NOT NULL,
    salon_id integer NOT NULL,
    user_id integer NOT NULL,
    tenant_id integer,
    sub_rol character varying(50) DEFAULT 'ESTILISTA'::character varying NOT NULL,
    estatus character varying(20) DEFAULT 'ACTIVO'::character varying NOT NULL,
    creado_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.salon_miembros FORCE ROW LEVEL SECURITY;


--
-- Name: salon_miembros_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.salon_miembros_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: salon_miembros_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.salon_miembros_id_seq OWNED BY public.salon_miembros.id;


--
-- Name: salones; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.salones (
    id integer NOT NULL,
    tenant_id integer,
    id_dueno integer NOT NULL,
    nombre_salon character varying(255) NOT NULL,
    nit character varying(50),
    direccion text,
    telefono character varying(50),
    ciudad character varying(100),
    plan_saas character varying(50) DEFAULT 'FREE_TRIAL'::character varying NOT NULL,
    latitude numeric(10,7),
    longitude numeric(10,7),
    ubicacion public.geography(Point,4326),
    location_enabled boolean DEFAULT false NOT NULL,
    location_public boolean DEFAULT true NOT NULL,
    creado_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.salones FORCE ROW LEVEL SECURITY;


--
-- Name: salones_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.salones_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: salones_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.salones_id_seq OWNED BY public.salones.id;


--
-- Name: scan_product_matches; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.scan_product_matches (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    profile_id integer NOT NULL,
    product_id integer NOT NULL,
    match_score numeric(5,4) NOT NULL,
    reasoning text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    tenant_id integer NOT NULL
);

ALTER TABLE ONLY public.scan_product_matches FORCE ROW LEVEL SECURITY;


--
-- Name: schema_migrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.schema_migrations (
    filename text NOT NULL,
    checksum text,
    applied_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: services; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.services (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    provider_id integer NOT NULL,
    name character varying(255) NOT NULL,
    description text,
    price numeric(10,2) NOT NULL,
    duration_minutes integer NOT NULL,
    category character varying(50),
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    tenant_id integer,
    business_profile_id uuid,
    CONSTRAINT services_duration_minutes_check CHECK ((duration_minutes > 0)),
    CONSTRAINT services_price_check CHECK ((price >= (0)::numeric))
);

ALTER TABLE ONLY public.services FORCE ROW LEVEL SECURITY;


--
-- Name: skin_profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.skin_profiles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id integer NOT NULL,
    tipo_piel character varying(50),
    hidratacion_promedio integer,
    tendencia_acne integer,
    sensibilidad_score integer,
    diagnosticos_count integer DEFAULT 0,
    ultimo_diagnostico_at timestamp with time zone,
    atributos_adicionales jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: social_shares_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.social_shares_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id integer NOT NULL,
    platform character varying(30) NOT NULL,
    content_type character varying(50) NOT NULL,
    share_reference_id character varying(255),
    reward_granted boolean DEFAULT false,
    points_awarded integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT social_shares_log_content_type_check CHECK (((content_type)::text = ANY ((ARRAY['AI_COLORIMETRY'::character varying, 'VTO_LOOK'::character varying, 'ACADEMY_CERT'::character varying, 'PROVIDER_PROFILE'::character varying])::text[]))),
    CONSTRAINT social_shares_log_platform_check CHECK (((platform)::text = ANY ((ARRAY['TIKTOK'::character varying, 'INSTAGRAM'::character varying, 'FACEBOOK'::character varying, 'WHATSAPP'::character varying])::text[])))
);


--
-- Name: sos_alerts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sos_alerts (
    id integer NOT NULL,
    user_id integer NOT NULL,
    booking_id uuid,
    latitude numeric(9,6),
    longitude numeric(9,6),
    estado character varying(20) DEFAULT 'ACTIVO'::character varying,
    creado_en timestamp with time zone DEFAULT now(),
    resolucion text,
    resuelto_en timestamp with time zone,
    resuelto_por integer,
    tenant_id integer,
    CONSTRAINT sos_alerts_estado_check CHECK (((estado)::text = ANY ((ARRAY['ACTIVO'::character varying, 'RESUELTO'::character varying])::text[])))
);


--
-- Name: sos_alerts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.sos_alerts_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: sos_alerts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.sos_alerts_id_seq OWNED BY public.sos_alerts.id;


--
-- Name: tenants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tenants (
    id integer NOT NULL,
    name character varying(100) NOT NULL,
    slug character varying(100) NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    es_plataforma boolean DEFAULT false NOT NULL
);


--
-- Name: tenants_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.tenants_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: tenants_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.tenants_id_seq OWNED BY public.tenants.id;


--
-- Name: ticket_mensajes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ticket_mensajes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    ticket_id uuid NOT NULL,
    remitente_id integer NOT NULL,
    mensaje text NOT NULL,
    fecha_envio timestamp with time zone DEFAULT now(),
    autor_tipo character varying(10),
    es_borrador boolean DEFAULT false NOT NULL,
    CONSTRAINT ticket_mensajes_autor_tipo_check CHECK (((autor_tipo IS NULL) OR ((autor_tipo)::text = ANY ((ARRAY['USUARIO'::character varying, 'OPERADOR'::character varying, 'AGENTE'::character varying])::text[]))))
);


--
-- Name: tickets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tickets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    usuario_id integer NOT NULL,
    booking_id uuid,
    tipo character varying(50) NOT NULL,
    categoria character varying(50) NOT NULL,
    asunto character varying(255) NOT NULL,
    descripcion text NOT NULL,
    estado character varying(50) DEFAULT 'ABIERTO'::character varying NOT NULL,
    prioridad character varying(50) DEFAULT 'MEDIA'::character varying NOT NULL,
    evidencia_urls text[] DEFAULT '{}'::text[],
    fecha_creacion timestamp with time zone DEFAULT now(),
    fecha_actualizacion timestamp with time zone DEFAULT now(),
    primera_respuesta_en timestamp with time zone,
    resuelto_en timestamp with time zone,
    cerrado_en timestamp with time zone,
    CONSTRAINT tickets_categoria_check CHECK (((categoria)::text = ANY ((ARRAY['pago'::character varying, 'servicio'::character varying, 'app'::character varying, 'seguridad'::character varying, 'otros'::character varying])::text[]))),
    CONSTRAINT tickets_estado_check CHECK (((estado)::text = ANY ((ARRAY['ABIERTO'::character varying, 'EN_PROCESO'::character varying, 'ESPERANDO_RESPUESTA_USUARIO'::character varying, 'RESUELTO'::character varying, 'CERRADO'::character varying])::text[]))),
    CONSTRAINT tickets_prioridad_check CHECK (((prioridad)::text = ANY ((ARRAY['BAJA'::character varying, 'MEDIA'::character varying, 'ALTA'::character varying, 'EMERGENCIA'::character varying])::text[]))),
    CONSTRAINT tickets_tipo_check CHECK (((tipo)::text = ANY ((ARRAY['PETICION'::character varying, 'QUEJA'::character varying, 'RECLAMO'::character varying, 'SUGERENCIA'::character varying, 'FELICITACION'::character varying, 'ARCO_SUPRESION'::character varying])::text[])))
);


--
-- Name: CONSTRAINT tickets_tipo_check ON tickets; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT tickets_tipo_check ON public.tickets IS 'Tipos de ticket válidos. ARCO_SUPRESION: Solicitud de supresión de datos bajo Ley 1581/2012 Art. 15';


--
-- Name: transactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.transactions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    booking_id uuid,
    amount numeric(10,2) NOT NULL,
    status character varying(20) DEFAULT 'pending'::character varying,
    payment_method character varying(50),
    external_id character varying(255),
    created_en timestamp with time zone DEFAULT now(),
    tenant_id integer,
    client_id integer,
    provider_id integer,
    monto_total numeric(12,2),
    comision_plataforma numeric(12,2) DEFAULT 0,
    monto_neto_prestador numeric(12,2),
    impuestos_retencion numeric(12,2) DEFAULT 0,
    pasarela_pago character varying(30),
    referencia_pasarela character varying(255),
    estado_pago character varying(30),
    liberado_al_prestador boolean DEFAULT false,
    CONSTRAINT transactions_status_check CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'paid'::character varying, 'refunded'::character varying, 'failed'::character varying])::text[])))
);

ALTER TABLE ONLY public.transactions FORCE ROW LEVEL SECURITY;


--
-- Name: user_activity_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_activity_logs (
    id bigint NOT NULL,
    user_id integer,
    session_id uuid NOT NULL,
    event_type character varying(50) NOT NULL,
    screen_name character varying(100) NOT NULL,
    element_id character varying(100),
    metadata jsonb,
    creado_en timestamp with time zone DEFAULT now(),
    tenant_id integer
);


--
-- Name: user_activity_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.user_activity_logs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: user_activity_logs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.user_activity_logs_id_seq OWNED BY public.user_activity_logs.id;


--
-- Name: user_biometrics; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_biometrics (
    id integer NOT NULL,
    user_id character varying(255) NOT NULL,
    subtono double precision,
    estacion character varying(50),
    paleta text[],
    hidratacion double precision,
    sebo double precision,
    mensaje_aura text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: user_biometrics_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.user_biometrics_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: user_biometrics_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.user_biometrics_id_seq OWNED BY public.user_biometrics.id;


--
-- Name: user_consents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_consents (
    id integer NOT NULL,
    user_id integer NOT NULL,
    consent_type character varying(100) NOT NULL,
    granted boolean NOT NULL,
    granted_at timestamp without time zone DEFAULT now()
);


--
-- Name: user_consents_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.user_consents_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: user_consents_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.user_consents_id_seq OWNED BY public.user_consents.id;


--
-- Name: user_delivery_addresses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_delivery_addresses (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id integer NOT NULL,
    tipo_via character varying(30) NOT NULL,
    numero_principal character varying(10) NOT NULL,
    letra_principal character varying(5),
    numero_secundario character varying(10),
    letra_secundaria character varying(5),
    complemento character varying(100),
    barrio character varying(150),
    ciudad character varying(100) NOT NULL,
    departamento character varying(100) NOT NULL,
    codigo_postal character varying(10),
    referencia text,
    direccion_formateada text GENERATED ALWAYS AS (((((((((((((tipo_via)::text || ' '::text) || (numero_principal)::text) || COALESCE((' '::text || (letra_principal)::text), ''::text)) || COALESCE((' #'::text || (numero_secundario)::text), ''::text)) || COALESCE(('-'::text || (letra_secundaria)::text), ''::text)) || COALESCE((' '::text || (complemento)::text), ''::text)) || COALESCE((', '::text || (barrio)::text), ''::text)) || ', '::text) || (ciudad)::text) || ', '::text) || (departamento)::text)) STORED,
    alias character varying(50),
    es_default boolean DEFAULT false NOT NULL,
    activo boolean DEFAULT true NOT NULL,
    creado_en timestamp with time zone DEFAULT now(),
    actualizado_en timestamp with time zone DEFAULT now()
);


--
-- Name: TABLE user_delivery_addresses; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.user_delivery_addresses IS 'Direcciones de entrega estructuradas bajo formato colombiano para GlowStore';


--
-- Name: COLUMN user_delivery_addresses.tipo_via; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.user_delivery_addresses.tipo_via IS 'Tipo de vía: Calle, Carrera, Avenida, Diagonal, Transversal, Circular, Vía, Autopista, etc.';


--
-- Name: COLUMN user_delivery_addresses.numero_principal; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.user_delivery_addresses.numero_principal IS 'Número principal de la vía (ej: 123 en "Calle 123 #45-67")';


--
-- Name: COLUMN user_delivery_addresses.numero_secundario; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.user_delivery_addresses.numero_secundario IS 'Número de la vía transversal/cruce (ej: 45 en "Calle 123 #45-67")';


--
-- Name: COLUMN user_delivery_addresses.complemento; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.user_delivery_addresses.complemento IS 'Apartamento, interior, oficina, casa, torre, bloque, local, etc.';


--
-- Name: COLUMN user_delivery_addresses.direccion_formateada; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.user_delivery_addresses.direccion_formateada IS 'Dirección legible auto-generada para mostrar en UI y usar en pedidos';


--
-- Name: COLUMN user_delivery_addresses.alias; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.user_delivery_addresses.alias IS 'Nombre amigable elegido por el usuario';


--
-- Name: user_levels; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_levels (
    id integer NOT NULL,
    user_id integer NOT NULL,
    level character varying(20),
    total_xp integer NOT NULL,
    badge_id integer,
    updated_at timestamp without time zone DEFAULT now(),
    CONSTRAINT user_levels_level_check CHECK (((level)::text = ANY ((ARRAY['novice'::character varying, 'intermediate'::character varying, 'advanced'::character varying, 'expert'::character varying])::text[])))
);


--
-- Name: user_levels_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.user_levels_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: user_levels_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.user_levels_id_seq OWNED BY public.user_levels.id;


--
-- Name: user_loyalty; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_loyalty (
    user_id integer NOT NULL,
    tier character varying(30) DEFAULT 'Base Complexion'::character varying NOT NULL,
    brillo_points numeric(10,2) DEFAULT 0.00 NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT user_loyalty_brillo_points_check CHECK ((brillo_points >= (0)::numeric)),
    CONSTRAINT user_loyalty_tier_check CHECK (((tier)::text = ANY ((ARRAY['Base Complexion'::character varying, 'Glow Effect'::character varying, 'Porcelain Radiance'::character varying])::text[])))
);


--
-- Name: user_loyalty_ledger; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_loyalty_ledger (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id integer NOT NULL,
    booking_id uuid,
    amount numeric(10,2) NOT NULL,
    description text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: user_photos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_photos (
    id integer NOT NULL,
    user_id integer NOT NULL,
    url_or_path text NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: user_photos_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.user_photos_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: user_photos_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.user_photos_id_seq OWNED BY public.user_photos.id;


--
-- Name: user_preferences; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_preferences (
    user_id integer NOT NULL,
    telemetry_enabled boolean DEFAULT true NOT NULL,
    push_enabled boolean DEFAULT true NOT NULL,
    marketing_enabled boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: TABLE user_preferences; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.user_preferences IS 'Preferencias de privacidad y comunicación del usuario (Ley 1581/2012)';


--
-- Name: COLUMN user_preferences.telemetry_enabled; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.user_preferences.telemetry_enabled IS 'Permitir telemetría anónima de uso para mejora de modelos Aura AI';


--
-- Name: COLUMN user_preferences.push_enabled; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.user_preferences.push_enabled IS 'Permitir notificaciones push (recordatorios, ofertas, alertas)';


--
-- Name: COLUMN user_preferences.marketing_enabled; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.user_preferences.marketing_enabled IS 'Permitir comunicaciones de marketing (Novedades Luxe, boletines)';


--
-- Name: user_social_accounts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_social_accounts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id integer NOT NULL,
    provider character varying(30) NOT NULL,
    provider_user_id character varying(255) NOT NULL,
    access_token text NOT NULL,
    refresh_token text,
    expires_at timestamp with time zone NOT NULL,
    scopes text[] DEFAULT '{}'::text[],
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT user_social_accounts_provider_check CHECK (((provider)::text = ANY ((ARRAY['TIKTOK'::character varying, 'INSTAGRAM'::character varying, 'FACEBOOK'::character varying])::text[])))
);


--
-- Name: usuarios_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.usuarios_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: usuarios_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.usuarios_id_seq OWNED BY public.usuarios.id;


--
-- Name: validaciones_medicas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.validaciones_medicas (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id integer NOT NULL,
    ai_diagnostic_id integer,
    profesional_id uuid,
    estado character varying(20) DEFAULT 'pendiente'::character varying,
    nota_profesional text,
    payment_reference character varying(255),
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    fecha_respuesta timestamp with time zone,
    CONSTRAINT validaciones_medicas_estado_check CHECK (((estado)::text = ANY ((ARRAY['pendiente'::character varying, 'revisado'::character varying])::text[])))
);


--
-- Name: wallet_ledger_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.wallet_ledger_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tx_id uuid NOT NULL,
    provider_id integer NOT NULL,
    evento character varying(40) NOT NULL,
    detalle jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT wallet_ledger_events_evento_check CHECK (((evento)::text = ANY ((ARRAY['MADURADO'::character varying, 'ACREDITADO'::character varying, 'RETIRO_COMPLETADO'::character varying, 'RETIRO_FALLIDO'::character varying])::text[])))
);


--
-- Name: wallet_transactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.wallet_transactions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    provider_id integer NOT NULL,
    booking_id uuid,
    tipo public.tipo_wallet_tx NOT NULL,
    monto numeric(12,2) NOT NULL,
    saldo_resultante numeric(12,2) NOT NULL,
    estado character varying(20) DEFAULT 'COMPLETADO'::character varying NOT NULL,
    referencia_wompi character varying(255),
    descripcion text,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now(),
    tenant_id integer,
    CONSTRAINT chk_monto_positivo CHECK ((monto > (0)::numeric)),
    CONSTRAINT wallet_transactions_estado_check CHECK (((estado)::text = ANY ((ARRAY['PENDIENTE'::character varying, 'COMPLETADO'::character varying, 'REVERTIDO'::character varying])::text[]))),
    CONSTRAINT wallet_transactions_monto_check CHECK ((monto > (0)::numeric))
);

ALTER TABLE ONLY public.wallet_transactions FORCE ROW LEVEL SECURITY;


--
-- Name: xp_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.xp_logs (
    id integer NOT NULL,
    user_id integer NOT NULL,
    xp_amount integer NOT NULL,
    reason character varying(255),
    metadata jsonb,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: xp_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.xp_logs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: xp_logs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.xp_logs_id_seq OWNED BY public.xp_logs.id;


--
-- Name: zonas_envio; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.zonas_envio (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    ciudad character varying(100) NOT NULL,
    departamento character varying(100) NOT NULL,
    codigo_postal_prefijo character varying(6),
    tarifa_base numeric(10,2) DEFAULT 12000 NOT NULL,
    tarifa_por_kg numeric(10,2) DEFAULT 0,
    gratis_desde_monto numeric(10,2),
    transportadora_default character varying(100),
    dias_estimados_min integer DEFAULT 2,
    dias_estimados_max integer DEFAULT 5,
    activa boolean DEFAULT true,
    creado_en timestamp with time zone DEFAULT now()
);


--
-- Name: TABLE zonas_envio; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.zonas_envio IS 'Zonas de envío con tarifas por ciudad/departamento/código postal para GlowStore';


--
-- Name: COLUMN zonas_envio.codigo_postal_prefijo; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.zonas_envio.codigo_postal_prefijo IS 'Prefijo del código postal (ej: 05 para Medellín, 11 para Bogotá). NULL = aplica a toda la ciudad';


--
-- Name: COLUMN zonas_envio.gratis_desde_monto; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.zonas_envio.gratis_desde_monto IS 'Monto mínimo del pedido para envío gratis. NULL = no aplica';


--
-- Name: COLUMN zonas_envio.transportadora_default; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.zonas_envio.transportadora_default IS 'Transportadora sugerida para despacho automático';


--
-- Name: biometric_vectors id; Type: DEFAULT; Schema: phi_vault; Owner: -
--

ALTER TABLE ONLY phi_vault.biometric_vectors ALTER COLUMN id SET DEFAULT nextval('phi_vault.biometric_vectors_id_seq'::regclass);


--
-- Name: academy_certificates id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.academy_certificates ALTER COLUMN id SET DEFAULT nextval('public.academy_certificates_id_seq'::regclass);


--
-- Name: admin_actions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_actions ALTER COLUMN id SET DEFAULT nextval('public.admin_actions_id_seq'::regclass);


--
-- Name: admin_audit_logs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_audit_logs ALTER COLUMN id SET DEFAULT nextval('public.admin_audit_logs_id_seq'::regclass);


--
-- Name: ai_diagnostics id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_diagnostics ALTER COLUMN id SET DEFAULT nextval('public.ai_diagnostics_id_seq'::regclass);


--
-- Name: analytics_events id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.analytics_events ALTER COLUMN id SET DEFAULT nextval('public.analytics_events_id_seq'::regclass);


--
-- Name: app_locales id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_locales ALTER COLUMN id SET DEFAULT nextval('public.app_locales_id_seq'::regclass);


--
-- Name: audit_log id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_log ALTER COLUMN id SET DEFAULT nextval('public.audit_log_id_seq'::regclass);


--
-- Name: auditoria_consentimiento_biometrico id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auditoria_consentimiento_biometrico ALTER COLUMN id SET DEFAULT nextval('public.auditoria_consentimiento_biometrico_id_seq'::regclass);


--
-- Name: badges id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.badges ALTER COLUMN id SET DEFAULT nextval('public.badges_id_seq'::regclass);


--
-- Name: biometric_access_log id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.biometric_access_log ALTER COLUMN id SET DEFAULT nextval('public.biometric_access_log_id_seq'::regclass);


--
-- Name: biometric_scan_comparisons id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.biometric_scan_comparisons ALTER COLUMN id SET DEFAULT nextval('public.biometric_scan_comparisons_id_seq'::regclass);


--
-- Name: biometric_scan_sessions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.biometric_scan_sessions ALTER COLUMN id SET DEFAULT nextval('public.biometric_scan_sessions_id_seq'::regclass);


--
-- Name: community_comments id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.community_comments ALTER COLUMN id SET DEFAULT nextval('public.community_comments_id_seq'::regclass);


--
-- Name: community_posts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.community_posts ALTER COLUMN id SET DEFAULT nextval('public.community_posts_id_seq'::regclass);


--
-- Name: events id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.events ALTER COLUMN id SET DEFAULT nextval('public.events_id_seq'::regclass);


--
-- Name: inventario_consignacion_prestador id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventario_consignacion_prestador ALTER COLUMN id SET DEFAULT nextval('public.inventario_consignacion_prestador_id_seq'::regclass);


--
-- Name: learning_paths id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.learning_paths ALTER COLUMN id SET DEFAULT nextval('public.learning_paths_id_seq'::regclass);


--
-- Name: legal_holds id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.legal_holds ALTER COLUMN id SET DEFAULT nextval('public.legal_holds_id_seq'::regclass);


--
-- Name: listas_precios id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.listas_precios ALTER COLUMN id SET DEFAULT nextval('public.listas_precios_id_seq'::regclass);


--
-- Name: logs_debug_operacionales id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.logs_debug_operacionales ALTER COLUMN id SET DEFAULT nextval('public.logs_debug_operacionales_id_seq'::regclass);


--
-- Name: mentorship_sessions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mentorship_sessions ALTER COLUMN id SET DEFAULT nextval('public.mentorship_sessions_id_seq'::regclass);


--
-- Name: portfolios id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portfolios ALTER COLUMN id SET DEFAULT nextval('public.portfolios_id_seq'::regclass);


--
-- Name: precios_historial id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.precios_historial ALTER COLUMN id SET DEFAULT nextval('public.precios_historial_id_seq'::regclass);


--
-- Name: productos id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.productos ALTER COLUMN id SET DEFAULT nextval('public.productos_id_seq'::regclass);


--
-- Name: qr_certificates id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.qr_certificates ALTER COLUMN id SET DEFAULT nextval('public.qr_certificates_id_seq'::regclass);


--
-- Name: rag_query_logs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rag_query_logs ALTER COLUMN id SET DEFAULT nextval('public.rag_query_logs_id_seq'::regclass);


--
-- Name: retention_policies id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.retention_policies ALTER COLUMN id SET DEFAULT nextval('public.retention_policies_id_seq'::regclass);


--
-- Name: salon_invitaciones id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.salon_invitaciones ALTER COLUMN id SET DEFAULT nextval('public.salon_invitaciones_id_seq'::regclass);


--
-- Name: salon_miembros id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.salon_miembros ALTER COLUMN id SET DEFAULT nextval('public.salon_miembros_id_seq'::regclass);


--
-- Name: salones id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.salones ALTER COLUMN id SET DEFAULT nextval('public.salones_id_seq'::regclass);


--
-- Name: sos_alerts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sos_alerts ALTER COLUMN id SET DEFAULT nextval('public.sos_alerts_id_seq'::regclass);


--
-- Name: tenants id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenants ALTER COLUMN id SET DEFAULT nextval('public.tenants_id_seq'::regclass);


--
-- Name: user_activity_logs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_activity_logs ALTER COLUMN id SET DEFAULT nextval('public.user_activity_logs_id_seq'::regclass);


--
-- Name: user_biometrics id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_biometrics ALTER COLUMN id SET DEFAULT nextval('public.user_biometrics_id_seq'::regclass);


--
-- Name: user_consents id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_consents ALTER COLUMN id SET DEFAULT nextval('public.user_consents_id_seq'::regclass);


--
-- Name: user_levels id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_levels ALTER COLUMN id SET DEFAULT nextval('public.user_levels_id_seq'::regclass);


--
-- Name: user_photos id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_photos ALTER COLUMN id SET DEFAULT nextval('public.user_photos_id_seq'::regclass);


--
-- Name: usuarios id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.usuarios ALTER COLUMN id SET DEFAULT nextval('public.usuarios_id_seq'::regclass);


--
-- Name: xp_logs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.xp_logs ALTER COLUMN id SET DEFAULT nextval('public.xp_logs_id_seq'::regclass);


--
-- Name: biometric_vectors biometric_vectors_pkey; Type: CONSTRAINT; Schema: phi_vault; Owner: -
--

ALTER TABLE ONLY phi_vault.biometric_vectors
    ADD CONSTRAINT biometric_vectors_pkey PRIMARY KEY (id);


--
-- Name: academy_ai_discrepancy_log academy_ai_discrepancy_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.academy_ai_discrepancy_log
    ADD CONSTRAINT academy_ai_discrepancy_log_pkey PRIMARY KEY (id);


--
-- Name: academy_certificates academy_certificates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.academy_certificates
    ADD CONSTRAINT academy_certificates_pkey PRIMARY KEY (id);


--
-- Name: academy_consentimientos academy_consentimientos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.academy_consentimientos
    ADD CONSTRAINT academy_consentimientos_pkey PRIMARY KEY (id);


--
-- Name: academy_consentimientos academy_consentimientos_provider_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.academy_consentimientos
    ADD CONSTRAINT academy_consentimientos_provider_id_key UNIQUE (provider_id);


--
-- Name: academy_courses academy_courses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.academy_courses
    ADD CONSTRAINT academy_courses_pkey PRIMARY KEY (id);


--
-- Name: academy_lessons academy_lessons_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.academy_lessons
    ADD CONSTRAINT academy_lessons_pkey PRIMARY KEY (id);


--
-- Name: academy_modules academy_modules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.academy_modules
    ADD CONSTRAINT academy_modules_pkey PRIMARY KEY (id);


--
-- Name: academy_progress academy_progress_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.academy_progress
    ADD CONSTRAINT academy_progress_pkey PRIMARY KEY (provider_id, lesson_id);


--
-- Name: academy_quiz_attempts academy_quiz_attempts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.academy_quiz_attempts
    ADD CONSTRAINT academy_quiz_attempts_pkey PRIMARY KEY (id);


--
-- Name: academy_quizzes academy_quizzes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.academy_quizzes
    ADD CONSTRAINT academy_quizzes_pkey PRIMARY KEY (id);


--
-- Name: academy_worksheet_submissions academy_worksheet_submissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.academy_worksheet_submissions
    ADD CONSTRAINT academy_worksheet_submissions_pkey PRIMARY KEY (provider_id, lesson_id);


--
-- Name: admin_actions admin_actions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_actions
    ADD CONSTRAINT admin_actions_pkey PRIMARY KEY (id);


--
-- Name: admin_audit_logs admin_audit_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_audit_logs
    ADD CONSTRAINT admin_audit_logs_pkey PRIMARY KEY (id);


--
-- Name: admin_mfa admin_mfa_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_mfa
    ADD CONSTRAINT admin_mfa_pkey PRIMARY KEY (user_id);


--
-- Name: affiliate_products affiliate_products_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.affiliate_products
    ADD CONSTRAINT affiliate_products_pkey PRIMARY KEY (id);


--
-- Name: ai_diagnostics ai_diagnostics_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_diagnostics
    ADD CONSTRAINT ai_diagnostics_pkey PRIMARY KEY (id);


--
-- Name: analytics_events analytics_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.analytics_events
    ADD CONSTRAINT analytics_events_pkey PRIMARY KEY (id);


--
-- Name: app_locales app_locales_locale_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_locales
    ADD CONSTRAINT app_locales_locale_code_key UNIQUE (locale_code);


--
-- Name: app_locales app_locales_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_locales
    ADD CONSTRAINT app_locales_pkey PRIMARY KEY (id);


--
-- Name: audit_log audit_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_log
    ADD CONSTRAINT audit_log_pkey PRIMARY KEY (id);


--
-- Name: auditoria_consentimiento_biometrico auditoria_consentimiento_biometrico_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auditoria_consentimiento_biometrico
    ADD CONSTRAINT auditoria_consentimiento_biometrico_pkey PRIMARY KEY (id);


--
-- Name: badges badges_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.badges
    ADD CONSTRAINT badges_pkey PRIMARY KEY (id);


--
-- Name: beauty_profiles beauty_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.beauty_profiles
    ADD CONSTRAINT beauty_profiles_pkey PRIMARY KEY (id);


--
-- Name: biometric_access_log biometric_access_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.biometric_access_log
    ADD CONSTRAINT biometric_access_log_pkey PRIMARY KEY (id);


--
-- Name: biometric_consent_log biometric_consent_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.biometric_consent_log
    ADD CONSTRAINT biometric_consent_log_pkey PRIMARY KEY (id);


--
-- Name: biometric_consents biometric_consents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.biometric_consents
    ADD CONSTRAINT biometric_consents_pkey PRIMARY KEY (id);


--
-- Name: biometric_consents biometric_consents_user_consent_version_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.biometric_consents
    ADD CONSTRAINT biometric_consents_user_consent_version_key UNIQUE (user_id, consent_type, version_terms);


--
-- Name: biometric_history biometric_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.biometric_history
    ADD CONSTRAINT biometric_history_pkey PRIMARY KEY (id);


--
-- Name: biometric_scan_comparisons biometric_scan_comparisons_current_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.biometric_scan_comparisons
    ADD CONSTRAINT biometric_scan_comparisons_current_unique UNIQUE (current_scan_id);


--
-- Name: biometric_scan_comparisons biometric_scan_comparisons_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.biometric_scan_comparisons
    ADD CONSTRAINT biometric_scan_comparisons_pkey PRIMARY KEY (id);


--
-- Name: biometric_scan_sessions biometric_scan_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.biometric_scan_sessions
    ADD CONSTRAINT biometric_scan_sessions_pkey PRIMARY KEY (id);


--
-- Name: booking_productos booking_productos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.booking_productos
    ADD CONSTRAINT booking_productos_pkey PRIMARY KEY (booking_id, producto_id);


--
-- Name: bookings bookings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bookings
    ADD CONSTRAINT bookings_pkey PRIMARY KEY (id);


--
-- Name: brand_sponsorships brand_sponsorships_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.brand_sponsorships
    ADD CONSTRAINT brand_sponsorships_pkey PRIMARY KEY (id);


--
-- Name: business_documents business_documents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.business_documents
    ADD CONSTRAINT business_documents_pkey PRIMARY KEY (id);


--
-- Name: business_evidences business_evidences_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.business_evidences
    ADD CONSTRAINT business_evidences_pkey PRIMARY KEY (id);


--
-- Name: business_findings business_findings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.business_findings
    ADD CONSTRAINT business_findings_pkey PRIMARY KEY (id);


--
-- Name: business_profiles business_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.business_profiles
    ADD CONSTRAINT business_profiles_pkey PRIMARY KEY (id);


--
-- Name: business_requirements business_requirements_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.business_requirements
    ADD CONSTRAINT business_requirements_code_key UNIQUE (code);


--
-- Name: business_requirements business_requirements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.business_requirements
    ADD CONSTRAINT business_requirements_pkey PRIMARY KEY (id);


--
-- Name: business_tasks business_tasks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.business_tasks
    ADD CONSTRAINT business_tasks_pkey PRIMARY KEY (id);


--
-- Name: business_verticals business_verticals_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.business_verticals
    ADD CONSTRAINT business_verticals_code_key UNIQUE (code);


--
-- Name: business_verticals business_verticals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.business_verticals
    ADD CONSTRAINT business_verticals_pkey PRIMARY KEY (id);


--
-- Name: community_comments community_comments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.community_comments
    ADD CONSTRAINT community_comments_pkey PRIMARY KEY (id);


--
-- Name: community_posts community_posts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.community_posts
    ADD CONSTRAINT community_posts_pkey PRIMARY KEY (id);


--
-- Name: corpus_ingest_manifest corpus_ingest_manifest_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.corpus_ingest_manifest
    ADD CONSTRAINT corpus_ingest_manifest_pkey PRIMARY KEY (filename);


--
-- Name: creditos_movimientos creditos_movimientos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.creditos_movimientos
    ADD CONSTRAINT creditos_movimientos_pkey PRIMARY KEY (id);


--
-- Name: creditos creditos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.creditos
    ADD CONSTRAINT creditos_pkey PRIMARY KEY (id);


--
-- Name: curated_collections curated_collections_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.curated_collections
    ADD CONSTRAINT curated_collections_pkey PRIMARY KEY (id);


--
-- Name: detalles_pedido_tienda detalles_pedido_tienda_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.detalles_pedido_tienda
    ADD CONSTRAINT detalles_pedido_tienda_pkey PRIMARY KEY (id);


--
-- Name: disputas disputas_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.disputas
    ADD CONSTRAINT disputas_pkey PRIMARY KEY (id);


--
-- Name: document_audit_logs document_audit_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_audit_logs
    ADD CONSTRAINT document_audit_logs_pkey PRIMARY KEY (id);


--
-- Name: document_templates document_templates_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_templates
    ADD CONSTRAINT document_templates_code_key UNIQUE (code);


--
-- Name: document_templates document_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_templates
    ADD CONSTRAINT document_templates_pkey PRIMARY KEY (id);


--
-- Name: envios envios_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.envios
    ADD CONSTRAINT envios_pkey PRIMARY KEY (id);


--
-- Name: event_registrations event_registrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_registrations
    ADD CONSTRAINT event_registrations_pkey PRIMARY KEY (event_id, user_id);


--
-- Name: events events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.events
    ADD CONSTRAINT events_pkey PRIMARY KEY (id);


--
-- Name: fraud_flags fraud_flags_booking_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fraud_flags
    ADD CONSTRAINT fraud_flags_booking_id_key UNIQUE (booking_id);


--
-- Name: fraud_flags fraud_flags_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fraud_flags
    ADD CONSTRAINT fraud_flags_pkey PRIMARY KEY (id);


--
-- Name: glow_cycle_measurements glow_cycle_measurements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.glow_cycle_measurements
    ADD CONSTRAINT glow_cycle_measurements_pkey PRIMARY KEY (id);


--
-- Name: glow_cycles glow_cycles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.glow_cycles
    ADD CONSTRAINT glow_cycles_pkey PRIMARY KEY (id);


--
-- Name: guardarropa_outfits guardarropa_outfits_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.guardarropa_outfits
    ADD CONSTRAINT guardarropa_outfits_pkey PRIMARY KEY (id);


--
-- Name: guardarropa_prendas guardarropa_prendas_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.guardarropa_prendas
    ADD CONSTRAINT guardarropa_prendas_pkey PRIMARY KEY (id);


--
-- Name: inventario_consignacion_prestador inventario_consignacion_prestador_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventario_consignacion_prestador
    ADD CONSTRAINT inventario_consignacion_prestador_pkey PRIMARY KEY (id);


--
-- Name: kyc_audit_logs kyc_audit_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kyc_audit_logs
    ADD CONSTRAINT kyc_audit_logs_pkey PRIMARY KEY (audit_id);


--
-- Name: learning_paths learning_paths_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.learning_paths
    ADD CONSTRAINT learning_paths_pkey PRIMARY KEY (id);


--
-- Name: legal_holds legal_holds_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.legal_holds
    ADD CONSTRAINT legal_holds_pkey PRIMARY KEY (id);


--
-- Name: listas_precios listas_precios_codigo_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.listas_precios
    ADD CONSTRAINT listas_precios_codigo_key UNIQUE (codigo);


--
-- Name: listas_precios listas_precios_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.listas_precios
    ADD CONSTRAINT listas_precios_pkey PRIMARY KEY (id);


--
-- Name: logs_debug_operacionales logs_debug_operacionales_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.logs_debug_operacionales
    ADD CONSTRAINT logs_debug_operacionales_pkey PRIMARY KEY (id);


--
-- Name: memberships memberships_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.memberships
    ADD CONSTRAINT memberships_pkey PRIMARY KEY (id);


--
-- Name: mentorship_sessions mentorship_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mentorship_sessions
    ADD CONSTRAINT mentorship_sessions_pkey PRIMARY KEY (id);


--
-- Name: messages messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_pkey PRIMARY KEY (id);


--
-- Name: nail_tryon_jobs nail_tryon_jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nail_tryon_jobs
    ADD CONSTRAINT nail_tryon_jobs_pkey PRIMARY KEY (id);


--
-- Name: otp_validaciones otp_validaciones_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.otp_validaciones
    ADD CONSTRAINT otp_validaciones_pkey PRIMARY KEY (id);


--
-- Name: path_courses path_courses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.path_courses
    ADD CONSTRAINT path_courses_pkey PRIMARY KEY (path_id, course_id);


--
-- Name: pedidos_tienda pedidos_tienda_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pedidos_tienda
    ADD CONSTRAINT pedidos_tienda_pkey PRIMARY KEY (id);


--
-- Name: perfiles_prestador perfiles_prestador_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.perfiles_prestador
    ADD CONSTRAINT perfiles_prestador_pkey PRIMARY KEY (id);


--
-- Name: platform_config platform_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platform_config
    ADD CONSTRAINT platform_config_pkey PRIMARY KEY (key);


--
-- Name: portfolio_items portfolio_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portfolio_items
    ADD CONSTRAINT portfolio_items_pkey PRIMARY KEY (id);


--
-- Name: portfolios portfolios_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portfolios
    ADD CONSTRAINT portfolios_pkey PRIMARY KEY (id);


--
-- Name: precios_historial precios_historial_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.precios_historial
    ADD CONSTRAINT precios_historial_pkey PRIMARY KEY (id);


--
-- Name: precios_producto precios_producto_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.precios_producto
    ADD CONSTRAINT precios_producto_pkey PRIMARY KEY (lista_id, producto_id);


--
-- Name: productos productos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.productos
    ADD CONSTRAINT productos_pkey PRIMARY KEY (id);


--
-- Name: profesionales_medicos profesionales_medicos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profesionales_medicos
    ADD CONSTRAINT profesionales_medicos_pkey PRIMARY KEY (id);


--
-- Name: propinas propinas_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.propinas
    ADD CONSTRAINT propinas_pkey PRIMARY KEY (id);


--
-- Name: provider_loyalty provider_loyalty_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.provider_loyalty
    ADD CONSTRAINT provider_loyalty_pkey PRIMARY KEY (provider_id);


--
-- Name: provider_wallet provider_wallet_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.provider_wallet
    ADD CONSTRAINT provider_wallet_pkey PRIMARY KEY (id);


--
-- Name: qr_certificates qr_certificates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.qr_certificates
    ADD CONSTRAINT qr_certificates_pkey PRIMARY KEY (id);


--
-- Name: rag_query_logs rag_query_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rag_query_logs
    ADD CONSTRAINT rag_query_logs_pkey PRIMARY KEY (id);


--
-- Name: reembolsos reembolsos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reembolsos
    ADD CONSTRAINT reembolsos_pkey PRIMARY KEY (id);


--
-- Name: referidos referidos_codigo_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.referidos
    ADD CONSTRAINT referidos_codigo_key UNIQUE (codigo);


--
-- Name: referidos referidos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.referidos
    ADD CONSTRAINT referidos_pkey PRIMARY KEY (id);


--
-- Name: retention_policies retention_policies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.retention_policies
    ADD CONSTRAINT retention_policies_pkey PRIMARY KEY (id);


--
-- Name: retiros retiros_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.retiros
    ADD CONSTRAINT retiros_pkey PRIMARY KEY (id);


--
-- Name: reviews reviews_booking_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reviews
    ADD CONSTRAINT reviews_booking_id_key UNIQUE (booking_id);


--
-- Name: reviews reviews_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reviews
    ADD CONSTRAINT reviews_pkey PRIMARY KEY (id);


--
-- Name: salon_invitaciones salon_invitaciones_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.salon_invitaciones
    ADD CONSTRAINT salon_invitaciones_pkey PRIMARY KEY (id);


--
-- Name: salon_invitaciones salon_invitaciones_token_invitacion_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.salon_invitaciones
    ADD CONSTRAINT salon_invitaciones_token_invitacion_key UNIQUE (token_invitacion);


--
-- Name: salon_miembros salon_miembros_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.salon_miembros
    ADD CONSTRAINT salon_miembros_pkey PRIMARY KEY (id);


--
-- Name: salones salones_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.salones
    ADD CONSTRAINT salones_pkey PRIMARY KEY (id);


--
-- Name: scan_product_matches scan_product_matches_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scan_product_matches
    ADD CONSTRAINT scan_product_matches_pkey PRIMARY KEY (id);


--
-- Name: schema_migrations schema_migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schema_migrations
    ADD CONSTRAINT schema_migrations_pkey PRIMARY KEY (filename);


--
-- Name: services services_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.services
    ADD CONSTRAINT services_pkey PRIMARY KEY (id);


--
-- Name: skin_profiles skin_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.skin_profiles
    ADD CONSTRAINT skin_profiles_pkey PRIMARY KEY (id);


--
-- Name: social_shares_log social_shares_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.social_shares_log
    ADD CONSTRAINT social_shares_log_pkey PRIMARY KEY (id);


--
-- Name: sos_alerts sos_alerts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sos_alerts
    ADD CONSTRAINT sos_alerts_pkey PRIMARY KEY (id);


--
-- Name: tenants tenants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenants
    ADD CONSTRAINT tenants_pkey PRIMARY KEY (id);


--
-- Name: tenants tenants_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenants
    ADD CONSTRAINT tenants_slug_key UNIQUE (slug);


--
-- Name: ticket_mensajes ticket_mensajes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ticket_mensajes
    ADD CONSTRAINT ticket_mensajes_pkey PRIMARY KEY (id);


--
-- Name: tickets tickets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tickets
    ADD CONSTRAINT tickets_pkey PRIMARY KEY (id);


--
-- Name: transactions transactions_booking_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_booking_id_key UNIQUE (booking_id);


--
-- Name: transactions transactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_pkey PRIMARY KEY (id);


--
-- Name: usuarios unique_auth_provider_id; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.usuarios
    ADD CONSTRAINT unique_auth_provider_id UNIQUE (auth_provider, provider_id);


--
-- Name: beauty_profiles unique_beauty_profiles_user_id; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.beauty_profiles
    ADD CONSTRAINT unique_beauty_profiles_user_id UNIQUE (user_id);


--
-- Name: academy_certificates unique_provider_course; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.academy_certificates
    ADD CONSTRAINT unique_provider_course UNIQUE (provider_id, course_id);


--
-- Name: memberships unique_user_business_profile; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.memberships
    ADD CONSTRAINT unique_user_business_profile UNIQUE (user_id, business_profile_id);


--
-- Name: skin_profiles unique_user_profile; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.skin_profiles
    ADD CONSTRAINT unique_user_profile UNIQUE (user_id);


--
-- Name: otp_validaciones uq_otp_booking; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.otp_validaciones
    ADD CONSTRAINT uq_otp_booking UNIQUE (booking_id);


--
-- Name: propinas uq_propina_booking; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.propinas
    ADD CONSTRAINT uq_propina_booking UNIQUE (booking_id);


--
-- Name: provider_wallet uq_provider_wallet; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.provider_wallet
    ADD CONSTRAINT uq_provider_wallet UNIQUE (provider_id);


--
-- Name: salon_miembros uq_salon_miembro; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.salon_miembros
    ADD CONSTRAINT uq_salon_miembro UNIQUE (salon_id, user_id);


--
-- Name: user_social_accounts uq_user_provider; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_social_accounts
    ADD CONSTRAINT uq_user_provider UNIQUE (user_id, provider);


--
-- Name: user_activity_logs user_activity_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_activity_logs
    ADD CONSTRAINT user_activity_logs_pkey PRIMARY KEY (id);


--
-- Name: user_biometrics user_biometrics_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_biometrics
    ADD CONSTRAINT user_biometrics_pkey PRIMARY KEY (id);


--
-- Name: user_consents user_consents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_consents
    ADD CONSTRAINT user_consents_pkey PRIMARY KEY (id);


--
-- Name: user_delivery_addresses user_delivery_addresses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_delivery_addresses
    ADD CONSTRAINT user_delivery_addresses_pkey PRIMARY KEY (id);


--
-- Name: user_levels user_levels_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_levels
    ADD CONSTRAINT user_levels_pkey PRIMARY KEY (id);


--
-- Name: user_loyalty_ledger user_loyalty_ledger_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_loyalty_ledger
    ADD CONSTRAINT user_loyalty_ledger_pkey PRIMARY KEY (id);


--
-- Name: user_loyalty user_loyalty_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_loyalty
    ADD CONSTRAINT user_loyalty_pkey PRIMARY KEY (user_id);


--
-- Name: user_photos user_photos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_photos
    ADD CONSTRAINT user_photos_pkey PRIMARY KEY (id);


--
-- Name: user_preferences user_preferences_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_preferences
    ADD CONSTRAINT user_preferences_pkey PRIMARY KEY (user_id);


--
-- Name: user_social_accounts user_social_accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_social_accounts
    ADD CONSTRAINT user_social_accounts_pkey PRIMARY KEY (id);


--
-- Name: usuarios usuarios_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.usuarios
    ADD CONSTRAINT usuarios_email_key UNIQUE (email);


--
-- Name: usuarios usuarios_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.usuarios
    ADD CONSTRAINT usuarios_pkey PRIMARY KEY (id);


--
-- Name: validaciones_medicas validaciones_medicas_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.validaciones_medicas
    ADD CONSTRAINT validaciones_medicas_pkey PRIMARY KEY (id);


--
-- Name: wallet_ledger_events wallet_ledger_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wallet_ledger_events
    ADD CONSTRAINT wallet_ledger_events_pkey PRIMARY KEY (id);


--
-- Name: wallet_transactions wallet_transactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wallet_transactions
    ADD CONSTRAINT wallet_transactions_pkey PRIMARY KEY (id);


--
-- Name: xp_logs xp_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.xp_logs
    ADD CONSTRAINT xp_logs_pkey PRIMARY KEY (id);


--
-- Name: zonas_envio zonas_envio_ciudad_departamento_codigo_postal_prefijo_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.zonas_envio
    ADD CONSTRAINT zonas_envio_ciudad_departamento_codigo_postal_prefijo_key UNIQUE (ciudad, departamento, codigo_postal_prefijo);


--
-- Name: zonas_envio zonas_envio_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.zonas_envio
    ADD CONSTRAINT zonas_envio_pkey PRIMARY KEY (id);


--
-- Name: idx_academy_certificates_code; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_academy_certificates_code ON public.academy_certificates USING btree (upper((code)::text));


--
-- Name: idx_academy_quiz_attempts_provider_course; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_academy_quiz_attempts_provider_course ON public.academy_quiz_attempts USING btree (provider_id, course_id, created_at DESC);


--
-- Name: idx_access_log_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_access_log_user ON public.biometric_access_log USING btree (user_id, accessed_at);


--
-- Name: idx_activity_logs_event; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_activity_logs_event ON public.user_activity_logs USING btree (event_type);


--
-- Name: idx_activity_logs_session; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_activity_logs_session ON public.user_activity_logs USING btree (session_id);


--
-- Name: idx_admin_audit_action; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_admin_audit_action ON public.admin_audit_logs USING btree (action, created_at DESC);


--
-- Name: idx_admin_audit_resource; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_admin_audit_resource ON public.admin_audit_logs USING btree (resource, resource_id);


--
-- Name: idx_admin_audit_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_admin_audit_user ON public.admin_audit_logs USING btree (user_id, created_at DESC);


--
-- Name: idx_admin_mfa_tenant_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_admin_mfa_tenant_id ON public.admin_mfa USING btree (tenant_id);


--
-- Name: idx_audit_actor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_actor ON public.audit_log USING btree (actor_id, creado_at DESC);


--
-- Name: idx_audit_fecha; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_fecha ON public.audit_log USING btree (creado_at DESC);


--
-- Name: idx_audit_logs_document; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_logs_document ON public.document_audit_logs USING btree (document_id);


--
-- Name: idx_audit_tabla; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_tabla ON public.audit_log USING btree (tabla, registro_id);


--
-- Name: idx_beauty_profiles_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_beauty_profiles_user_id ON public.beauty_profiles USING btree (user_id);


--
-- Name: idx_biometric_access_log_accessed_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_biometric_access_log_accessed_at ON public.biometric_access_log USING btree (accessed_at);


--
-- Name: idx_biometric_consent_log_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_biometric_consent_log_user ON public.biometric_consent_log USING btree (user_id, created_at DESC);


--
-- Name: idx_biometric_consents_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_biometric_consents_user_id ON public.biometric_consents USING btree (user_id);


--
-- Name: idx_biometric_history_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_biometric_history_user_id ON public.biometric_history USING btree (user_id);


--
-- Name: idx_biometric_scan_comparisons_user_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_biometric_scan_comparisons_user_created ON public.biometric_scan_comparisons USING btree (user_id, created_at DESC);


--
-- Name: idx_biometric_scan_sessions_task; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_biometric_scan_sessions_task ON public.biometric_scan_sessions USING btree (provider_task_id);


--
-- Name: idx_biometric_scan_sessions_user_captured; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_biometric_scan_sessions_user_captured ON public.biometric_scan_sessions USING btree (user_id, captured_at DESC);


--
-- Name: idx_bookings_business_profile; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bookings_business_profile ON public.bookings USING btree (business_profile_id);


--
-- Name: idx_bookings_client; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bookings_client ON public.bookings USING btree (client_id);


--
-- Name: idx_bookings_client_estado; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bookings_client_estado ON public.bookings USING btree (client_id, estado);


--
-- Name: idx_bookings_cufe; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bookings_cufe ON public.bookings USING btree (cufe);


--
-- Name: idx_bookings_provider; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bookings_provider ON public.bookings USING btree (provider_id);


--
-- Name: idx_bookings_provider_estado; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bookings_provider_estado ON public.bookings USING btree (provider_id, estado);


--
-- Name: idx_bookings_scheduled; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bookings_scheduled ON public.bookings USING btree (scheduled_at DESC);


--
-- Name: idx_bookings_tenant_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bookings_tenant_id ON public.bookings USING btree (tenant_id);


--
-- Name: idx_business_documents_profile_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_business_documents_profile_id ON public.business_documents USING btree (business_profile_id);


--
-- Name: idx_business_documents_provider; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_business_documents_provider ON public.business_documents USING btree (provider_id);


--
-- Name: idx_business_documents_provider_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_business_documents_provider_tenant ON public.business_documents USING btree (provider_id, tenant_id);


--
-- Name: idx_business_evidences_admin_queue; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_business_evidences_admin_queue ON public.business_evidences USING btree (created_at) WHERE ((validation_state)::text = ANY ((ARRAY['EVIDENCE_SUBMITTED'::character varying, 'USER_DECLARED'::character varying])::text[]));


--
-- Name: idx_business_evidences_task; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_business_evidences_task ON public.business_evidences USING btree (task_id);


--
-- Name: idx_business_evidences_task_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_business_evidences_task_id ON public.business_evidences USING btree (task_id);


--
-- Name: idx_business_findings_open; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_business_findings_open ON public.business_findings USING btree (business_profile_id, risk_level) WHERE ((status)::text = 'OPEN'::text);


--
-- Name: idx_business_findings_profile; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_business_findings_profile ON public.business_findings USING btree (business_profile_id);


--
-- Name: idx_business_findings_profile_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_business_findings_profile_id ON public.business_findings USING btree (business_profile_id);


--
-- Name: idx_business_profiles_provider; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_business_profiles_provider ON public.business_profiles USING btree (provider_id);


--
-- Name: idx_business_requirements_vert; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_business_requirements_vert ON public.business_requirements USING btree (vertical_id);


--
-- Name: idx_business_tasks_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_business_tasks_active ON public.business_tasks USING btree (business_profile_id, stage) WHERE ((status)::text = ANY ((ARRAY['IN_PROGRESS'::character varying, 'PENDING'::character varying])::text[]));


--
-- Name: idx_business_tasks_profile; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_business_tasks_profile ON public.business_tasks USING btree (business_profile_id);


--
-- Name: idx_business_tasks_profile_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_business_tasks_profile_id ON public.business_tasks USING btree (business_profile_id);


--
-- Name: idx_business_tasks_profile_status_score; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_business_tasks_profile_status_score ON public.business_tasks USING btree (business_profile_id, status) INCLUDE (id);


--
-- Name: idx_consents_audit; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_consents_audit ON public.biometric_consents USING btree (granted_at, revoked_at);


--
-- Name: idx_consents_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_consents_user ON public.biometric_consents USING btree (user_id, consent_type, granted);


--
-- Name: idx_creditos_mov_usuario; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_creditos_mov_usuario ON public.creditos_movimientos USING btree (usuario_id, creado_at DESC);


--
-- Name: idx_creditos_usuario; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_creditos_usuario ON public.creditos USING btree (usuario_id, vence_at);


--
-- Name: idx_detalles_pedido_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_detalles_pedido_id ON public.detalles_pedido_tienda USING btree (pedido_id);


--
-- Name: idx_disputas_booking; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_disputas_booking ON public.disputas USING btree (booking_id);


--
-- Name: idx_disputas_estado; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_disputas_estado ON public.disputas USING btree (estado, creado_at DESC);


--
-- Name: idx_disputas_sla; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_disputas_sla ON public.disputas USING btree (sla_limite_at) WHERE (estado = ANY (ARRAY['ABIERTA'::public.estado_disputa, 'EN_REVISION'::public.estado_disputa]));


--
-- Name: idx_document_audit_logs_doc_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_document_audit_logs_doc_id ON public.document_audit_logs USING btree (document_id);


--
-- Name: idx_document_audit_logs_metadata_gin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_document_audit_logs_metadata_gin ON public.document_audit_logs USING gin (metadata);


--
-- Name: idx_envios_guia; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_envios_guia ON public.envios USING btree (guia);


--
-- Name: idx_envios_pedido; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_envios_pedido ON public.envios USING btree (pedido_id);


--
-- Name: idx_glow_cycle_measurements_cycle_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_glow_cycle_measurements_cycle_id ON public.glow_cycle_measurements USING btree (cycle_id);


--
-- Name: idx_glow_cycles_user_id_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_glow_cycles_user_id_status ON public.glow_cycles USING btree (user_id, status);


--
-- Name: idx_kyc_audit_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_kyc_audit_created_at ON public.kyc_audit_logs USING btree (created_at DESC);


--
-- Name: idx_kyc_audit_provider_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_kyc_audit_provider_id ON public.kyc_audit_logs USING btree (provider_id);


--
-- Name: idx_kyc_audit_provider_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_kyc_audit_provider_name ON public.kyc_audit_logs USING btree (provider_name);


--
-- Name: idx_kyc_audit_result; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_kyc_audit_result ON public.kyc_audit_logs USING btree (result);


--
-- Name: idx_logs_debug_operacionales_creado_en; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_logs_debug_operacionales_creado_en ON public.logs_debug_operacionales USING btree (creado_en);


--
-- Name: idx_memberships_business_profile; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_memberships_business_profile ON public.memberships USING btree (business_profile_id);


--
-- Name: idx_memberships_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_memberships_user ON public.memberships USING btree (user_id);


--
-- Name: idx_memberships_user_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_memberships_user_status ON public.memberships USING btree (user_id, status);


--
-- Name: idx_messages_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_messages_created_at ON public.messages USING btree (created_at DESC);


--
-- Name: idx_messages_sender_receiver; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_messages_sender_receiver ON public.messages USING btree (sender_id, receiver_id);


--
-- Name: idx_messages_tenant_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_messages_tenant_id ON public.messages USING btree (tenant_id);


--
-- Name: idx_nail_tryon_jobs_expires; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_nail_tryon_jobs_expires ON public.nail_tryon_jobs USING btree (expires_at);


--
-- Name: idx_nail_tryon_jobs_tenant_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_nail_tryon_jobs_tenant_id ON public.nail_tryon_jobs USING btree (tenant_id);


--
-- Name: idx_nail_tryon_jobs_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_nail_tryon_jobs_user ON public.nail_tryon_jobs USING btree (user_id);


--
-- Name: idx_otp_booking; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_otp_booking ON public.otp_validaciones USING btree (booking_id);


--
-- Name: idx_otp_expira; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_otp_expira ON public.otp_validaciones USING btree (expira_at);


--
-- Name: idx_pedidos_tienda_booking; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pedidos_tienda_booking ON public.pedidos_tienda USING btree (booking_id);


--
-- Name: idx_pedidos_tienda_comisionado; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pedidos_tienda_comisionado ON public.pedidos_tienda USING btree (prestador_comisionado_id);


--
-- Name: idx_pedidos_tienda_comprador; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pedidos_tienda_comprador ON public.pedidos_tienda USING btree (comprador_id);


--
-- Name: idx_pedidos_tienda_cufe; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pedidos_tienda_cufe ON public.pedidos_tienda USING btree (cufe);


--
-- Name: idx_perfiles_prestador_tenant_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_perfiles_prestador_tenant_id ON public.perfiles_prestador USING btree (tenant_id);


--
-- Name: idx_platform_config_tenant_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_platform_config_tenant_id ON public.platform_config USING btree (tenant_id);


--
-- Name: idx_portfolio_items_tenant_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_portfolio_items_tenant_id ON public.portfolio_items USING btree (tenant_id);


--
-- Name: idx_precios_historial_producto; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_precios_historial_producto ON public.precios_historial USING btree (producto_id, lista_id, creado_en DESC);


--
-- Name: idx_precios_producto_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_precios_producto_tenant ON public.precios_producto USING btree (tenant_id);


--
-- Name: idx_productos_tenant_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_productos_tenant_id ON public.productos USING btree (tenant_id);


--
-- Name: idx_propinas_provider; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_propinas_provider ON public.propinas USING btree (provider_id, pagado_at DESC);


--
-- Name: idx_provider_wallet_provider; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_provider_wallet_provider ON public.provider_wallet USING btree (provider_id);


--
-- Name: idx_provider_wallet_retiro; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_provider_wallet_retiro ON public.provider_wallet USING btree (ultimo_retiro_at);


--
-- Name: idx_providers_spatial_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_providers_spatial_active ON public.perfiles_prestador USING gist (ubicacion) WHERE ((is_active = true) AND (estatus_verificacion = 'APROBADO'::public.estado_verificacion));


--
-- Name: idx_providers_spatial_elite; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_providers_spatial_elite ON public.perfiles_prestador USING gist (ubicacion) WHERE ((is_active = true) AND (estatus_verificacion = 'APROBADO'::public.estado_verificacion) AND (is_avant_garde_elite = true));


--
-- Name: idx_rag_logs_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rag_logs_created ON public.rag_query_logs USING btree (created_at);


--
-- Name: idx_rag_logs_error; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rag_logs_error ON public.rag_query_logs USING btree (error) WHERE (error IS NOT NULL);


--
-- Name: idx_rag_logs_llm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rag_logs_llm ON public.rag_query_logs USING btree (llm_used);


--
-- Name: idx_rag_logs_trace; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rag_logs_trace ON public.rag_query_logs USING btree (trace_id);


--
-- Name: idx_rag_logs_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rag_logs_user ON public.rag_query_logs USING btree (user_id_hash);


--
-- Name: idx_rag_query_logs_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rag_query_logs_category ON public.rag_query_logs USING btree (category);


--
-- Name: idx_rag_query_logs_created_at_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rag_query_logs_created_at_category ON public.rag_query_logs USING btree (created_at, category);


--
-- Name: idx_rag_query_logs_fallback_triggered; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rag_query_logs_fallback_triggered ON public.rag_query_logs USING btree (fallback_triggered);


--
-- Name: idx_rag_query_logs_retrieval_mode; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rag_query_logs_retrieval_mode ON public.rag_query_logs USING btree (retrieval_mode);


--
-- Name: idx_rag_query_logs_threshold_used; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rag_query_logs_threshold_used ON public.rag_query_logs USING btree (threshold_used);


--
-- Name: idx_reembolsos_booking; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reembolsos_booking ON public.reembolsos USING btree (booking_id);


--
-- Name: idx_reembolsos_estado; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reembolsos_estado ON public.reembolsos USING btree (estado);


--
-- Name: idx_retiros_estado; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_retiros_estado ON public.retiros USING btree (estado);


--
-- Name: idx_retiros_provider; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_retiros_provider ON public.retiros USING btree (provider_id, solicitado_at DESC);


--
-- Name: idx_reviews_provider; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reviews_provider ON public.reviews USING btree (provider_id);


--
-- Name: idx_reviews_tenant_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reviews_tenant_id ON public.reviews USING btree (tenant_id);


--
-- Name: idx_salon_invitaciones_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_salon_invitaciones_email ON public.salon_invitaciones USING btree (email);


--
-- Name: idx_salon_invitaciones_token; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_salon_invitaciones_token ON public.salon_invitaciones USING btree (token_invitacion);


--
-- Name: idx_salon_miembros_salon; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_salon_miembros_salon ON public.salon_miembros USING btree (salon_id);


--
-- Name: idx_salon_miembros_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_salon_miembros_tenant ON public.salon_miembros USING btree (tenant_id);


--
-- Name: idx_salon_miembros_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_salon_miembros_user ON public.salon_miembros USING btree (user_id);


--
-- Name: idx_salones_dueno; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_salones_dueno ON public.salones USING btree (id_dueno);


--
-- Name: idx_salones_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_salones_tenant ON public.salones USING btree (tenant_id);


--
-- Name: idx_salones_ubicacion_gist; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_salones_ubicacion_gist ON public.salones USING gist (ubicacion);


--
-- Name: idx_scan_product_matches_product; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_scan_product_matches_product ON public.scan_product_matches USING btree (product_id);


--
-- Name: idx_scan_product_matches_profile; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_scan_product_matches_profile ON public.scan_product_matches USING btree (profile_id);


--
-- Name: idx_services_provider; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_services_provider ON public.services USING btree (provider_id);


--
-- Name: idx_skin_profiles_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_skin_profiles_user ON public.skin_profiles USING btree (user_id);


--
-- Name: idx_social_accounts_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_social_accounts_user ON public.user_social_accounts USING btree (user_id);


--
-- Name: idx_social_shares_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_social_shares_user ON public.social_shares_log USING btree (user_id, created_at DESC);


--
-- Name: idx_sos_alerts_booking; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sos_alerts_booking ON public.sos_alerts USING btree (booking_id);


--
-- Name: idx_sos_alerts_tenant_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sos_alerts_tenant_id ON public.sos_alerts USING btree (tenant_id);


--
-- Name: idx_sos_alerts_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sos_alerts_user ON public.sos_alerts USING btree (user_id);


--
-- Name: idx_ticket_mensajes_ticket_fecha; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ticket_mensajes_ticket_fecha ON public.ticket_mensajes USING btree (ticket_id, fecha_envio);


--
-- Name: idx_tickets_estado_prioridad; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tickets_estado_prioridad ON public.tickets USING btree (estado, prioridad);


--
-- Name: idx_tickets_primera_respuesta; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tickets_primera_respuesta ON public.tickets USING btree (primera_respuesta_en);


--
-- Name: idx_transactions_external_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_transactions_external_id ON public.transactions USING btree (external_id);


--
-- Name: idx_transactions_tenant_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_transactions_tenant_id ON public.transactions USING btree (tenant_id);


--
-- Name: idx_user_activity_logs_tenant_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_activity_logs_tenant_id ON public.user_activity_logs USING btree (tenant_id);


--
-- Name: idx_user_biometrics_user_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_biometrics_user_created ON public.user_biometrics USING btree (user_id, created_at DESC);


--
-- Name: idx_user_delivery_addresses_default; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_delivery_addresses_default ON public.user_delivery_addresses USING btree (user_id, es_default) WHERE (es_default = true);


--
-- Name: idx_user_delivery_addresses_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_delivery_addresses_user ON public.user_delivery_addresses USING btree (user_id);


--
-- Name: idx_user_photos_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_photos_created_at ON public.user_photos USING btree (created_at);


--
-- Name: idx_user_preferences_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_preferences_user_id ON public.user_preferences USING btree (user_id);


--
-- Name: idx_usuarios_auth_provider; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_usuarios_auth_provider ON public.usuarios USING btree (auth_provider);


--
-- Name: idx_usuarios_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_usuarios_email ON public.usuarios USING btree (email);


--
-- Name: idx_usuarios_responsabilidad_sin_declarar; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_usuarios_responsabilidad_sin_declarar ON public.usuarios USING btree (responsable_iva) WHERE ((rut_responsabilidad_codigo IS NULL) AND (responsable_iva_override IS NULL));


--
-- Name: idx_usuarios_tenant_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_usuarios_tenant_id ON public.usuarios USING btree (tenant_id);


--
-- Name: idx_validaciones_medicas_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_validaciones_medicas_user ON public.validaciones_medicas USING btree (user_id);


--
-- Name: idx_wallet_ledger_events_provider; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_wallet_ledger_events_provider ON public.wallet_ledger_events USING btree (provider_id, created_at DESC);


--
-- Name: idx_wallet_ledger_events_tx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_wallet_ledger_events_tx ON public.wallet_ledger_events USING btree (tx_id, evento);


--
-- Name: idx_wallet_tx_booking; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_wallet_tx_booking ON public.wallet_transactions USING btree (booking_id);


--
-- Name: idx_wallet_tx_provider; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_wallet_tx_provider ON public.wallet_transactions USING btree (provider_id, created_at DESC);


--
-- Name: idx_wallet_tx_tipo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_wallet_tx_tipo ON public.wallet_transactions USING btree (tipo);


--
-- Name: idx_zonas_envio_lookup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_zonas_envio_lookup ON public.zonas_envio USING btree (ciudad, departamento, codigo_postal_prefijo) WHERE activa;


--
-- Name: tenants_unico_plataforma; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX tenants_unico_plataforma ON public.tenants USING btree (es_plataforma) WHERE es_plataforma;


--
-- Name: uq_user_delivery_addresses_one_default; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_user_delivery_addresses_one_default ON public.user_delivery_addresses USING btree (user_id) WHERE (es_default = true);


--
-- Name: bookings before_booking_insert_update; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER before_booking_insert_update BEFORE INSERT OR UPDATE OF valor_bruto ON public.bookings FOR EACH ROW EXECUTE FUNCTION public.calc_booking_split();


--
-- Name: admin_audit_logs trg_admin_audit_logs_append_only; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_admin_audit_logs_append_only BEFORE DELETE OR UPDATE ON public.admin_audit_logs FOR EACH ROW EXECUTE FUNCTION public.admin_audit_logs_append_only();


--
-- Name: fraud_flags trg_apply_fraud_penalty; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_apply_fraud_penalty AFTER INSERT ON public.fraud_flags FOR EACH ROW EXECUTE FUNCTION public.apply_provider_fraud_penalty();


--
-- Name: booking_productos trg_assign_tenant_id; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_assign_tenant_id BEFORE INSERT ON public.booking_productos FOR EACH ROW EXECUTE FUNCTION public.app_assign_tenant_id();


--
-- Name: bookings trg_assign_tenant_id; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_assign_tenant_id BEFORE INSERT ON public.bookings FOR EACH ROW EXECUTE FUNCTION public.app_assign_tenant_id();


--
-- Name: detalles_pedido_tienda trg_assign_tenant_id; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_assign_tenant_id BEFORE INSERT ON public.detalles_pedido_tienda FOR EACH ROW EXECUTE FUNCTION public.app_assign_tenant_id();


--
-- Name: disputas trg_assign_tenant_id; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_assign_tenant_id BEFORE INSERT ON public.disputas FOR EACH ROW EXECUTE FUNCTION public.app_assign_tenant_id();


--
-- Name: inventario_consignacion_prestador trg_assign_tenant_id; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_assign_tenant_id BEFORE INSERT ON public.inventario_consignacion_prestador FOR EACH ROW EXECUTE FUNCTION public.app_assign_tenant_id();


--
-- Name: messages trg_assign_tenant_id; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_assign_tenant_id BEFORE INSERT ON public.messages FOR EACH ROW EXECUTE FUNCTION public.app_assign_tenant_id();


--
-- Name: nail_tryon_jobs trg_assign_tenant_id; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_assign_tenant_id BEFORE INSERT ON public.nail_tryon_jobs FOR EACH ROW EXECUTE FUNCTION public.app_assign_tenant_id();


--
-- Name: pedidos_tienda trg_assign_tenant_id; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_assign_tenant_id BEFORE INSERT ON public.pedidos_tienda FOR EACH ROW EXECUTE FUNCTION public.app_assign_tenant_id();


--
-- Name: perfiles_prestador trg_assign_tenant_id; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_assign_tenant_id BEFORE INSERT ON public.perfiles_prestador FOR EACH ROW EXECUTE FUNCTION public.app_assign_tenant_id();


--
-- Name: portfolio_items trg_assign_tenant_id; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_assign_tenant_id BEFORE INSERT ON public.portfolio_items FOR EACH ROW EXECUTE FUNCTION public.app_assign_tenant_id();


--
-- Name: productos trg_assign_tenant_id; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_assign_tenant_id BEFORE INSERT ON public.productos FOR EACH ROW EXECUTE FUNCTION public.app_assign_tenant_id();


--
-- Name: provider_wallet trg_assign_tenant_id; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_assign_tenant_id BEFORE INSERT ON public.provider_wallet FOR EACH ROW EXECUTE FUNCTION public.app_assign_tenant_id();


--
-- Name: retiros trg_assign_tenant_id; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_assign_tenant_id BEFORE INSERT ON public.retiros FOR EACH ROW EXECUTE FUNCTION public.app_assign_tenant_id();


--
-- Name: reviews trg_assign_tenant_id; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_assign_tenant_id BEFORE INSERT ON public.reviews FOR EACH ROW EXECUTE FUNCTION public.app_assign_tenant_id();


--
-- Name: salon_invitaciones trg_assign_tenant_id; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_assign_tenant_id BEFORE INSERT ON public.salon_invitaciones FOR EACH ROW EXECUTE FUNCTION public.app_assign_tenant_id();


--
-- Name: salon_miembros trg_assign_tenant_id; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_assign_tenant_id BEFORE INSERT ON public.salon_miembros FOR EACH ROW EXECUTE FUNCTION public.app_assign_tenant_id();


--
-- Name: salones trg_assign_tenant_id; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_assign_tenant_id BEFORE INSERT ON public.salones FOR EACH ROW EXECUTE FUNCTION public.app_assign_tenant_id();


--
-- Name: scan_product_matches trg_assign_tenant_id; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_assign_tenant_id BEFORE INSERT ON public.scan_product_matches FOR EACH ROW EXECUTE FUNCTION public.app_assign_tenant_id();


--
-- Name: services trg_assign_tenant_id; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_assign_tenant_id BEFORE INSERT ON public.services FOR EACH ROW EXECUTE FUNCTION public.app_assign_tenant_id();


--
-- Name: transactions trg_assign_tenant_id; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_assign_tenant_id BEFORE INSERT ON public.transactions FOR EACH ROW EXECUTE FUNCTION public.app_assign_tenant_id();


--
-- Name: usuarios trg_assign_tenant_id; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_assign_tenant_id BEFORE INSERT ON public.usuarios FOR EACH ROW EXECUTE FUNCTION public.app_assign_tenant_id();


--
-- Name: wallet_transactions trg_assign_tenant_id; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_assign_tenant_id BEFORE INSERT ON public.wallet_transactions FOR EACH ROW EXECUTE FUNCTION public.app_assign_tenant_id();


--
-- Name: bookings trg_client_loyalty_reward; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_client_loyalty_reward AFTER UPDATE OF estado, payment_status ON public.bookings FOR EACH ROW EXECUTE FUNCTION public.process_client_loyalty_reward();


--
-- Name: perfiles_prestador trg_crear_wallet; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_crear_wallet AFTER INSERT ON public.perfiles_prestador FOR EACH ROW EXECUTE FUNCTION public.crear_wallet_prestador();


--
-- Name: bookings trg_detect_circumvention; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_detect_circumvention AFTER UPDATE OF estado ON public.bookings FOR EACH ROW EXECUTE FUNCTION public.detect_circumvention_on_cancellation();


--
-- Name: disputas trg_disputa_sla; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_disputa_sla BEFORE INSERT ON public.disputas FOR EACH ROW EXECUTE FUNCTION public.set_disputa_sla();


--
-- Name: disputas trg_disputa_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_disputa_updated_at BEFORE UPDATE ON public.disputas FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: precios_producto trg_precio_tenant; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_precio_tenant BEFORE INSERT OR UPDATE ON public.precios_producto FOR EACH ROW EXECUTE FUNCTION public.app_precio_tenant_id();


--
-- Name: kyc_audit_logs trg_prevent_kyc_audit_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_prevent_kyc_audit_delete BEFORE DELETE ON public.kyc_audit_logs FOR EACH ROW EXECUTE FUNCTION public.prevent_kyc_audit_modification();


--
-- Name: kyc_audit_logs trg_prevent_kyc_audit_update; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_prevent_kyc_audit_update BEFORE UPDATE ON public.kyc_audit_logs FOR EACH ROW EXECUTE FUNCTION public.prevent_kyc_audit_modification();


--
-- Name: provider_loyalty trg_sync_provider_elite_flag; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_sync_provider_elite_flag AFTER INSERT OR UPDATE OF tier ON public.provider_loyalty FOR EACH ROW EXECUTE FUNCTION public.sync_provider_elite_flag();


--
-- Name: wallet_ledger_events trg_wallet_ledger_events_append_only; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_wallet_ledger_events_append_only BEFORE DELETE OR UPDATE ON public.wallet_ledger_events FOR EACH ROW EXECUTE FUNCTION public.enforce_append_only();


--
-- Name: wallet_ledger_events trg_wallet_ledger_events_no_truncate; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_wallet_ledger_events_no_truncate BEFORE TRUNCATE ON public.wallet_ledger_events FOR EACH STATEMENT EXECUTE FUNCTION public.enforce_append_only();


--
-- Name: wallet_transactions trg_wallet_transactions_append_only; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_wallet_transactions_append_only BEFORE DELETE OR UPDATE ON public.wallet_transactions FOR EACH ROW EXECUTE FUNCTION public.enforce_append_only();


--
-- Name: wallet_transactions trg_wallet_transactions_no_truncate; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_wallet_transactions_no_truncate BEFORE TRUNCATE ON public.wallet_transactions FOR EACH STATEMENT EXECUTE FUNCTION public.enforce_append_only();


--
-- Name: provider_wallet trg_wallet_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_wallet_updated_at BEFORE UPDATE ON public.provider_wallet FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: envios trigger_envios_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trigger_envios_updated_at BEFORE UPDATE ON public.envios FOR EACH ROW EXECUTE FUNCTION public.update_envios_updated_at();


--
-- Name: biometric_consents trigger_update_consent_timestamp; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trigger_update_consent_timestamp BEFORE UPDATE ON public.biometric_consents FOR EACH ROW EXECUTE FUNCTION public.update_consent_timestamp();


--
-- Name: user_delivery_addresses trigger_update_user_delivery_addresses_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trigger_update_user_delivery_addresses_updated_at BEFORE UPDATE ON public.user_delivery_addresses FOR EACH ROW EXECUTE FUNCTION public.update_user_delivery_addresses_updated_at();


--
-- Name: user_preferences trigger_update_user_preferences_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trigger_update_user_preferences_updated_at BEFORE UPDATE ON public.user_preferences FOR EACH ROW EXECUTE FUNCTION public.update_user_preferences_updated_at();


--
-- Name: academy_ai_discrepancy_log academy_ai_discrepancy_log_leccion_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.academy_ai_discrepancy_log
    ADD CONSTRAINT academy_ai_discrepancy_log_leccion_id_fkey FOREIGN KEY (leccion_id) REFERENCES public.academy_lessons(id) ON DELETE CASCADE;


--
-- Name: academy_ai_discrepancy_log academy_ai_discrepancy_log_provider_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.academy_ai_discrepancy_log
    ADD CONSTRAINT academy_ai_discrepancy_log_provider_id_fkey FOREIGN KEY (provider_id) REFERENCES public.usuarios(id) ON DELETE CASCADE;


--
-- Name: academy_certificates academy_certificates_course_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.academy_certificates
    ADD CONSTRAINT academy_certificates_course_id_fkey FOREIGN KEY (course_id) REFERENCES public.academy_courses(id) ON DELETE CASCADE;


--
-- Name: academy_certificates academy_certificates_provider_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.academy_certificates
    ADD CONSTRAINT academy_certificates_provider_id_fkey FOREIGN KEY (provider_id) REFERENCES public.usuarios(id) ON DELETE CASCADE;


--
-- Name: academy_consentimientos academy_consentimientos_provider_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.academy_consentimientos
    ADD CONSTRAINT academy_consentimientos_provider_id_fkey FOREIGN KEY (provider_id) REFERENCES public.usuarios(id) ON DELETE CASCADE;


--
-- Name: academy_lessons academy_lessons_module_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.academy_lessons
    ADD CONSTRAINT academy_lessons_module_id_fkey FOREIGN KEY (module_id) REFERENCES public.academy_modules(id) ON DELETE CASCADE;


--
-- Name: academy_modules academy_modules_course_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.academy_modules
    ADD CONSTRAINT academy_modules_course_id_fkey FOREIGN KEY (course_id) REFERENCES public.academy_courses(id) ON DELETE CASCADE;


--
-- Name: academy_progress academy_progress_lesson_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.academy_progress
    ADD CONSTRAINT academy_progress_lesson_id_fkey FOREIGN KEY (lesson_id) REFERENCES public.academy_lessons(id) ON DELETE CASCADE;


--
-- Name: academy_progress academy_progress_provider_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.academy_progress
    ADD CONSTRAINT academy_progress_provider_id_fkey FOREIGN KEY (provider_id) REFERENCES public.usuarios(id) ON DELETE CASCADE;


--
-- Name: academy_quiz_attempts academy_quiz_attempts_course_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.academy_quiz_attempts
    ADD CONSTRAINT academy_quiz_attempts_course_id_fkey FOREIGN KEY (course_id) REFERENCES public.academy_courses(id) ON DELETE CASCADE;


--
-- Name: academy_quiz_attempts academy_quiz_attempts_provider_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.academy_quiz_attempts
    ADD CONSTRAINT academy_quiz_attempts_provider_id_fkey FOREIGN KEY (provider_id) REFERENCES public.usuarios(id) ON DELETE CASCADE;


--
-- Name: academy_quizzes academy_quizzes_course_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.academy_quizzes
    ADD CONSTRAINT academy_quizzes_course_id_fkey FOREIGN KEY (course_id) REFERENCES public.academy_courses(id) ON DELETE CASCADE;


--
-- Name: academy_worksheet_submissions academy_worksheet_submissions_consentimiento_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.academy_worksheet_submissions
    ADD CONSTRAINT academy_worksheet_submissions_consentimiento_id_fkey FOREIGN KEY (consentimiento_id) REFERENCES public.academy_consentimientos(id);


--
-- Name: academy_worksheet_submissions academy_worksheet_submissions_lesson_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.academy_worksheet_submissions
    ADD CONSTRAINT academy_worksheet_submissions_lesson_id_fkey FOREIGN KEY (lesson_id) REFERENCES public.academy_lessons(id) ON DELETE CASCADE;


--
-- Name: academy_worksheet_submissions academy_worksheet_submissions_provider_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.academy_worksheet_submissions
    ADD CONSTRAINT academy_worksheet_submissions_provider_id_fkey FOREIGN KEY (provider_id) REFERENCES public.usuarios(id) ON DELETE CASCADE;


--
-- Name: admin_actions admin_actions_admin_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_actions
    ADD CONSTRAINT admin_actions_admin_id_fkey FOREIGN KEY (admin_id) REFERENCES public.usuarios(id) ON DELETE SET NULL;


--
-- Name: admin_mfa admin_mfa_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_mfa
    ADD CONSTRAINT admin_mfa_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: admin_mfa admin_mfa_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_mfa
    ADD CONSTRAINT admin_mfa_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.usuarios(id) ON DELETE CASCADE;


--
-- Name: ai_diagnostics ai_diagnostics_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_diagnostics
    ADD CONSTRAINT ai_diagnostics_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.usuarios(id) ON DELETE CASCADE;


--
-- Name: audit_log audit_log_actor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_log
    ADD CONSTRAINT audit_log_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.usuarios(id) ON DELETE SET NULL;


--
-- Name: auditoria_consentimiento_biometrico auditoria_consentimiento_biometrico_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auditoria_consentimiento_biometrico
    ADD CONSTRAINT auditoria_consentimiento_biometrico_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.usuarios(id) ON DELETE CASCADE;


--
-- Name: beauty_profiles beauty_profiles_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.beauty_profiles
    ADD CONSTRAINT beauty_profiles_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.usuarios(id) ON DELETE CASCADE;


--
-- Name: biometric_access_log biometric_access_log_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.biometric_access_log
    ADD CONSTRAINT biometric_access_log_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.usuarios(id) ON DELETE CASCADE;


--
-- Name: biometric_consents biometric_consents_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.biometric_consents
    ADD CONSTRAINT biometric_consents_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.usuarios(id) ON DELETE CASCADE;


--
-- Name: biometric_history biometric_history_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.biometric_history
    ADD CONSTRAINT biometric_history_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.usuarios(id) ON DELETE CASCADE;


--
-- Name: booking_productos booking_productos_booking_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.booking_productos
    ADD CONSTRAINT booking_productos_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES public.bookings(id) ON DELETE CASCADE;


--
-- Name: booking_productos booking_productos_producto_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.booking_productos
    ADD CONSTRAINT booking_productos_producto_id_fkey FOREIGN KEY (producto_id) REFERENCES public.productos(id) ON DELETE RESTRICT;


--
-- Name: booking_productos booking_productos_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.booking_productos
    ADD CONSTRAINT booking_productos_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: bookings bookings_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bookings
    ADD CONSTRAINT bookings_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.usuarios(id) ON DELETE RESTRICT;


--
-- Name: bookings bookings_provider_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bookings
    ADD CONSTRAINT bookings_provider_id_fkey FOREIGN KEY (provider_id) REFERENCES public.perfiles_prestador(id) ON DELETE RESTRICT;


--
-- Name: bookings bookings_service_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bookings
    ADD CONSTRAINT bookings_service_id_fkey FOREIGN KEY (service_id) REFERENCES public.services(id) ON DELETE RESTRICT;


--
-- Name: business_documents business_documents_business_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.business_documents
    ADD CONSTRAINT business_documents_business_profile_id_fkey FOREIGN KEY (business_profile_id) REFERENCES public.business_profiles(id) ON DELETE SET NULL;


--
-- Name: business_documents business_documents_provider_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.business_documents
    ADD CONSTRAINT business_documents_provider_id_fkey FOREIGN KEY (provider_id) REFERENCES public.usuarios(id) ON DELETE SET NULL;


--
-- Name: business_evidences business_evidences_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.business_evidences
    ADD CONSTRAINT business_evidences_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.business_tasks(id) ON DELETE CASCADE;


--
-- Name: business_findings business_findings_business_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.business_findings
    ADD CONSTRAINT business_findings_business_profile_id_fkey FOREIGN KEY (business_profile_id) REFERENCES public.business_profiles(id) ON DELETE CASCADE;


--
-- Name: business_profiles business_profiles_provider_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.business_profiles
    ADD CONSTRAINT business_profiles_provider_id_fkey FOREIGN KEY (provider_id) REFERENCES public.usuarios(id) ON DELETE CASCADE;


--
-- Name: business_profiles business_profiles_vertical_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.business_profiles
    ADD CONSTRAINT business_profiles_vertical_id_fkey FOREIGN KEY (vertical_id) REFERENCES public.business_verticals(id);


--
-- Name: business_requirements business_requirements_vertical_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.business_requirements
    ADD CONSTRAINT business_requirements_vertical_id_fkey FOREIGN KEY (vertical_id) REFERENCES public.business_verticals(id);


--
-- Name: business_tasks business_tasks_business_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.business_tasks
    ADD CONSTRAINT business_tasks_business_profile_id_fkey FOREIGN KEY (business_profile_id) REFERENCES public.business_profiles(id) ON DELETE CASCADE;


--
-- Name: business_tasks business_tasks_requirement_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.business_tasks
    ADD CONSTRAINT business_tasks_requirement_id_fkey FOREIGN KEY (requirement_id) REFERENCES public.business_requirements(id);


--
-- Name: community_comments community_comments_post_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.community_comments
    ADD CONSTRAINT community_comments_post_id_fkey FOREIGN KEY (post_id) REFERENCES public.community_posts(id);


--
-- Name: creditos_movimientos creditos_movimientos_booking_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.creditos_movimientos
    ADD CONSTRAINT creditos_movimientos_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES public.bookings(id) ON DELETE SET NULL;


--
-- Name: creditos_movimientos creditos_movimientos_credito_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.creditos_movimientos
    ADD CONSTRAINT creditos_movimientos_credito_id_fkey FOREIGN KEY (credito_id) REFERENCES public.creditos(id) ON DELETE RESTRICT;


--
-- Name: creditos_movimientos creditos_movimientos_usuario_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.creditos_movimientos
    ADD CONSTRAINT creditos_movimientos_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES public.usuarios(id) ON DELETE RESTRICT;


--
-- Name: creditos creditos_usuario_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.creditos
    ADD CONSTRAINT creditos_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES public.usuarios(id) ON DELETE RESTRICT;


--
-- Name: detalles_pedido_tienda detalles_pedido_tienda_pedido_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.detalles_pedido_tienda
    ADD CONSTRAINT detalles_pedido_tienda_pedido_id_fkey FOREIGN KEY (pedido_id) REFERENCES public.pedidos_tienda(id) ON DELETE CASCADE;


--
-- Name: detalles_pedido_tienda detalles_pedido_tienda_producto_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.detalles_pedido_tienda
    ADD CONSTRAINT detalles_pedido_tienda_producto_id_fkey FOREIGN KEY (producto_id) REFERENCES public.productos(id) ON DELETE RESTRICT;


--
-- Name: detalles_pedido_tienda detalles_pedido_tienda_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.detalles_pedido_tienda
    ADD CONSTRAINT detalles_pedido_tienda_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: disputas disputas_booking_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.disputas
    ADD CONSTRAINT disputas_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES public.bookings(id) ON DELETE RESTRICT;


--
-- Name: disputas disputas_iniciado_por_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.disputas
    ADD CONSTRAINT disputas_iniciado_por_fkey FOREIGN KEY (iniciado_por) REFERENCES public.usuarios(id) ON DELETE RESTRICT;


--
-- Name: disputas disputas_resuelto_por_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.disputas
    ADD CONSTRAINT disputas_resuelto_por_fkey FOREIGN KEY (resuelto_por) REFERENCES public.usuarios(id) ON DELETE SET NULL;


--
-- Name: disputas disputas_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.disputas
    ADD CONSTRAINT disputas_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: document_audit_logs document_audit_logs_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_audit_logs
    ADD CONSTRAINT document_audit_logs_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.business_documents(id) ON DELETE CASCADE;


--
-- Name: envios envios_pedido_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.envios
    ADD CONSTRAINT envios_pedido_id_fkey FOREIGN KEY (pedido_id) REFERENCES public.pedidos_tienda(id) ON DELETE CASCADE;


--
-- Name: event_registrations event_registrations_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_registrations
    ADD CONSTRAINT event_registrations_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.events(id);


--
-- Name: learning_paths fk_learning_paths_badge_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.learning_paths
    ADD CONSTRAINT fk_learning_paths_badge_id FOREIGN KEY (badge_id) REFERENCES public.badges(id);


--
-- Name: precios_historial fk_precios_historial_lista; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.precios_historial
    ADD CONSTRAINT fk_precios_historial_lista FOREIGN KEY (lista_id) REFERENCES public.listas_precios(id) ON DELETE RESTRICT;


--
-- Name: precios_historial fk_precios_historial_producto; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.precios_historial
    ADD CONSTRAINT fk_precios_historial_producto FOREIGN KEY (producto_id) REFERENCES public.productos(id) ON DELETE RESTRICT;


--
-- Name: qr_certificates fk_qr_certificates_certificate_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.qr_certificates
    ADD CONSTRAINT fk_qr_certificates_certificate_id FOREIGN KEY (certificate_id) REFERENCES public.academy_certificates(id);


--
-- Name: user_levels fk_user_levels_badge_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_levels
    ADD CONSTRAINT fk_user_levels_badge_id FOREIGN KEY (badge_id) REFERENCES public.badges(id);


--
-- Name: usuarios fk_usuarios_responsabilidad_cambiada_por; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.usuarios
    ADD CONSTRAINT fk_usuarios_responsabilidad_cambiada_por FOREIGN KEY (responsabilidad_iva_cambiada_por) REFERENCES public.usuarios(id) ON DELETE SET NULL;


--
-- Name: fraud_flags fraud_flags_booking_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fraud_flags
    ADD CONSTRAINT fraud_flags_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES public.bookings(id) ON DELETE CASCADE;


--
-- Name: fraud_flags fraud_flags_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fraud_flags
    ADD CONSTRAINT fraud_flags_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.usuarios(id) ON DELETE CASCADE;


--
-- Name: fraud_flags fraud_flags_provider_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fraud_flags
    ADD CONSTRAINT fraud_flags_provider_id_fkey FOREIGN KEY (provider_id) REFERENCES public.perfiles_prestador(id) ON DELETE CASCADE;


--
-- Name: glow_cycle_measurements glow_cycle_measurements_cycle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.glow_cycle_measurements
    ADD CONSTRAINT glow_cycle_measurements_cycle_id_fkey FOREIGN KEY (cycle_id) REFERENCES public.glow_cycles(id) ON DELETE CASCADE;


--
-- Name: glow_cycle_measurements glow_cycle_measurements_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.glow_cycle_measurements
    ADD CONSTRAINT glow_cycle_measurements_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.usuarios(id) ON DELETE CASCADE;


--
-- Name: glow_cycles glow_cycles_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.glow_cycles
    ADD CONSTRAINT glow_cycles_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.usuarios(id) ON DELETE CASCADE;


--
-- Name: guardarropa_outfits guardarropa_outfits_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.guardarropa_outfits
    ADD CONSTRAINT guardarropa_outfits_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.usuarios(id) ON DELETE CASCADE;


--
-- Name: guardarropa_prendas guardarropa_prendas_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.guardarropa_prendas
    ADD CONSTRAINT guardarropa_prendas_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.usuarios(id) ON DELETE CASCADE;


--
-- Name: inventario_consignacion_prestador inventario_consignacion_prestador_producto_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventario_consignacion_prestador
    ADD CONSTRAINT inventario_consignacion_prestador_producto_id_fkey FOREIGN KEY (producto_id) REFERENCES public.productos(id) ON DELETE RESTRICT;


--
-- Name: inventario_consignacion_prestador inventario_consignacion_prestador_provider_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventario_consignacion_prestador
    ADD CONSTRAINT inventario_consignacion_prestador_provider_id_fkey FOREIGN KEY (provider_id) REFERENCES public.perfiles_prestador(id) ON DELETE CASCADE;


--
-- Name: inventario_consignacion_prestador inventario_consignacion_prestador_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventario_consignacion_prestador
    ADD CONSTRAINT inventario_consignacion_prestador_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: legal_holds legal_holds_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.legal_holds
    ADD CONSTRAINT legal_holds_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: listas_precios listas_precios_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.listas_precios
    ADD CONSTRAINT listas_precios_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: memberships memberships_business_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.memberships
    ADD CONSTRAINT memberships_business_profile_id_fkey FOREIGN KEY (business_profile_id) REFERENCES public.business_profiles(id) ON DELETE CASCADE;


--
-- Name: memberships memberships_created_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.memberships
    ADD CONSTRAINT memberships_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES public.usuarios(id) ON DELETE SET NULL;


--
-- Name: memberships memberships_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.memberships
    ADD CONSTRAINT memberships_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.usuarios(id) ON DELETE CASCADE;


--
-- Name: messages messages_receiver_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_receiver_id_fkey FOREIGN KEY (receiver_id) REFERENCES public.usuarios(id) ON DELETE CASCADE;


--
-- Name: messages messages_sender_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_sender_id_fkey FOREIGN KEY (sender_id) REFERENCES public.usuarios(id) ON DELETE CASCADE;


--
-- Name: nail_tryon_jobs nail_tryon_jobs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nail_tryon_jobs
    ADD CONSTRAINT nail_tryon_jobs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.usuarios(id) ON DELETE CASCADE;


--
-- Name: otp_validaciones otp_validaciones_booking_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.otp_validaciones
    ADD CONSTRAINT otp_validaciones_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES public.bookings(id) ON DELETE CASCADE;


--
-- Name: path_courses path_courses_course_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.path_courses
    ADD CONSTRAINT path_courses_course_id_fkey FOREIGN KEY (course_id) REFERENCES public.academy_courses(id);


--
-- Name: path_courses path_courses_path_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.path_courses
    ADD CONSTRAINT path_courses_path_id_fkey FOREIGN KEY (path_id) REFERENCES public.learning_paths(id);


--
-- Name: path_courses path_courses_prerequisite_course_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.path_courses
    ADD CONSTRAINT path_courses_prerequisite_course_id_fkey FOREIGN KEY (prerequisite_course_id) REFERENCES public.academy_courses(id);


--
-- Name: pedidos_tienda pedidos_tienda_booking_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pedidos_tienda
    ADD CONSTRAINT pedidos_tienda_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES public.bookings(id) ON DELETE SET NULL;


--
-- Name: pedidos_tienda pedidos_tienda_comprador_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pedidos_tienda
    ADD CONSTRAINT pedidos_tienda_comprador_id_fkey FOREIGN KEY (comprador_id) REFERENCES public.usuarios(id) ON DELETE RESTRICT;


--
-- Name: pedidos_tienda pedidos_tienda_direccion_entrega_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pedidos_tienda
    ADD CONSTRAINT pedidos_tienda_direccion_entrega_id_fkey FOREIGN KEY (direccion_entrega_id) REFERENCES public.user_delivery_addresses(id) ON DELETE SET NULL;


--
-- Name: pedidos_tienda pedidos_tienda_prestador_comisionado_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pedidos_tienda
    ADD CONSTRAINT pedidos_tienda_prestador_comisionado_id_fkey FOREIGN KEY (prestador_comisionado_id) REFERENCES public.usuarios(id) ON DELETE SET NULL;


--
-- Name: pedidos_tienda pedidos_tienda_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pedidos_tienda
    ADD CONSTRAINT pedidos_tienda_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: perfiles_prestador perfiles_prestador_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.perfiles_prestador
    ADD CONSTRAINT perfiles_prestador_id_fkey FOREIGN KEY (id) REFERENCES public.usuarios(id) ON DELETE CASCADE;


--
-- Name: platform_config platform_config_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platform_config
    ADD CONSTRAINT platform_config_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: platform_config platform_config_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platform_config
    ADD CONSTRAINT platform_config_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.usuarios(id) ON DELETE SET NULL;


--
-- Name: portfolio_items portfolio_items_provider_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portfolio_items
    ADD CONSTRAINT portfolio_items_provider_id_fkey FOREIGN KEY (provider_id) REFERENCES public.perfiles_prestador(id) ON DELETE CASCADE;


--
-- Name: precios_historial precios_historial_actor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.precios_historial
    ADD CONSTRAINT precios_historial_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.usuarios(id) ON DELETE SET NULL;


--
-- Name: precios_historial precios_historial_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.precios_historial
    ADD CONSTRAINT precios_historial_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: precios_producto precios_producto_lista_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.precios_producto
    ADD CONSTRAINT precios_producto_lista_id_fkey FOREIGN KEY (lista_id) REFERENCES public.listas_precios(id) ON DELETE CASCADE;


--
-- Name: precios_producto precios_producto_producto_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.precios_producto
    ADD CONSTRAINT precios_producto_producto_id_fkey FOREIGN KEY (producto_id) REFERENCES public.productos(id) ON DELETE CASCADE;


--
-- Name: precios_producto precios_producto_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.precios_producto
    ADD CONSTRAINT precios_producto_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: productos productos_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.productos
    ADD CONSTRAINT productos_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: propinas propinas_booking_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.propinas
    ADD CONSTRAINT propinas_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES public.bookings(id) ON DELETE RESTRICT;


--
-- Name: propinas propinas_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.propinas
    ADD CONSTRAINT propinas_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.usuarios(id) ON DELETE RESTRICT;


--
-- Name: propinas propinas_provider_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.propinas
    ADD CONSTRAINT propinas_provider_id_fkey FOREIGN KEY (provider_id) REFERENCES public.usuarios(id) ON DELETE RESTRICT;


--
-- Name: provider_loyalty provider_loyalty_provider_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.provider_loyalty
    ADD CONSTRAINT provider_loyalty_provider_id_fkey FOREIGN KEY (provider_id) REFERENCES public.perfiles_prestador(id) ON DELETE CASCADE;


--
-- Name: provider_wallet provider_wallet_provider_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.provider_wallet
    ADD CONSTRAINT provider_wallet_provider_id_fkey FOREIGN KEY (provider_id) REFERENCES public.usuarios(id) ON DELETE CASCADE;


--
-- Name: provider_wallet provider_wallet_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.provider_wallet
    ADD CONSTRAINT provider_wallet_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: reembolsos reembolsos_booking_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reembolsos
    ADD CONSTRAINT reembolsos_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES public.bookings(id) ON DELETE RESTRICT;


--
-- Name: reembolsos reembolsos_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reembolsos
    ADD CONSTRAINT reembolsos_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.usuarios(id) ON DELETE RESTRICT;


--
-- Name: referidos referidos_referidor_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.referidos
    ADD CONSTRAINT referidos_referidor_user_id_fkey FOREIGN KEY (referidor_user_id) REFERENCES public.usuarios(id) ON DELETE CASCADE;


--
-- Name: retention_policies retention_policies_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.retention_policies
    ADD CONSTRAINT retention_policies_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: retiros retiros_provider_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.retiros
    ADD CONSTRAINT retiros_provider_id_fkey FOREIGN KEY (provider_id) REFERENCES public.usuarios(id) ON DELETE RESTRICT;


--
-- Name: retiros retiros_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.retiros
    ADD CONSTRAINT retiros_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: retiros retiros_wallet_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.retiros
    ADD CONSTRAINT retiros_wallet_id_fkey FOREIGN KEY (wallet_id) REFERENCES public.provider_wallet(id) ON DELETE RESTRICT;


--
-- Name: reviews reviews_booking_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reviews
    ADD CONSTRAINT reviews_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES public.bookings(id) ON DELETE CASCADE;


--
-- Name: reviews reviews_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reviews
    ADD CONSTRAINT reviews_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.usuarios(id) ON DELETE RESTRICT;


--
-- Name: reviews reviews_provider_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reviews
    ADD CONSTRAINT reviews_provider_id_fkey FOREIGN KEY (provider_id) REFERENCES public.perfiles_prestador(id) ON DELETE RESTRICT;


--
-- Name: salon_invitaciones salon_invitaciones_creado_por_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.salon_invitaciones
    ADD CONSTRAINT salon_invitaciones_creado_por_fkey FOREIGN KEY (creado_por) REFERENCES public.usuarios(id) ON DELETE SET NULL;


--
-- Name: salon_invitaciones salon_invitaciones_salon_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.salon_invitaciones
    ADD CONSTRAINT salon_invitaciones_salon_id_fkey FOREIGN KEY (salon_id) REFERENCES public.salones(id) ON DELETE CASCADE;


--
-- Name: salon_invitaciones salon_invitaciones_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.salon_invitaciones
    ADD CONSTRAINT salon_invitaciones_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE SET NULL;


--
-- Name: salon_miembros salon_miembros_salon_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.salon_miembros
    ADD CONSTRAINT salon_miembros_salon_id_fkey FOREIGN KEY (salon_id) REFERENCES public.salones(id) ON DELETE CASCADE;


--
-- Name: salon_miembros salon_miembros_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.salon_miembros
    ADD CONSTRAINT salon_miembros_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE SET NULL;


--
-- Name: salon_miembros salon_miembros_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.salon_miembros
    ADD CONSTRAINT salon_miembros_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.usuarios(id) ON DELETE CASCADE;


--
-- Name: salones salones_id_dueno_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.salones
    ADD CONSTRAINT salones_id_dueno_fkey FOREIGN KEY (id_dueno) REFERENCES public.usuarios(id) ON DELETE CASCADE;


--
-- Name: salones salones_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.salones
    ADD CONSTRAINT salones_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE SET NULL;


--
-- Name: scan_product_matches scan_product_matches_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scan_product_matches
    ADD CONSTRAINT scan_product_matches_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: services services_provider_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.services
    ADD CONSTRAINT services_provider_id_fkey FOREIGN KEY (provider_id) REFERENCES public.perfiles_prestador(id) ON DELETE CASCADE;


--
-- Name: services services_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.services
    ADD CONSTRAINT services_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: skin_profiles skin_profiles_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.skin_profiles
    ADD CONSTRAINT skin_profiles_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.usuarios(id) ON DELETE CASCADE;


--
-- Name: social_shares_log social_shares_log_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.social_shares_log
    ADD CONSTRAINT social_shares_log_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.usuarios(id) ON DELETE CASCADE;


--
-- Name: sos_alerts sos_alerts_booking_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sos_alerts
    ADD CONSTRAINT sos_alerts_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES public.bookings(id) ON DELETE SET NULL;


--
-- Name: sos_alerts sos_alerts_resuelto_por_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sos_alerts
    ADD CONSTRAINT sos_alerts_resuelto_por_fkey FOREIGN KEY (resuelto_por) REFERENCES public.usuarios(id) ON DELETE SET NULL;


--
-- Name: sos_alerts sos_alerts_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sos_alerts
    ADD CONSTRAINT sos_alerts_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.usuarios(id) ON DELETE CASCADE;


--
-- Name: ticket_mensajes ticket_mensajes_remitente_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ticket_mensajes
    ADD CONSTRAINT ticket_mensajes_remitente_id_fkey FOREIGN KEY (remitente_id) REFERENCES public.usuarios(id) ON DELETE CASCADE;


--
-- Name: ticket_mensajes ticket_mensajes_ticket_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ticket_mensajes
    ADD CONSTRAINT ticket_mensajes_ticket_id_fkey FOREIGN KEY (ticket_id) REFERENCES public.tickets(id) ON DELETE CASCADE;


--
-- Name: tickets tickets_booking_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tickets
    ADD CONSTRAINT tickets_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES public.bookings(id) ON DELETE SET NULL;


--
-- Name: tickets tickets_usuario_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tickets
    ADD CONSTRAINT tickets_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES public.usuarios(id) ON DELETE CASCADE;


--
-- Name: transactions transactions_booking_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES public.bookings(id) ON DELETE CASCADE;


--
-- Name: user_activity_logs user_activity_logs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_activity_logs
    ADD CONSTRAINT user_activity_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.usuarios(id) ON DELETE SET NULL;


--
-- Name: user_delivery_addresses user_delivery_addresses_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_delivery_addresses
    ADD CONSTRAINT user_delivery_addresses_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.usuarios(id) ON DELETE CASCADE;


--
-- Name: user_loyalty_ledger user_loyalty_ledger_booking_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_loyalty_ledger
    ADD CONSTRAINT user_loyalty_ledger_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES public.bookings(id) ON DELETE SET NULL;


--
-- Name: user_loyalty_ledger user_loyalty_ledger_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_loyalty_ledger
    ADD CONSTRAINT user_loyalty_ledger_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.usuarios(id) ON DELETE CASCADE;


--
-- Name: user_loyalty user_loyalty_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_loyalty
    ADD CONSTRAINT user_loyalty_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.usuarios(id) ON DELETE CASCADE;


--
-- Name: user_photos user_photos_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_photos
    ADD CONSTRAINT user_photos_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.usuarios(id) ON DELETE CASCADE;


--
-- Name: user_preferences user_preferences_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_preferences
    ADD CONSTRAINT user_preferences_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.usuarios(id) ON DELETE CASCADE;


--
-- Name: user_social_accounts user_social_accounts_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_social_accounts
    ADD CONSTRAINT user_social_accounts_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.usuarios(id) ON DELETE CASCADE;


--
-- Name: validaciones_medicas validaciones_medicas_ai_diagnostic_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.validaciones_medicas
    ADD CONSTRAINT validaciones_medicas_ai_diagnostic_id_fkey FOREIGN KEY (ai_diagnostic_id) REFERENCES public.ai_diagnostics(id) ON DELETE SET NULL;


--
-- Name: validaciones_medicas validaciones_medicas_profesional_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.validaciones_medicas
    ADD CONSTRAINT validaciones_medicas_profesional_id_fkey FOREIGN KEY (profesional_id) REFERENCES public.profesionales_medicos(id) ON DELETE CASCADE;


--
-- Name: validaciones_medicas validaciones_medicas_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.validaciones_medicas
    ADD CONSTRAINT validaciones_medicas_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.usuarios(id) ON DELETE CASCADE;


--
-- Name: wallet_ledger_events wallet_ledger_events_provider_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wallet_ledger_events
    ADD CONSTRAINT wallet_ledger_events_provider_id_fkey FOREIGN KEY (provider_id) REFERENCES public.usuarios(id) ON DELETE RESTRICT;


--
-- Name: wallet_ledger_events wallet_ledger_events_tx_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wallet_ledger_events
    ADD CONSTRAINT wallet_ledger_events_tx_id_fkey FOREIGN KEY (tx_id) REFERENCES public.wallet_transactions(id) ON DELETE RESTRICT;


--
-- Name: wallet_transactions wallet_transactions_booking_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wallet_transactions
    ADD CONSTRAINT wallet_transactions_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES public.bookings(id) ON DELETE SET NULL;


--
-- Name: wallet_transactions wallet_transactions_provider_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wallet_transactions
    ADD CONSTRAINT wallet_transactions_provider_id_fkey FOREIGN KEY (provider_id) REFERENCES public.usuarios(id) ON DELETE RESTRICT;


--
-- Name: wallet_transactions wallet_transactions_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wallet_transactions
    ADD CONSTRAINT wallet_transactions_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: admin_mfa; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.admin_mfa ENABLE ROW LEVEL SECURITY;

--
-- Name: booking_productos; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.booking_productos ENABLE ROW LEVEL SECURITY;

--
-- Name: bookings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;

--
-- Name: business_documents; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.business_documents ENABLE ROW LEVEL SECURITY;

--
-- Name: business_evidences; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.business_evidences ENABLE ROW LEVEL SECURITY;

--
-- Name: business_findings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.business_findings ENABLE ROW LEVEL SECURITY;

--
-- Name: business_profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.business_profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: business_tasks; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.business_tasks ENABLE ROW LEVEL SECURITY;

--
-- Name: detalles_pedido_tienda; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.detalles_pedido_tienda ENABLE ROW LEVEL SECURITY;

--
-- Name: disputas; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.disputas ENABLE ROW LEVEL SECURITY;

--
-- Name: document_audit_logs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.document_audit_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: inventario_consignacion_prestador; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.inventario_consignacion_prestador ENABLE ROW LEVEL SECURITY;

--
-- Name: listas_precios; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.listas_precios ENABLE ROW LEVEL SECURITY;

--
-- Name: messages; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

--
-- Name: nail_tryon_jobs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.nail_tryon_jobs ENABLE ROW LEVEL SECURITY;

--
-- Name: pedidos_tienda; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.pedidos_tienda ENABLE ROW LEVEL SECURITY;

--
-- Name: perfiles_prestador; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.perfiles_prestador ENABLE ROW LEVEL SECURITY;

--
-- Name: platform_config; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.platform_config ENABLE ROW LEVEL SECURITY;

--
-- Name: portfolio_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.portfolio_items ENABLE ROW LEVEL SECURITY;

--
-- Name: listas_precios precios_borrado; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY precios_borrado ON public.listas_precios FOR DELETE USING ((tenant_id = public.app_current_tenant_id()));


--
-- Name: precios_historial precios_borrado; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY precios_borrado ON public.precios_historial FOR DELETE USING ((tenant_id = public.app_current_tenant_id()));


--
-- Name: precios_producto precios_borrado; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY precios_borrado ON public.precios_producto FOR DELETE USING ((tenant_id = public.app_current_tenant_id()));


--
-- Name: listas_precios precios_edicion; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY precios_edicion ON public.listas_precios FOR UPDATE USING ((tenant_id = public.app_current_tenant_id())) WITH CHECK ((tenant_id = public.app_current_tenant_id()));


--
-- Name: precios_historial precios_edicion; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY precios_edicion ON public.precios_historial FOR UPDATE USING ((tenant_id = public.app_current_tenant_id())) WITH CHECK ((tenant_id = public.app_current_tenant_id()));


--
-- Name: precios_producto precios_edicion; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY precios_edicion ON public.precios_producto FOR UPDATE USING ((tenant_id = public.app_current_tenant_id())) WITH CHECK ((tenant_id = public.app_current_tenant_id()));


--
-- Name: listas_precios precios_escritura; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY precios_escritura ON public.listas_precios FOR INSERT WITH CHECK ((tenant_id = public.app_current_tenant_id()));


--
-- Name: precios_historial precios_escritura; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY precios_escritura ON public.precios_historial FOR INSERT WITH CHECK ((tenant_id = public.app_current_tenant_id()));


--
-- Name: precios_producto precios_escritura; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY precios_escritura ON public.precios_producto FOR INSERT WITH CHECK ((tenant_id = public.app_current_tenant_id()));


--
-- Name: precios_historial; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.precios_historial ENABLE ROW LEVEL SECURITY;

--
-- Name: listas_precios precios_lectura; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY precios_lectura ON public.listas_precios FOR SELECT USING (((tenant_id = public.app_current_tenant_id()) OR (tenant_id = public.app_platform_tenant_id())));


--
-- Name: precios_historial precios_lectura; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY precios_lectura ON public.precios_historial FOR SELECT USING (((tenant_id = public.app_current_tenant_id()) OR (tenant_id = public.app_platform_tenant_id())));


--
-- Name: precios_producto precios_lectura; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY precios_lectura ON public.precios_producto FOR SELECT USING (((tenant_id = public.app_current_tenant_id()) OR (tenant_id = public.app_platform_tenant_id())));


--
-- Name: precios_producto; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.precios_producto ENABLE ROW LEVEL SECURITY;

--
-- Name: productos; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.productos ENABLE ROW LEVEL SECURITY;

--
-- Name: productos productos_alta; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY productos_alta ON public.productos FOR INSERT WITH CHECK ((tenant_id = public.app_current_tenant_id()));


--
-- Name: productos productos_borrado; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY productos_borrado ON public.productos FOR DELETE USING ((tenant_id = public.app_current_tenant_id()));


--
-- Name: productos productos_edicion; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY productos_edicion ON public.productos FOR UPDATE USING ((tenant_id = public.app_current_tenant_id())) WITH CHECK ((tenant_id = public.app_current_tenant_id()));


--
-- Name: productos productos_lectura; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY productos_lectura ON public.productos FOR SELECT USING (((tenant_id = public.app_current_tenant_id()) OR (tenant_id = public.app_platform_tenant_id())));


--
-- Name: provider_wallet; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.provider_wallet ENABLE ROW LEVEL SECURITY;

--
-- Name: retiros; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.retiros ENABLE ROW LEVEL SECURITY;

--
-- Name: reviews; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;

--
-- Name: salon_invitaciones; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.salon_invitaciones ENABLE ROW LEVEL SECURITY;

--
-- Name: salon_miembros; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.salon_miembros ENABLE ROW LEVEL SECURITY;

--
-- Name: salones; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.salones ENABLE ROW LEVEL SECURITY;

--
-- Name: scan_product_matches; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.scan_product_matches ENABLE ROW LEVEL SECURITY;

--
-- Name: services; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.services ENABLE ROW LEVEL SECURITY;

--
-- Name: sos_alerts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.sos_alerts ENABLE ROW LEVEL SECURITY;

--
-- Name: booking_productos tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.booking_productos USING ((tenant_id = public.app_current_tenant_id())) WITH CHECK ((tenant_id = public.app_current_tenant_id()));


--
-- Name: bookings tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.bookings USING (((tenant_id IS NOT NULL) AND (tenant_id = public.app_current_tenant_id()))) WITH CHECK (((tenant_id IS NOT NULL) AND (tenant_id = public.app_current_tenant_id())));


--
-- Name: detalles_pedido_tienda tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.detalles_pedido_tienda USING ((tenant_id = public.app_current_tenant_id())) WITH CHECK ((tenant_id = public.app_current_tenant_id()));


--
-- Name: disputas tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.disputas USING (((tenant_id IS NOT NULL) AND (tenant_id = public.app_current_tenant_id()))) WITH CHECK (((tenant_id IS NOT NULL) AND (tenant_id = public.app_current_tenant_id())));


--
-- Name: inventario_consignacion_prestador tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.inventario_consignacion_prestador USING ((tenant_id = public.app_current_tenant_id())) WITH CHECK ((tenant_id = public.app_current_tenant_id()));


--
-- Name: messages tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.messages USING (((tenant_id IS NOT NULL) AND (tenant_id = public.app_current_tenant_id()))) WITH CHECK (((tenant_id IS NOT NULL) AND (tenant_id = public.app_current_tenant_id())));


--
-- Name: nail_tryon_jobs tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.nail_tryon_jobs USING (((tenant_id IS NOT NULL) AND (tenant_id = public.app_current_tenant_id()))) WITH CHECK (((tenant_id IS NOT NULL) AND (tenant_id = public.app_current_tenant_id())));


--
-- Name: pedidos_tienda tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.pedidos_tienda USING ((tenant_id = public.app_current_tenant_id())) WITH CHECK ((tenant_id = public.app_current_tenant_id()));


--
-- Name: perfiles_prestador tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.perfiles_prestador USING (((tenant_id IS NOT NULL) AND (tenant_id = public.app_current_tenant_id()))) WITH CHECK (((tenant_id IS NOT NULL) AND (tenant_id = public.app_current_tenant_id())));


--
-- Name: portfolio_items tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.portfolio_items USING (((tenant_id IS NOT NULL) AND (tenant_id = public.app_current_tenant_id()))) WITH CHECK (((tenant_id IS NOT NULL) AND (tenant_id = public.app_current_tenant_id())));


--
-- Name: provider_wallet tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.provider_wallet USING (((tenant_id IS NOT NULL) AND (tenant_id = public.app_current_tenant_id()))) WITH CHECK (((tenant_id IS NOT NULL) AND (tenant_id = public.app_current_tenant_id())));


--
-- Name: retiros tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.retiros USING (((tenant_id IS NOT NULL) AND (tenant_id = public.app_current_tenant_id()))) WITH CHECK (((tenant_id IS NOT NULL) AND (tenant_id = public.app_current_tenant_id())));


--
-- Name: reviews tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.reviews USING (((tenant_id IS NOT NULL) AND (tenant_id = public.app_current_tenant_id()))) WITH CHECK (((tenant_id IS NOT NULL) AND (tenant_id = public.app_current_tenant_id())));


--
-- Name: salon_invitaciones tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.salon_invitaciones USING (((tenant_id IS NOT NULL) AND (tenant_id = public.app_current_tenant_id()))) WITH CHECK (((tenant_id IS NOT NULL) AND (tenant_id = public.app_current_tenant_id())));


--
-- Name: salon_miembros tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.salon_miembros USING (((tenant_id IS NOT NULL) AND (tenant_id = public.app_current_tenant_id()))) WITH CHECK (((tenant_id IS NOT NULL) AND (tenant_id = public.app_current_tenant_id())));


--
-- Name: salones tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.salones USING (((tenant_id IS NOT NULL) AND (tenant_id = public.app_current_tenant_id()))) WITH CHECK (((tenant_id IS NOT NULL) AND (tenant_id = public.app_current_tenant_id())));


--
-- Name: scan_product_matches tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.scan_product_matches USING ((tenant_id = public.app_current_tenant_id())) WITH CHECK ((tenant_id = public.app_current_tenant_id()));


--
-- Name: services tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.services USING (((tenant_id IS NOT NULL) AND (tenant_id = public.app_current_tenant_id()))) WITH CHECK (((tenant_id IS NOT NULL) AND (tenant_id = public.app_current_tenant_id())));


--
-- Name: transactions tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.transactions USING (((tenant_id IS NOT NULL) AND (tenant_id = public.app_current_tenant_id()))) WITH CHECK (((tenant_id IS NOT NULL) AND (tenant_id = public.app_current_tenant_id())));


--
-- Name: wallet_transactions tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.wallet_transactions USING (((tenant_id IS NOT NULL) AND (tenant_id = public.app_current_tenant_id()))) WITH CHECK (((tenant_id IS NOT NULL) AND (tenant_id = public.app_current_tenant_id())));


--
-- Name: admin_mfa tenant_isolation_admin_mfa; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation_admin_mfa ON public.admin_mfa FOR SELECT USING ((tenant_id = public.app_current_tenant_id()));


--
-- Name: admin_mfa tenant_isolation_admin_mfa_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation_admin_mfa_delete ON public.admin_mfa FOR DELETE USING ((tenant_id = public.app_current_tenant_id()));


--
-- Name: admin_mfa tenant_isolation_admin_mfa_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation_admin_mfa_insert ON public.admin_mfa FOR INSERT WITH CHECK ((tenant_id = public.app_current_tenant_id()));


--
-- Name: admin_mfa tenant_isolation_admin_mfa_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation_admin_mfa_update ON public.admin_mfa FOR UPDATE USING ((tenant_id = public.app_current_tenant_id())) WITH CHECK ((tenant_id = public.app_current_tenant_id()));


--
-- Name: business_documents tenant_isolation_business_documents; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation_business_documents ON public.business_documents USING ((((tenant_id)::text = current_setting('app.tenant_id'::text, true)) OR (current_setting('app.tenant_id'::text, true) IS NULL)));


--
-- Name: business_evidences tenant_isolation_business_evidences; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation_business_evidences ON public.business_evidences USING ((((tenant_id)::text = current_setting('app.tenant_id'::text, true)) OR (current_setting('app.tenant_id'::text, true) IS NULL)));


--
-- Name: business_findings tenant_isolation_business_findings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation_business_findings ON public.business_findings USING ((((tenant_id)::text = current_setting('app.tenant_id'::text, true)) OR (current_setting('app.tenant_id'::text, true) IS NULL)));


--
-- Name: business_profiles tenant_isolation_business_profiles; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation_business_profiles ON public.business_profiles USING ((((tenant_id)::text = current_setting('app.tenant_id'::text, true)) OR (current_setting('app.tenant_id'::text, true) IS NULL)));


--
-- Name: business_tasks tenant_isolation_business_tasks; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation_business_tasks ON public.business_tasks USING ((((tenant_id)::text = current_setting('app.tenant_id'::text, true)) OR (current_setting('app.tenant_id'::text, true) IS NULL)));


--
-- Name: document_audit_logs tenant_isolation_document_audit_logs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation_document_audit_logs ON public.document_audit_logs USING ((((tenant_id)::text = current_setting('app.tenant_id'::text, true)) OR (current_setting('app.tenant_id'::text, true) IS NULL)));


--
-- Name: platform_config tenant_isolation_platform_config; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation_platform_config ON public.platform_config FOR SELECT USING ((tenant_id = public.app_current_tenant_id()));


--
-- Name: platform_config tenant_isolation_platform_config_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation_platform_config_delete ON public.platform_config FOR DELETE USING ((tenant_id = public.app_current_tenant_id()));


--
-- Name: platform_config tenant_isolation_platform_config_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation_platform_config_insert ON public.platform_config FOR INSERT WITH CHECK ((tenant_id = public.app_current_tenant_id()));


--
-- Name: platform_config tenant_isolation_platform_config_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation_platform_config_update ON public.platform_config FOR UPDATE USING ((tenant_id = public.app_current_tenant_id())) WITH CHECK ((tenant_id = public.app_current_tenant_id()));


--
-- Name: sos_alerts tenant_isolation_sos_alerts; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation_sos_alerts ON public.sos_alerts FOR SELECT USING ((tenant_id = public.app_current_tenant_id()));


--
-- Name: sos_alerts tenant_isolation_sos_alerts_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation_sos_alerts_delete ON public.sos_alerts FOR DELETE USING ((tenant_id = public.app_current_tenant_id()));


--
-- Name: sos_alerts tenant_isolation_sos_alerts_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation_sos_alerts_insert ON public.sos_alerts FOR INSERT WITH CHECK ((tenant_id = public.app_current_tenant_id()));


--
-- Name: sos_alerts tenant_isolation_sos_alerts_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation_sos_alerts_update ON public.sos_alerts FOR UPDATE USING ((tenant_id = public.app_current_tenant_id())) WITH CHECK ((tenant_id = public.app_current_tenant_id()));


--
-- Name: user_activity_logs tenant_isolation_user_activity_logs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation_user_activity_logs ON public.user_activity_logs FOR SELECT USING ((tenant_id = public.app_current_tenant_id()));


--
-- Name: user_activity_logs tenant_isolation_user_activity_logs_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation_user_activity_logs_delete ON public.user_activity_logs FOR DELETE USING ((tenant_id = public.app_current_tenant_id()));


--
-- Name: user_activity_logs tenant_isolation_user_activity_logs_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation_user_activity_logs_insert ON public.user_activity_logs FOR INSERT WITH CHECK ((tenant_id = public.app_current_tenant_id()));


--
-- Name: user_activity_logs tenant_isolation_user_activity_logs_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation_user_activity_logs_update ON public.user_activity_logs FOR UPDATE USING ((tenant_id = public.app_current_tenant_id())) WITH CHECK ((tenant_id = public.app_current_tenant_id()));


--
-- Name: transactions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;

--
-- Name: user_activity_logs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_activity_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: usuarios; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.usuarios ENABLE ROW LEVEL SECURITY;

--
-- Name: usuarios usuarios_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY usuarios_isolation ON public.usuarios USING (((id = public.app_current_user_id()) OR ((tenant_id IS NOT NULL) AND (tenant_id = public.app_current_tenant_id())))) WITH CHECK (((id = public.app_current_user_id()) OR ((tenant_id IS NOT NULL) AND (tenant_id = public.app_current_tenant_id())) OR (public.app_current_user_id() IS NULL)));


--
-- Name: wallet_transactions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.wallet_transactions ENABLE ROW LEVEL SECURITY;

--
-- PostgreSQL database dump complete
--

\unrestrict r8nqwocbWXgJO9SMM8jnFp2TsKrq7OCLKBHRRaBuhsuRQvwdeZeAWieeoF6EnUl

