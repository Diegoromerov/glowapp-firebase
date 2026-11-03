/**
 * backend/src/services/metadataEnricher.js
 * Servicio de enriquecimiento de metadata para chunks de conocimiento de belleza
 * Extrae/normaliza: category, skin_type, season_station, age_range, ingredients, contraindications
 * Determinista: cache por content_hash para misma entrada → misma salida
 */

const { breakers } = require('./circuitBreakerService');
const { pool } = require('../config/db');

/**
 * Cache en memoria para metadata determinista
 * Clave: content_hash, Valor: metadata enriquecida
 */
const metadataCache = new Map();

/**
 * Palabras clave para clasificación automática de categoría
 */
const CATEGORY_KEYWORDS = {
  skincare: ['piel', 'cutis', 'facial', 'crema', 'sérum', 'limpiador', 'hidratante', 'protector solar', 'ácido hialurónico', 'niacinamida', 'retinol', 'vitamina c', 'bakuchiol', 'ceramidas', 'barrera', 'acné', 'manchas', 'poros', 'arrugas', 'antienvejecimiento'],
  maquillaje: ['maquillaje', 'base', 'corrector', 'polvo', 'rubor', 'bronceador', 'iluminador', 'sombra', 'delineador', 'máscara', 'labial', 'brillo', 'mate', 'cobertura'],
  cabello: ['cabello', 'pelo', 'champú', 'acondicionador', 'mascarilla', 'aceite', 'keratina', 'protección térmica', 'frizz', 'puntas', 'caída', 'crecimiento', 'tinte', 'coloración', 'mechas'],
  cejas: ['ceja', 'cejas', 'laminado', 'microblading', 'visagismo', 'depilación', 'henna', 'tinte cejas', 'diseño'],
  pestañas: ['pestaña', 'pestañas', 'lifting', 'extensiones', 'rímel', 'curvatura', 'volumen'],
  uñas: ['uña', 'uñas', 'manicura', 'pedicura', 'esmalte', 'gel', 'semipermanente', 'cutícula', 'quebradiza', 'fortalecedora'],
  corporal: ['cuerpo', 'corporal', 'exfoliante', 'hidratante corporal', 'celulitis', 'estrías', 'firming', 'reafirmante', 'masaje'],
  wellness: ['wellness', 'bienestar', 'suplemento', 'vitamina', 'colágeno', 'antioxidante', 'estrés', 'sueño', 'energia', 'inmunidad'],
  tintes: ['tinte', 'tintes', 'coloración', 'mechas', 'balayage', 'rubio', 'castaño', 'negro', 'rojo', 'fantasía', 'canas'],
  suplementos: ['suplemento', 'suplementos', 'vitamina', 'mineral', 'colágeno', 'biotina', 'omega', 'probiótico', 'hierro', 'magnesio'],
  barba: ['barba', 'bigote', 'aceite barba', 'bálsamo', 'crecimiento barba', 'recortar', 'afeitado'],
};

/**
 * Palabras clave para tipo de piel
 * Orden importante: más específico primero
 */
const SKIN_TYPE_KEYWORDS = {
  mixta: ['mixta', 'zona T', 'grasa en frente', 'seca en mejillas'],
  grasa: ['grasa', 'seborreica', 'brillo', 'poros abiertos', 'acné', 'comedones', 'sebo'],
  seca: ['seca', 'deshidratada', 'tirantez', 'descamación', 'áspera', 'falta de lípidos'],
  sensible: ['sensible', 'reactiva', 'irritación', 'rojeces', 'alergia', 'rosácea', 'atópica'],
  normal: ['normal', 'equilibrada', 'sin problemas'],
};

/**
 * Palabras clave para estación colorimétrica
 */
const SEASON_KEYWORDS = {
  primavera: ['primavera', 'cálido', 'claro', 'brillante', 'melocotón', 'coral', 'durazno', 'verde menta'],
  verano: ['verano', 'frío', 'claro', 'suave', 'rosa', 'lila', 'azul pastel', 'gris azulado'],
  otoño: ['otoño', 'cálido', 'profundo', 'terracota', 'mostaza', 'oliva', 'borgoña', 'naranja quemado'],
  invierno: ['invierno', 'frío', 'profundo', 'intenso', 'negro', 'blanco', 'rojo puro', 'azul real', 'fucsia'],
};

