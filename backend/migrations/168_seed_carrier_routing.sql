-- Migración 168: Seed carrier_accounts (Envíame sandbox) + shipping_routing_rules iniciales
-- Ejecuta DESPUÉS de 161 (carrier_accounts), 162 (routing_rules), 167 (municipios_dane)

-- 1. Carrier accounts: Envíame sandbox (mock mode usa estos como referencia)
-- En producción, Director dijo: "después de los convenios hare las integraciones"
-- Estos son placeholders para que el routing funcione en mock mode
INSERT INTO carrier_accounts (carrier, account_name, account_id_external, api_key_encrypted, secret_encrypted, webhook_secret_encrypted, is_default, modo_prueba, tenant_id)
VALUES 
  ('envia', 'Envíame Sandbox', 'envia-sandbox-001', 'mock-api-key-placeholder', 'mock-secret-placeholder', 'mock-webhook-secret-placeholder', true, true, (SELECT id FROM tenants WHERE es_plataforma = true LIMIT 1)),
  ('inter', 'Inter Rapidísimo (via Envíame)', 'inter-envia-001', 'mock-api-key-placeholder', 'mock-secret-placeholder', 'mock-webhook-secret-placeholder', false, true, (SELECT id FROM tenants WHERE es_plataforma = true LIMIT 1)),
  ('coordinadora', 'Coordinadora (via Envíame)', 'coord-envia-001', 'mock-api-key-placeholder', 'mock-secret-placeholder', 'mock-webhook-secret-placeholder', false, true, (SELECT id FROM tenants WHERE es_plataforma = true LIMIT 1)),
  ('servientrega', 'Servientrega (via Envíame)', 'servi-envia-001', 'mock-api-key-placeholder', 'mock-secret-placeholder', 'mock-webhook-secret-placeholder', false, true, (SELECT id FROM tenants WHERE es_plataforma = true LIMIT 1)),
  ('tcc', 'TCC (via Envíame)', 'tcc-envia-001', 'mock-api-key-placeholder', 'mock-secret-placeholder', 'mock-webhook-secret-placeholder', false, true, (SELECT id FROM tenants WHERE es_plataforma = true LIMIT 1))
ON CONFLICT DO NOTHING;

