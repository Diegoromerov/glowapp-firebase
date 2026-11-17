// backend/src/controllers/returnController.js
// Devoluciones (reverse logistics): cliente solicita, proveedor aprueba/rechaza/recibe, reembolso

const { pool, systemPool } = require('../config/db');
const { runInTenantTransaction, runAsSystem } = require('../config/tenantRouting');
const { notificarPartesEnvio } = require('../services/notificationService');
const { EnviameClient } = require('../services/enviameClient');

/**
 * POST /api/client/orders/:id/return
 * Cliente solicita devolución
 * Body: { motivo, fotos[], items: [{producto_id, cantidad}] }
 */
async function solicitarDevolucion(req, res) {
  const clienteId = req.user.id;
  const tenantId = req.user.tenant_id;
  const orderId = req.params.id;
  const { motivo, fotos = [], items } = req.body;

  if (!motivo || motivo.trim().length < 10) {
    return res.status(400).json({ error: 'Motivo obligatorio (mín 10 caracteres)' });
  }
  if (!items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Items a devolver requeridos' });
  }

  try {
    await runInTenantTransaction({ pool }, tenantId, async (client) => {
      // Verificar pedido: del cliente, estado ENTREGADO, dentro de ventana (ej 30 días)
      const pedidoRes = await client.query(
        `SELECT * FROM pedidos_tienda 
         WHERE id = $1 AND comprador_id = $2 AND estado = 'ENTREGADO'
         AND entregado_en > NOW() - INTERVAL '30 days'`,
        [orderId, clienteId]
      );

      if (pedidoRes.rows.length === 0) {
        return res.status(404).json({ error: 'Pedido no encontrado, no entregado o fuera de plazo (30 días)' });
      }

      const pedido = pedidoRes.rows[0];

      // Verificar items existen en el pedido y cantidades válidas
      for (const item of items) {
        const { producto_id, cantidad } = item;
        const itemRes = await client.query(
          `SELECT cantidad FROM detalles_pedido_tienda WHERE pedido_id = $1 AND producto_id = $2`,
          [orderId, producto_id]
        );
        if (itemRes.rows.length === 0) {
          return res.status(400).json({ error: `Producto ${producto_id} no está en este pedido` });
        }
        if (cantidad > itemRes.rows[0].cantidad) {
          return res.status(400).json({ error: `Cantidad a devolver excede la comprada para producto ${producto_id}` });
        }
      }

      // Crear devolución
      const devRes = await client.query(
        `INSERT INTO devoluciones (
           pedido_id, cliente_id, prestador_id, estado, motivo,
           items, fotos, creado_en
         ) VALUES ($1,$2,$3,'SOLICITADA',$4,$5,$6,NOW())
         RETURNING *`,
        [orderId, clienteId, pedido.prestador_comisionado_id, motivo, JSON.stringify(items), JSON.stringify(fotos)]
      );

      const devolucion = devRes.rows[0];

      // Notificar a proveedor
      await notificarPartesEnvio({
        guia: `DEV-${devolucion.id}`, // guía temporal
        eventoTipo: 'DEVOLUCION_SOLICITADA',
        contextoExtra: {
          devolucion_id: devolucion.id,
          pedido_id: orderId,
          motivo,
          items,
        },
      });

      res.json({ success: true, data: devolucion });
    });
  } catch (error) {
    console.error('❌ ERROR EN POST /api/client/orders/:id/return:', error);
    if (!res.headersSent) res.status(500).json({ error: 'Error al solicitar devolución' });
  }
}

/**
 * GET /api/client/returns
 * Cliente lista sus devoluciones
 */
async function getMisDevoluciones(req, res) {
  const clienteId = req.user.id;
  const tenantId = req.user.tenant_id;

  try {
    await runInTenantTransaction({ pool }, tenantId, async (client) => {
      const { rows } = await client.query(
        `SELECT d.*, pt.total as pedido_total, pt.creado_en as pedido_creado
         FROM devoluciones d
         JOIN pedidos_tienda pt ON pt.id = d.pedido_id
         WHERE d.cliente_id = $1
         ORDER BY d.creado_en DESC`,
        [clienteId]
      );

      res.json({ success: true, data: rows });
    });
  } catch (error) {
    console.error('❌ ERROR EN GET /api/client/returns:', error);
    res.status(500).json({ error: 'Error al obtener devoluciones' });
  }
}

/**
 * GET /api/provider/returns
 * Proveedor lista devoluciones de sus pedidos
 */
