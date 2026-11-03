const { wrapRouterAsync } = require('../utils/expressAsync');
const express = require('express');
const router = express.Router();
const providerController = require('../controllers/providerController');
const { authMiddleware } = require('../middleware/auth');
const { pool } = require('../config/db');
const {
  validarRut,
  validarCodigoResponsabilidad,
  resolverResponsabilidadIva,
  reconciliarConDian
} = require('../services/ivaPrestador');

// ─── CONTRATO DE COMISIÓN E INDEPENDENCIA (D-GL-023 · F8) ────────────────────
// El prestador es independiente, no empleado. Se registra versión, fecha e IP:
// sin ese registro no hay forma de probar el vínculo comercial.

const CONTRATO_VERSION_ACTUAL = '2026-10';

router.get('/provider/contract', authMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query(
      // `responsable_iva` y `rut_responsabilidad_codigo` viven en `usuarios`
      // (migraciones 086 y 087), no en `perfiles_prestador`. La consulta las pedía
      // a la tabla equivocada y la ruta devolvía 500 en cada llamada, de modo que
      // el prestador no podía ver ni aceptar su contrato.
      `SELECT p.contrato_version, p.contrato_aceptado_at, p.independencia_aceptada_at,
              u.responsable_iva, u.rut_responsabilidad_codigo
         FROM perfiles_prestador p
         JOIN usuarios u ON u.id = p.id
        WHERE p.id = $1`,
      [req.user.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Perfil de prestador no encontrado.' });

    res.json({
      version_actual: CONTRATO_VERSION_ACTUAL,
      ...rows[0],
      aceptado: Boolean(rows[0].contrato_aceptado_at && rows[0].independencia_aceptada_at)
    });
  } catch (err) {
    console.error('Error al consultar contrato:', err);
    res.status(500).json({ error: 'Error al consultar el contrato.' });
  }
});

router.post('/provider/contract/accept', authMiddleware, async (req, res) => {
  const { version, independencia } = req.body;

  if (!independencia) {
    return res.status(400).json({
      error: 'Debes aceptar expresamente la cláusula de independencia: la plataforma no es tu empleador.'
    });
  }

  try {
    const { rows } = await pool.query(
      // `RETURNING` solo devuelve columnas de la tabla actualizada: las fiscales
      // se leen de `usuarios` con un CTE. El `JOIN` dentro del UPDATE mezclaría
      // las filas y dejaría el perfil sin actualizar.
      `WITH actualizado AS (
         UPDATE perfiles_prestador
            SET contrato_version = $2,
                contrato_aceptado_at = NOW(),
                contrato_aceptado_ip = $3,
                independencia_aceptada_at = NOW()
          WHERE id = $1
          RETURNING *
       )
       SELECT a.contrato_version, a.contrato_aceptado_at, a.independencia_aceptada_at,
              u.responsable_iva, u.rut_responsabilidad_codigo
         FROM actualizado a
         JOIN usuarios u ON u.id = a.id`,
      [req.user.id, version || CONTRATO_VERSION_ACTUAL, req.ip]
    );

    if (!rows.length) return res.status(404).json({ error: 'Perfil de prestador no encontrado.' });

    res.json({
      ok: true,
      mensaje: 'Contrato aceptado. Ya puedes recibir pagos y retirar.',
      contrato: rows[0]
    });
  } catch (err) {
    console.error('Error al aceptar contrato:', err);
    res.status(500).json({ error: 'Error al registrar la aceptación.' });
  }
});

router.get('/providers', providerController.getProviders);
router.get('/providers/:id', providerController.getProviderById);
router.get('/providers/:id/slots', providerController.getProviderSlots);

// ─── HORARIOS DEL PRESTADOR ──────────────────────────────────────────────────

