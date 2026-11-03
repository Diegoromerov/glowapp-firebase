#!/usr/bin/env node
/**
 * backend/scripts/r5c13AnnotateBlind.js
 * CICLO 25 — FASE 2: Anotación CIEGA del pool (por contenido, sin mapping)
 *
 * El anotador recibe: query + candidates anonimizados (solo contenido/título).
 * Clasifica cada candidato: 3 RELEVANT / 2 PARTIALLY / 1 RELATED / 0 NOT / U / A
 *
 * La anotación se basa EXCLUSIVAMENTE en el contenido semántico.
 * El mapping se revela después (FASE 3) en el script principal.
 *
 * Uso: node scripts/r5c13AnnotateBlind.js --run=A
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');

const OUT_DIR = path.join(__dirname, '..', 'src', 'data', 'eval');

async function main() {
  const args = process.argv.slice(2);
  const run = (args.find(a => a.startsWith('--run=')) || '--run=A').split('=')[1];
  const blindPath = path.join(OUT_DIR, `r5c13_blind_gold_candidates_${run.toLowerCase()}.json`);
  const blind = JSON.parse(fs.readFileSync(blindPath, 'utf8'));

  // ── ANOTACIÓN MANUAL (juicio semántico sobre contenido, sin chunk_ids) ──
  // Formato: query_id -> { anon_id: {label, score, reason} }
  // Solo se anotan los candidatos RELEVANTES/parciales; el resto queda NOT_RELEVANT por defecto
  const annotation = {
    'skincare_003': {
      'candidate_01': { label: 'RELEVANT', score: 3, reason: 'Clima de Bogotá + textura de piel: responde rutina para piel grasa en clima húmedo' },
      'candidate_05': { label: 'RELEVANT', score: 3, reason: 'Altitud y poros en Bogotá: adaptación cutánea directa a la intención' },
      'candidate_02': { label: 'PARTIALLY_RELEVANT', score: 2, reason: 'LHA para descamación: ingrediente útil para piel grasa, no específico de clima' },
      'candidate_06': { label: 'PARTIALLY_RELEVANT', score: 2, reason: 'Osmolaridad del estrato córneo: relacionado con clima/humedad' },
      'candidate_04': { label: 'RELATED_BUT_NOT_ANSWERING', score: 1, reason: 'Quelación de metales: contexto urbano pero no responde rutina' },
      'candidate_03': { label: 'RELATED_BUT_NOT_ANSWERING', score: 1, reason: 'Maquillaje para brotes: tangencial' },
    },
    'skincare_005': {
      'candidate_05': { label: 'RELEVANT', score: 3, reason: 'Filtros solares químicos vs físicos en pieles reactivas: responde directamente' },
      'candidate_01': { label: 'PARTIALLY_RELEVANT', score: 2, reason: 'Reactividad neurogénica de piel sensible: contexto, no selección de SPF' },
      'candidate_02': { label: 'PARTIALLY_RELEVANT', score: 2, reason: 'Mezcla de protector con maquillaje: relacionado con uso de SPF' },
      'candidate_08': { label: 'RELATED_BUT_NOT_ANSWERING', score: 1, reason: 'Alfa-arbutina: activo para melasma pero no es protector solar' },
    },
    'skincare_006': {
      'candidate_05': { label: 'RELEVANT', score: 3, reason: 'Reología del AH: selección estratégica, responde uso correcto' },
      'candidate_02': { label: 'RELEVANT', score: 3, reason: 'AH alto peso molecular y riesgo de efecto esponja: uso correcto' },
      'candidate_01': { label: 'RELEVANT', score: 3, reason: 'Skin flooding con AH: técnica de aplicación directa' },
      'candidate_06': { label: 'PARTIALLY_RELEVANT', score: 2, reason: 'Reología por indicación: relacionado' },
      'candidate_03': { label: 'RELATED_BUT_NOT_ANSWERING', score: 1, reason: 'Suplementación ingerible: no responde aplicación tópica' },
      'candidate_04': { label: 'RELATED_BUT_NOT_ANSWERING', score: 1, reason: 'Suplementación oral: tangencial' },
    },
    'skincare_007': {
      'candidate_05': { label: 'RELEVANT', score: 3, reason: 'Reloj biológico cutáneo y rutina nocturna: responde anti-edad nocturna' },
      'candidate_06': { label: 'RELEVANT', score: 3, reason: 'Cronocosmética: sincronización con ritmo circadiano, anti-edad nocturna' },
      'candidate_01': { label: 'PARTIALLY_RELEVANT', score: 2, reason: 'Autofagia con péptidos: mecanismo anti-edad pero no rutina nocturna' },
      'candidate_02': { label: 'RELATED_BUT_NOT_ANSWERING', score: 1, reason: 'Péptidos cobre vs VitC: combinación, no rutina' },
      'candidate_03': { label: 'RELATED_BUT_NOT_ANSWERING', score: 1, reason: 'Interacción péptidos cobre + VitC: tangencial' },
      'candidate_04': { label: 'RELATED_BUT_NOT_ANSWERING', score: 1, reason: 'Incompatibilidad química: no responde rutina anti-edad' },
    },
    'skincare_008': {
      'candidate_02': { label: 'RELEVANT', score: 3, reason: 'Regulación melanogénesis en HPI: responde tratamiento hiperpigmentación' },
      'candidate_01': { label: 'RELEVANT', score: 3, reason: 'Gestión HPI con inhibición: tratamiento directo' },
      'candidate_03': { label: 'RELEVANT', score: 3, reason: 'Regulación melanogénesis en HPI: tratamiento directo' },
      'candidate_04': { label: 'RELEVANT', score: 3, reason: 'Gestión HPI mediante inhibición: tratamiento directo' },
    },
    'skincare_009': {
      'candidate_03': { label: 'RELEVANT', score: 3, reason: 'Niacinamida y pH ácido (VitC): responde combinación directa' },
      'candidate_04': { label: 'RELEVANT', score: 3, reason: 'Niacinamida hidrólisis y ácido nicotínico: riesgo de combinación' },
      'candidate_01': { label: 'PARTIALLY_RELEVANT', score: 2, reason: 'Péptidos cobre + VitC: interacción con VitC pero no niacinamida' },
      'candidate_02': { label: 'RELATED_BUT_NOT_ANSWERING', score: 1, reason: 'Quelantes y estabilidad VitC: contexto de formulación' },
    },
    'skincare_010': {
      'candidate_02': { label: 'RELEVANT', score: 3, reason: 'pH de limpiadores y microbioma: responde selección de limpiador' },
      'candidate_03': { label: 'PARTIALLY_RELEVANT', score: 2, reason: 'Preservación microbioma en piel reactiva: complementa limpiador' },
      'candidate_01': { label: 'PARTIALLY_RELEVANT', score: 2, reason: 'Piel seca vs deshidratada: contexto de tipo de piel' },
      'candidate_05': { label: 'RELATED_BUT_NOT_ANSWERING', score: 1, reason: 'Restauración lipídica en xerosis: no es limpiador' },
    },
    'cabello_002': {
      'candidate_03': { label: 'RELEVANT', score: 3, reason: 'pH en integridad de cutícula durante tinte: proceso químico que daña cabello' },
      'candidate_04': { label: 'PARTIALLY_RELEVANT', score: 2, reason: 'Metales en cabello y decoloración: relacionado con daño por decoloración' },
      'candidate_01': { label: 'PARTIALLY_RELEVANT', score: 2, reason: 'SERS para detectar daño proteico: diagnóstico de daño' },
      'candidate_02': { label: 'RELATED_BUT_NOT_ANSWERING', score: 1, reason: 'Viscoelasticidad: propiedad, no tratamiento' },
      'candidate_08': { label: 'RELATED_BUT_NOT_ANSWERING', score: 1, reason: 'Protección barrera cuero cabelludo: contexto de servicio' },
    },
    'cabello_004': {},  // UNSUPPORTED: ningún candidato responde caída post-parto/estrés
    'cabello_006': {
      'candidate_01': { label: 'PARTIALLY_RELEVANT', score: 2, reason: 'Homeostasis del cuero cabelludo: relacionado con salud del cuero' },
      'candidate_02': { label: 'RELATED_BUT_NOT_ANSWERING', score: 1, reason: 'Tinte y microbiota: no es champú' },
      'candidate_03': { label: 'RELATED_BUT_NOT_ANSWERING', score: 1, reason: 'Alcalinidad y microbiota: no champú para graso' },
    },
    'cabello_008': {
      'candidate_05': { label: 'RELEVANT', score: 3, reason: 'Mecanismos oclusivos vs humectantes: responde hidratación profunda' },
      'candidate_07': { label: 'RELEVANT', score: 3, reason: 'Diferenciación oclusivos/humectantes: hidratación directa' },
      'candidate_06': { label: 'PARTIALLY_RELEVANT', score: 2, reason: 'Hidrofaciales: tratamiento de hidratación profesional' },
      'candidate_03': { label: 'PARTIALLY_RELEVANT', score: 2, reason: 'Urea umbral hidratación/queratolisis: activo hidratante' },
      'candidate_04': { label: 'RELATED_BUT_NOT_ANSWERING', score: 1, reason: 'Face-basting: tendencia, no comparativa' },
    },
    'cejas_001': {
      'candidate_01': { label: 'PARTIALLY_RELEVANT', score: 2, reason: 'Microblading y envejecimiento: responde parcialmente qué es' },
      'candidate_03': { label: 'PARTIALLY_RELEVANT', score: 2, reason: 'Cicatrización post-microblading: relacionado con el procedimiento' },
      'candidate_04': { label: 'RELATED_BUT_NOT_ANSWERING', score: 1, reason: 'Fotoprotección en longevidad: tangencial a duración' },
    },
    'cejas_002': {},  // UNSUPPORTED: ningún candidato compara las 3 técnicas
    'cejas_003': {
      'candidate_01': { label: 'PARTIALLY_RELEVANT', score: 2, reason: 'Visajismo proporción áurea: base del diseño de cejas' },
    },
    'cejas_004': {
      'candidate_01': { label: 'RELEVANT', score: 3, reason: 'Dinámica muscular orbicular y simetría: responde corrección de asimetría' },
      'candidate_02': { label: 'RELEVANT', score: 3, reason: 'Dinámica muscular facial y simetría del diseño: corrección directa' },
      'candidate_04': { label: 'RELEVANT', score: 3, reason: 'Adaptación del diseño en ptosis palpebral: corrección de asimetría' },
      'candidate_03': { label: 'PARTIALLY_RELEVANT', score: 2, reason: 'Sesgos cognitivos en evaluación de diseño: contexto' },
    },
    'cejas_005': {
      'candidate_01': { label: 'RELEVANT', score: 3, reason: 'Fisiología de cicatrización post-microblading: cuidados directos' },
      'candidate_02': { label: 'RELEVANT', score: 3, reason: 'Fotoprotección estratégica post-microblading: cuidado directo' },
      'candidate_04': { label: 'RELEVANT', score: 3, reason: 'Microbiota ciliar y curación post-microblading: cuidado directo' },
      'candidate_03': { label: 'PARTIALLY_RELEVANT', score: 2, reason: 'Variabilidad glucémica y cicatrización: factor que afecta cuidados' },
    },
    'cejas_007': {
      'candidate_02': { label: 'RELEVANT', score: 3, reason: 'Microblading en diabéticos: contraindicación directa' },
      'candidate_01': { label: 'PARTIALLY_RELEVANT', score: 2, reason: 'Piel seborreica: contraindicación técnica' },
      'candidate_06': { label: 'RELATED_BUT_NOT_ANSWERING', score: 1, reason: 'Dermatitis a pigmentos: riesgo, no contraindicación absoluta' },
    },
    'cejas_008': {
      'candidate_01': { label: 'RELEVANT', score: 3, reason: 'Microblading y láser de eliminación: remoción directa' },
      'candidate_02': { label: 'RELEVANT', score: 3, reason: 'Electrólisis y remoción: opción de remoción directa' },
      'candidate_03': { label: 'RELEVANT', score: 3, reason: 'Láser Erbio-Glass: tecnología de remoción' },
      'candidate_04': { label: 'PARTIALLY_RELEVANT', score: 2, reason: 'Tyndall en microblading mal ejecutado: contexto de remoción' },
    },
  };

  // Aplicar anotaciones: todo lo no anotado explícitamente = NOT_RELEVANT (0)
  const annotated = blind.queries.map(q => ({
    query_id: q.query_id,
    query: q.query,
    candidates: q.candidates.map(c => {
      const a = (annotation[q.query_id] || {})[c.anon_id];
      return {
        anon_id: c.anon_id,
        title: c.title,
        label: a ? a.label : 'NOT_RELEVANT',
        score: a ? a.score : 0,
        reason: a ? a.reason : 'Sin relación semántica suficiente con la intención de la query',
      };
    }),
  }));

  const out = {
    phase: 'FASE 2 — ANOTACIÓN CIEGA COMPLETA',
    generated_at: new Date().toISOString(), run,
    note: 'Anotación por CONTENIDO (título + contenido leído). El anotador no tuvo acceso a chunk_ids ni rankings.',
    queries: annotated,
  };
  const outPath = path.join(OUT_DIR, `r5c13_annotations_${run.toLowerCase()}.json`);
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(`✅ FASE 2 → ${outPath}`);

  // Resumen
  const counts = {};
  for (const q of annotated) {
    for (const c of q.candidates) { counts[c.label] = (counts[c.label] || 0) + 1; }
  }
  console.log('Distribución:', JSON.stringify(counts));
}

main().catch(e => { console.error('❌ Fatal:', e.message); process.exit(1); });
