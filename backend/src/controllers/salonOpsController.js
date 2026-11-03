// backend/src/controllers/salonOpsController.js
// E-06 (D-GL-027) — Inventario operable y recursos alquilables del salón.
//
// REGLAS
//  1. El stock nunca se escribe desde el cliente: se mueve con movimientos
//     tipados (ENTRADA / SALIDA / AJUSTE) y el saldo se recalcula en la misma
//     transacción. Sin eso no hay auditoría y el número no se puede explicar.
//  2. Una salida mayor que el stock se rechaza; no se deja el saldo negativo
//     «para arreglarlo luego».
//  3. Un recurso (silla, mesa, puesto) no puede estar alquilado dos veces a la
//     vez: lo garantiza un índice único parcial en la base, no sólo el código.
//  4. Registrar inventario o alquileres exige rol de administración o recepción.
//     Leer lo puede hacer cualquier miembro activo.
//  5. `salon_id` y `tenant_id` los decide el servidor: el tenant sale del salón,
//     nunca del cuerpo de la petición.

const { pool } = require('../config/db');

const CATEGORIAS = new Set(['INSUMO', 'PRODUCTO', 'HERRAMIENTA', 'OTRO']);
const TIPOS_MOVIMIENTO = new Set(['ENTRADA', 'SALIDA', 'AJUSTE']);
const TIPOS_RECURSO = new Set(['SILLA', 'MESA', 'PUESTO', 'CABINA', 'OTRO']);
const ROLES_QUE_ESCRIBEN = new Set(['DUEÑO', 'ADMINISTRADOR', 'RECEPCIONISTA', 'MANAGER']);

function rolDe(req) {
  return String((req.salonMembership && req.salonMembership.sub_rol) || '').toUpperCase();
}

function puedeEscribir(req) {
  return ROLES_QUE_ESCRIBEN.has(rolDe(req));
}

function numero(valor) {
  const n = Number(valor);
  return Number.isFinite(n) ? n : null;
}

