#!/usr/bin/env node
/**
 * scripts/publishAcademyContent.js
 * ============================================================================
 * Publica el material didáctico real de `docs/academy/**` en `academy_lessons`.
 *
 * Contexto (auditoría 2026-09-22): las lecciones del curso de colorimetría se
 * crearon con el marcador interno `CONTENIDO_LECCION_*` y el alumno veía ese
 * texto en pantalla. La migración 066 sustituye el marcador por un aviso honesto
 * de "contenido en preparación"; este script es el que carga el contenido de
 * verdad, desde los documentos versionados del repositorio.
 *
 * Uso:
 *   node scripts/publishAcademyContent.js            # simulación (no escribe)
 *   node scripts/publishAcademyContent.js --apply    # publica de verdad
 *   node scripts/publishAcademyContent.js --apply --only=a0000000-...-0001
 *
 * Requiere DATABASE_URL (o las variables PG* / el .env del backend).
 * Es idempotente: solo actualiza las lecciones cuyo contenido cambia.
 * ============================================================================
 */

const fs = require('fs');
const path = require('path');

try {
  // eslint-disable-next-line global-require
  require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
} catch (_) { /* dotenv es opcional */ }

const { Client } = require('pg');

const DOCS_DIR = path.join(__dirname, '..', '..', 'docs', 'academy', 'modulo-1');

/**
 * Correspondencia explícita documento → lección del currículo canónico
 * (definido en backend/migrations/066_fix_academia_curriculum_and_content.sql).
 * Se declara a mano y no por heurística: publicar material en la lección
 * equivocada es peor que no publicarlo.
 */
const PUBLICACIONES = [
  { archivo: 'leccion-1-fisica-luz-circulo-cromatico-itten.md', lessonId: 'a0000000-0000-0000-0000-000000000001' },
  { archivo: 'leccion-2-matiz-valor-intensidad.md', lessonId: 'a0000000-0000-0000-0000-000000000002' },
  { archivo: 'leccion-3-quimica-melanina-eumelanina-feomelanina.md', lessonId: 'a0000000-0000-0000-0000-000000000003' },
  // Las leyes de neutralización pertenecen al módulo de corrección de color
  { archivo: 'leccion-4-leyes-neutralizacion-complementarios.md', lessonId: 'a0000000-0000-0000-0000-000000000009' },
];

/**
 * Markdown → texto plano legible en la app Flutter (su visor muestra texto, no
 * markdown). Conserva la estructura (títulos, listas, tablas) sin los marcadores.
 */
