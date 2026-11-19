-- Corrige la resolución de zona de las métricas usando el destino persistido
-- en envios, que es el contrato vigente del esquema 174.
CREATE INDEX IF NOT EXISTS idx_envios_creado_en_metricas
  ON envios (creado_en);
ALTER TABLE envios
  ADD COLUMN IF NOT EXISTS peso_kg NUMERIC(8,3),
  ADD COLUMN IF NOT EXISTS costo_etiqueta_cop BIGINT;

CREATE OR REPLACE FUNCTION refrescar_logistica_metricas_diarias(p_fecha DATE DEFAULT CURRENT_DATE - 1)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  -- NULL no colisiona en la restricción UNIQUE(fecha, carrier, zona_id).
  -- Reemplazar esos agregados para esta fecha mantiene el job idempotente.
  DELETE FROM logistica_metricas_diarias
   WHERE fecha = p_fecha AND zona_id IS NULL;

  WITH shipment_stats AS (
    SELECT
      (e.creado_en AT TIME ZONE 'UTC')::date AS fecha,
      e.transportadora AS carrier,
      z.id AS zona_id,
      COUNT(*) FILTER (WHERE e.estado = 'CREADO') AS envios_creados,
      COUNT(*) FILTER (WHERE e.estado IN ('RECOGIDO','EN_TRANSITO','EN_CENTRO_DESTINO','SALIDA_ENTREGA','ENTREGADO')) AS envios_recogidos,
      COUNT(*) FILTER (WHERE e.estado = 'ENTREGADO') AS envios_entregados,
      COUNT(*) FILTER (WHERE e.estado = 'FALLIDO') AS envios_fallidos,
      COUNT(*) FILTER (WHERE e.estado = 'DEVUELTO') AS envios_devueltos,
      AVG(EXTRACT(EPOCH FROM (e.entregado_en - e.creado_en))/3600) FILTER (WHERE e.estado = 'ENTREGADO') AS sla_promedio_horas,
      PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (e.entregado_en - e.creado_en))/3600) FILTER (WHERE e.estado = 'ENTREGADO') AS sla_p50_horas,
      PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (e.entregado_en - e.creado_en))/3600) FILTER (WHERE e.estado = 'ENTREGADO') AS sla_p90_horas,
      PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (e.entregado_en - e.creado_en))/3600) FILTER (WHERE e.estado = 'ENTREGADO') AS sla_p99_horas,
      COALESCE(SUM(e.peso_kg), 0) AS volumen_peso_kg,
      COALESCE(SUM(pt.total), 0) AS valor_total_cop,
      COALESCE(SUM(e.costo_etiqueta_cop), 0) AS costo_etiquetas_cop
    FROM envios e
    LEFT JOIN pedidos_tienda pt ON pt.id = e.pedido_id
    LEFT JOIN LATERAL (
      SELECT ze.id
        FROM zonas_envio ze
       WHERE ze.ciudad = e.destino_ciudad
         AND ze.departamento = e.destino_departamento
       ORDER BY (ze.codigo_postal_prefijo IS NULL) DESC, ze.creado_en, ze.id
       LIMIT 1
    ) z ON TRUE
    WHERE e.creado_en >= (p_fecha::timestamp AT TIME ZONE 'UTC')
      AND e.creado_en < ((p_fecha + 1)::timestamp AT TIME ZONE 'UTC')
    GROUP BY (e.creado_en AT TIME ZONE 'UTC')::date, e.transportadora, z.id
  ), return_events AS (
    SELECT
      (d.solicitada_en AT TIME ZONE 'UTC')::date AS fecha,
      e.transportadora AS carrier,
      z.id AS zona_id,
      1::BIGINT AS solicitudes,
      0::BIGINT AS completadas
    FROM devoluciones d
    JOIN LATERAL (
      SELECT envio.*
        FROM envios envio
       WHERE envio.id = d.envio_original_id
          OR (d.envio_original_id IS NULL AND envio.pedido_id = d.pedido_id)
       ORDER BY (envio.id = d.envio_original_id) DESC, envio.creado_en, envio.id
       LIMIT 1
    ) e ON TRUE
    JOIN pedidos_tienda pt ON pt.id = d.pedido_id
    LEFT JOIN LATERAL (
      SELECT ze.id
        FROM zonas_envio ze
       WHERE ze.ciudad = e.destino_ciudad
         AND ze.departamento = e.destino_departamento
       ORDER BY (ze.codigo_postal_prefijo IS NULL) DESC, ze.creado_en, ze.id
       LIMIT 1
    ) z ON TRUE
    WHERE d.solicitada_en >= (p_fecha::timestamp AT TIME ZONE 'UTC')
      AND d.solicitada_en < ((p_fecha + 1)::timestamp AT TIME ZONE 'UTC')

    UNION ALL

    SELECT
      (COALESCE(d.resuelta_en, d.cerrada_en) AT TIME ZONE 'UTC')::date AS fecha,
      e.transportadora AS carrier,
      z.id AS zona_id,
      0::BIGINT AS solicitudes,
      1::BIGINT AS completadas
    FROM devoluciones d
    JOIN LATERAL (
      SELECT envio.*
        FROM envios envio
       WHERE envio.id = d.envio_original_id
          OR (d.envio_original_id IS NULL AND envio.pedido_id = d.pedido_id)
       ORDER BY (envio.id = d.envio_original_id) DESC, envio.creado_en, envio.id
       LIMIT 1
    ) e ON TRUE
    JOIN pedidos_tienda pt ON pt.id = d.pedido_id
    LEFT JOIN LATERAL (
      SELECT ze.id
        FROM zonas_envio ze
       WHERE ze.ciudad = e.destino_ciudad
         AND ze.departamento = e.destino_departamento
       ORDER BY (ze.codigo_postal_prefijo IS NULL) DESC, ze.creado_en, ze.id
       LIMIT 1
    ) z ON TRUE
    WHERE d.estado IN ('RECHAZADA','REEMBOLSADA','CAMBIADA','CERRADA')
      AND COALESCE(d.resuelta_en, d.cerrada_en) IS NOT NULL
      AND COALESCE(d.resuelta_en, d.cerrada_en) >= (p_fecha::timestamp AT TIME ZONE 'UTC')
      AND COALESCE(d.resuelta_en, d.cerrada_en) < ((p_fecha + 1)::timestamp AT TIME ZONE 'UTC')
  ), return_stats AS (
    SELECT fecha, carrier, zona_id,
           SUM(solicitudes) AS devoluciones_solicitadas,
           SUM(completadas) AS devoluciones_completadas
      FROM return_events
     GROUP BY fecha, carrier, zona_id
  ), combined AS (
    SELECT
      COALESCE(s.fecha, r.fecha) AS fecha,
      COALESCE(s.carrier, r.carrier) AS carrier,
      COALESCE(s.zona_id, r.zona_id) AS zona_id,
      COALESCE(s.envios_creados, 0) AS envios_creados,
      COALESCE(s.envios_recogidos, 0) AS envios_recogidos,
      COALESCE(s.envios_entregados, 0) AS envios_entregados,
      COALESCE(s.envios_fallidos, 0) AS envios_fallidos,
      COALESCE(s.envios_devueltos, 0) AS envios_devueltos,
      s.sla_promedio_horas, s.sla_p50_horas, s.sla_p90_horas, s.sla_p99_horas,
      COALESCE(s.volumen_peso_kg, 0) AS volumen_peso_kg,
      COALESCE(s.valor_total_cop, 0) AS valor_total_cop,
      COALESCE(r.devoluciones_solicitadas, 0) AS devoluciones_solicitadas,
      COALESCE(r.devoluciones_completadas, 0) AS devoluciones_completadas,
      COALESCE(s.costo_etiquetas_cop, 0) AS costo_etiquetas_cop
    FROM shipment_stats s
    FULL JOIN return_stats r
      ON r.fecha = s.fecha
     AND r.carrier = s.carrier
     AND r.zona_id IS NOT DISTINCT FROM s.zona_id
  )
  INSERT INTO logistica_metricas_diarias (
    fecha, carrier, zona_id, envios_creados, envios_recogidos,
    envios_entregados, envios_fallidos, envios_devueltos,
    sla_promedio_horas, sla_p50_horas, sla_p90_horas, sla_p99_horas,
    volumen_peso_kg, valor_total_cop, devoluciones_solicitadas,
    devoluciones_completadas, costo_etiquetas_cop
  )
  SELECT fecha, carrier, zona_id, envios_creados, envios_recogidos,
         envios_entregados, envios_fallidos, envios_devueltos,
         sla_promedio_horas, sla_p50_horas, sla_p90_horas, sla_p99_horas,
         volumen_peso_kg, valor_total_cop, devoluciones_solicitadas,
         devoluciones_completadas, costo_etiquetas_cop
    FROM combined
  ON CONFLICT (fecha, carrier, zona_id) DO UPDATE SET
    envios_creados = EXCLUDED.envios_creados,
    envios_recogidos = EXCLUDED.envios_recogidos,
    envios_entregados = EXCLUDED.envios_entregados,
    envios_fallidos = EXCLUDED.envios_fallidos,
    envios_devueltos = EXCLUDED.envios_devueltos,
    sla_promedio_horas = EXCLUDED.sla_promedio_horas,
    sla_p50_horas = EXCLUDED.sla_p50_horas,
    sla_p90_horas = EXCLUDED.sla_p90_horas,
    sla_p99_horas = EXCLUDED.sla_p99_horas,
    volumen_peso_kg = EXCLUDED.volumen_peso_kg,
    valor_total_cop = EXCLUDED.valor_total_cop,
    devoluciones_solicitadas = EXCLUDED.devoluciones_solicitadas,
    devoluciones_completadas = EXCLUDED.devoluciones_completadas,
    costo_etiquetas_cop = EXCLUDED.costo_etiquetas_cop,
    actualizado_en = NOW();
END;
$$;

COMMENT ON FUNCTION refrescar_logistica_metricas_diarias(DATE) IS
  'Refresca métricas de envíos y eventos de devoluciones para el día indicado.';