-- 2. Shipping routing rules: Reglas iniciales por zona (10 ciudades principales)
-- Usa Envíame como carrier unificado (multi-carrier), el service_code mapea a carrier real
-- Prioridad 1 = primera opción, el motor prueba en orden
DO $$
DECLARE
  v_platform_tenant_id INTEGER;
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
  SELECT id INTO v_platform_tenant_id FROM tenants WHERE es_plataforma = true LIMIT 1;
  IF v_platform_tenant_id IS NULL THEN
    RAISE EXCEPTION 'No hay tenant de plataforma';
  END IF;

  SELECT id INTO v_envia_account_id FROM carrier_accounts WHERE carrier = 'envia' AND tenant_id = v_platform_tenant_id LIMIT 1;
  IF v_envia_account_id IS NULL THEN
    RAISE EXCEPTION 'Carrier account Envíame no encontrado';
  END IF;

  -- Obtener IDs de zonas (creadas en migración 010/160)
  SELECT id INTO v_zona_bogota FROM zonas_envio WHERE lower(ciudad) = 'bogota' AND lower(departamento) = 'cundinamarca' LIMIT 1;
  SELECT id INTO v_zona_medellin FROM zonas_envio WHERE lower(ciudad) = 'medellin' AND lower(departamento) = 'antioquia' LIMIT 1;
  SELECT id INTO v_zona_cali FROM zonas_envio WHERE lower(ciudad) = 'cali' AND lower(departamento) = 'valle del cauca' LIMIT 1;
  SELECT id INTO v_zona_barranquilla FROM zonas_envio WHERE lower(ciudad) = 'barranquilla' AND lower(departamento) = 'atlantico' LIMIT 1;
  SELECT id INTO v_zona_cartagena FROM zonas_envio WHERE lower(ciudad) = 'cartagena' AND lower(departamento) = 'bolivar' LIMIT 1;
  SELECT id INTO v_zona_bucaramanga FROM zonas_envio WHERE lower(ciudad) = 'bucaramanga' AND lower(departamento) = 'santander' LIMIT 1;
  SELECT id INTO v_zona_pereira FROM zonas_envio WHERE lower(ciudad) = 'pereira' AND lower(departamento) = 'risaralda' LIMIT 1;
  SELECT id INTO v_zona_manizales FROM zonas_envio WHERE lower(ciudad) = 'manizales' AND lower(departamento) = 'caldas' LIMIT 1;
  SELECT id INTO v_zona_ibague FROM zonas_envio WHERE lower(ciudad) = 'ibague' AND lower(departamento) = 'tolima' LIMIT 1;
  SELECT id INTO v_zona_villavicencio FROM zonas_envio WHERE lower(ciudad) = 'villavicencio' AND lower(departamento) = 'meta' LIMIT 1;
  SELECT id INTO v_zona_otro FROM zonas_envio WHERE lower(ciudad) = 'otro' LIMIT 1;

  -- Reglas Bogotá (prioridad 1: Envíame express, 2: Envíame estándar)
  INSERT INTO shipping_routing_rules (zona_id, carrier, carrier_service_code, carrier_account_id, prioridad, peso_min_kg, peso_max_kg, valor_min_cop, dias_maximos_entrega, activo, tenant_id)
  VALUES
    (v_zona_bogota, 'envia', 'envia_express', v_envia_account_id, 1, 0, 30, 0, 1, true, v_platform_tenant_id),
    (v_zona_bogota, 'envia', 'envia_estandar', v_envia_account_id, 2, 0, 50, 0, 2, true, v_platform_tenant_id)
  ON CONFLICT DO NOTHING;

  -- Medellín
  INSERT INTO shipping_routing_rules (zona_id, carrier, carrier_service_code, carrier_account_id, prioridad, peso_min_kg, peso_max_kg, valor_min_cop, dias_maximos_entrega, activo, tenant_id)
  VALUES
    (v_zona_medellin, 'envia', 'envia_express', v_envia_account_id, 1, 0, 30, 0, 2, true, v_platform_tenant_id),
    (v_zona_medellin, 'envia', 'envia_estandar', v_envia_account_id, 2, 0, 50, 0, 3, true, v_platform_tenant_id)
  ON CONFLICT DO NOTHING;

  -- Cali
  INSERT INTO shipping_routing_rules (zona_id, carrier, carrier_service_code, carrier_account_id, prioridad, peso_min_kg, peso_max_kg, valor_min_cop, dias_maximos_entrega, activo, tenant_id)
  VALUES
    (v_zona_cali, 'envia', 'envia_express', v_envia_account_id, 1, 0, 30, 0, 2, true, v_platform_tenant_id),
    (v_zona_cali, 'envia', 'envia_estandar', v_envia_account_id, 2, 0, 50, 0, 3, true, v_platform_tenant_id)
  ON CONFLICT DO NOTHING;

  -- Barranquilla
  INSERT INTO shipping_routing_rules (zona_id, carrier, carrier_service_code, carrier_account_id, prioridad, peso_min_kg, peso_max_kg, valor_min_cop, dias_maximos_entrega, activo, tenant_id)
  VALUES
    (v_zona_barranquilla, 'envia', 'envia_express', v_envia_account_id, 1, 0, 30, 0, 2, true, v_platform_tenant_id),
    (v_zona_barranquilla, 'envia', 'envia_estandar', v_envia_account_id, 2, 0, 50, 0, 4, true, v_platform_tenant_id)
  ON CONFLICT DO NOTHING;

  -- Cartagena
  INSERT INTO shipping_routing_rules (zona_id, carrier, carrier_service_code, carrier_account_id, prioridad, peso_min_kg, peso_max_kg, valor_min_cop, dias_maximos_entrega, activo, tenant_id)
  VALUES
    (v_zona_cartagena, 'envia', 'envia_express', v_envia_account_id, 1, 0, 30, 0, 2, true, v_platform_tenant_id),
    (v_zona_cartagena, 'envia', 'envia_estandar', v_envia_account_id, 2, 0, 50, 0, 4, true, v_platform_tenant_id)
  ON CONFLICT DO NOTHING;

  -- Bucaramanga
  INSERT INTO shipping_routing_rules (zona_id, carrier, carrier_service_code, carrier_account_id, prioridad, peso_min_kg, peso_max_kg, valor_min_cop, dias_maximos_entrega, activo, tenant_id)
  VALUES
    (v_zona_bucaramanga, 'envia', 'envia_express', v_envia_account_id, 1, 0, 30, 0, 3, true, v_platform_tenant_id),
    (v_zona_bucaramanga, 'envia', 'envia_estandar', v_envia_account_id, 2, 0, 50, 0, 4, true, v_platform_tenant_id)
  ON CONFLICT DO NOTHING;

  -- Pereira
  INSERT INTO shipping_routing_rules (zona_id, carrier, carrier_service_code, carrier_account_id, prioridad, peso_min_kg, peso_max_kg, valor_min_cop, dias_maximos_entrega, activo, tenant_id)
  VALUES
    (v_zona_pereira, 'envia', 'envia_express', v_envia_account_id, 1, 0, 30, 0, 3, true, v_platform_tenant_id),
    (v_zona_pereira, 'envia', 'envia_estandar', v_envia_account_id, 2, 0, 50, 0, 4, true, v_platform_tenant_id)
  ON CONFLICT DO NOTHING;

  -- Manizales
  INSERT INTO shipping_routing_rules (zona_id, carrier, carrier_service_code, carrier_account_id, prioridad, peso_min_kg, peso_max_kg, valor_min_cop, dias_maximos_entrega, activo, tenant_id)
  VALUES
    (v_zona_manizales, 'envia', 'envia_express', v_envia_account_id, 1, 0, 30, 0, 3, true, v_platform_tenant_id),
    (v_zona_manizales, 'envia', 'envia_estandar', v_envia_account_id, 2, 0, 50, 0, 4, true, v_platform_tenant_id)
  ON CONFLICT DO NOTHING;

  -- Ibagué
  INSERT INTO shipping_routing_rules (zona_id, carrier, carrier_service_code, carrier_account_id, prioridad, peso_min_kg, peso_max_kg, valor_min_cop, dias_maximos_entrega, activo, tenant_id)
  VALUES
    (v_zona_ibague, 'envia', 'envia_express', v_envia_account_id, 1, 0, 30, 0, 3, true, v_platform_tenant_id),
    (v_zona_ibague, 'envia', 'envia_estandar', v_envia_account_id, 2, 0, 50, 0, 4, true, v_platform_tenant_id)
  ON CONFLICT DO NOTHING;

  -- Villavicencio
  INSERT INTO shipping_routing_rules (zona_id, carrier, carrier_service_code, carrier_account_id, prioridad, peso_min_kg, peso_max_kg, valor_min_cop, dias_maximos_entrega, activo, tenant_id)
  VALUES
    (v_zona_villavicencio, 'envia', 'envia_express', v_envia_account_id, 1, 0, 30, 0, 3, true, v_platform_tenant_id),
    (v_zona_villavicencio, 'envia', 'envia_estandar', v_envia_account_id, 2, 0, 50, 0, 5, true, v_platform_tenant_id)
  ON CONFLICT DO NOTHING;

  -- Zona OTRO (fallback nacional)
  INSERT INTO shipping_routing_rules (zona_id, carrier, carrier_service_code, carrier_account_id, prioridad, peso_min_kg, peso_max_kg, valor_min_cop, dias_maximos_entrega, activo, tenant_id)
  VALUES
    (v_zona_otro, 'envia', 'envia_estandar', v_envia_account_id, 1, 0, 50, 0, 5, true, v_platform_tenant_id),
    (v_zona_otro, 'envia', 'envia_economico', v_envia_account_id, 2, 0, 50, 0, 7, true, v_platform_tenant_id)
  ON CONFLICT DO NOTHING;

  RAISE NOTICE 'Carrier accounts: %', (SELECT count(*) FROM carrier_accounts WHERE tenant_id = v_platform_tenant_id);
  RAISE NOTICE 'Routing rules: %', (SELECT count(*) FROM shipping_routing_rules WHERE tenant_id = v_platform_tenant_id);
END $$;