/**
 * Palabras clave para rango etario
 */
const AGE_RANGE_KEYWORDS = {
  adolescencia: ['adolescente', 'adolescencia', 'pubertad', '15', '16', '17', '18', '19', 'acné juvenil'],
  '20-30': ['veinte', '20', '25', '30', 'joven', 'primeras arrugas', 'prevención'],
  '30-40': ['treinta', '30', '35', '40', 'primeras líneas', 'elasticidad', 'antienvejecimiento temprano'],
  '40-50': ['cuarenta', '40', '45', '50', 'arrugas marcadas', 'flacidez', 'manchas edad', 'menopausia'],
  '50+': ['cincuenta', '50', '55', '60', '65', 'madurez', 'piel madura', 'profundas', 'reafirmante'],
};

/**
 * Ingredientes activos conocidos para extracción
 */
const KNOWN_INGREDIENTS = [
  'bakuchiol', 'retinol', 'retinal', 'retinoide', 'ácido hialurónico', 'hialuronato',
  'niacinamida', 'vitamina c', 'ácido ascórbico', 'ácido ferúlico', 'vitamina e',
  'ceramidas', 'péptidos', 'péptido de cobre', 'matrixyl', 'argireline',
  'ácido salicílico', 'bha', 'ácido glicólico', 'aha', 'ácido láctico', 'ácido mandélico',
  'ácido azelaico', 'azelaico', 'árbol de té', 'tea tree', 'centella asiática', 'cica',
  'aloe vera', 'aloevera', 'mucina de caracol', 'snail mucin', 'propóleo',
  'vitamina b5', 'pantenol', 'glicerina', 'urea', 'escualano', 'esqualeno',
  'aceite de jojoba', 'jojoba', 'aceite de rosa mosqueta', 'rosa mosqueta',
  'aceite de argán', 'argán', 'aceite de marula', 'marula', 'aceite de semilla de uva',
  'protección solar', 'fps', 'spf', 'filtro solar', 'óxido de zinc', 'dióxido de titanio',
  'colágeno', 'colageno', 'elastina', 'elastina', 'coenzima q10', 'q10', 'ubiquinona',
  'resveratrol', 'polifenoles', 'té verde', 'green tea', 'extracto de regaliz',
  'ácido tranexámico', 'tranexámico', 'arbutina', 'alpha arbutin', 'kójico', 'ácido kójico',
];

/**
 * Contraindicaciones conocidas
 */
const KNOWN_CONTRAINDICATIONS = [
  'embarazo', 'lactancia', 'embarazada', 'amamantando',
  'piel sensible', 'sensibilidad', 'irritación', 'alergia',
  'rosácea', 'eczema', 'dermatitis', 'psoriasis',
  'heridas abiertas', 'quemaduras', 'infección activa',
  'isotretinoina', 'accutane', 'tratamiento médico',
  'fotosensibilidad', 'medicamentos fotosensibilizantes',
  'cirugía reciente', 'láser reciente', 'peeling reciente',
];

/**
 * Normaliza un string: minúsculas, sin acentos, trim
 * @param {string} text - Texto a normalizar
 * @returns {string} Texto normalizado
 */
function normalize(text) {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // quitar acentos
    .trim();
}

/**
 * Busca coincidencias de keywords en texto
 * @param {string} text - Texto a buscar
 * @param {Object} keywordMap - Mapa de categoría -> array de keywords
 * @returns {string[]} Categorías encontradas
 */
function findKeywords(text, keywordMap) {
  const normalized = normalize(text);
  const found = [];
  
  for (const [category, keywords] of Object.entries(keywordMap)) {
    for (const keyword of keywords) {
      if (normalized.includes(normalize(keyword))) {
        found.push(category);
        break;
      }
    }
  }
  
  return found;
}

/**
 * Extrae ingredientes conocidos del texto
 * @param {string} text - Texto a analizar
 * @returns {string[]} Ingredientes encontrados
 */
