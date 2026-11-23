'use strict';

/**
 * Descuenta la receta de un servicio cuando la reserva queda completada.
 * Debe ejecutarse dentro de la misma transacción que el cierre de reserva.
 * Si falta stock, registra lo que sí había y deja visible el faltante; nunca
 * bloquea la confirmación de un servicio ya prestado ni deja saldo negativo.
 */
async function consumirInsumosDeReserva(db, { bookingId, serviceId, salonId, tenantId, actorId }) {
  if (!bookingId || !serviceId || !salonId || !tenantId) {
    return { consumidos: 0, faltantes: 0, omitido: 'reserva_sin_salon' };
  }

  const { rows: receta } = await db.query(
    `SELECT si.item_id, si.cantidad AS cantidad_solicitada,
            i.stock_actual, i.nombre, i.unidad
       FROM salon_servicio_insumos si
       JOIN inventario_salon i ON i.id = si.item_id AND i.salon_id = si.salon_id
      WHERE si.tenant_id = $1 AND si.salon_id = $2 AND si.service_id = $3
        AND si.activo = TRUE AND i.activo = TRUE
      ORDER BY si.item_id
      FOR UPDATE OF si, i`,
    [tenantId, salonId, serviceId]
  );

  let consumidos = 0;
  let faltantes = 0;
  for (const item of receta) {
    const { rows: previo } = await db.query(
      `SELECT id FROM inventario_consumos_reserva WHERE booking_id = $1 AND item_id = $2`,
      [bookingId, item.item_id]
    );
    if (previo.length) continue;

    const solicitada = Number(item.cantidad_solicitada);
    const disponible = Math.max(0, Number(item.stock_actual));
    const consumida = Math.min(solicitada, disponible);
    const faltante = solicitada - consumida;

    if (consumida > 0) {
      await db.query(
        `UPDATE inventario_salon SET stock_actual = stock_actual - $1, actualizado_en = NOW()
          WHERE id = $2 AND salon_id = $3`,
        [consumida, item.item_id, salonId]
      );
      await db.query(
        `INSERT INTO inventario_movimientos
           (tenant_id, salon_id, item_id, tipo, cantidad, motivo, registrado_por,
            idempotency_key, request_hash, booking_id, service_id)
         VALUES ($1, $2, $3, 'SALIDA', $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (tenant_id, salon_id, idempotency_key)
           WHERE idempotency_key IS NOT NULL DO NOTHING`,
        [tenantId, salonId, item.item_id, consumida,
          `Consumo de reserva ${bookingId}${faltante ? `; faltante ${faltante} ${item.unidad || ''}` : ''}`.slice(0, 160),
          actorId, `booking:${bookingId}:item:${item.item_id}`,
          `${bookingId}:${serviceId}:${item.item_id}`, bookingId, serviceId]
      );
    }

    await db.query(
      `INSERT INTO inventario_consumos_reserva
         (tenant_id, salon_id, booking_id, service_id, item_id,
          cantidad_solicitada, cantidad_consumida, faltante)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (booking_id, item_id) DO NOTHING`,
      [tenantId, salonId, bookingId, serviceId, item.item_id, solicitada, consumida, faltante]
    );
    if (consumida > 0) consumidos += 1;
    if (faltante > 0) faltantes += 1;
  }
  return { consumidos, faltantes };
}

module.exports = { consumirInsumosDeReserva };
