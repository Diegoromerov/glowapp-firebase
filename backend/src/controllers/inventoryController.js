// backend/src/controllers/inventoryController.js
const { pool } = require('../config/db');

// GET /api/provider/inventory/consignment → Obtener inventario en consignación del salón/prestador
exports.getProviderConsignmentInventory = async (req, res) => {
  try {
    const providerId = req.user.id;

    const query = `
      SELECT 
        ic.id,
        ic.producto_id,
        p.nombre AS producto_nombre,
        p.precio AS producto_precio,
        p.imagen_url AS producto_imagen,
        ic.cantidad_entregada,
        ic.cantidad_vendida,
        (ic.cantidad_entregada - ic.cantidad_vendida) AS cantidad_disponible,
        ic.lote,
        ic.fecha_vencimiento,
        ic.fecha_entrega,
        CASE 
          WHEN (ic.cantidad_entregada - ic.cantidad_vendida) <= 2 THEN true 
          ELSE false 
        END AS alerta_stock_bajo
      FROM inventario_consignacion_prestador ic
      JOIN productos p ON ic.producto_id = p.id
      WHERE ic.provider_id = $1
      ORDER BY alerta_stock_bajo DESC, p.nombre ASC;
    `;

    const result = await pool.query(query, [providerId]);

    res.json({
      success: true,
      count: result.rows.length,
      // El cliente (api_service.dart:2005) lee `items`. Con la clave `data`
      // la pantalla recibía 200 pero la lista salía siempre vacía.
      items: result.rows
    });
  } catch (error) {
    console.error('❌ ERROR EN GET /api/provider/inventory/consignment:', error);
    res.status(500).json({ error: 'Error al obtener inventario en consignación' });
  }
};

// POST /api/provider/inventory/consume → Registrar consumo de insumo en cita o venta presencial (Transacción Atómica ACID)
exports.consumeInventoryItem = async (req, res) => {
  const client = await pool.connect();
  try {
    const providerId = req.user.id;
    const { producto_id, cantidad } = req.body;

    const qty = parseInt(cantidad) || 1;
    if (!producto_id || qty <= 0) {
      client.release();
      return res.status(400).json({ error: 'Debes proporcionar producto_id y cantidad válida (>0)' });
    }

    await client.query('BEGIN');

    // Verificar disponibilidad en consignación con bloqueo de fila (FOR UPDATE) para prevenir race conditions
    const checkQuery = `
      SELECT id, cantidad_entregada, cantidad_vendida 
      FROM inventario_consignacion_prestador 
      WHERE provider_id = $1 AND producto_id = $2
      FOR UPDATE;
    `;
    const checkRes = await client.query(checkQuery, [providerId, producto_id]);

    if (checkRes.rows.length === 0) {
      await client.query('ROLLBACK');
      client.release();
      return res.status(404).json({ error: 'Producto no encontrado en el inventario de consignación del prestador' });
    }

    const item = checkRes.rows[0];
    const disponible = item.cantidad_entregada - item.cantidad_vendida;

    if (disponible < qty) {
      await client.query('ROLLBACK');
      client.release();
      return res.status(400).json({ 
        error: `Stock insuficiente en consignación. Disponible: ${disponible}, Solicitado: ${qty}` 
      });
    }

    // Incrementar cantidad vendida/consumida
    const updateQuery = `
      UPDATE inventario_consignacion_prestador
      SET cantidad_vendida = cantidad_vendida + $1
      WHERE id = $2
      RETURNING *, (cantidad_entregada - cantidad_vendida) AS cantidad_disponible;
    `;
    const updateRes = await client.query(updateQuery, [qty, item.id]);

    await client.query('COMMIT');
    client.release();

    res.json({
      success: true,
      message: 'Consumo de insumo registrado en el inventario SaaS',
      data: updateRes.rows[0]
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    client.release();
    console.error('❌ ERROR EN POST /api/inventory/consume:', error);
    res.status(500).json({ error: 'Error al registrar consumo de inventario' });
  }
};