async function getProviderDevoluciones(req, res) {
  const providerId = req.user.id;
  const tenantId = req.user.tenant_id;

  try {
    await runInTenantTransaction({ pool }, tenantId, async (client) => {
      const { rows } = await client.query(
        `SELECT d.*, pt.total as pedido_total, pt.nombre_entrega, pt.ciudad, pt.departamento,
                u.nombre as cliente_nombre, u.email as cliente_email, u.telefono as cliente_telefono
         FROM devoluciones d
         JOIN pedidos_tienda pt ON pt.id = d.pedido_id
         LEFT JOIN usuarios u ON u.id = d.cliente_id
         WHERE d.prestador_id = $1
         ORDER BY d.creado_en DESC`,
        [providerId]
      );

      res.json({ success: true, data: rows });
    });
  } catch (error) {
    console.error('❌ ERROR EN GET /api/provider/returns:', error);
    res.status(500).json({ error: 'Error al obtener devoluciones' });
  }
}

/**
 * POST /api/provider/returns/:id/approve
 * Proveedor aprueba devolución y genera etiqueta de retorno via Envíame
 * Body: { carrier_retorno?, service_code_retorno? }
 */
async function aprobarDevolucion(req, res) {
  const providerId = req.user.id;
  const tenantId = req.user.tenant_id;
  const devolucionId = req.params.id;
  const { carrier_retorno, service_code_retorno } = req.body;

  try {
    await runInTenantTransaction({ pool }, tenantId, async (client) => {
      // Verificar devolución pertenece a este proveedor y está SOLICITADA
      const devRes = await client.query(
        `SELECT d.*, pt.id as pedido_id, pt.comprador_id, pt.prestador_comisionado_id,
                pt.ciudad, pt.departamento, pt.codigo_postal, pt.direccion_entrega,
                u.nombre as cliente_nombre, u.telefono as cliente_telefono
         FROM devoluciones d
         JOIN pedidos_tienda pt ON pt.id = d.pedido_id
         LEFT JOIN usuarios u ON u.id = d.cliente_id
         WHERE d.id = $1 AND d.prestador_id = $2 AND d.estado = 'SOLICITADA'`,
        [devolucionId, providerId]
      );

      if (devRes.rows.length === 0) {
        return res.status(404).json({ error: 'Devolución no encontrada, no autorizada o ya procesada' });
      }

      const devolucion = devRes.rows[0];

      // Obtener dirección origen (proveedor) para retorno
      const origenRes = await client.query(
        `SELECT * FROM business_profile WHERE user_id = $1`,
        [providerId]
      );
      if (origenRes.rows.length === 0) {
        return res.status(400).json({ error: 'Proveedor no tiene dirección configurada (business_profile)' });
      }
      const origen = origenRes.rows[0];

      // Dirección destino = dirección del proveedor (retorno)
      const destino = {
        ciudad: origen.ciudad,
        departamento: origen.departamento,
        codigo_postal: origen.codigo_postal,
        street: `${origen.tipo_via} ${origen.numero_principal}${origen.letra_principal || ''} ${origen.cruce || ''} ${origen.complemento || ''}`.trim(),
      };

      // Origen = dirección del cliente
      const origenCliente = {
        ciudad: devolucion.ciudad,
        departamento: devolucion.departamento,
        codigo_postal: devolucion.codigo_postal,
        street: devolucion.direccion_entrega,
      };

      // Calcular peso estimado desde items
      const items = typeof devolucion.items === 'string' ? JSON.parse(devolucion.items) : devolucion.items;
      const pesoEstimado = items.reduce((sum, i) => sum + (i.cantidad * 0.2), 0.5); // ~200g por item default

      // Llamar Envíame para generar etiqueta de retorno
      const enviameClient = new EnviameClient({ pool: client });
      const rates = await enviameClient.getRates({
        origin: {
          city: _ciudadToDaneCode(origenCliente.ciudad),
          state: _departamentoToDaneState(origenCliente.departamento),
          country: 'CO',
          postal_code: origenCliente.codigo_postal,
          street: origenCliente.street,
        },
        destination: {
          city: _ciudadToDaneCode(destino.ciudad),
          state: _departamentoToDaneState(destino.departamento),
          country: 'CO',
          postal_code: destino.codigo_postal,
          street: destino.street,
        },
        parcels: [{ weight: pesoEstimado, length: 20, width: 15, height: 10 }],
        value_cop: devolucion.monto_estimado || 50000,
        currency: 'COP',
      });

      // Seleccionar carrier (preferir el pasado o el más barato)
      let bestRate = rates[0];
      if (carrier_retorno) {
        bestRate = rates.find(r => r.carrier === carrier_retorno) || rates[0];
      }

      if (!bestRate) {
        return res.status(500).json({ error: 'No hay carriers disponibles para retorno' });
      }

      const labelResult = await enviameClient.generateLabel({
        rate_id: bestRate.rate_id,
        reference: `return_${devolucionId}`,
        metadata: { devolucion_id: devolucionId, provider_id: providerId },
      });

      // Actualizar devolución con datos de retorno
      await client.query(
        `UPDATE devoluciones SET
           estado = 'APROBADA',
           carrier_retorno = $1,
           carrier_retorno_service_code = $2,
           guia_retorno = $3,
           guia_retorno_tracking_url = $4,
           etiqueta_retorno_pdf_url = $5,
           etiqueta_retorno_zpl = $6,
           aprobada_en = NOW(),
           aprobada_por = $7
         WHERE id = $8`,
        [
          bestRate.carrier,
          bestRate.service_code,
          labelResult.tracking_number,
          labelResult.tracking_url,
          labelResult.label_pdf_url,
          labelResult.label_zpl,
          providerId,
          devolucionId,
        ]
      );

      // Notificar al cliente
      await notificarPartesEnvio({
        guia: labelResult.tracking_number,
        eventoTipo: 'DEVOLUCION_APROBADA',
        contextoExtra: {
          devolucion_id: devolucionId,
          guia_retorno: labelResult.tracking_number,
          label_pdf_url: labelResult.label_pdf_url,
        },
      });

      res.json({
        success: true,
        data: {
          devolucion_id: devolucionId,
          guia_retorno: labelResult.tracking_number,
          tracking_url: labelResult.tracking_url,
          label_pdf_url: labelResult.label_pdf_url,
          label_zpl: labelResult.label_zpl,
          carrier: bestRate.carrier,
          service_code: bestRate.service_code,
        },
      });
    });
  } catch (error) {
    console.error('❌ ERROR EN POST /api/provider/returns/:id/approve:', error);
    if (!res.headersSent) res.status(500).json({ error: 'Error al aprobar devolución: ' + error.message });
  }
}

