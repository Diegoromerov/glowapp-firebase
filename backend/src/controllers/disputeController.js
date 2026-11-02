// backend/src/controllers/disputeController.js
const { sequelize } = require('../config/database');
const { QueryTypes } = require('sequelize');

// POST /api/disputas -> Abrir una nueva disputa
exports.createDispute = async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role; // 'client' o 'provider'
    const { booking_id, tipo, descripcion, evidencia_urls } = req.body;

    if (!booking_id || !tipo || !descripcion) {
      return res.status(400).json({ error: 'booking_id, tipo y descripcion son campos obligatorios.' });
    }

    // 1. Verificar existencia y validez de la reserva
    const bookingQuery = `SELECT id, valor_bruto, client_id, provider_id, estado FROM bookings WHERE id = :booking_id;`;
    const bookings = await sequelize.query(bookingQuery, {
      replacements: { booking_id },
      type: QueryTypes.SELECT
    });

    if (bookings.length === 0) {
      return res.status(404).json({ error: 'Reserva no encontrada.' });
    }

    const booking = bookings[0];

    // Verificar que el usuario esté involucrado en la reserva
    const isClient = booking.client_id === userId;
    const isProvider = booking.provider_id === userId;

    if (!isClient && !isProvider) {
      return res.status(403).json({ error: 'No tienes autorización para disputar esta reserva.' });
    }

    // Verificar si ya existe una disputa para esta reserva
    const disputeCheckQuery = `SELECT id FROM disputas WHERE booking_id = :booking_id;`;
    const existingDisputes = await sequelize.query(disputeCheckQuery, {
      replacements: { booking_id },
      type: QueryTypes.SELECT
    });

    if (existingDisputes.length > 0) {
      return res.status(400).json({ error: 'Ya existe una disputa activa para esta reserva.' });
    }

    const actorType = userRole === 'client' ? 'CLIENTE' : 'PRESTADOR';
    const amount = booking.valor_bruto;

    // 2. Insertar la disputa
    const insertQuery = `
      INSERT INTO disputas (booking_id, iniciado_por, tipo_actor, tipo, descripcion, evidencia_urls, monto_disputado, estado)
      VALUES (:booking_id, :userId, :actorType, :tipo, :descripcion, :evidencia_urls, :amount, 'ABIERTA')
      RETURNING id, booking_id, iniciado_por, tipo_actor, tipo, descripcion, evidencia_urls, monto_disputado, estado, creado_at;
    `;

    const results = await sequelize.query(insertQuery, {
      replacements: {
        booking_id,
        userId,
        actorType,
        tipo,
        descripcion,
        evidencia_urls: evidencia_urls || [],
        amount
      },
      type: QueryTypes.INSERT
    });

    const newDispute = results[0][0];

    res.status(201).json({
      success: true,
      data: newDispute
    });
  } catch (error) {
    console.error('❌ ERROR EN POST /api/disputas:', error);
    res.status(500).json({ error: 'Error al iniciar la disputa.' });
  }
};

// GET /api/disputas/my-disputes -> Listar disputas del usuario o todas si es Admin
exports.getMyDisputes = async (req, res) => {
  try {
    const userId = req.user.id;
    const is_admin = req.user.role === 'admin';

    let query = `
      SELECT d.*, b.scheduled_at as booking_fecha, s.name as servicio_nombre
      FROM disputas d
      JOIN bookings b ON d.booking_id = b.id
      JOIN services s ON b.service_id = s.id
    `;
    const replacements = {};

    if (!is_admin) {
      query += ` WHERE d.iniciado_por = :userId OR b.provider_id = :userId`;
      replacements.userId = userId;
    }

    query += ` ORDER BY d.creado_at DESC;`;

    const disputes = await sequelize.query(query, {
      replacements,
      type: QueryTypes.SELECT
    });

    res.json({
      success: true,
      data: disputes
    });
  } catch (error) {
    console.error('❌ ERROR EN GET /api/disputas/my-disputes:', error);
    res.status(500).json({ error: 'Error al obtener las disputas.' });
  }
};

// GET /api/disputas/:id -> Detalle de una disputa
exports.getDisputeById = async (req, res) => {
  try {
    const disputeId = req.params.id;
    const userId = req.user.id;
    const is_admin = req.user.role === 'admin';

    const query = `
      SELECT d.*, b.client_id, b.provider_id, s.name as servicio_nombre
      FROM disputas d
      JOIN bookings b ON d.booking_id = b.id
      JOIN services s ON b.service_id = s.id
      WHERE d.id = :disputeId;
    `;

    const results = await sequelize.query(query, {
      replacements: { disputeId },
      type: QueryTypes.SELECT
    });

    if (results.length === 0) {
      return res.status(404).json({ error: 'Disputa no encontrada.' });
    }

    const dispute = results[0];

    // Verificar permisos
    if (!is_admin && dispute.client_id !== userId && dispute.provider_id !== userId) {
      return res.status(403).json({ error: 'No autorizado para ver esta disputa.' });
    }

    res.json({
      success: true,
      data: dispute
    });
  } catch (error) {
    console.error('❌ ERROR EN GET /api/disputas/:id:', error);
    res.status(500).json({ error: 'Error al obtener detalle de la disputa.' });
  }
};

// PATCH /api/disputas/:id/resolve -> Resolver disputa (Solo Admin)
exports.resolveDispute = async (req, res) => {
  try {
    const disputeId = req.params.id;
    const adminId = req.user.id;
    const { resolucion, porcentaje_prestador, nota_resolucion } = req.body;

    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Solo los administradores pueden resolver disputas.' });
    }

    if (!resolucion || !['REEMBOLSO_CLIENTE', 'LIBERAR_PRESTADOR', 'PARCIAL'].includes(resolucion)) {
      return res.status(400).json({ error: 'Resolución inválida.' });
    }

    // Verificar existencia de la disputa
    const checkQuery = `SELECT id, estado FROM disputas WHERE id = :disputeId;`;
    const check = await sequelize.query(checkQuery, {
      replacements: { disputeId },
      type: QueryTypes.SELECT
    });

    if (check.length === 0) {
      return res.status(404).json({ error: 'Disputa no encontrada.' });
    }

    if (check[0].estado === 'RESUELTA') {
      return res.status(400).json({ error: 'La disputa ya ha sido resuelta.' });
    }

    // Actualizar la disputa
    const updateQuery = `
      UPDATE disputas
      SET estado = 'RESUELTA',
          resuelto_por = :adminId,
          resolucion = :resolucion,
          porcentaje_prestador = :porcentaje_prestador,
          nota_resolucion = :nota_resolucion,
          resuelto_at = NOW(),
          actualizado_at = NOW()
      WHERE id = :disputeId
      RETURNING *;
    `;

    const results = await sequelize.query(updateQuery, {
      replacements: {
        disputeId,
        adminId,
        resolucion,
        porcentaje_prestador: porcentaje_prestador || 0.0,
        nota_resolucion: nota_resolucion || ''
      },
      type: QueryTypes.UPDATE
    });

    res.json({
      success: true,
      message: 'Disputa resuelta exitosamente.',
      data: results[0][0]
    });
  } catch (error) {
    console.error('❌ ERROR EN PATCH /api/disputas/:id/resolve:', error);
    res.status(500).json({ error: 'Error al resolver la disputa.' });
  }
};