function extractIngredients(text) {
  const normalized = normalize(text);
  const found = [];
  
  for (const ingredient of KNOWN_INGREDIENTS) {
    if (normalized.includes(normalize(ingredient))) {
      found.push(ingredient);
    }
  }
  
  // Deduplicar manteniendo orden
  return [...new Set(found)];
}

/**
 * Extrae contraindicaciones conocidas del texto
 * @param {string} text - Texto a analizar
 * @returns {string[]} Contraindicaciones encontradas
 */
function extractContraindications(text) {
  const normalized = normalize(text);
  const found = [];
  
  for (const contra of KNOWN_CONTRAINDICATIONS) {
    if (normalized.includes(normalize(contra))) {
      found.push(contra);
    }
  }
  
  return [...new Set(found)];
}

/**
 * Determina rango etario por palabras clave o por defecto
 * @param {string} text - Texto a analizar
 * @returns {string|null} Rango etario o null si no se detecta
 */
function determineAgeRange(text) {
  const found = findKeywords(text, AGE_RANGE_KEYWORDS);
  return found[0] || null;
}

/**
 * Determina estación colorimétrica
 * @param {string} text - Texto a analizar
 * @returns {string|null} Estación o null si no se detecta
 */
function determineSeasonStation(text) {
  const found = findKeywords(text, SEASON_KEYWORDS);
  return found[0] || null;
}

/**
 * Determina tipo de piel
 * @param {string} text - Texto a analizar
 * @returns {string|null} Tipo de piel o null si no se detecta
 */
function determineSkinType(text) {
  const found = findKeywords(text, SKIN_TYPE_KEYWORDS);
  return found[0] || null;
}

/**
 * Determina categoría principal
 * @param {string} text - Texto a analizar
 * @param {string} documentCategory - Categoría del documento padre
 * @returns {string} Categoría
 */
function determineCategory(text, documentCategory) {
  // Primero usar categoría del documento si existe
  if (documentCategory && CATEGORY_KEYWORDS[documentCategory.toLowerCase()]) {
    return documentCategory.toLowerCase();
  }
  
  // Buscar por palabras clave en el contenido
  const found = findKeywords(text, CATEGORY_KEYWORDS);
  return found[0] || 'skincare';
}

/**
 * Calcula score de ambigüedad (0-1) basado en coincidencias múltiples
 * @param {string} text - Texto a analizar
 * @returns {number} Score 0-1
 */
function calculateAmbiguityScore(text) {
  const normalized = normalize(text);
  let totalMatches = 0;
  
  // Contar coincidencias en todas las categorías
  for (const keywords of Object.values(CATEGORY_KEYWORDS)) {
    for (const kw of keywords) {
      if (normalize(text).includes(normalize(kw))) totalMatches++;
    }
  }
  
  // Normalizar: 0 matches = 0, 10+ matches = 1
  return Math.min(totalMatches / 10, 1);
}

/**
 * Enriquecimiento con LLM (DeepSeek) para chunks ambiguos
 * @param {string} text - Contenido del chunk
 * @param {Object} documentMetadata - Metadata del documento
 * @returns {Promise<Object>} Metadata refinada
 */