function markdownAPlano(markdown) {
  const lineas = String(markdown).replace(/\r\n/g, '\n').split('\n');
  const salida = [];

  for (const linea of lineas) {
    const limpia = linea.replace(/\s+$/, '');

    // Encabezados # y ## que duplican el título que ya está en la base
    if (/^#{1,2}\s/.test(limpia)) continue;

    // Separadores de tabla markdown (|---|---|)
    if (/^\s*\|?[\s:-]*-[\s|:-]*\|?\s*$/.test(limpia) && limpia.includes('-')) continue;

    // Filas de tabla: | a | b | -> a · b
    if (limpia.trim().startsWith('|')) {
      const celdas = limpia.split('|').map((c) => c.trim()).filter((c) => c.length > 0);
      if (celdas.length) salida.push(`• ${celdas.join(' · ')}`);
      continue;
    }

    salida.push(
      limpia
        // Subtítulos ### -> "Subtítulo:"
        .replace(/^###\s+(.*)$/, '$1')
        .replace(/^####\s+(.*)$/, '$1')
        // Negritas / cursivas
        .replace(/\*\*(.+?)\*\*/g, '$1')
        .replace(/(^|\W)\*(?!\s)(.+?)\*/g, '$1$2')
        .replace(/__(.+?)__/g, '$1')
        // Código en línea
        .replace(/`([^`]+)`/g, '$1')
        // Enlaces [texto](url) -> texto (url)
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')
        // Viñetas markdown -> viñeta tipográfica
        .replace(/^\s*[-*+]\s+/, '• ')
    );
  }

  // Colapsar más de 2 líneas en blanco seguidas
  return salida.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

async function main() {
  const args = process.argv.slice(2);
  const aplicar = args.includes('--apply');
  const solo = (args.find((a) => a.startsWith('--only=')) || '').split('=')[1];

  const connectionString = process.env.DATABASE_URL
    || `postgres://${process.env.DB_USER || 'postgres'}:${process.env.DB_PASSWORD}@${process.env.DB_HOST || 'localhost'}:${process.env.DB_PORT || 5432}/${process.env.DB_NAME || 'beauty_db'}`;

  const planes = [];
  for (const pub of PUBLICACIONES) {
    if (solo && pub.lessonId !== solo) continue;

    const ruta = path.join(DOCS_DIR, pub.archivo);
    if (!fs.existsSync(ruta)) {
      planes.push({ ...pub, error: `no existe ${ruta}` });
      continue;
    }

    const contenido = markdownAPlano(fs.readFileSync(ruta, 'utf8'));
    if (contenido.length < 200) {
      planes.push({ ...pub, error: `contenido sospechosamente corto (${contenido.length} caracteres)` });
      continue;
    }
    planes.push({ ...pub, contenido, bytes: contenido.length });
  }

  console.log(`\n📚 Documentos encontrados en ${DOCS_DIR}`);
  console.log(`🔎 Modo: ${aplicar ? 'APLICAR (escribe en la base)' : 'SIMULACIÓN (no escribe; usa --apply)'}\n`);

  const client = new Client({ connectionString });
  await client.connect();

  let actualizadas = 0;
  let omitidas = 0;

  try {
    for (const plan of planes) {
      if (plan.error) {
        console.log(`❌ ${plan.archivo}: ${plan.error}`);
        continue;
      }

      const { rows } = await client.query(
        'SELECT id, title, content_text FROM academy_lessons WHERE id = $1',
        [plan.lessonId]
      );

      if (!rows.length) {
        console.log(`⚠️  ${plan.archivo}: la lección ${plan.lessonId} no existe en esta base (¿migraciones aplicadas?)`);
        continue;
      }

      const leccion = rows[0];
      const yaIgual = (leccion.content_text || '') === plan.contenido;

      console.log(`${yaIgual ? '✅' : '✏️ '} ${leccion.title}`);
      console.log(`    ${plan.archivo} → ${plan.bytes} caracteres (antes: ${(leccion.content_text || '').length})`);

      if (yaIgual) {
        omitidas += 1;
        continue;
      }
      if (!aplicar) continue;

      await client.query(
        'UPDATE academy_lessons SET content_text = $1 WHERE id = $2',
        [plan.contenido, plan.lessonId]
      );
      actualizadas += 1;
    }

    if (aplicar) {
      const { rows } = await client.query(`
        SELECT COUNT(*)::int AS total,
               COUNT(*) FILTER (WHERE content_text LIKE 'CONTENIDO_LECCION%')::int AS marcadores,
               COUNT(*) FILTER (WHERE content_text LIKE 'Contenido en preparación%')::int AS en_preparacion
          FROM academy_lessons`);
      const r = rows[0];
      console.log(`\n📊 Lecciones: ${r.total} | con marcador interno: ${r.marcadores} | en preparación: ${r.en_preparacion}`);
    }

    console.log(`\n${aplicar ? '✅ Publicadas' : '🧪 Se publicarían'}: ${planes.length - omitidas - planes.filter((p) => p.error).length} | sin cambios: ${omitidas}`);
    if (aplicar) console.log(`✍️  Filas actualizadas: ${actualizadas}`);
    console.log('');
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('💥 Error publicando el contenido de la academia:', err.message);
  process.exit(1);
});

module.exports = { markdownAPlano, PUBLICACIONES };
