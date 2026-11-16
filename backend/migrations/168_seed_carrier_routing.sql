-- Migración 168: Seed carrier_accounts (Envíame sandbox) + shipping_routing_rules iniciales
-- Ejecuta DESPUÉS de 161 (carrier_accounts), 162 (routing_rules), 167 (municipios_dane)
-- IDEMPOTENTE: corre en cada arranque (lista MIGRACIONES_ARRANQUE), así que todos los
-- INSERT van guardados con NOT EXISTS y no duplican filas.

-- 1. Carrier accounts: Envíame sandbox (mock mode usa estos como referencia)
-- En producción, Director dijo: "después de los convenios hare las integraciones"
-- Estos son placeholders para que el routing funcione en mock mode
INSERT INTO carrier_accounts (carrier, account_name, account_id_external, api_key_encrypted, api_secret_encrypted, webhook_secret_encrypted, is_default, modo_prueba, tenant_id)
SELECT v.carrier, v.account_name, v.account_id_external, 'mock-api-key-placeholder', 'mock-secret-placeholder', 'mock-webhook-secret-placeholder', v.is_default, true, t.tenant_id
FROM (VALUES
  ('envia', 'Envíame Sandbox', 'envia-sandbox-001', true),
  ('inter', 'Inter Rapidísimo (via Envíame)', 'inter-envia-001', false),
  ('coordinadora', 'Coordinadora (via Envíame)', 'coord-envia-001', false),
  ('servientrega', 'Servientrega (via Envíame)', 'servi-envia-001', false),
  ('tcc', 'TCC (via Envíame)', 'tcc-envia-001', false)
) AS v(carrier, account_name, account_id_external, is_default)
CROSS JOIN (SELECT id AS tenant_id FROM tenants ORDER BY id LIMIT 1) AS t
WHERE NOT EXISTS (
  SELECT 1 FROM carrier_accounts ca
  WHERE ca.carrier = v.carrier AND ca.account_id_external = v.account_id_external
);

-- 2. Shipping routing rules: Reglas iniciales por zona (10 ciudades principales + OTRO)
-- Usa Envíame como carrier unificado (multi-carrier), el service_code mapea a carrier real
-- Prioridad 1 = primera opción, el motor prueba en orden
DO $$
DECLARE
  v_envia_account_id UUID;
  v_zona_bogota UUID;
  v_zona_medellin UUID;
  v_zona_cali UUID;
  v_zona_barranquilla UUID;
  v_zona_cartagena UUID;
  v_zona_bucaramanga UUID;
  v_zona_pereira UUID;
  v_zona_manizales UUID;
  v_zona_ibague UUID;
  v_zona_villavicencio UUID;
  v_zona_otro UUID;