async function enrichWithLLM(text, documentMetadata) {
  // Usar circuit breaker existente para DeepSeek
  const { breakers } = require('./circuitBreakerService');
  
  if (!breakers.deepseek) {
    throw new Error('DeepSeek breaker no disponible');
  }
  
  return await breakers.deepseek.execute(
    async () => {
      const axios = require('axios');
      const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
      const DEEPSEEK_BASE_URL = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/chat/completions';
      const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash';
      
      const prompt = `Analiza este fragmento de contenido de belleza/skincare y extrae metadata estructurada en JSON:

CONTENIDO:
${text.slice(0, 1500)}

METADATA DEL DOCUMENTO PADRE:
${JSON.stringify(documentMetadata, null, 2)}

Extrae SOLO estos campos (usa valores por defecto si no se mencionan):
{
  "category": "skincare|maquillaje|cabello|cejas|pestañas|uñas|corporal|wellness|tintes|suplementos|barba",
  "skin_type": "normal|seca|grasa|mixta|sensible|todos",
  "season_station": "primavera|verano|otoño|invierno|todas",
  "age_range": "adolescencia|20-30|30-40|40-50|50+|todas",
  "ingredients": ["ingrediente1", "ingrediente2"],
  "contraindications": ["contraindicacion1", "contraindicacion2"]
}

RESPONDE SOLO CON EL JSON, sin explicaciones ni markdown.`;

      const response = await axios.post(
        DEEPSEEK_BASE_URL,
        {
          model: DEEPSEEK_MODEL,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.1,
          max_tokens: 500,
        },
        {
          headers: {
            'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
            'Content-Type': 'application/json',
          },
          timeout: 15000,
        }
      );
      
      const content = response.data?.choices?.[0]?.message?.content;
      if (!content) throw new Error('Respuesta vacía de DeepSeek');
      
      const parsed = JSON.parse(content);
      return parsed;
    },
    () => ({}) // fallback vacío si breaker open
  );
}

/**
 * Enriquece metadata de un chunk usando heurísticas y LLM para casos ambiguos
 * @param {string} chunkContent - Contenido del chunk
 * @param {Object} documentMetadata - Metadata del documento padre
 * @returns {Promise<Object>} Metadata enriquecida
 */
async function enrichChunkMetadata(chunkContent, documentMetadata = {}) {
  const contentHash = require('crypto').createHash('sha256').update(chunkContent).digest('hex');
  
  // Verificar cache
  if (metadataCache.has(contentHash)) {
    return metadataCache.get(contentHash);
  }
  
  const text = chunkContent.toString();
  
  // Enriquecimiento por heurísticas (rápido, determinista)
  const category = determineCategory(text, documentMetadata.category);
  const skinType = determineSkinType(text) || documentMetadata.skin_type || 'todos';
  const seasonStation = determineSeasonStation(text) || documentMetadata.season_station || 'todas';
  const ageRange = determineAgeRange(text) || documentMetadata.age_range || 'todas';
  const ingredients = extractIngredients(text);
  const contraindications = extractContraindications(text);
  
  // Calcular score de ambigüedad (cuántas categorías/keywords coinciden)
  const ambiguityScore = calculateAmbiguityScore(text);
  
  let finalMetadata = {
    category,
    skin_type: skinType,
    season_station: seasonStation,
    age_range: ageRange,
    ingredients,
    contraindications,
    _enrichment_method: 'heuristic',
    _ambiguity_score: ambiguityScore,
  };
  
  // Si ambigüedad alta, usar LLM para refinar (opcional, controlado por flag)
  const useLLM = process.env.USE_LLM_ENRICHMENT === 'true' && ambiguityScore > 0.5;
  
  if (useLLM) {
    try {
      const llmMetadata = await enrichWithLLM(text, documentMetadata);
      finalMetadata = { ...finalMetadata, ...llmMetadata, _enrichment_method: 'llm' };
    } catch (error) {
      console.warn('⚠️ LLM enrichment falló, usando heurístico:', error.message);
    }
  }
  
  // Guardar en cache
  metadataCache.set(contentHash, finalMetadata);
  
  return finalMetadata;
}

/**
 * Limpia cache (útil para tests)
 */
function clearCache() {
  metadataCache.clear();
}

/**
 * Obtiene stats del cache
 * @returns {Object} Stats del cache
 */
function getCacheStats() {
  return {
    size: metadataCache.size,
    keys: Array.from(metadataCache.keys()).slice(0, 10),
  };
}

module.exports = {
  enrichChunkMetadata,
  determineCategory,
  determineSkinType,
  determineSeasonStation,
  determineAgeRange,
  extractIngredients,
  extractContraindications,
  clearCache,
  getCacheStats,
  CATEGORY_KEYWORDS,
  SKIN_TYPE_KEYWORDS,
  SEASON_KEYWORDS,
  AGE_RANGE_KEYWORDS,
  KNOWN_INGREDIENTS,
  KNOWN_CONTRAINDICATIONS,
};