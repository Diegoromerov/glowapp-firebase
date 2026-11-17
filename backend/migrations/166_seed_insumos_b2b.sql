-- Migración 166: Seed insumos B2B (tipo_visibilidad = INSUMO_PRESTADOR) con precios en listas profesional y negocio
-- Ejecuta DESPUÉS de que existan las listas_precios (migración 121) y la tabla productos (migración 010)

-- 1. Asegurar que las listas profesional y negocio existen y están activas
INSERT INTO listas_precios (codigo, nombre, rol_destino, incluye_iva, estado, tenant_id)
VALUES 
  ('profesional', 'Profesional', 'provider', false, 'ACTIVA', (SELECT id FROM tenants WHERE es_plataforma = true LIMIT 1)),
  ('negocio', 'Negocio / Salón', 'salon', false, 'ACTIVA', (SELECT id FROM tenants WHERE es_plataforma = true LIMIT 1))
ON CONFLICT (codigo) DO UPDATE SET 
  estado = 'ACTIVA',
  tenant_id = EXCLUDED.tenant_id;

-- 2. Obtener tenant de plataforma
DO $$
DECLARE
  v_platform_tenant_id INTEGER;
  v_lista_profesional_id INTEGER;
  v_lista_negocio_id INTEGER;
BEGIN
  SELECT id INTO v_platform_tenant_id FROM tenants WHERE es_plataforma = true LIMIT 1;
  IF v_platform_tenant_id IS NULL THEN
    RAISE EXCEPTION 'No hay tenant de plataforma (es_plataforma=true)';
  END IF;

  SELECT id INTO v_lista_profesional_id FROM listas_precios WHERE codigo = 'profesional' AND tenant_id = v_platform_tenant_id;
  SELECT id INTO v_lista_negocio_id FROM listas_precios WHERE codigo = 'negocio' AND tenant_id = v_platform_tenant_id;

  IF v_lista_profesional_id IS NULL OR v_lista_negocio_id IS NULL THEN
    RAISE EXCEPTION 'Listas profesional/negocio no encontradas';
  END IF;

  -- 3. Insertar insumos B2B (tipo_visibilidad = INSUMO_PRESTADOR)
  -- Estos productos NO aparecen en retail (lista cliente)
  -- Idempotente: productos no tiene UNIQUE(nombre), así que ON CONFLICT DO NOTHING
  -- nunca disparaba y cada arranque duplicaba los 21 insumos. Se guarda con NOT EXISTS.
  INSERT INTO productos (nombre, descripcion, precio, precio_al_publico, precio_con_reserva, precio_prestador, comision_prestador, stock, imagen_url, tag_especialidad, tipo_visibilidad, tenant_id)
  SELECT v.nombre, v.descripcion, v.precio, v.precio_al_publico, v.precio_con_reserva, v.precio_prestador, v.comision_prestador, v.stock, v.imagen_url, v.tag_especialidad, v.tipo_visibilidad, v.tenant_id
  FROM (VALUES 
    -- Estética / Depilación
    ('Cera Elástica de Miel (1kg)', 'Cera elástica profesional con extracto de miel orgánica. Ideal para depilación de zonas sensibles, alta elasticidad y bajo punto de fusión.', 45000.00, 0.00, 0.00, 45000.00, 0.00, 100, 'https://images.unsplash.com/photo-1512290923902-8a9f81dc236c?q=80&w=300&auto=format&fit=crop', 'Estética', 'INSUMO_PRESTADOR', v_platform_tenant_id),
    ('Cera Roll-On Miel (100ml x 6)', 'Cartucho roll-on de cera tibia de miel. Formato higiénico, listo para calentar y aplicar. Pack 6 unidades.', 32000.00, 0.00, 0.00, 32000.00, 0.00, 80, 'https://images.unsplash.com/photo-1608248543803-ba4f8c70ae0b?q=80&w=300&auto=format&fit=crop', 'Estética', 'INSUMO_PRESTADOR', v_platform_tenant_id),
    ('Bandas Depilatorias TNT (100 u)', 'Bandas de tela no tejida para cera tibia/caliente. Resistentes, no se rompen al tirar. Paquete 100 unidades.', 18000.00, 0.00, 0.00, 18000.00, 0.00, 200, 'https://images.unsplash.com/photo-1598440909899-6e8f4c5a9b6e?q=80&w=300&auto=format&fit=crop', 'Estética', 'INSUMO_PRESTADOR', v_platform_tenant_id),
    ('Gel Post-Depilatorio Calmante (500ml)', 'Gel refrescante con aloe vera y manzanilla. Calma e hidrata la piel tras la depilación. Formato profesional.', 22000.00, 0.00, 0.00, 22000.00, 0.00, 120, 'https://images.unsplash.com/photo-1556228578-8c89e6adf883?q=80&w=300&auto=format&fit=crop', 'Estética', 'INSUMO_PRESTADOR', v_platform_tenant_id),

    -- Pestañas / Cejas
    ('Kit Pestañas Pelo a Pelo Premium', 'Kit completo: pestañas seda/mink, adhesivo quirúrgico secado rápido (1-2s), removedor gel, pinzas precisión, pads.', 90000.00, 0.00, 0.00, 90000.00, 0.00, 50, 'https://images.unsplash.com/photo-1522337360788-8b13df793f1f?q=80&w=300&auto=format&fit=crop', 'Maquillaje', 'INSUMO_PRESTADOR', v_platform_tenant_id),
    ('Adhesivo Pestañas Quirúrgico 5ml', 'Cianoacrilato grado médico, secado 0.5-1s, retención 6-8 semanas, bajo humos. Botella 5ml con punta dosificadora.', 35000.00, 0.00, 0.00, 35000.00, 0.00, 80, 'https://images.unsplash.com/photo-1596462502278-27bfdc403348?q=80&w=300&auto=format&fit=crop', 'Maquillaje', 'INSUMO_PRESTADOR', v_platform_tenant_id),
    ('Pestañas Volumen Ruso 0.07mm (16 filas)', 'Bandas de pestañas ultra finas para técnica volumen ruso. 16 filas, curvas C/D, longitudes 8-14mm mixtas.', 28000.00, 0.00, 0.00, 28000.00, 0.00, 100, 'https://images.unsplash.com/photo-1487412720507-e7ab37603c6f?q=80&w=300&auto=format&fit=crop', 'Maquillaje', 'INSUMO_PRESTADOR', v_platform_tenant_id),
    ('Removedor Pestañas Gel 15ml', 'Removedor en gel no gotea, disuelve adhesivo en 2-3 min sin irritar. Formato profesional 15ml.', 15000.00, 0.00, 0.00, 15000.00, 0.00, 120, 'https://images.unsplash.com/photo-1585386959984-a4155224a1ad?q=80&w=300&auto=format&fit=crop', 'Maquillaje', 'INSUMO_PRESTADOR', v_platform_tenant_id),

    -- Uñas / Manicura
    ('Sistema Gel Builder 3-en-1 (15ml)', 'Gel constructor, color y brillo en uno. Autonivelante, curado LED/UV 60s. 15ml tono natural.', 42000.00, 0.00, 0.00, 42000.00, 0.00, 60, 'https://images.unsplash.com/photo-1519014816548-bf6f4b4e9c1d?q=80&w=300&auto=format&fit=crop', 'Uñas', 'INSUMO_PRESTADOR', v_platform_tenant_id),
    ('Lámpara LED/UV 48W Profesional', 'Curado dual 365+405nm, 48W, sensor movimiento, timer 10/30/60s, pantalla LCD. Base extraíble pedicura.', 85000.00, 0.00, 0.00, 85000.00, 0.00, 30, 'https://images.unsplash.com/photo-1603491503956-5d2b6a1b3b8e?q=80&w=300&auto=format&fit=crop', 'Uñas', 'INSUMO_PRESTADOR', v_platform_tenant_id),
    ('Kit Brochas Detalle Uñas (12 pcs)', 'Brochas kolinsky/sintéticas para arte: liner, oval, flat, fan, dotter. Mango ergonómico, estuche.', 38000.00, 0.00, 0.00, 38000.00, 0.00, 70, 'https://images.unsplash.com/photo-1595318202305-4d7b7f8f4a2e?q=80&w=300&auto=format&fit=crop', 'Uñas', 'INSUMO_PRESTADOR', v_platform_tenant_id),
    ('Prep + Primer + Bond (Set 3x15ml)', 'Preparador deshidratante, primer sin ácido, bond adhesivo. Base esencial para duración 3+ semanas.', 36000.00, 0.00, 0.00, 36000.00, 0.00, 90, 'https://images.unsplash.com/photo-1608248543803-ba4f8c70ae0b?q=80&w=300&auto=format&fit=crop', 'Uñas', 'INSUMO_PRESTADOR', v_platform_tenant_id),

    -- Cabello / Barbería
    ('Máquina Corte Profesional Sin Cable', 'Motor brushless 7200 RPM, cuchilla DLC/titanio, 3h autonomía, 1h carga, 4 peines guía, estuche.', 180000.00, 0.00, 0.00, 180000.00, 0.00, 25, 'https://images.unsplash.com/photo-1503951914875-452162b0f3f1?q=80&w=300&auto=format&fit=crop', 'Corte & Capilar', 'INSUMO_PRESTADOR', v_platform_tenant_id),
    ('Trimmer Detalle Cero Gap', 'Cuchilla T ajustable zero-gap, motor rotativo, 2h autonomía, ideal barba/perfilado. Incluye 3 peines.', 95000.00, 0.00, 0.00, 95000.00, 0.00, 40, 'https://images.unsplash.com/photo-1526947425960-945c6e72858f?q=80&w=300&auto=format&fit=crop', 'Barba & Bigote', 'INSUMO_PRESTADOR', v_platform_tenant_id),
    ('Aceite Barba Premium 30ml (Pack 6)', 'Blend jojoba, argán, vitamina E. No graso, absorción rápida. Pack 6 unidades para reventa.', 54000.00, 0.00, 0.00, 54000.00, 0.00, 60, 'https://images.unsplash.com/photo-1571781926291-c4e72914638e?q=80&w=300&auto=format&fit=crop', 'Barba & Bigote', 'INSUMO_PRESTADOR', v_platform_tenant_id),
    ('Tinte Barba/Cabello Sin Amoníaco (12 tonos)', 'Cobertura 100% canas, 20 min, dura 6-8 lavados. Kit: crema color, revelador, guantes, aplicador.', 24000.00, 0.00, 0.00, 24000.00, 0.00, 100, 'https://images.unsplash.com/photo-1522337360788-8b13df793f1f?q=80&w=300&auto=format&fit=crop', 'Corte & Capilar', 'INSUMO_PRESTADOR', v_platform_tenant_id),

    -- Skincare / Facial
    ('Dermapen Microneedling Profesional', 'Motor 18000 RPM, profundidad 0.25-2.5mm, 16 agujas estériles, pantalla OLED, batería 4h.', 220000.00, 0.00, 0.00, 220000.00, 0.00, 20, 'https://images.unsplash.com/photo-1598440909899-6e8f4c5a9b6e?q=80&w=300&auto=format&fit=crop', 'Estética', 'INSUMO_PRESTADOR', v_platform_tenant_id),
    ('Sueros Mesoterapia (Box 10x5ml)', 'Cócteles: hialurónico, vitaminas, péptidos, DMAE, orgánico. Estériles, uso tópico/inyectable.', 180000.00, 0.00, 0.00, 180000.00, 0.00, 40, 'https://images.unsplash.com/photo-1556228578-8c89e6adf883?q=80&w=300&auto=format&fit=crop', 'Estética', 'INSUMO_PRESTADOR', v_platform_tenant_id),
    ('Mascarilla LED Facial 7 Colores', 'Terapia fotodinámica: rojo/azul/verde/amarillo/cian/morado/blanco. 150 LEDs, 3 modos, recargable.', 150000.00, 0.00, 0.00, 150000.00, 0.00, 35, 'https://images.unsplash.com/photo-1571781926291-c4e72914638e?q=80&w=300&auto=format&fit=crop', 'Estética', 'INSUMO_PRESTADOR', v_platform_tenant_id),

    -- Consumibles / Desechables
    ('Guantes Nitrilo Negro Sin Polvo (Caja 100)', 'Gramaje 4.5g, textura micro-rugosa, ambidiestros, talla M/L/XL mixtos. Caja dispensadora.', 35000.00, 0.00, 0.00, 35000.00, 0.00, 200, 'https://images.unsplash.com/photo-1584030373211-0b4b6b0e4a2e?q=80&w=300&auto=format&fit=crop', 'Estética', 'INSUMO_PRESTADOR', v_platform_tenant_id),
    ('Batas Desechables TNT (Pack 50)', 'Manga larga, puños elásticos, cierre velcro cuello, gramaje 35g/m2. Talla única universal.', 42000.00, 0.00, 0.00, 42000.00, 0.00, 150, 'https://images.unsplash.com/photo-1584030373211-0b4b6b0e4a2e?q=80&w=300&auto=format&fit=crop', 'Estética', 'INSUMO_PRESTADOR', v_platform_tenant_id),
    ('Camasillas Camilla Desechables (Roll x 50)', 'Papel 2 capas + PE impermeable 50x80cm. Perforadas, hipoalergénicas. Roll 50 unidades.', 28000.00, 0.00, 0.00, 28000.00, 0.00, 180, 'https://images.unsplash.com/photo-1584030373211-0b4b6b0e4a2e?q=80&w=300&auto=format&fit=crop', 'Estética', 'INSUMO_PRESTADOR', v_platform_tenant_id)
  ) AS v(nombre, descripcion, precio, precio_al_publico, precio_con_reserva, precio_prestador, comision_prestador, stock, imagen_url, tag_especialidad, tipo_visibilidad, tenant_id)
  WHERE NOT EXISTS (
    SELECT 1 FROM productos p
    WHERE p.nombre = v.nombre
      AND p.tipo_visibilidad = v.tipo_visibilidad
      AND p.tenant_id = v.tenant_id
  );

  -- 4. Poblar precios_producto para lista PROFESIONAL (precio_prestador = costo base)
  -- y lista NEGOCIO (mismo precio, unidad_minima = 6)
  INSERT INTO precios_producto (lista_id, producto_id, precio, unidad_minima, tenant_id)
  SELECT 
    v_lista_profesional_id,
    p.id,
    p.precio_prestador,
    1,
    v_platform_tenant_id
  FROM productos p
  WHERE p.tipo_visibilidad = 'INSUMO_PRESTADOR'
    AND p.tenant_id = v_platform_tenant_id
    AND NOT EXISTS (
      SELECT 1 FROM precios_producto pp 
      WHERE pp.lista_id = v_lista_profesional_id AND pp.producto_id = p.id
    );

  INSERT INTO precios_producto (lista_id, producto_id, precio, unidad_minima, tenant_id)
  SELECT 
    v_lista_negocio_id,
    p.id,
    p.precio_prestador,
    6,
    v_platform_tenant_id
  FROM productos p
  WHERE p.tipo_visibilidad = 'INSUMO_PRESTADOR'
    AND p.tenant_id = v_platform_tenant_id
    AND NOT EXISTS (
      SELECT 1 FROM precios_producto pp 
      WHERE pp.lista_id = v_lista_negocio_id AND pp.producto_id = p.id
    );

  RAISE NOTICE 'Insumos B2B insertados: %', (SELECT count(*) FROM productos WHERE tipo_visibilidad = 'INSUMO_PRESTADOR' AND tenant_id = v_platform_tenant_id);
  RAISE NOTICE 'Precios profesional insertados: %', (SELECT count(*) FROM precios_producto WHERE lista_id = v_lista_profesional_id);
  RAISE NOTICE 'Precios negocio insertados: %', (SELECT count(*) FROM precios_producto WHERE lista_id = v_lista_negocio_id);
END $$;