function crearControladorOps(db = pool) {
  // ── Inventario ────────────────────────────────────────────────────────────

  /** GET /api/salon/:salonId/inventario */
  async function listarInventario(req, res) {
    try {
      const { rows } = await db.query(
        `SELECT id, nombre, categoria, unidad, stock_actual, stock_minimo,
                costo_unitario, proveedor,
                (stock_actual <= stock_minimo) AS stock_bajo
           FROM inventario_salon
          WHERE salon_id = $1 AND activo = TRUE
          ORDER BY (stock_actual <= stock_minimo) DESC, nombre ASC`,
        [req.salonId]
      );

      const items = rows.map((r) => ({
        ...r,
        stock_actual: Number(r.stock_actual),
        stock_minimo: Number(r.stock_minimo),
        costo_unitario: r.costo_unitario === null ? null : Number(r.costo_unitario),
      }));

      return res.json({
        success: true,
        total: items.length,
        stock_bajo: items.filter((i) => i.stock_bajo).length,
        puede_editar: puedeEscribir(req),
        items,
      });
    } catch (error) {
      console.error('❌ ERROR listarInventario:', error.message);
      return res.status(500).json({ error: 'No se pudo leer el inventario.' });
    }
  }

  /** POST /api/salon/:salonId/inventario */
  async function crearItem(req, res) {
    if (!puedeEscribir(req)) {
      return res.status(403).json({ error: 'Tu rol no edita el inventario del salón.' });
    }

    const { nombre, categoria, unidad, stock_minimo, costo_unitario, proveedor, stock_inicial } =
      req.body || {};

    if (!nombre || String(nombre).trim().length < 2) {
      return res.status(400).json({ error: 'nombre es obligatorio (mínimo 2 caracteres).' });
    }
    const categoriaNorm = String(categoria || 'INSUMO').toUpperCase();
    if (!CATEGORIAS.has(categoriaNorm)) {
      return res.status(400).json({ error: 'categoria no válida.', validas: [...CATEGORIAS] });
    }
    const minimo = numero(stock_minimo ?? 0);
    const inicial = numero(stock_inicial ?? 0);
    const costo = costo_unitario === undefined || costo_unitario === null
      ? null
      : numero(costo_unitario);

    if (minimo === null || minimo < 0) {
      return res.status(400).json({ error: 'stock_minimo debe ser un número mayor o igual a cero.' });
    }
    if (inicial === null || inicial < 0) {
      return res.status(400).json({ error: 'stock_inicial debe ser un número mayor o igual a cero.' });
    }
    if (costo !== null && (costo < 0)) {
      return res.status(400).json({ error: 'costo_unitario no puede ser negativo.' });
    }

    try {
      // Inquilino desde el perfil de negocio (fuente única, D-GL-027).
      // `salones.tenant_id` es legado y puede ser NULL: usarlo producía un
      // INSERT con NULL en una columna NOT NULL.
      const { rows: perfilRows } = await db.query(
        `SELECT tenant_id FROM business_profiles
          WHERE id = left('salon-' || $1::text, 36)`,
        [req.salonId]
      );
      if (perfilRows.length === 0) {
        return res.status(409).json({
          error: 'El salón no tiene identidad provisionada (business_profiles).',
          salon_id: Number(req.salonId),
        });
      }

      const { rows } = await db.query(
        `INSERT INTO inventario_salon
           (tenant_id, salon_id, nombre, categoria, unidad, stock_actual, stock_minimo,
            costo_unitario, proveedor)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING id, nombre, categoria, unidad, stock_actual, stock_minimo, costo_unitario`,
        [
          perfilRows[0].tenant_id, req.salonId, String(nombre).trim(), categoriaNorm,
          String(unidad || 'UNIDAD').toUpperCase(), inicial, minimo, costo,
          proveedor || null,
        ]
      );

      return res.status(201).json({
        success: true,
        item: {
          ...rows[0],
          stock_actual: Number(rows[0].stock_actual),
          stock_minimo: Number(rows[0].stock_minimo),
          costo_unitario: rows[0].costo_unitario === null ? null : Number(rows[0].costo_unitario),
        },
      });
    } catch (error) {
      // 23505 = unique_violation: el insumo ya existe en este salón.
      if (error.code === '23505') {
        return res.status(409).json({ error: 'Ya existe un insumo con ese nombre en el salón.' });
      }
      console.error('❌ ERROR crearItemInventario:', error.message);
      return res.status(500).json({ error: 'No se pudo crear el insumo.' });
    }
  }

  /** POST /api/salon/:salonId/inventario/:itemId/movimientos */
  async function registrarMovimiento(req, res) {
    if (!puedeEscribir(req)) {
      return res.status(403).json({ error: 'Tu rol no mueve el inventario del salón.' });
    }

    const { tipo, cantidad, motivo } = req.body || {};
    const tipoNorm = String(tipo || '').toUpperCase();
    const cant = numero(cantidad);

    if (!TIPOS_MOVIMIENTO.has(tipoNorm)) {
      return res.status(400).json({
        error: 'tipo debe ser ENTRADA, SALIDA o AJUSTE.',
        validos: [...TIPOS_MOVIMIENTO],
      });
    }
    if (cant === null || cant <= 0) {
      return res.status(400).json({ error: 'cantidad debe ser mayor que cero.' });
    }

    try {
      const { rows: itemRows } = await db.query(
        `SELECT id, tenant_id, stock_actual FROM inventario_salon
          WHERE id = $1 AND salon_id = $2`,
        [req.params.itemId, req.salonId]
      );
      if (itemRows.length === 0) {
        return res.status(404).json({ error: 'El insumo no existe en este salón.' });
      }

      const item = itemRows[0];
      const actual = Number(item.stock_actual);

      // AJUSTE fija el saldo; ENTRADA suma; SALIDA resta.
      const nuevo = tipoNorm === 'AJUSTE'
        ? cant
        : tipoNorm === 'ENTRADA'
          ? actual + cant
          : actual - cant;

      if (nuevo < 0) {
        return res.status(400).json({
          error: 'La salida supera el stock disponible.',
          stock_actual: actual,
          solicitado: cant,
        });
      }

      const { rows } = await db.query(
        `UPDATE inventario_salon
            SET stock_actual = $1, actualizado_en = NOW()
          WHERE id = $2 AND salon_id = $3
          RETURNING id, nombre, stock_actual, stock_minimo`,
        [nuevo, item.id, req.salonId]
      );

      await db.query(
        `INSERT INTO inventario_movimientos
           (tenant_id, salon_id, item_id, tipo, cantidad, motivo, registrado_por)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [item.tenant_id, req.salonId, item.id, tipoNorm, cant, motivo || null, req.user.id]
      );

      return res.status(201).json({
        success: true,
        item: {
          ...rows[0],
          stock_actual: Number(rows[0].stock_actual),
          stock_minimo: Number(rows[0].stock_minimo),
        },
        movimiento: { tipo: tipoNorm, cantidad: cant },
      });
    } catch (error) {
      console.error('❌ ERROR registrarMovimientoInventario:', error.message);
      return res.status(500).json({ error: 'No se pudo registrar el movimiento.' });
    }
  }

  /** GET /api/salon/:salonId/inventario/:itemId/movimientos */
  async function historialItem(req, res) {
    try {
      const { rows } = await db.query(
        `SELECT id, tipo, cantidad, motivo, registrado_por, creado_en
           FROM inventario_movimientos
          WHERE item_id = $1 AND salon_id = $2
          ORDER BY creado_en DESC
          LIMIT 100`,
        [req.params.itemId, req.salonId]
      );
      return res.json({
        success: true,
        total: rows.length,
        items: rows.map((r) => ({ ...r, cantidad: Number(r.cantidad) })),
      });
    } catch (error) {
      console.error('❌ ERROR historialItem:', error.message);
      return res.status(500).json({ error: 'No se pudo leer el historial.' });
    }
  }

  // ── Recursos alquilables ──────────────────────────────────────────────────

  /** GET /api/salon/:salonId/recursos */
  async function listarRecursos(req, res) {
    try {
      const { rows } = await db.query(
        `SELECT r.id, r.nombre, r.tipo, r.canon_mensual, r.estado,
                a.persona_id, a.periodo_inicio
           FROM recursos_alquilables r
           LEFT JOIN alquileres a ON a.recurso_id = r.id AND a.estado = 'ACTIVO'
          WHERE r.salon_id = $1
          ORDER BY r.estado ASC, r.nombre ASC`,
        [req.salonId]
      );

      const items = rows.map((r) => ({ ...r, canon_mensual: Number(r.canon_mensual) }));
      return res.json({
        success: true,
        total: items.length,
        ocupados: items.filter((i) => i.estado === 'OCUPADO').length,
        puede_editar: puedeEscribir(req),
        items,
      });
    } catch (error) {
      console.error('❌ ERROR listarRecursos:', error.message);
      return res.status(500).json({ error: 'No se pudieron leer los recursos.' });
    }
  }

  /** POST /api/salon/:salonId/recursos */
  async function crearRecurso(req, res) {
    if (!puedeEscribir(req)) {
      return res.status(403).json({ error: 'Tu rol no administra los recursos del salón.' });
    }

    const { nombre, tipo, canon_mensual } = req.body || {};
    if (!nombre || String(nombre).trim().length < 2) {
      return res.status(400).json({ error: 'nombre es obligatorio.' });
    }
    const tipoNorm = String(tipo || 'PUESTO').toUpperCase();
    if (!TIPOS_RECURSO.has(tipoNorm)) {
      return res.status(400).json({ error: 'tipo no válido.', validos: [...TIPOS_RECURSO] });
    }
    const canon = numero(canon_mensual ?? 0);
    if (canon === null || canon < 0) {
      return res.status(400).json({ error: 'canon_mensual no puede ser negativo.' });
    }

    try {
      // Inquilino desde el perfil de negocio (fuente única, D-GL-027).
      // `salones.tenant_id` es legado y puede ser NULL: usarlo producía un
      // INSERT con NULL en una columna NOT NULL.
      const { rows: perfilRows } = await db.query(
        `SELECT tenant_id FROM business_profiles
          WHERE id = left('salon-' || $1::text, 36)`,
        [req.salonId]
      );
      if (perfilRows.length === 0) {
        return res.status(409).json({
          error: 'El salón no tiene identidad provisionada (business_profiles).',
          salon_id: Number(req.salonId),
        });
      }

      const { rows } = await db.query(
        `INSERT INTO recursos_alquilables (tenant_id, salon_id, nombre, tipo, canon_mensual)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, nombre, tipo, canon_mensual, estado`,
        [perfilRows[0].tenant_id, req.salonId, String(nombre).trim(), tipoNorm, canon]
      );

      return res.status(201).json({
        success: true,
        recurso: { ...rows[0], canon_mensual: Number(rows[0].canon_mensual) },
      });
    } catch (error) {
      if (error.code === '23505') {
        return res.status(409).json({ error: 'Ya existe un recurso con ese nombre en el salón.' });
      }
      console.error('❌ ERROR crearRecurso:', error.message);
      return res.status(500).json({ error: 'No se pudo crear el recurso.' });
    }
  }

  /** POST /api/salon/:salonId/alquileres */
  async function crearAlquiler(req, res) {
    if (!puedeEscribir(req)) {
      return res.status(403).json({ error: 'Tu rol no registra alquileres.' });
    }

    const { recurso_id: recursoId, persona_id: personaId, periodo_inicio: inicio } = req.body || {};
    if (!recursoId) return res.status(400).json({ error: 'recurso_id es obligatorio.' });
    if (!personaId) return res.status(400).json({ error: 'persona_id es obligatorio.' });

    try {
      const { rows: recursoRows } = await db.query(
        `SELECT id, tenant_id, canon_mensual, estado FROM recursos_alquilables
          WHERE id = $1 AND salon_id = $2`,
        [recursoId, req.salonId]
      );
      if (recursoRows.length === 0) {
        return res.status(404).json({ error: 'El recurso no existe en este salón.' });
      }

      const recurso = recursoRows[0];
      if (recurso.estado !== 'DISPONIBLE') {
        return res.status(409).json({
          error: 'El recurso no está disponible.',
          estado: recurso.estado,
        });
      }

      const canon = numero(req.body.canon_mensual ?? recurso.canon_mensual) ?? 0;

      const { rows } = await db.query(
        `INSERT INTO alquileres
           (tenant_id, salon_id, recurso_id, persona_id, canon_mensual, periodo_inicio, creado_por)
         VALUES ($1, $2, $3, $4, $5, COALESCE($6::date, CURRENT_DATE), $7)
         RETURNING id, recurso_id, persona_id, canon_mensual, periodo_inicio, estado`,
        [recurso.tenant_id, req.salonId, recurso.id, personaId, canon, inicio || null, req.user.id]
      );

      await db.query(
        `UPDATE recursos_alquilables SET estado = 'OCUPADO' WHERE id = $1`,
        [recurso.id]
      );

      return res.status(201).json({
        success: true,
        alquiler: { ...rows[0], canon_mensual: Number(rows[0].canon_mensual) },
      });
    } catch (error) {
      // El índice único parcial es la última palabra: un recurso, un alquiler activo.
      if (error.code === '23505') {
        return res.status(409).json({ error: 'Ese recurso ya tiene un alquiler activo.' });
      }
      console.error('❌ ERROR crearAlquiler:', error.message);
      return res.status(500).json({ error: 'No se pudo registrar el alquiler.' });
    }
  }

  /** GET /api/salon/:salonId/alquileres */
  async function listarAlquileres(req, res) {
    const soloMios = !puedeEscribir(req);
    try {
      const { rows } = await db.query(
        `SELECT a.id, a.recurso_id, r.nombre AS recurso_nombre, r.tipo,
                a.persona_id, a.canon_mensual, a.periodo_inicio, a.periodo_fin, a.estado
           FROM alquileres a
           JOIN recursos_alquilables r ON r.id = a.recurso_id
          WHERE a.salon_id = $1
            ${soloMios ? 'AND a.persona_id = $2' : ''}
          ORDER BY a.estado ASC, a.periodo_inicio DESC`,
        soloMios ? [req.salonId, req.user.id] : [req.salonId]
      );

      return res.json({
        success: true,
        alcance: soloMios ? 'PROPIO' : 'SALON',
        total: rows.length,
        items: rows.map((r) => ({ ...r, canon_mensual: Number(r.canon_mensual) })),
      });
    } catch (error) {
      console.error('❌ ERROR listarAlquileres:', error.message);
      return res.status(500).json({ error: 'No se pudieron leer los alquileres.' });
    }
  }
  return {
    listarInventario,
    crearItem,
    registrarMovimiento,
    historialItem,
    listarRecursos,
    crearRecurso,
    crearAlquiler,
    listarAlquileres,
  };
}

module.exports = { ...crearControladorOps(), crearControladorOps };