BEGIN
  SELECT id INTO v_envia_account_id FROM carrier_accounts
   WHERE carrier = 'envia' AND account_id_external = 'envia-sandbox-001' LIMIT 1;
  IF v_envia_account_id IS NULL THEN
    RAISE EXCEPTION 'Carrier account Envime no encontrado';
  END IF;

  -- IDs de zonas (creadas en migracion 094). Comparacion sin tildes porque
  -- zonas_envio guarda Bogota, Medellin, Ibague, etc. con tilde.
  SELECT id INTO v_zona_bogota        FROM zonas_envio WHERE lower(translate(ciudad,'áéíóúüñ','aeiouun')) = 'bogota'        ORDER BY activa DESC NULLS LAST LIMIT 1;
  SELECT id INTO v_zona_medellin      FROM zonas_envio WHERE lower(translate(ciudad,'áéíóúüñ','aeiouun')) = 'medellin'      ORDER BY activa DESC NULLS LAST LIMIT 1;
  SELECT id INTO v_zona_cali          FROM zonas_envio WHERE lower(translate(ciudad,'áéíóúüñ','aeiouun')) = 'cali'          ORDER BY activa DESC NULLS LAST LIMIT 1;
  SELECT id INTO v_zona_barranquilla  FROM zonas_envio WHERE lower(translate(ciudad,'áéíóúüñ','aeiouun')) = 'barranquilla'  ORDER BY activa DESC NULLS LAST LIMIT 1;
  SELECT id INTO v_zona_cartagena     FROM zonas_envio WHERE lower(translate(ciudad,'áéíóúüñ','aeiouun')) = 'cartagena'     ORDER BY activa DESC NULLS LAST LIMIT 1;
  SELECT id INTO v_zona_bucaramanga   FROM zonas_envio WHERE lower(translate(ciudad,'áéíóúüñ','aeiouun')) = 'bucaramanga'   ORDER BY activa DESC NULLS LAST LIMIT 1;
  SELECT id INTO v_zona_pereira       FROM zonas_envio WHERE lower(translate(ciudad,'áéíóúüñ','aeiouun')) = 'pereira'       ORDER BY activa DESC NULLS LAST LIMIT 1;
  SELECT id INTO v_zona_manizales     FROM zonas_envio WHERE lower(translate(ciudad,'áéíóúüñ','aeiouun')) = 'manizales'     ORDER BY activa DESC NULLS LAST LIMIT 1;
  SELECT id INTO v_zona_ibague        FROM zonas_envio WHERE lower(translate(ciudad,'áéíóúüñ','aeiouun')) = 'ibague'        ORDER BY activa DESC NULLS LAST LIMIT 1;
  SELECT id INTO v_zona_villavicencio FROM zonas_envio WHERE lower(translate(ciudad,'áéíóúüñ','aeiouun')) = 'villavicencio' ORDER BY activa DESC NULLS LAST LIMIT 1;
  SELECT id INTO v_zona_otro          FROM zonas_envio WHERE lower(translate(ciudad,'áéíóúüñ','aeiouun')) = 'otro'          ORDER BY activa DESC NULLS LAST LIMIT 1;

  -- Reglas por zona (prioridad 1 = express, 2 = estandar). Idempotente:
  -- solo inserta la combinacion que aun no exista para esa zona.
  INSERT INTO shipping_routing_rules
    (zona_id, carrier, carrier_service_code, carrier_account_id, prioridad,
     peso_min_kg, peso_max_kg, valor_min_cop, dias_maximos_entrega, activo)
  SELECT v.zona_id, 'envia', v.service_code, v_envia_account_id, v.prioridad,
         0, v.peso_max_kg, 0, v.dias, true
  FROM (VALUES
    (v_zona_bogota,        'envia_express',   1, 30, 1),
    (v_zona_bogota,        'envia_estandar',  2, 50, 2),
    (v_zona_medellin,      'envia_express',   1, 30, 2),
    (v_zona_medellin,      'envia_estandar',  2, 50, 3),
    (v_zona_cali,          'envia_express',   1, 30, 2),
    (v_zona_cali,          'envia_estandar',  2, 50, 3),
    (v_zona_barranquilla,  'envia_express',   1, 30, 2),
    (v_zona_barranquilla,  'envia_estandar',  2, 50, 4),
    (v_zona_cartagena,     'envia_express',   1, 30, 2),
    (v_zona_cartagena,     'envia_estandar',  2, 50, 4),
    (v_zona_bucaramanga,   'envia_express',   1, 30, 3),
    (v_zona_bucaramanga,   'envia_estandar',  2, 50, 4),
    (v_zona_pereira,       'envia_express',   1, 30, 3),
    (v_zona_pereira,       'envia_estandar',  2, 50, 4),
    (v_zona_manizales,     'envia_express',   1, 30, 3),
    (v_zona_manizales,     'envia_estandar',  2, 50, 4),
    (v_zona_ibague,        'envia_express',   1, 30, 3),
    (v_zona_ibague,        'envia_estandar',  2, 50, 4),
    (v_zona_villavicencio, 'envia_express',   1, 30, 3),
    (v_zona_villavicencio, 'envia_estandar',  2, 50, 5),
    (v_zona_otro,          'envia_estandar',  1, 50, 5),
    (v_zona_otro,          'envia_economico', 2, 50, 7)
  ) AS v(zona_id, service_code, prioridad, peso_max_kg, dias)
  WHERE v.zona_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM shipping_routing_rules r
      WHERE r.carrier = 'envia'
        AND r.carrier_service_code = v.service_code
        AND r.prioridad = v.prioridad
        AND r.zona_id IS NOT DISTINCT FROM v.zona_id
    );

  RAISE NOTICE 'Carrier accounts: %', (SELECT count(*) FROM carrier_accounts);
  RAISE NOTICE 'Routing rules: %', (SELECT count(*) FROM shipping_routing_rules);
END $$;