/**
 * POST /api/provider/returns/:id/reject
 * Proveedor rechaza devolución
 * Body: { motivo_rechazo }
 */
async function rechazarDevolucion(req, res) {
  const providerId = req.user.id;
  const tenantId = req.user.tenant_id;
  const devolucionId = req.params.id;
  const { motivo_rechazo } = req.body;

  if (!motivo_rechazo || motivo_rechazo.trim().length < 10) {
    return res.status(400).json({ error: 'Motivo de rechazo obligatorio (mín 10 caracteres)' });
  }

  try {
    await runInTenantTransaction({ pool }, tenantId, async (client) => {
      const devRes = await client.query(
        `SELECT * FROM devoluciones WHERE id = $1 AND prestador_id = $2 AND estado = 'SOLICITADA'`,
        [devolucionId, providerId]
      );

      if (devRes.rows.length === 0) {
        return res.status(404).json({ error: 'Devolución no encontrada o no autorizada' });
      }

      await client.query(
        `UPDATE devoluciones SET
           estado = 'RECHAZADA',
           rechazo_motivo = $1,
           rechazada_en = NOW(),
           rechazada_por = $2
         WHERE id = $3`,
        [motivo_rechazo, providerId, devolucionId]
      );

      // Notificar al cliente
      await notificarPartesEnvio({
        guia: `DEV-${devolucionId}`,
        eventoTipo: 'DEVOLUCION_RECHAZADA',
        contextoExtra: { devolucion_id: devolucionId, motivo_rechazo },
      });

      res.json({ success: true, data: { message: 'Devolución rechazada' } });
    });
  } catch (error) {
    console.error('❌ ERROR EN POST /api/provider/returns/:id/reject:', error);
    if (!res.headersSent) res.status(500).json({ error: 'Error al rechazar devolución' });
  }
}

/**
 * POST /api/provider/returns/:id/receive
 * Proveedor recibe e inspecciona devolución
 * Body: { inspeccion_estado: 'aprobada'|'rechazada'|'parcial', notas, fotos[], monto_reembolso_cop? }
 */
