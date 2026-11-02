-- ─────────────────────────────────────────────────────────────────────────────
-- D-GL-011 v2: envío gratis solo por encima de 300.000 en Bogotá y 480.000 en
-- el resto del país.
--
-- La migración 094 sembró `gratis_desde_monto` con 120.000 / 130.000 / 140.000 /
-- 150.000, umbrales de un borrador anterior. Cualquier base creada desde cero
-- nacía cobrando envío con la política vieja, y el checkout de esos entornos
-- daba envío gratis a pedidos de 150.000.
--
-- Producción ya tenía los valores correctos porque se corrigieron a mano; esta
-- migración los deja escritos para no depender de una corrección manual.
--
-- Esta migración es idempotente: si los valores ya son los aprobados, el UPDATE
-- afecta cero filas. También se corrigió el seed de 094 para instalaciones
-- nuevas, que no pasan por aquí al crear la tabla desde cero.
-- ─────────────────────────────────────────────────────────────────────────────

UPDATE zonas_envio
   SET gratis_desde_monto = CASE
         WHEN lower(ciudad) LIKE 'bogot%' THEN 300000
         ELSE 480000
       END
 WHERE gratis_desde_monto IS DISTINCT FROM CASE
         WHEN lower(ciudad) LIKE 'bogot%' THEN 300000
         ELSE 480000
       END;

-- Verificación: 1 fila en 300.000 (Bogotá) y el resto en 480.000.
--   SELECT gratis_desde_monto, count(*) FROM zonas_envio GROUP BY 1 ORDER BY 1;
