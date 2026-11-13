// src/jobs/nivelJob.js
//
// Red de seguridad del aviso de nivel.
//
// El punto único de XP (`xpService.acreditarXp`) avisa en el momento. Este job
// recorre las cuentas y avisa de cualquier subida que se haya escrito por fuera
// de ese camino: un UPDATE manual, una migración, un script. Sin él, un XP
// acreditado por otra vía dejaría a la usuaria sin enterarse.
//
// No repite avisos: `ultimo_nivel_notificado` es la memoria compartida con el
// punto único.
const tenantRouting = require('../config/tenantRouting');
const { pool } = require('../config/db');
const { nivelDeXp } = require('../config/cuotasIA');
const { avisarNivel } = require('../services/xpService');

const LOTE = 500;

async function avisarNivelesPendientes() {
  const r = await tenantRouting.runAsSystem({ pool }, (c) =>
    c.query(
      `SELECT u.id, u.ultimo_nivel_notificado,
              COALESCE(SUM(x.xp_amount), 0)::int AS xp
         FROM usuarios u
         JOIN xp_logs x ON x.user_id = u.id AND x.xp_amount > 0
        WHERE u.is_active = true
        GROUP BY u.id, u.ultimo_nivel_notificado
        HAVING COALESCE(SUM(x.xp_amount), 0) > 0
        LIMIT ${LOTE}`
    )
  );

  let avisados = 0;
  for (const fila of r.rows) {
    const nivel = nivelDeXp(Number(fila.xp));
    // Glow es el nivel de entrada: nadie «sube» a Glow, y avisarlo sería ruido.
    if (nivel.clave === 'glow') continue;
    if (fila.ultimo_nivel_notificado === nivel.clave) continue;
    const ok = await avisarNivel({ userId: fila.id, nivel });
    if (ok) avisados += 1;
  }
  return { revisadas: r.rows.length, avisados };
}

module.exports = { avisarNivelesPendientes };