async function recibirDevolucion(req, res) {
  const providerId = req.user.id;
  const tenantId = req.user.tenant_id;
  const devolucionId = req.params.id;
  const { inspeccion_estado, notas, fotos = [], monto_reembolso_cop } = req.body;

  if (!['aprobada', 'rechazada', 'parcial'].includes(inspeccion_estado)) {
    return res.status(400).json({ error: 'inspeccion_estado debe ser: aprobada, rechazada o parcial' });
  }

  try {
    await runInTenantTransaction({ pool }, tenantId, async (client) => {
      const devRes = await client.query(
        `SELECT d.*, pt.comprador_id, pt.total as pedido_total
         FROM devoluciones d
         JOIN pedidos_tienda pt ON pt.id = d.pedido_id
         WHERE d.id = $1 AND d.prestador_id = $2 AND d.estado = 'APROBADA'`,
        [devolucionId, providerId]
      );

      if (devRes.rows.length === 0) {
        return res.status(404).json({ error: 'Devolución no encontrada, no autorizada o no aprobada' });
      }

      const devolucion = devRes.rows[0];

      // Actualizar inspección
      await client.query(
        `UPDATE devoluciones SET
           inspeccion_estado = $1,
           inspeccion_notas = $2,
           inspeccion_fotos = $3,
           inspeccionada_por = $4,
           inspeccionada_en = NOW(),
           estado = CASE 
             WHEN $1 = 'aprobada' THEN 'RECIBIDA'
             WHEN $1 = 'rechazada' THEN 'RECHAZADA_INSPECCION'
             ELSE 'RECIBIDA_PARCIAL'
           END
         WHERE id = $5`,
        [inspeccion_estado, notas, JSON.stringify(fotos), providerId, devolucionId]
      );

      // Si aprobada o parcial → procesar reembolso
      if (inspeccion_estado === 'aprobada' || inspeccion_estado === 'parcial') {
        const monto = monto_reembolso_cop || (inspeccion_estado === 'aprobada' ? devolucion.pedido_total : Math.round(devolucion.pedido_total * 0.5));
        
        // Aquí iría la llamada a Stripe/Wompi para reembolso
        // Por ahora solo marcamos como pendiente
        await client.query(
          `UPDATE devoluciones SET
             reembolso_monto_cop = $1,
             reembolso_estado = 'pendiente'
           WHERE id = $2`,
          [monto, devolucionId]
        );

        // Notificar cliente
        await notificarPartesEnvio({
          guia: devolucion.guia_retorno,
          eventoTipo: 'DEVOLUCION_RECIBIDA',
          contextoExtra: {
            devolucion_id: devolucionId,
            inspeccion_estado,
            monto_reembolso: monto,
          },
        });
      } else {
        // Rechazada en inspección
        await notificarPartesEnvio({
          guia: devolucion.guia_retorno,
          eventoTipo: 'DEVOLUCION_RECHAZADA',
          contextoExtra: {
            devolucion_id: devolucionId,
            motivo: 'Inspección fallida: ' + notas,
          },
        });
      }

      res.json({ success: true, data: { message: 'Devolución recibida e inspeccionada' } });
    });
  } catch (error) {
    console.error('❌ ERROR EN POST /api/provider/returns/:id/receive:', error);
    if (!res.headersSent) res.status(500).json({ error: 'Error al recibir devolución' });
  }
}

/**
 * Helpers (copiados de orderController para evitar circular)
 */
function _ciudadToDaneCode(ciudad) {
  const map = {
    'bogota': 11001, 'bogotá': 11001,
    'medellin': 5001, 'medellín': 5001,
    'cali': 76001,
    'barranquilla': 8001,
    'cartagena': 13001,
    'bucaramanga': 68001,
    'cucuta': 54001, 'cúcuta': 54001,
    'pereira': 66001,
    'santa marta': 47001,
    'ibague': 73001, 'ibagué': 73001,
  };
  const key = (ciudad || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return map[key] || 11001;
}

function _departamentoToDaneState(departamento) {
  const map = {
    'bogota': 'CUN', 'bogotá': 'CUN', 'cundinamarca': 'CUN',
    'antioquia': 'ANT',
    'valle del cauca': 'VAC', 'valle': 'VAC',
    'atlantico': 'ATL', 'atlántico': 'ATL',
    'bolivar': 'BOL', 'bolívar': 'BOL',
    'santander': 'SAN',
    'norte de santander': 'NSA',
    'risaralda': 'RIS',
    'magdalena': 'MAG',
    'tolima': 'TOL',
  };
  const key = (departamento || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return map[key] || 'CUN';
}

module.exports = {
  solicitarDevolucion,
  getMisDevoluciones,
  getProviderDevoluciones,
  aprobarDevolucion,
  rechazarDevolucion,
  recibirDevolucion,
};