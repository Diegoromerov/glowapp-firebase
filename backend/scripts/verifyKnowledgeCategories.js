#!/usr/bin/env node
/**
 * backend/scripts/verifyKnowledgeCategories.js
 * Verificación de la Fase 1 (filtros): el vocabulario canónico de `config/knowledgeCategories.js`
 * debe coincidir EXACTAMENTE con las categorías que existen en la base de conocimiento, y toda
 * categoría del vocabulario debe poder filtrar (devolver > 0 chunks cuando hay corpus).
 *
 * Uso:  node scripts/verifyKnowledgeCategories.js
 * Salida: códigos 0 (todo correcto) / 1 (desajuste) — apto para CI.
 */

require('dotenv').config();
const { pool } = require('../src/config/db');
const { KNOWLEDGE_CATEGORIES, resolveCategory } = require('../src/config/knowledgeCategories');

(async () => {
  const fallos = [];
  const avisos = [];

  try {
    const { rows: dist } = await pool.query(
      `SELECT category, COUNT(*)::int AS n
       FROM beauty_knowledge_embeddings
       WHERE deleted_at IS NULL
       GROUP BY category ORDER BY n DESC`
    );

    if (dist.length === 0) {
      console.log('⚠️  La tabla beauty_knowledge_embeddings está vacía: no se puede contrastar contra datos.');
      console.log('    (Es el estado esperado hasta la re-ingesta de la Fase 0.)');
      process.exit(0);
    }

    const enBd = dist.map(r => r.category);
    const faltanEnVocabulario = enBd.filter(c => !KNOWLEDGE_CATEGORIES.includes(c));
    const sinDocumentos = KNOWLEDGE_CATEGORIES.filter(c => !enBd.includes(c));

    console.log(`Categorías en BD: ${enBd.length} | en el vocabulario: ${KNOWLEDGE_CATEGORIES.length}`);
    console.log('\nDistribución real por categoría:');
    for (const r of dist) console.log(`  ${String(r.n).padStart(5)}  ${r.category}${KNOWLEDGE_CATEGORIES.includes(r.category) ? '' : '   <-- FUERA del vocabulario'}`);

    if (faltanEnVocabulario.length > 0) {
      fallos.push(`Categorías en BD que NO están en el vocabulario: ${faltanEnVocabulario.join(', ')}`);
    }
    if (sinDocumentos.length > 0) {
      avisos.push(`Categorías del vocabulario sin documentos (¿corpus incompleto?): ${sinDocumentos.join(', ')}`);
    }

    // Toda categoría del vocabulario debe sobrevivir la validación del filtro (no descartarse)
    const descartadas = KNOWLEDGE_CATEGORIES.filter(c => resolveCategory(c) === null);
    if (descartadas.length > 0) {
      fallos.push(`Categorías del vocabulario que el filtro descartaría: ${descartadas.join(', ')}`);
    }

    // Y toda categoría debe devolver algo al filtrar (con corpus cargado)
    const vacias = [];
    for (const c of KNOWLEDGE_CATEGORIES) {
      const { rows } = await pool.query(
        'SELECT COUNT(*)::int AS n FROM beauty_knowledge_embeddings WHERE deleted_at IS NULL AND category = $1',
        [c]
      );
      if (rows[0].n === 0) vacias.push(c);
    }
    if (vacias.length > 0) fallos.push(`Categorías del vocabulario que devuelven 0 filas: ${vacias.join(', ')}`);

    console.log('');
    avisos.forEach(a => console.log('⚠️ ', a));
    if (fallos.length === 0) {
      console.log('✅ Fase 1 — vocabulario y filtros coherentes: las 12 categorías existen y devuelven chunks.');
      process.exit(0);
    }
    fallos.forEach(f => console.log('❌', f));
    process.exit(1);

  } catch (error) {
    console.error('❌ No se pudo verificar (¿base de datos accesible?):', error.message);
    process.exit(1);
  } finally {
    if (pool && typeof pool.end === 'function') await pool.end().catch(() => {});
  }
})();