// GET /api/provider/schedule
router.get('/provider/schedule', authMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT active_start_hour, active_end_hour, weekly_schedule
       FROM perfiles_prestador
       WHERE id = $1`,
      [req.user.id]
    );

    if (!rows.length) {
      return res.status(404).json({ error: 'Perfil de prestador no encontrado.' });
    }

    res.json({
      active_start_hour: rows[0].active_start_hour ?? 8,
      active_end_hour: rows[0].active_end_hour ?? 19,
      weekly_schedule: rows[0].weekly_schedule ?? {}
    });
  } catch (err) {
    console.error('Error al consultar horario de prestador:', err);
    res.status(500).json({ error: 'Error al consultar horario de atención.' });
  }
});

// PUT /api/provider/schedule
router.put('/provider/schedule', authMiddleware, async (req, res) => {
  const { weekly_schedule, active_start_hour, active_end_hour } = req.body;

  try {
    const startHour = active_start_hour !== undefined ? parseInt(active_start_hour) : 8;
    const endHour = active_end_hour !== undefined ? parseInt(active_end_hour) : 19;

    const { rows } = await pool.query(
      `UPDATE perfiles_prestador
       SET weekly_schedule = COALESCE($2, weekly_schedule),
           active_start_hour = $3,
           active_end_hour = $4,
           updated_at = NOW()
       WHERE id = $1
       RETURNING active_start_hour, active_end_hour, weekly_schedule`,
      [req.user.id, weekly_schedule ? JSON.stringify(weekly_schedule) : null, startHour, endHour]
    );

    if (!rows.length) {
      return res.status(404).json({ error: 'Perfil de prestador no encontrado.' });
    }

    res.json({
      ok: true,
      mensaje: 'Horario de atención actualizado correctamente.',
      horario: rows[0]
    });
  } catch (err) {
    console.error('Error al actualizar horario de prestador:', err);
    res.status(500).json({ error: 'Error al actualizar horario de atención.' });
  }
});

// ─── DATOS FISCALES: RESPONSABILIDAD DE IVA DEL PRESTADOR ───────────────────
//
// Contexto: hallazgo W13 de `.hermes/REVISAR.md` y el diseño en
// `.hermes/plans/2026-10-10_captura-responsabilidad-iva-onboarding.md`.
//
// El art. 476 num. 1 lit. a) del E.T. dice que los tratamientos de belleza están
// GRAVADOS, pero quién cobra el impuesto lo decide el art. 437 par. 3 (por
// ingresos) y consta en el RUT: código 48 = responsable de IVA, 49 = no
// responsable.
//
// D3 — mientras el prestador no declare, NO se presume responsable y sus reservas
// no discriminan IVA. Como el precio publicado es el precio final al consumidor,
// esto NO cambia lo que paga el cliente: sólo deja de desglosarse un IVA que el
// prestador no ha acreditado.
const ROLES_ADMIN = ['admin', 'ADMIN', 'superadmin', 'SUPERADMIN'];

// GET /api/provider/fiscal — estado de la responsabilidad de IVA del prestador.
router.get('/provider/fiscal', authMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT rut_numero, rut_responsabilidad_codigo, responsable_iva,
              responsable_iva_override, responsabilidad_iva_fuente,
              responsabilidad_iva_actualizada_at
         FROM usuarios
        WHERE id = $1`,
      [req.user.id]
    );

    if (!rows.length) {
      return res.status(404).json({ error: 'Usuario no encontrado.' });
    }

    const fila = rows[0];
    res.json({
      rut_numero: fila.rut_numero,
      rut_responsabilidad_codigo: fila.rut_responsabilidad_codigo,
      responsable_iva: fila.responsable_iva,
      override: fila.responsable_iva_override,
      fuente: fila.responsabilidad_iva_fuente,
      actualizada_at: fila.responsabilidad_iva_actualizada_at,
      // Explícito, para que la app no tenga que deducir el estado.
      estado: fila.responsabilidad_iva_fuente ? 'DECLARADA' : 'SIN_DECLARAR'
    });
  } catch (err) {
    console.error('Error al consultar datos fiscales:', err);
    res.status(500).json({ error: 'Error al consultar los datos fiscales.' });
  }
});

// PATCH /api/provider/fiscal — declarar la responsabilidad de IVA.
// D2: el número de RUT es obligatorio. D1: el valor se DERIVA del código, y el
// override manual queda auditado (y sólo lo fija un admin).
// Extensión: si la DIAN está disponible, valida y reconcilia contra el RUT real.
router.patch('/provider/fiscal', authMiddleware, async (req, res) => {
  const { rut_numero, rut_responsabilidad_codigo } = req.body;

  const rut = validarRut(rut_numero);
  if (!rut.valido) {
    return res.status(400).json({ error: 'RUT_INVALIDO', detalle: rut.motivo });
  }

  const codigo = validarCodigoResponsabilidad(rut_responsabilidad_codigo);
  if (!codigo.valido) {
    return res.status(400).json({
      error: 'CODIGO_RESPONSABILIDAD_INVALIDO',
      detalle: codigo.motivo
    });
  }

  try {
    const actual = await pool.query(
      'SELECT responsable_iva_override FROM usuarios WHERE id = $1',
      [req.user.id]
    );
    if (!actual.rows.length) {
      return res.status(404).json({ error: 'Usuario no encontrado.' });
    }

    // El override NO lo puede tocar el prestador: si pudiera, se declararía a sí
    // mismo lo contrario de lo que dice su RUT. Es una decisión de un admin, y
    // queda registrada como MANUAL (D1).
    let override = actual.rows[0].responsable_iva_override;
    if (Object.prototype.hasOwnProperty.call(req.body, 'override')) {
      if (!ROLES_ADMIN.includes(req.user.role)) {
        return res.status(403).json({
          error: 'OVERRIDE_REQUIERE_ADMIN',
          detalle:
            'El override de la responsabilidad de IVA sólo lo puede fijar un administrador.'
        });
      }
      override = req.body.override === null ? null : Boolean(req.body.override);
    }

    // Reconciliar con DIAN (si disponible)
    const reconciliacion = await reconciliarConDian({
      rutNumero: rut.rut,
      codigoDeclarado: codigo.codigo,
      override
    });

    const { rows } = await pool.query(
      `UPDATE usuarios
          SET rut_numero = $2,
              rut_responsabilidad_codigo = $3,
              responsable_iva = $4,
              responsable_iva_override = $5,
              responsabilidad_iva_fuente = $6,
              responsabilidad_iva_actualizada_at = NOW(),
              responsabilidad_iva_cambiada_por = $7
        WHERE id = $1
        RETURNING rut_numero, rut_responsabilidad_codigo, responsable_iva,
                  responsable_iva_override, responsabilidad_iva_fuente,
                  responsabilidad_iva_actualizada_at`,
      [
        req.user.id,
        rut.rut,
        codigo.codigo,
        reconciliacion.responsableIva === true,
        override,
        reconciliacion.fuente,
        req.user.id
      ]
    );

    res.json({
      ok: true,
      mensaje: reconciliacion.responsableIva
        ? 'Quedaste registrado como responsable de IVA.'
        : 'Quedaste registrado como no responsable de IVA.',
      fiscal: {
        ...rows[0],
        estado: reconciliacion.fuente ? 'DECLARADA' : 'SIN_DECLARAR',
        // Auditoría de la reconciliación DIAN
        auditoria_dian: reconciliacion.auditoria
      }
    });
  } catch (err) {
    console.error('Error al actualizar datos fiscales:', err);
    res.status(500).json({ error: 'Error al actualizar los datos fiscales.' });
  }
});

wrapRouterAsync(router);
module.exports = router;
