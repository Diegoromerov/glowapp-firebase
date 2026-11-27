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
const { getActiveClient } = require('../config/tenantRouting');
const usageMeteringService = require('../services/usageMeteringService');
const crypto = require('crypto');

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

function idempotencyKey(req) {
  const raw = req.body?.idempotency_key || req.get?.('Idempotency-Key');
  const key = raw == null ? null : String(raw).trim();
  return key && key.length <= 100 ? key : null;
}

function hashSolicitud(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

// Auth middleware owns the request transaction and initializes RLS with the
// user's legacy tenant. Salon operational tables use business_profiles.tenant_id,
// so switch this request-local transaction to the verified salon tenant before
// querying inventory, recipes, resources, or rentals.
async function getSalonOperationalDb(req, db) {
  const client = getActiveClient();
  if (!client) return db; // Direct controller tests / explicitly injected DB.
  if (!req.user?.id || !req.salonId) throw new Error('Falta el contexto autenticado del salón.');

  await client.query("SELECT set_config('app.user_id', $1, true)", [String(req.user.id)]);
  const { rows } = await client.query(
    `SELECT bp.tenant_id
       FROM salones s
       JOIN business_profiles bp ON bp.id = s.business_profile_id
      WHERE s.id = $1`,
    [req.salonId]
  );
  if (!rows.length || !rows[0].tenant_id) throw new Error('El salón no tiene un tenant empresarial activo.');
  req.salonOperationalTenantId = String(rows[0].tenant_id);
  await client.query("SELECT set_config('app.tenant_id', $1, true)", [req.salonOperationalTenantId]);
  return client;
}

function crearControladorOps(db = pool) {
  // ── Inventario ────────────────────────────────────────────────────────────

  /** GET /api/salon/:salonId/inventario */
  async function listarInventario(req, res) {
    try {
      const queryDb = await getSalonOperationalDb(req, db);
      const { rows } = await queryDb.query(
        `SELECT i.id, i.nombre, i.categoria, i.unidad, i.stock_actual, i.stock_minimo,
                i.costo_unitario, i.proveedor,
                (i.stock_actual <= i.stock_minimo) AS stock_bajo,
                COALESCE(c.faltante_reservas, 0)::numeric AS faltante_reservas_acumulado
           FROM inventario_salon i
           LEFT JOIN (
             SELECT item_id, SUM(faltante) AS faltante_reservas
               FROM inventario_consumos_reserva
              WHERE salon_id = $1 AND faltante > 0
              GROUP BY item_id
           ) c ON c.item_id = i.id
          WHERE i.salon_id = $1 AND i.activo = TRUE
          ORDER BY (i.stock_actual <= i.stock_minimo) DESC, i.nombre ASC`,
        [req.salonId]
      );

      const items = rows.map((r) => ({
        ...r,
        stock_actual: Number(r.stock_actual),
        stock_minimo: Number(r.stock_minimo),
        costo_unitario: r.costo_unitario === null ? null : Number(r.costo_unitario),
        faltante_reservas_acumulado: Number(r.faltante_reservas_acumulado || 0),
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

    let paso = 'resolver tenant del salón';
    try {
      paso = 'inicializar contexto RLS del salón';
      const queryDb = await getSalonOperationalDb(req, db);
      // Inquilino desde el perfil de negocio (fuente única, D-GL-027).
      // `salones.tenant_id` es legado y puede ser NULL: usarlo producía un
      // INSERT con NULL en una columna NOT NULL.
      paso = 'resolver tenant del perfil empresarial';
      let tenantId = req.salonOperationalTenantId;
      if (!tenantId) {
        const { rows: perfilRows } = await queryDb.query(
          `SELECT bp.tenant_id
             FROM salones s
             JOIN business_profiles bp ON bp.id = s.business_profile_id
            WHERE s.id = $1`,
          [req.salonId]
        );
        tenantId = perfilRows[0]?.tenant_id || null;
      }
      if (!tenantId) {
        return res.status(409).json({
          error: 'El salón no tiene identidad provisionada (business_profiles).',
          salon_id: Number(req.salonId),
        });
      }

      paso = 'insertar artículo de inventario';
      const { rows } = await queryDb.query(
        `INSERT INTO inventario_salon
           (tenant_id, salon_id, nombre, categoria, unidad, stock_actual, stock_minimo,
            costo_unitario, proveedor)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING id, nombre, categoria, unidad, stock_actual, stock_minimo, costo_unitario`,
        [
          tenantId, req.salonId, String(nombre).trim(), categoriaNorm,
          String(unidad || 'UNIDAD').toUpperCase(), inicial, minimo, costo,
          proveedor || null,
        ]
      );

      if (inicial > 0) {
        paso = 'registrar stock inicial';
        await queryDb.query(
          `INSERT INTO inventario_movimientos
             (tenant_id, salon_id, item_id, tipo, cantidad, motivo, registrado_por)
           VALUES ($1, $2, $3, 'ENTRADA', $4, 'Stock inicial', $5)`,
          [tenantId, req.salonId, rows[0].id, inicial, req.user.id]
        );
      }

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
      req.tenantTransactionError = error;
      console.error(`❌ ERROR crearItemInventario (${paso}):`, error.message);
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
    const key = idempotencyKey(req);
    if (!key || key.length < 8) {
      return res.status(400).json({ error: 'idempotency_key es obligatorio (8–100 caracteres).' });
    }

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
      const queryDb = await getSalonOperationalDb(req, db);
      const { rows: itemRows } = await queryDb.query(
        `SELECT id, tenant_id, stock_actual FROM inventario_salon
          WHERE id = $1 AND salon_id = $2 FOR UPDATE`,
        [req.params.itemId, req.salonId]
      );
      if (itemRows.length === 0) {
        return res.status(404).json({ error: 'El insumo no existe en este salón.' });
      }

      const item = itemRows[0];
      const actual = Number(item.stock_actual);

      const requestHash = hashSolicitud({ item_id: item.id, tipo: tipoNorm, cantidad: cant, motivo: motivo || null });
      // Serializa la misma clave incluso cuando dos reintentos apuntan a
      // insumos distintos; el bloqueo por fila solo cubriría el mismo insumo.
      await queryDb.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [key]);
      if (key) {
        const { rows: repetido } = await queryDb.query(
          `SELECT id, request_hash FROM inventario_movimientos
            WHERE tenant_id = $1 AND salon_id = $2 AND idempotency_key = $3`,
          [item.tenant_id, req.salonId, key]
        );
        if (repetido.length) {
          if (repetido[0].request_hash !== requestHash) {
            return res.status(409).json({ error: 'La clave de idempotencia ya se usó con otros datos.' });
          }
          return res.status(200).json({ success: true, repetido: true, movimiento_id: repetido[0].id });
        }
      }

      // El bloqueo serializa movimientos simultáneos del mismo insumo.
      // La primera lectura también se bloquea (FOR UPDATE) en el SELECT de arriba.

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

      const { rows } = await queryDb.query(
        `UPDATE inventario_salon
            SET stock_actual = $1, actualizado_en = NOW()
          WHERE id = $2 AND salon_id = $3
          RETURNING id, nombre, stock_actual, stock_minimo`,
        [nuevo, item.id, req.salonId]
      );

      await queryDb.query(
        `INSERT INTO inventario_movimientos
           (tenant_id, salon_id, item_id, tipo, cantidad, motivo, registrado_por,
            idempotency_key, request_hash)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [item.tenant_id, req.salonId, item.id, tipoNorm, cant, motivo || null, req.user.id, key, key ? requestHash : null]
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
      req.tenantTransactionError = error;
      console.error('❌ ERROR registrarMovimientoInventario:', error.message);
      return res.status(500).json({ error: 'No se pudo registrar el movimiento.' });
    }
  }

  /** GET /api/salon/:salonId/inventario/:itemId/movimientos */
  async function historialItem(req, res) {
    try {
      const queryDb = await getSalonOperationalDb(req, db);
      const { rows } = await queryDb.query(
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
      const queryDb = await getSalonOperationalDb(req, db);
      const { rows } = await queryDb.query(
        `SELECT r.id, r.nombre, r.tipo, r.canon_mensual, r.estado,
                a.id AS alquiler_id, a.persona_id, a.periodo_inicio
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

    const client = typeof db.connect === 'function' ? await db.connect() : db;
    const inTransaction = client !== db;
    try {
      if (inTransaction) await client.query('BEGIN');
      // This controller owns a separate connection/transaction. The request's
      // AsyncLocalStorage tenant context belongs to another client, so copy the
      // authenticated subject and legacy salon tenant onto this transaction
      // before touching RLS-protected salons/business_profiles.
      if (req.user?.id !== undefined && req.user?.id !== null) {
        await client.query("SELECT set_config('app.user_id', $1, true)", [String(req.user.id)]);
        if (req.user.tenant_id !== undefined && req.user.tenant_id !== null) {
          await client.query("SELECT set_config('app.tenant_id', $1, true)", [String(req.user.tenant_id)]);
        }
      }
      // Serialize quota check + insert per salon without SELECT FOR UPDATE on
      // business_profiles: RLS grants the app role profile reads, not row updates.
      // A transaction-scoped advisory lock avoids bypassing that policy and is
      // automatically released on COMMIT/ROLLBACK.
      if (inTransaction) {
        await client.query('SELECT pg_advisory_xact_lock($1, $2)', [73107, Number(req.salonId)]);
      }
      // Inquilino desde el perfil de negocio (fuente única, D-GL-027).
      // `salones.tenant_id` es legado y puede ser NULL: usarlo producía un
      // INSERT con NULL en una columna NOT NULL.
      const { rows: perfilRows } = await client.query(
        `SELECT bp.tenant_id, bp.saas_plan
           FROM salones s
           JOIN business_profiles bp ON bp.id = s.business_profile_id
          WHERE s.id = $1
          `,
        [req.salonId]
      );
      if (perfilRows.length === 0) {
        if (inTransaction) await client.query('ROLLBACK');
        return res.status(409).json({
          error: 'El salón no tiene identidad provisionada (business_profiles).',
          salon_id: Number(req.salonId),
        });
      }

      const plan = perfilRows[0].saas_plan || 'FREEMIUM';
      // Operational resource rows use the canonical business_profile tenant
      // (VARCHAR), while auth's tenant_id is the legacy integer tenant. After
      // validating the salon/profile using the auth tenant, scope the remaining
      // resource count/insert to the canonical tenant for this transaction.
      if (req.user?.id !== undefined && req.user?.id !== null && perfilRows[0].tenant_id) {
        await client.query("SELECT set_config('app.tenant_id', $1, true)", [String(perfilRows[0].tenant_id)]);
      }
      const limit = usageMeteringService.getLimit(plan, 'RESOURCES');
      const { rows: countRows } = await client.query(
        `SELECT COUNT(*)::int AS count FROM recursos_alquilables WHERE salon_id = $1`,
        [req.salonId]
      );
      const current = Number(countRows[0]?.count || 0);
      if (limit === 0 || (limit !== null && current >= limit)) {
        if (inTransaction) await client.query('ROLLBACK');
        return res.status(403).json({
          error: limit === 0
              ? 'El plan actual no incluye la gestión de recursos.'
              : 'Límite de recursos alcanzado para el plan actual.',
          code: 'SAAS_QUOTA_EXCEEDED',
          feature: 'RESOURCES',
          current,
          limit,
          plan,
          upgradeUrl: '/api/saas/billing/checkout',
        });
      }

      const { rows } = await client.query(
        `INSERT INTO recursos_alquilables (tenant_id, salon_id, nombre, tipo, canon_mensual)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, nombre, tipo, canon_mensual, estado`,
        [perfilRows[0].tenant_id, req.salonId, String(nombre).trim(), tipoNorm, canon]
      );
      if (inTransaction) await client.query('COMMIT');

      return res.status(201).json({
        success: true,
        recurso: { ...rows[0], canon_mensual: Number(rows[0].canon_mensual) },
      });
    } catch (error) {
      if (inTransaction) await client.query('ROLLBACK').catch(() => {});
      if (error.code === '23505') {
        return res.status(409).json({ error: 'Ya existe un recurso con ese nombre en el salón.' });
      }
      console.error('❌ ERROR crearRecurso:', error.message);
      return res.status(500).json({ error: 'No se pudo crear el recurso.' });
    } finally {
      if (inTransaction) client.release();
    }
  }

  /** POST /api/salon/:salonId/alquileres */
  async function crearAlquiler(req, res) {
    if (!puedeEscribir(req)) {
      return res.status(403).json({ error: 'Tu rol no registra alquileres.' });
    }

    const { recurso_id: recursoId, persona_id: personaId, periodo_inicio: inicio } = req.body || {};
    if (!recursoId) return res.status(400).json({ error: 'recurso_id es obligatorio.' });
    const personaIdNorm = Number(personaId);
    if (!Number.isInteger(personaIdNorm) || personaIdNorm <= 0) {
      return res.status(400).json({ error: 'persona_id debe ser un identificador entero positivo.' });
    }

    try {
      const queryDb = await getSalonOperationalDb(req, db);
      const { rows: recursoRows } = await queryDb.query(
        `SELECT id, tenant_id, canon_mensual, estado FROM recursos_alquilables
          WHERE id = $1 AND salon_id = $2 FOR UPDATE`,
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

      const { rows } = await queryDb.query(
        `INSERT INTO alquileres
           (tenant_id, salon_id, recurso_id, persona_id, canon_mensual, periodo_inicio, creado_por)
         VALUES ($1, $2, $3, $4, $5, COALESCE($6::date, CURRENT_DATE), $7)
         RETURNING id, recurso_id, persona_id, canon_mensual, periodo_inicio, estado`,
        [recurso.tenant_id, req.salonId, recurso.id, personaIdNorm, canon, inicio || null, req.user.id]
      );

      await queryDb.query(
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
      req.tenantTransactionError = error;
      console.error('❌ ERROR crearAlquiler:', error.message);
      return res.status(500).json({ error: 'No se pudo registrar el alquiler.' });
    }
  }

  /** PATCH /api/salon/:salonId/alquileres/:alquilerId/finalizar */
  async function finalizarAlquiler(req, res) {
    if (!puedeEscribir(req)) {
      return res.status(403).json({ error: 'Tu rol no administra los alquileres del salón.' });
    }

    try {
      const queryDb = await getSalonOperationalDb(req, db);
      const { rows } = await queryDb.query(
        `UPDATE alquileres
            SET estado = 'FINALIZADO', periodo_fin = COALESCE(periodo_fin, CURRENT_DATE)
          WHERE id = $1 AND salon_id = $2 AND estado = 'ACTIVO'
          RETURNING id, recurso_id, persona_id, estado, periodo_fin`,
        [req.params.alquilerId, req.salonId]
      );
      if (!rows.length) {
        const { rows: existente } = await queryDb.query(
          `SELECT id, estado FROM alquileres WHERE id = $1 AND salon_id = $2`,
          [req.params.alquilerId, req.salonId]
        );
        return existente.length
          ? res.status(409).json({ error: 'El alquiler ya está finalizado.', estado: existente[0].estado })
          : res.status(404).json({ error: 'El alquiler no existe en este salón.' });
      }

      await queryDb.query(
        `UPDATE recursos_alquilables SET estado = 'DISPONIBLE'
          WHERE id = $1 AND salon_id = $2`,
        [rows[0].recurso_id, req.salonId]
      );
      return res.json({ success: true, alquiler: rows[0] });
    } catch (error) {
      req.tenantTransactionError = error;
      console.error('❌ ERROR finalizarAlquiler:', error.message);
      return res.status(500).json({ error: 'No se pudo finalizar el alquiler.' });
    }
  }

  async function listarInsumosServicio(req, res) {
    try {
      const queryDb = await getSalonOperationalDb(req, db);
      const { rows } = await queryDb.query(
        `SELECT si.id, si.service_id, si.item_id, i.nombre, i.unidad, si.cantidad
           FROM salon_servicio_insumos si
           JOIN inventario_salon i ON i.id = si.item_id AND i.salon_id = si.salon_id
          WHERE si.salon_id = $1 AND si.service_id = $2 AND si.activo = TRUE
          ORDER BY i.nombre`,
        [req.salonId, req.params.serviceId]
      );
      return res.json({ success: true, items: rows.map((r) => ({ ...r, cantidad: Number(r.cantidad) })) });
    } catch (error) {
      console.error('❌ ERROR listarInsumosServicio:', error.message);
      return res.status(500).json({ error: 'No se pudieron consultar los insumos del servicio.' });
    }
  }

  async function guardarInsumosServicio(req, res) {
    if (!puedeEscribir(req)) {
      return res.status(403).json({ error: 'Tu rol no puede modificar los insumos de servicios.' });
    }
    const items = req.body?.items;
    if (!Array.isArray(items) || items.length > 100) {
      return res.status(400).json({ error: 'items debe ser una lista de hasta 100 insumos.' });
    }
    const vistos = new Set();
    for (const item of items) {
      const qty = numero(item?.cantidad);
      if (!item?.item_id || qty === null || qty <= 0 || vistos.has(String(item.item_id))) {
        return res.status(400).json({ error: 'Cada insumo debe ser único y tener una cantidad mayor que cero.' });
      }
      vistos.add(String(item.item_id));
    }
    try {
      // `services.tenant_id` uses the legacy integer tenant. Validate the
      // service before switching this transaction to the canonical business
      // profile tenant used by operational tables.
      const authClient = getActiveClient();
      let servicioRows;
      if (authClient) {
        const { rows } = await authClient.query(
          `SELECT sv.id FROM services sv
             JOIN salones s ON s.id = sv.salon_id
            WHERE sv.id = $1 AND sv.salon_id = $2 AND sv.is_active = TRUE
              AND sv.business_profile_id = s.business_profile_id`,
          [req.params.serviceId, req.salonId]
        );
        servicioRows = rows;
      }

      const queryDb = await getSalonOperationalDb(req, db);
      if (!servicioRows) {
        const { rows } = await queryDb.query(
          `SELECT sv.id FROM services sv
             JOIN salones s ON s.id = sv.salon_id
            WHERE sv.id = $1 AND sv.salon_id = $2 AND sv.is_active = TRUE
              AND sv.business_profile_id = s.business_profile_id`,
          [req.params.serviceId, req.salonId]
        );
        servicioRows = rows;
      }
      if (!servicioRows.length) return res.status(404).json({ error: 'El servicio no existe en este salón.' });

      let tenantId = req.salonOperationalTenantId;
      if (!tenantId) {
        const { rows: perfil } = await queryDb.query(
          `SELECT bp.tenant_id FROM salones s JOIN business_profiles bp ON bp.id = s.business_profile_id WHERE s.id = $1`,
          [req.salonId]
        );
        tenantId = perfil[0]?.tenant_id || null;
      }
      if (!tenantId) return res.status(409).json({ error: 'El salón no tiene identidad de negocio provisionada.' });

      if (items.length) {
        const ids = items.map((x) => x.item_id);
        const { rows: válidos } = await queryDb.query(
          `SELECT id FROM inventario_salon
            WHERE salon_id = $1 AND tenant_id = $3 AND id = ANY($2::uuid[]) AND activo = TRUE`,
          [req.salonId, ids, tenantId]
        );
        if (válidos.length !== ids.length) return res.status(400).json({ error: 'Hay insumos inexistentes o inactivos en esta sede.' });
      }
      await queryDb.query(
        `UPDATE salon_servicio_insumos SET activo = FALSE, actualizado_en = NOW()
          WHERE salon_id = $1 AND service_id = $2 AND activo = TRUE`,
        [req.salonId, req.params.serviceId]
      );
      for (const item of items) {
        await queryDb.query(
          `INSERT INTO salon_servicio_insumos
             (tenant_id, salon_id, service_id, item_id, cantidad, activo, creado_por, actualizado_en)
           VALUES ($1, $2, $3, $4, $5, TRUE, $6, NOW())
           ON CONFLICT (salon_id, service_id, item_id)
           DO UPDATE SET cantidad = EXCLUDED.cantidad, activo = TRUE,
                         actualizado_en = NOW(), creado_por = EXCLUDED.creado_por`,
          [tenantId, req.salonId, req.params.serviceId, item.item_id, Number(item.cantidad), req.user.id]
        );
      }
      return res.json({ success: true, service_id: req.params.serviceId, total_insumos: items.length });
    } catch (error) {
      req.tenantTransactionError = error;
      console.error('❌ ERROR guardarInsumosServicio:', error.message);
      return res.status(500).json({ error: 'No se pudieron guardar los insumos del servicio.' });
    }
  }

  /** GET /api/salon/:salonId/alquileres */
  async function listarAlquileres(req, res) {
    const soloMios = !puedeEscribir(req);
    try {
      const queryDb = await getSalonOperationalDb(req, db);
      const { rows } = await queryDb.query(
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
    finalizarAlquiler,
    listarInsumosServicio,
    guardarInsumosServicio,
  };
}

module.exports = { ...crearControladorOps(), crearControladorOps };
