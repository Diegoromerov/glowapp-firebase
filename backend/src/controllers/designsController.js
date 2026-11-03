const { GoogleGenerativeAI } = require('@google/generative-ai');
const path = require('path');
require('dotenv').config();
const { pool } = require('../config/db');

const saveAnalysisToDb = async (userId, toolType, resultData, track = 'piel', imageUrl = null) => {
  if (!userId) return null;
  try {
    const scores = resultData.scores || {};
    const hidratacion = scores.hidratacion !== undefined ? parseInt(scores.hidratacion) : null;
    const impurezas = scores.impurezas !== undefined ? parseInt(scores.impurezas) : null;
    const luminosidad = scores.luminosidad !== undefined ? parseInt(scores.luminosidad) : null;

    const query = `
      INSERT INTO ai_diagnostics (user_id, tool_type, result_data, score_hidratacion, score_impurezas, score_luminosidad, track, image_url)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING id;
    `;
    const dbRes = await pool.query(query, [userId, toolType, JSON.stringify(resultData), hidratacion, impurezas, luminosidad, track, imageUrl]);
    const generatedId = dbRes.rows[0].id;
    console.log(`💾 [DB] Guardado historial de IA (${toolType}) para usuario ${userId} con ID: ${generatedId}`);

    if (toolType === 'care-routine') {
      await updateSkinProfile(userId, resultData.skin_type || 'Piel Mixta');
    }
    return generatedId;
  } catch (err) {
    console.error('⚠️ [DB ERROR] Error guardando historial de IA:', err.message);
    return null;
  }
};

const updateSkinProfile = async (userId, tipoPiel) => {
  try {
    const lastDiagQuery = `
      SELECT score_hidratacion, score_impurezas, score_luminosidad
      FROM ai_diagnostics
      WHERE user_id = $1 AND tool_type = 'care-routine'
      ORDER BY created_at DESC
      LIMIT 5;
    `;
    const diags = await pool.query(lastDiagQuery, [userId]);
    
    if (diags.rows.length === 0) return;

    let totalHidra = 0, totalAcne = 0, totalSens = 0;
    let countH = 0, countI = 0;
    
    diags.rows.forEach(r => {
      if (r.score_hidratacion !== null) {
        totalHidra += r.score_hidratacion;
        countH++;
      }
      if (r.score_impurezas !== null) {
        totalAcne += r.score_impurezas;
        countI++;
      }
    });

    const avgHidra = countH > 0 ? Math.round(totalHidra / countH) : 50;
    const avgAcne = countI > 0 ? Math.round(totalAcne / countI) : 30;
    const avgSens = 15;

    const upsertQuery = `
      INSERT INTO skin_profiles (user_id, tipo_piel, hidratacion_promedio, tendencia_acne, sensibilidad_score, diagnosticos_count, ultimo_diagnostico_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, 1, NOW(), NOW())
      ON CONFLICT (user_id) DO UPDATE SET
        tipo_piel = EXCLUDED.tipo_piel,
        hidratacion_promedio = EXCLUDED.hidratacion_promedio,
        tendencia_acne = EXCLUDED.tendencia_acne,
        sensibilidad_score = EXCLUDED.sensibilidad_score,
        diagnosticos_count = skin_profiles.diagnosticos_count + 1,
        ultimo_diagnostico_at = NOW(),
        updated_at = NOW();
    `;
    await pool.query(upsertQuery, [userId, tipoPiel, avgHidra, avgAcne, avgSens]);
    console.log(`💾 [DB] Perfil de piel actualizado para usuario ${userId}`);
  } catch (err) {
    console.error('⚠️ [DB ERROR] Error actualizando perfil de piel:', err.message);
  }
};

// Inicializar el cliente de la API de Gemini
const apiKey = process.env.GEMINI_API_KEY;
const ai = apiKey ? new GoogleGenerativeAI(apiKey) : null;

// Función helper para buscar imágenes reales de Pinterest usando DuckDuckGo sin llaves
const searchRealPinterestImages = async (query, category) => {
  try {
    let suffix = ' uñas manicure';
    if (category === 'hair' || category === 'capilar') {
      suffix = ' cabello peinado';
    } else if (category === 'skin' || category === 'facial' || category === 'facials') {
      suffix = ' piel rostro skincare';
    } else if (category === 'eyebrow' || category === 'ceja') {
      suffix = ' cejas visagismo';
    }
    const searchQuery = `${query}${suffix} site:pinterest.com`;
    const url = `https://duckduckgo.com/?q=${encodeURIComponent(searchQuery)}`;
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });
    
    if (!response.ok) return null;
    
    const html = await response.text();
    const vqdRegex = /vqd=([^&'"]+)/;
    const match = html.match(vqdRegex);
    
    let vqd = null;
    if (match) {
      vqd = match[1];
    } else {
      const vqdRegex2 = /vqd\s*=\s*['"]([^'"]+)['"]/;
      const match2 = html.match(vqdRegex2);
      if (match2) vqd = match2[1];
    }

    if (!vqd) return null;

    const searchUrl = `https://duckduckgo.com/i.js?q=${encodeURIComponent(searchQuery)}&o=json&vqd=${vqd}&f=,,,`;
    const imageResponse = await fetch(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://duckduckgo.com/'
      }
    });

    if (!imageResponse.ok) return null;

    const data = await imageResponse.json();
    if (!data.results || data.results.length === 0) return [];

    return data.results.slice(0, 6).map(item => {
      let defaultTitle = 'Diseño de uñas';
      if (category === 'hair' || category === 'capilar') defaultTitle = 'Diseño de cabello';
      else if (category === 'skin' || category === 'facial' || category === 'facials') defaultTitle = 'Cuidado de piel';
      else if (category === 'eyebrow' || category === 'ceja') defaultTitle = 'Diseño de cejas';
      return {
        title: item.title || defaultTitle,
        image_url: `/api/designs/proxy?url=${encodeURIComponent(item.image)}`,
        link: item.url || 'https://pinterest.com'
      };
    });

  } catch (err) {
    console.error('⚠️ Error buscando en DuckDuckGo:', err.message);
    return null;
  }
};

const personalizeSearchResults = async (results, userId, category) => {
  try {
    const userRes = await pool.query('SELECT glowai_plan, email FROM usuarios WHERE id = $1', [userId]);
    if (userRes.rows.length === 0) return results;
    
    const user = userRes.rows[0];
    const isPremium = user.glowai_plan === 'premium';
    if (!isPremium) return results;

    let track = 'piel';
    if (category === 'hair' || category === 'capilar') {
      track = 'capilar';
    }
    
    const diagRes = await pool.query(
      'SELECT result_data, score_hidratacion, score_impurezas, score_luminosidad FROM ai_diagnostics WHERE user_id = $1 AND track = $2 AND score_hidratacion IS NOT NULL ORDER BY created_at DESC LIMIT 1',
      [userId, track]
    );

    if (diagRes.rows.length === 0) return results;
    const diag = diagRes.rows[0];
    const resultData = diag.result_data || {};
    
    const skinType = (resultData.skin_type || '').toLowerCase();
    const explanation = (resultData.explanation || '').toLowerCase();
    
    let targetKeywords = [];
    if (track === 'piel') {
      if (skinType.includes('seco') || skinType.includes('deshidratad') || explanation.includes('seco') || explanation.includes('hidrat')) {
        targetKeywords.push('hydrate', 'dewy', 'glow', 'moist', 'hidratación', 'brillo', 'suave', 'nude', 'pink');
      }
      if (skinType.includes('grasa') || skinType.includes('acné') || skinType.includes('impureza') || explanation.includes('grasa') || explanation.includes('acné')) {
        targetKeywords.push('matte', 'clean', 'oil-free', 'purifying', 'mate', 'limpio', 'poros', 'dark', 'negro');
      }
      if (skinType.includes('mixta')) {
        targetKeywords.push('balance', 'clean', 'natural', 'equilibrio', 'minimalist');
      }
    } else {
      const scalpStatus = (resultData.scalp_status || '').toLowerCase();
      if (scalpStatus.includes('seco') || explanation.includes('seco') || explanation.includes('daño') || explanation.includes('porosidad')) {
        targetKeywords.push('repair', 'nourish', 'oil', 'damage', 'seco', 'nutrición', 'reparación', 'aceite');
      }
      if (scalpStatus.includes('graso') || explanation.includes('graso') || explanation.includes('caspa')) {
        targetKeywords.push('volume', 'clean', 'fresh', 'detox', 'graso', 'volumen', 'fresco');
      }
    }

    const colorimetryRes = await pool.query(
      `SELECT result FROM ai_diagnostics 
       WHERE user_id = $1 AND type IN ('skin-tone', 'hair-color') 
       ORDER BY created_at DESC LIMIT 1`,
      [userId]
    );

    if (colorimetryRes.rows.length > 0) {
      const colResult = colorimetryRes.rows[0].result || {};
      const recommendedColors = colResult.recommended_colors || colResult.recommended_shades || [];
      recommendedColors.forEach(color => {
        targetKeywords.push(color.toLowerCase());
      });
      if (colResult.undertone) {
        targetKeywords.push(colResult.undertone.toLowerCase());
      }
      if (colResult.skin_undertone) {
        targetKeywords.push(colResult.skin_undertone.toLowerCase());
      }
    }

    const scoredResults = results.map(item => {
      let score = 0;
      const title = (item.title || '').toLowerCase();
      
      targetKeywords.forEach(kw => {
        if (title.includes(kw)) {
          score += 5;
        }
      });
      
      return { ...item, _sortScore: score };
    });

    scoredResults.sort((a, b) => b._sortScore - a._sortScore);
    return scoredResults.map(({ _sortScore, ...rest }) => rest);
  } catch (err) {
    console.error('⚠️ Error al personalizar resultados de búsqueda:', err.message);
    return results;
  }
};

exports.searchPinterestDesigns = async (req, res) => {
  try {
    const { q, category, personalize } = req.query;
    if (!q) {
      return res.status(400).json({ error: 'El parámetro de búsqueda "q" es obligatorio' });
    }

    let optimizedQuery = q;
    if (ai) {
      try {
        const model = ai.getGenerativeModel({ model: 'gemini-3.1-flash-lite' });
        let topicPrompt = 'diseño de uñas o belleza';
        if (category === 'hair' || category === 'capilar') {
          topicPrompt = 'cuidado del cabello, peinados o coloración capilar';
        } else if (category === 'skin' || category === 'facial' || category === 'facials') {
          topicPrompt = 'cuidado de la piel, skincare o tratamientos faciales';
        } else if (category === 'eyebrow' || category === 'ceja') {
          topicPrompt = 'diseño de cejas o visagismo';
        }
        
        const prompt = `Actúa como un experto en SEO y tendencias de belleza. Recibes un término de búsqueda para buscar ideas en Pinterest: "${q}".
Optimiza y expande este término a una consulta de búsqueda corta en inglés y español que consiga los mejores y más estéticos resultados de ${topicPrompt} en Pinterest.
Ejemplo: "uñas rosas" -> "elegant pink nails design aesthetic".
Devuelve ÚNICAMENTE la consulta de búsqueda optimizada final de 3 a 6 palabras, sin comillas ni texto adicional.`;
        const response = await model.generateContent(prompt);
        const text = response.response.text().trim();
        if (text && text.length > 2 && text.length < 100) {
          optimizedQuery = text;
          console.log(`🤖 Consulta de búsqueda optimizada con Gemini: "${q}" -> "${optimizedQuery}"`);
        }
      } catch (geminiErr) {
        console.error('⚠️ Error optimizando query con Gemini:', geminiErr.message);
      }
    }

    const apiKey = process.env.GOOGLE_SEARCH_API_KEY;
    const cx = process.env.GOOGLE_SEARCH_CX;

    if (!apiKey || !cx) {
      console.log(`🔍 Buscando imágenes reales de Pinterest mediante motor alternativo para: "${optimizedQuery}"...`);
      const realImages = await searchRealPinterestImages(optimizedQuery, category);
      
      if (realImages && realImages.length > 0) {
        let finalData = realImages;
        if (personalize === 'true') {
          finalData = await personalizeSearchResults(finalData, req.user.id, category);
        }
        return res.status(200).json({
          success: true,
          source: 'ddg-pinterest',
          data: finalData
        });
      }

      return res.status(200).json({
        success: true,
        source: 'unavailable',
        data: []
      });
    }

    let suffix = ' uñas manicure';
    if (category === 'hair' || category === 'capilar') {
      suffix = ' cabello peinado';
    } else if (category === 'skin' || category === 'facial' || category === 'facials') {
      suffix = ' piel rostro skincare';
    } else if (category === 'eyebrow' || category === 'ceja') {
      suffix = ' cejas visagismo';
    }

    const searchQuery = `${optimizedQuery}${suffix} site:pinterest.com`;
    const searchUrl = `https://www.googleapis.com/customsearch/v1?key=${apiKey}&cx=${cx}&q=${encodeURIComponent(searchQuery)}&searchType=image&num=6`;

    const response = await fetch(searchUrl);
    if (!response.ok) {
      throw new Error(`Google Search API responded with status: ${response.status}`);
    }

    const searchData = await response.json();
    
    if (!searchData.items || searchData.items.length === 0) {
      return res.status(200).json({
        success: true,
        source: 'google',
        data: []
      });
    }

    const formattedResults = searchData.items.map(item => {
      let defaultTitle = 'Diseño de uñas';
      if (category === 'hair' || category === 'capilar') defaultTitle = 'Diseño de cabello';
      else if (category === 'skin' || category === 'facial' || category === 'facials') defaultTitle = 'Cuidado de piel';
      else if (category === 'eyebrow' || category === 'ceja') defaultTitle = 'Diseño de cejas';
      return {
        title: item.title || defaultTitle,
        image_url: `/api/designs/proxy?url=${encodeURIComponent(item.link)}`, 
        link: item.image?.contextLink || 'https://pinterest.com'
      };
    });

    let finalData = formattedResults;
    if (personalize === 'true') {
      finalData = await personalizeSearchResults(finalData, req.user.id, category);
    }

    return res.status(200).json({
      success: true,
      source: 'google',
      data: finalData
    });

  } catch (error) {
    console.error('❌ ERROR AL BUSCAR DISEÑOS:', error.message);
    res.status(500).json({ error: 'Error al buscar ideas de diseños' });
  }
};

exports.analyzeFaceShape = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Es obligatorio subir una foto de rostro en el campo "image".' });
    }

    // No presentar resultados estáticos como análisis de una imagen real.
    if (!ai) {
      if (req.file?.buffer) req.file.buffer.fill(0);
      return res.status(503).json({ error: 'AI_UNAVAILABLE', message: 'El análisis de rostro no está disponible en este momento.' });
    }

    const fileBuffer = req.file.buffer;
    let mimeType = req.file.mimetype;

    // Detectar mimetype si es genérico
    if (!mimeType || mimeType === 'application/octet-stream') {
      const ext = path.extname(req.file.originalname || '').toLowerCase();
      if (ext === '.png') {
        mimeType = 'image/png';
      } else if (ext === '.webp') {
        mimeType = 'image/webp';
      } else if (ext === '.gif') {
        mimeType = 'image/gif';
      } else {
        mimeType = 'image/jpeg';
      }
    }

    const imagePart = {
      inlineData: {
        data: fileBuffer.toString('base64'),
        mimeType
      }
    };

    const prompt = `Analiza detenidamente la forma del rostro de la persona en esta imagen.
Dime qué tipo de rostro tiene (Ovalado, Redondo, Cuadrado, Corazón, Diamante, Alargado).
Recomienda 3 cortes de cabello específicos para este tipo de rostro.
Genera una consulta de búsqueda en español óptima de no más de 6 palabras para buscar ideas visuales de estos cortes de cabello en Pinterest (por ejemplo, "cortes de cabello para rostro redondo").
Responde de manera obligatoria únicamente con un objeto JSON válido, sin formato markdown (sin bloques de código \`\`\`json) y sin caracteres adicionales, usando este formato exacto:
{
  "face_shape": "Tipo de rostro",
  "explanation": "Breve explicación de por qué y qué le beneficia",
  "recommended_cuts": [
    { "name": "Nombre del corte", "reason": "Razón corta de la recomendación" },
    { "name": "Nombre del corte 2", "reason": "Razón corta de la recomendación" },
    { "name": "Nombre del corte 3", "reason": "Razón corta de la recomendación" }
  ],
  "pinterest_query": "consulta de búsqueda para pinterest"
}`;

    const model = ai.getGenerativeModel({ model: 'gemini-3.1-flash-lite' });
    const result = await model.generateContent({
      contents: [
        {
          role: 'user',
          parts: [
            { text: prompt },
            imagePart
          ]
        }
      ]
    });
    const response = await result.response;
    
    let text = response.text().trim();
    
    // Limpieza de formato markdown de bloques de código en caso de que Gemini los retorne
    if (text.startsWith('```json')) {
      text = text.substring(7, text.length - 3).trim();
    } else if (text.startsWith('```')) {
      text = text.substring(3, text.length - 3).trim();
    }

    let analysisJson;
    try {
      analysisJson = JSON.parse(text);
    } catch (parseErr) {
      console.error('Error al parsear respuesta JSON de Gemini:', text);
      // Garantizar purga incluso si falla el parseo
      if (req.file && req.file.buffer) req.file.buffer.fill(0);
      throw new Error('La IA no retornó un formato JSON válido.');
    }

    // Purga criptográfica inmediata de la imagen del buffer en memoria RAM
    if (req.file && req.file.buffer) {
      req.file.buffer.fill(0);
    }

    if (req.user && req.user.id) {
      await saveAnalysisToDb(req.user.id, 'eyebrow-visagism', analysisJson);
    }

    return res.status(200).json({
      success: true,
      source: 'gemini',
      analysis: analysisJson
    });

  } catch (error) {
    // Garantizar purga en caso de excepciones
    if (req.file && req.file.buffer) {
      try { req.file.buffer.fill(0); } catch (e) {}
    }
    console.error('❌ ERROR ANALIZANDO ROSTRO:', error.message);
    res.status(500).json({ 
      error: 'Error al analizar la forma del rostro con IA',
      details: error.message 
    });
  }
};

exports.analyzeDesign = async (req, res) => {
  let weatherInfo = null;
  try {
    const { type, concern, track } = req.body;
    if (!req.file) {
      return res.status(400).json({ error: 'Es obligatorio subir una imagen para el análisis.' });
    }
    if (!type) {
      return res.status(400).json({ error: 'El campo "type" es obligatorio para identificar el análisis.' });
    }

    const userId = req.user.id;
    const userRes = await pool.query('SELECT glowai_plan FROM usuarios WHERE id = $1', [userId]);
    const userPlan = userRes.rows[0]?.glowai_plan || 'free';
    const isPremium = userPlan === 'premium';

    // No generar ni guardar diagnósticos inventados cuando el proveedor de IA falta.
    if (!ai) {
      if (req.file?.buffer) req.file.buffer.fill(0);
      return res.status(503).json({ error: 'AI_UNAVAILABLE', message: 'Los análisis de Glow IA+ no están disponibles en este momento.' });
    }

    const fileBuffer = req.file.buffer;
    let mimeType = req.file.mimetype;

    if (!mimeType || mimeType === 'application/octet-stream') {
      const ext = path.extname(req.file.originalname || '').toLowerCase();
      if (ext === '.png') mimeType = 'image/png';
      else if (ext === '.webp') mimeType = 'image/webp';
      else if (ext === '.gif') mimeType = 'image/gif';
      else mimeType = 'image/jpeg';
    }

    const imagePart = {
      inlineData: {
        data: fileBuffer.toString('base64'),
        mimeType
      }
    };

    let prompt = '';
    let jsonTemplate = '';
    let profileContext = '';

    if (req.user && req.user.id && type === 'care-routine') {
      const profRes = await pool.query('SELECT tipo_piel, hidratacion_promedio, tendencia_acne, sensibilidad_score, diagnosticos_count FROM skin_profiles WHERE user_id = $1', [req.user.id]);
      if (profRes.rows.length > 0) {
        const prof = profRes.rows[0];
        profileContext = `
[PERFIL HISTÓRICO DEL USUARIO]
Tipo de piel inferido: ${prof.tipo_piel}
Hidratación promedio histórica: ${prof.hidratacion_promedio}/100
Tendencia de acné: ${prof.tendencia_acne}/100
Sensibilidad histórica: ${prof.sensibilidad_score}/100
Diagnósticos anteriores: ${prof.diagnosticos_count}
Usa este contexto para personalizar la rutina sin pedirle al usuario que lo explique de nuevo.
`;
      }
    }

    if (type === 'skin-tone') {
      prompt = `Analiza detalladamente la colorimetría de la piel en esta foto de rostro.
Identifica el subtono de piel (Cálido, Frío o Neutro) y el tono general (Claro, Medio, Oscuro).
Proporciona una explicación detallada sobre qué colores de cabello, prendas y maquillaje le favorecen según su estación de color.
Sugiere una lista de 4 colores específicos recomendados.
Genera una consulta corta (máximo 6 palabras) en español para buscar paletas de color inspiracionales en Pinterest.`;
      
      if (isPremium) {
        prompt += `\nAdicionalmente, genera una paleta cromática profesional completa ("paleta_completa") con tres categorías: "ropa", "maquillaje" y "tinte_cabello". Cada categoría debe contener entre 6 y 8 colores específicos en formato HEX (ej. #E89E8C) con un "nombre" descriptivo en español.`;
        jsonTemplate = `{
  "undertone": "Subtono de piel",
  "skin_tone": "Tono general",
  "explanation": "Explicación detallada de colorimetría facial...",
  "recommended_colors": ["Color 1", "Color 2", "Color 3", "Color 4"],
  "pinterest_query": "consulta corta de pinterest",
  "paleta_completa": {
    "ropa": [{"nombre": "Rojo Cereza", "hex": "#C41E3A"}, {"nombre": "Azul Marino", "hex": "#000080"}],
    "maquillaje": [{"nombre": "Nude Rosa", "hex": "#E89E8C"}, {"nombre": "Labios Fresa", "hex": "#D23B51"}],
    "tinte_cabello": [{"nombre": "Castaño Claro", "hex": "#A07855"}, {"nombre": "Rubio Cenizo", "hex": "#C9AE87"}]
  }
}`;
      } else {
        jsonTemplate = `{
  "undertone": "Subtono de piel",
  "skin_tone": "Tono general",
  "explanation": "Explicación detallada de colorimetría facial...",
  "recommended_colors": ["Color 1", "Color 2", "Color 3", "Color 4"],
  "pinterest_query": "consulta corta de pinterest"
}`;
      }
    } else if (type === 'hair-diagnostic') {
      prompt = `Analiza la condición de la hebra capilar o cuero cabelludo que se observa de cerca en esta foto.
Evalúa el nivel de daño (Bajo, Medio, Alto) y la condición general (Seco, Graso, Mixto o Saludable).
Proporciona una explicación diagnóstica sobre el frizz, porosidad aparente, puntas y brillo.
Recomienda una lista de 3 tratamientos específicos o mascarillas reparadoras.
Genera una consulta corta (máximo 6 palabras) en español para buscar tratamientos o resultados en Pinterest.`;
      jsonTemplate = `{
  "damage_level": "Nivel de daño",
  "scalp_status": "Condición general",
  "explanation": "Explicación detallada del diagnóstico...",
  "recommended_treatments": ["Tratamiento 1", "Tratamiento 2", "Tratamiento 3"],
  "pinterest_query": "consulta corta de pinterest"
}`;
    } else if (type === 'skin-texture') {
      prompt = `Analiza el estado de la textura de la piel del rostro en esta foto de primer plano.
Determina el tipo de piel observado (Grasa, Seca, Mixta, Normal o Sensible) y el estado de los poros/imperfecciones (Dilatados, Congestionados, Obstruidos o Normales).
Explica la presencia de brillo, puntos negros, resequedad o texturas irregulares en zonas como la T o las mejillas.
Sugiere una rutina de cuidado facial corta (3 pasos específicos).
Genera una consulta corta (máximo 6 palabras) en español para buscar rutinas de skincare de inspiración en Pinterest.`;
      jsonTemplate = `{
  "skin_type": "Tipo de piel",
  "pore_status": "Estado de poros",
  "explanation": "Explicación de textura de la piel...",
  "recommended_routine": ["Paso 1: Limpiador...", "Paso 2: Tónico...", "Paso 3: Hidratación/Sérum..."],
  "pinterest_query": "consulta corta de pinterest"
}`;
    } else if (type === 'eyebrow-visagism') {
      prompt = `Realiza un estudio de visagismo de cejas a partir de la estructura del rostro en esta foto.
Identifica las proporciones del rostro (ej. Rostro Redondo, Ovalado, Cuadrado) y la forma recomendada de cejas (ej. Arqueada, Angular, Recta, Sutil).
Explica detalladamente cómo el arco, la longitud y el grosor ideal de la ceja pueden armonizar sus rasgos faciales.
Recomienda 3 diseños de cejas o técnicas profesionales aplicables (ej. Depilación con hilo, Laminado, Henna).
Genera una consulta corta (máximo 6 palabras) en español para buscar diseños de cejas óptimos en Pinterest.`;
      jsonTemplate = `{
  "face_proportions": "Proporción facial detectada",
  "eyebrow_shape": "Forma recomendada",
  "explanation": "Explicación de visagismo geométrico...",
  "recommended_designs": ["Técnica/Diseño 1", "Técnica/Diseño 2", "Técnica/Diseño 3"],
  "pinterest_query": "consulta corta de pinterest"
}`;
    } else if (type === 'nails-style') {
      prompt = `Analiza la estructura de la mano, la longitud de los dedos y el tono de piel en esta foto.
Determina la proporción de los dedos (ej. Dedos cortos, Dedos alargados) y el subtono cromático de la mano (Cálido o Frío).
Sugiere las 3 formas de uñas que más estilizan la mano (ej. Almendra, Ovalada, Coffin) y una lista de 4 colores de esmalte favorecedores.
Genera una consulta corta (máximo 6 palabras) en español para buscar estilos de manicure ideales en Pinterest.`;
      jsonTemplate = `{
  "finger_proportion": "Proporción de los dedos",
  "skin_undertone": "Subtono cromático de mano",
  "recommended_shapes": ["Forma 1", "Forma 2", "Forma 3"],
  "recommended_colors": ["Color 1", "Color 2", "Color 3", "Color 4"],
  "pinterest_query": "consulta corta de pinterest"
}`;
    } else if (type === 'care-routine') {
      weatherInfo = { temp: 14, humidity: 80, description: 'Llovizna/Nublado' };
      try {
        const weatherApiKey = process.env.OPENWEATHER_API_KEY;
        if (weatherApiKey) {
          const resW = await fetch(`https://api.openweathermap.org/data/2.5/weather?q=Bogota,CO&appid=${weatherApiKey}&units=metric`);
          if (resW.ok) {
            const dataW = await resW.json();
            weatherInfo = {
              temp: dataW.main.temp,
              humidity: dataW.main.humidity,
              description: dataW.weather[0].description
            };
          }
        }
      } catch (wErr) {
        console.warn('⚠️ No se pudo obtener clima en tiempo real, usando clima promedio de Bogotá:', wErr.message);
      }

      const concernStr = concern ? `La preocupación u objetivo principal del usuario es: "${concern}". Asegúrate de orientar los pasos de la rutina y las explicaciones para mitigar este problema específicamente.` : '';
      const weatherPrompt = `
[CONTEXTO CLIMÁTICO ACTUAL - BOGOTÁ]
Temperatura: ${weatherInfo.temp}°C | Humedad: ${weatherInfo.humidity}% | Condición: ${weatherInfo.description}
Ajusta las recomendaciones considerando cómo este clima afecta el tipo de piel del usuario.
`;

      const isCapilar = track === 'capilar';
      if (isCapilar) {
        prompt = `Analiza detalladamente la hebra capilar o el cuero cabelludo que se observa en esta foto.
Determina el tipo de cabello (ej. Seco, Graso, Mixto) y el estado general (frizz, puntas abiertas, caspa).
Proporciona una explicación detallada del diagnóstico y genera una rutina semanal paso a paso en casa (3 pasos específicos).
${concernStr}
${weatherPrompt}
Genera una consulta corta (máximo 6 palabras) en español para buscar tratamientos capilares en Pinterest.`;
        jsonTemplate = `{
  "skin_type": "Tipo de cabello/cuero cabelludo",
  "scalp_status": "Estado del cuero cabelludo",
  "explanation": "Explicación de hebra y porosidad...",
  "recommended_routine": ["Paso 1...", "Paso 2...", "Paso 3..."],
  "scores": {
    "hidratacion": 70,
    "impurezas": 10,
    "luminosidad": 80
  },
  "pinterest_query": "consulta corta de pinterest"
}`;
      } else {
        prompt = `Analiza detalladamente la piel del rostro o la textura de cabello que se observa en esta foto.
Determina el tipo de piel o cabello (ej. Piel Mixta, Cabello Seco/Fino) y el estado general observando el brillo, resequedad o texturas.
Proporciona una explicación detallada del diagnóstico y genera una rutina semanal paso a paso en casa (3 pasos específicos).
${concernStr}
${profileContext}
${weatherPrompt}
Genera una consulta corta (máximo 6 palabras) en español para buscar rutinas de skincare o haircare recomendadas en Pinterest.`;
        jsonTemplate = `{
  "skin_type": "Tipo de piel o cabello detectado",
  "scalp_status": "Estado/Condición general",
  "explanation": "Explicación detallada del cuidado recomendado...",
  "recommended_routine": ["Paso 1...", "Paso 2...", "Paso 3..."],
  "scores": {
    "hidratacion": 80,
    "impurezas": 20,
    "luminosidad": 75
  },
  "pinterest_query": "consulta corta de pinterest"
}`;
      }
    } else if (type === 'hair-color') {
      prompt = `Analiza el rostro de la persona en esta foto, enfocándose en el subtono cromático de su piel (Cálido, Frío o Neutro) y la forma del rostro.
Determina el subtono cromático detectado y el tipo de rostro (Ovalado, Redondo, Cuadrado, etc.).
Recomienda los 3 tonos o reflejos de tinte de cabello que más le favorecen para enmarcar su cara y aportar luminosidad a su piel.
Explica detalladamente por qué estos colores armonizan con sus rasgos.
Genera una consulta corta (máximo 6 palabras) en español para buscar ideas visuales de coloración capilar recomendada en Pinterest.`;
      jsonTemplate = `{
  "skin_undertone": "Subtono de piel detectado",
  "face_shape": "Forma del rostro detectada",
  "recommended_shades": ["Tono 1", "Tono 2", "Tono 3"],
  "explanation": "Explicación detallada de colorimetría capilar...",
  "recommended_colors": ["Color 1", "Color 2", "Color 3", "Color 4"],
  "pinterest_query": "consulta corta de pinterest"
}`;
    } else {
      return res.status(400).json({ error: `Tipo de análisis "${type}" no es válido.` });
    }

    const fullPrompt = `${prompt}
Responde de manera obligatoria únicamente con un objeto JSON válido, sin formato markdown (sin bloques de código \`\`\`json) y sin caracteres adicionales, usando este formato exacto:
${jsonTemplate}`;

    const model = ai.getGenerativeModel({ model: 'gemini-3.1-flash-lite' });
    const result = await model.generateContent({
      contents: [
        {
          role: 'user',
          parts: [
            { text: fullPrompt },
            imagePart
          ]
        }
      ]
    });
    const response = await result.response;
    
    let text = response.text().trim();
    if (text.startsWith('```json')) {
      text = text.substring(7, text.length - 3).trim();
    } else if (text.startsWith('```')) {
      text = text.substring(3, text.length - 3).trim();
    }

    let analysisJson;
    try {
      analysisJson = JSON.parse(text);
      if (weatherInfo) {
        analysisJson.weather_snapshot = weatherInfo;
      }
    } catch (parseErr) {
      console.error('Error al parsear respuesta JSON de Gemini para análisis:', text);
      if (req.file && req.file.buffer) req.file.buffer.fill(0);
      throw new Error('La IA no retornó un formato JSON válido.');
    }

    // Purga de RAM
    if (req.file && req.file.buffer) {
      req.file.buffer.fill(0);
    }

    if (type === 'care-routine') {
      const targetConcern = concern || 'Hidratación';
      try {
        const prodRes = await pool.query(
          `SELECT nombre, marca, url_afiliado as url, comision_pct 
           FROM affiliate_products 
           WHERE objetivo = $1 AND activo = TRUE 
           LIMIT 1;`,
          [targetConcern]
        );
        if (prodRes.rows.length > 0) {
          analysisJson.recommended_product = prodRes.rows[0];
        }

        const sponsorRes = await pool.query(
          `SELECT marca, nombre_rutina, descripcion, producto_destacado, logo_url 
           FROM brand_sponsorships 
           WHERE objetivo_target = $1 AND activo = TRUE 
           LIMIT 1;`,
          [targetConcern]
        );
        if (sponsorRes.rows.length > 0) {
          analysisJson.brand_sponsorship = sponsorRes.rows[0];
        }
      } catch (prodErr) {
        console.warn('⚠️ No se pudo cargar recomendación de afiliado o patrocinio:', prodErr.message);
      }
    }

    let dbId = null;
    if (req.user && req.user.id) {
      // Las imágenes originales se procesan en memoria y no se guardan en el historial.
      dbId = await saveAnalysisToDb(req.user.id, type, analysisJson, track, null);
    }
    analysisJson.id = dbId;

    return res.status(200).json({
      success: true,
      source: 'gemini',
      analysis: analysisJson
    });

  } catch (error) {
    if (req.file && req.file.buffer) {
      try { req.file.buffer.fill(0); } catch (e) {}
    }
    console.error('❌ ERROR REALIZANDO ANÁLISIS DE DISEÑO:', error.message);
    res.status(500).json({ 
      error: 'Error al analizar la imagen con IA',
      details: error.message 
    });
  }
};

exports.proxyImage = async (req, res) => {
  try {
    const { url } = req.query;
    if (!url) {
      return res.status(400).json({ error: 'Falta el parámetro url' });
    }

    const response = await fetch(url);
    if (!response.ok) {
      return res.status(response.status).json({ error: 'Error al obtener la imagen' });
    }

    const contentType = response.headers.get('content-type');
    if (contentType) {
      res.setHeader('Content-Type', contentType);
    }
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.setHeader('Access-Control-Allow-Origin', '*');

    const buffer = await response.arrayBuffer();
    res.send(Buffer.from(buffer));
  } catch (error) {
    console.error('Error en proxy de imagen:', error.message);
    res.status(500).json({ error: 'Error interno del proxy de imagen' });
  }
};

exports.getAIHistory = async (req, res) => {
  try {
    const userId = req.user.id;
    const { tool_type } = req.query;

    let query = `
      SELECT id, tool_type, result_data, created_at 
      FROM ai_diagnostics 
      WHERE user_id = $1
    `;
    const params = [userId];

    if (tool_type) {
      query += ` AND tool_type = $2`;
      params.push(tool_type);
    }

    query += ` ORDER BY created_at DESC;`;

    const result = await pool.query(query, params);

    res.json({
      success: true,
      data: result.rows.map(row => ({
        id: row.id,
        tool_type: row.tool_type,
        result_data: typeof row.result_data === 'string' ? JSON.parse(row.result_data) : row.result_data,
        created_at: row.created_at
      }))
    });
  } catch (error) {
    console.error('❌ ERROR AL OBTENER HISTORIAL DE IA:', error);
    res.status(500).json({ error: 'Error al obtener el historial de diagnósticos' });
  }
};

exports.compareDesigns = async (req, res) => {
  try {
    const { diagnostic_id } = req.body;

    if (!req.files || !req.files.imageBefore || !req.files.imageAfter) {
      return res.status(400).json({ error: 'Es obligatorio subir ambas imágenes (Antes y Después) para realizar la comparación.' });
    }

    const fileBefore = req.files.imageBefore[0];
    const fileAfter = req.files.imageAfter[0];

    const imageBeforePart = {
      inlineData: {
        data: fileBefore.buffer.toString('base64'),
        mimeType: fileBefore.mimetype || 'image/jpeg'
      }
    };

    const imageAfterPart = {
      inlineData: {
        data: fileAfter.buffer.toString('base64'),
        mimeType: fileAfter.mimetype || 'image/jpeg'
      }
    };

    let comparisonResult = {};

    if (!ai) {
      if (fileBefore.buffer) fileBefore.buffer.fill(0);
      if (fileAfter.buffer) fileAfter.buffer.fill(0);
      return res.status(503).json({ error: 'AI_UNAVAILABLE', message: 'La comparación no está disponible en este momento.' });
    } else {
      const prompt = `Eres un especialista en análisis de piel. Se te proporcionan DOS fotografías del mismo usuario tomadas en momentos diferentes (foto A = antes, foto B = después). Analiza ambas y genera un JSON con esta estructura exacta:
{
  "delta_hidratacion": número entre -100 y 100 (positivo = mejoró),
  "delta_impurezas": número entre -100 y 100 (negativo = disminuyeron las impurezas, positivo = aumentaron),
  "delta_luminosidad": número entre -100 y 100,
  "resumen": "texto de máximo 2 oraciones en español describiendo el cambio observable",
  "recomendacion": "texto de máximo 2 oraciones con ajuste a la rutina si aplica"
}
Responde SOLO con el JSON. Sin texto adicional, sin backticks, sin explicación.`;

      const model = ai.getGenerativeModel({ model: 'gemini-3.1-flash-lite' });
      const result = await model.generateContent({
        contents: [
          {
            role: 'user',
            parts: [
              { text: prompt },
              imageBeforePart,
              imageAfterPart
            ]
          }
        ]
      });

      const response = await result.response;
      let text = response.text().trim();
      if (text.startsWith('```json')) {
        text = text.substring(7, text.length - 3).trim();
      } else if (text.startsWith('```')) {
        text = text.substring(3, text.length - 3).trim();
      }

      try {
        comparisonResult = JSON.parse(text);
      } catch (parseErr) {
        console.error('Error al parsear JSON de comparación:', text);
        throw new Error('La IA no retornó un formato de comparación JSON válido.');
      }
    }

    // Purga de RAM
    if (fileBefore.buffer) fileBefore.buffer.fill(0);
    if (fileAfter.buffer) fileAfter.buffer.fill(0);

    if (diagnostic_id) {
      const updateQuery = `
        UPDATE ai_diagnostics
        SET comparison_delta = $1
        WHERE id = $2 AND user_id = $3;
      `;
      const updated = await pool.query(updateQuery, [JSON.stringify(comparisonResult), diagnostic_id, req.user.id]);
      if (updated.rowCount === 0) {
        return res.status(404).json({ error: 'DIAGNOSTIC_NOT_FOUND', message: 'No se encontró un diagnóstico propio con ese identificador.' });
      }
    }

    res.json({
      success: true,
      comparison: comparisonResult
    });

  } catch (error) {
    console.error('❌ ERROR EN DIAGNÓSTICO SECUENCIAL DE DOBLE CAPA:', error);
    res.status(500).json({ error: 'Error al realizar el análisis comparativo' });
  }
};

exports.getSkinProfile = async (req, res) => {
  try {
    const userId = req.user.id;
    const query = `
      SELECT id, tipo_piel, hidratacion_promedio, tendencia_acne, sensibilidad_score, diagnosticos_count, ultimo_diagnostico_at
      FROM skin_profiles
      WHERE user_id = $1;
    `;
    const result = await pool.query(query, [userId]);
    if (result.rows.length === 0) {
      return res.json({
        success: true,
        data: null
      });
    }
    res.json({
      success: true,
      data: result.rows[0]
    });
  } catch (error) {
    console.error('❌ ERROR AL OBTENER PERFIL DE PIEL:', error);
    res.status(500).json({ error: 'Error al obtener el perfil de piel' });
  }
};

exports.checkGlowAIQuota = async (req, res, next) => {
  try {
    const { type } = req.body;
    if (type === 'skin-tone' || type === 'hair-color') {
      return next();
    }
    const userId = req.user.id;
    const userQuery = `
      SELECT email, glowai_plan, glowai_diagnosticos_mes, glowai_ciclo_reset_at
      FROM usuarios
      WHERE id = $1;
    `;
    const result = await pool.query(userQuery, [userId]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Usuario no encontrado.' });
    }

    let { glowai_plan, glowai_diagnosticos_mes, glowai_ciclo_reset_at } = result.rows[0];

    const ahora = new Date();
    const resetDate = new Date(glowai_ciclo_reset_at || ahora);

    const diffTime = Math.abs(ahora - resetDate);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    if (diffDays >= 30) {
      await pool.query(
        `UPDATE usuarios 
         SET glowai_diagnosticos_mes = 0, glowai_ciclo_reset_at = NOW() 
         WHERE id = $1;`,
        [userId]
      );
      glowai_diagnosticos_mes = 0;
    }

    if (glowai_plan === 'free' && glowai_diagnosticos_mes >= 2) {
      return res.status(402).json({
        error: 'quota_exceeded',
        message: 'Has alcanzado el límite mensual de diagnósticos gratuitos.',
        upgrade_url: '/glowaipremium'
      });
    }

    await pool.query(
      `UPDATE usuarios SET glowai_diagnosticos_mes = COALESCE(glowai_diagnosticos_mes, 0) + 1 WHERE id = $1;`,
      [userId]
    );
    
    next();

  } catch (error) {
    console.error('❌ ERROR EN MIDDLEWARE DE CUOTA GLOWAI:', error);
    res.status(500).json({ error: 'Error al verificar la cuota de diagnósticos' });
  }
};

exports.subscribePremium = async (req, res) => {
  return res.status(503).json({ error: 'PAYMENT_GATEWAY_NOT_INTEGRATED', message: 'La suscripción Premium no está disponible hasta integrar y verificar el pago.' });
};

exports.checkInStreak = async (req, res) => {
  try {
    const userId = req.user.id;
    const userQuery = `
      SELECT streak_actual, streak_maximo, streak_ultimo_registro
      FROM usuarios
      WHERE id = $1;
    `;
    const userRes = await pool.query(userQuery, [userId]);
    if (userRes.rows.length === 0) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    let { streak_actual, streak_maximo, streak_ultimo_registro } = userRes.rows[0];
    const hoy = new Date().toISOString().split('T')[0];
    
    // Si la fecha coincide con la del último registro (teniendo en cuenta la zona horaria)
    // Para simplificar, convertimos ambas fechas a strings YYYY-MM-DD
    let lastDateStr = null;
    if (streak_ultimo_registro) {
      const dbDate = new Date(streak_ultimo_registro);
      lastDateStr = dbDate.toISOString().split('T')[0];
    }

    if (lastDateStr === hoy) {
      return res.status(400).json({
        error: 'already_checked_in',
        message: 'Ya has registrado tu rutina de hoy. ¡Vuelve mañana!',
        streak_actual,
        streak_maximo
      });
    }

    let nuevoStreak = 1;
    if (lastDateStr) {
      const ayer = new Date();
      ayer.setDate(ayer.getDate() - 1);
      const ayerStr = ayer.toISOString().split('T')[0];
      
      if (lastDateStr === ayerStr) {
        nuevoStreak = (streak_actual || 0) + 1;
      }
    }

    const nuevoMaximo = Math.max(streak_maximo || 0, nuevoStreak);
    
    const rewardUnlocked = false;

    const updateQuery = `
      UPDATE usuarios
      SET streak_actual = $1, streak_maximo = $2, streak_ultimo_registro = $3
      WHERE id = $4;
    `;
    await pool.query(updateQuery, [nuevoStreak, nuevoMaximo, hoy, userId]);

    res.json({
      success: true,
      message: '¡Rutina diaria registrada con éxito! Sigue así.',
      streak_actual: nuevoStreak,
      streak_maximo: nuevoMaximo,
      reward_unlocked: rewardUnlocked
    });

  } catch (error) {
    console.error('❌ ERROR AL REGISTRAR RACHA DE RUTINA:', error);
    res.status(500).json({ error: 'Error al registrar la racha de la rutina' });
  }
};

exports.getShareCode = async (req, res) => {
  try {
    const userId = req.user.id;
    const checkQuery = `SELECT codigo FROM referidos WHERE referidor_user_id = $1;`;
    const checkRes = await pool.query(checkQuery, [userId]);
    
    if (checkRes.rows.length > 0) {
      return res.json({
        success: true,
        code: checkRes.rows[0].codigo
      });
    }

    const code = 'GLOW' + Math.random().toString(36).substring(2, 8).toUpperCase();
    const insertQuery = `
      INSERT INTO referidos (referidor_user_id, codigo)
      VALUES ($1, $2)
      RETURNING codigo;
    `;
    const insertRes = await pool.query(insertQuery, [userId, code]);
    
    res.json({
      success: true,
      code: insertRes.rows[0].codigo
    });

  } catch (error) {
    console.error('❌ ERROR AL OBTENER CÓDIGO DE REFERIDO:', error);
    res.status(500).json({ error: 'Error al generar código de referido' });
  }
};

exports.redirectReferral = async (req, res) => {
  try {
    const { code } = req.params;
    
    await pool.query(
      `UPDATE referidos SET clicks = clicks + 1 WHERE codigo = $1;`,
      [code]
    );

    res.redirect('/');
  } catch (error) {
    console.error('❌ ERROR EN REDIRECCIÓN DE REFERIDO:', error);
    res.status(500).send('Error al procesar el enlace de referido');
  }
};

exports.getRecommendedDoctors = async (req, res) => {
  try {
    const query = `
      SELECT id, nombre, especialidad, registro_medico, telefono, email, ciudad, foto_url, condiciones_tratadas
      FROM profesionales_medicos
      WHERE membresia_activa = TRUE;
    `;
    const result = await pool.query(query);
    res.json({
      success: true,
      data: result.rows
    });
  } catch (error) {
    console.error('❌ ERROR AL OBTENER DERMATÓLOGOS RECOMENDADOS:', error);
    res.status(500).json({ error: 'Error al obtener dermatólogos' });
  }
};

exports.getEvolutionData = async (req, res) => {
  try {
    const userId = req.user.id;
    let { track } = req.params;
    const dbTrack = track === 'facial' ? 'piel' : 'capilar';

    const userPlanRes = await pool.query('SELECT glowai_plan FROM usuarios WHERE id = $1', [userId]);
    const plan = userPlanRes.rows[0]?.glowai_plan || 'free';

    let query = `
      SELECT id, score_hidratacion, score_impurezas, score_luminosidad, image_url, comparison_photo_url, comparison_delta, created_at
      FROM ai_diagnostics
      WHERE user_id = $1 AND track = $2 AND score_hidratacion IS NOT NULL
      ORDER BY created_at ASC;
    `;
    
    const result = await pool.query(query, [userId, dbTrack]);
    let list = result.rows;

    if (plan !== 'premium') {
      list = list.slice(-1);
    }

    res.json({
      success: true,
      plan,
      data: list
    });
  } catch (error) {
    console.error('❌ ERROR AL OBTENER DATOS DE EVOLUCIÓN:', error);
    res.status(500).json({ error: 'Error al obtener datos de evolución' });
  }
};

exports.getEvolutionInsight = async (req, res) => {
  try {
    const userId = req.user.id;
    let { track } = req.params;
    const dbTrack = track === 'facial' ? 'piel' : 'capilar';

    const query = `
      SELECT score_hidratacion, score_impurezas, score_luminosidad, created_at
      FROM ai_diagnostics
      WHERE user_id = $1 AND track = $2 AND score_hidratacion IS NOT NULL
      ORDER BY created_at ASC;
    `;
    const result = await pool.query(query, [userId, dbTrack]);
    const list = result.rows;

    if (list.length === 0) {
      return res.json({
        success: true,
        insight: "Aún no tienes diagnósticos registrados en este track. Realiza tu primer escaneo para iniciar tu evolución."
      });
    }

    if (list.length === 1) {
      return res.json({
        success: true,
        insight: "¡Felicidades por iniciar tu rutina! En tu próximo escaneo analizaremos tu progreso comparando tus fotos y métricas actuales."
      });
    }

    const first = list[0];
    const last = list[list.length - 1];

    const diffHydration = last.score_hidratacion - first.score_hidratacion;
    const diffImpures = last.score_impurezas - first.score_impurezas;
    const diffLuminosity = last.score_luminosidad - first.score_luminosidad;

    let insightText = `Analizando tu evolución desde tu primer registro: `;
    const parts = [];

    if (diffHydration !== 0) {
      parts.push(`la hidratación ha ${diffHydration > 0 ? 'aumentado' : 'disminuido'} un ${Math.abs(diffHydration)}%`);
    }
    if (diffImpures !== 0) {
      parts.push(`las impurezas se han ${diffImpures < 0 ? 'reducido' : 'incrementado'} un ${Math.abs(diffImpures)}%`);
    }
    if (diffLuminosity !== 0) {
      parts.push(`la luminosidad facial se ha ${diffLuminosity > 0 ? 'incrementado' : 'reducido'} un ${Math.abs(diffLuminosity)}%`);
    }

    if (parts.length > 0) {
      insightText += parts.join(', ') + `.`;
    } else {
      insightText += `Tus métricas de cuidado de la piel se mantienen estables en un nivel balanceado.`;
    }

    res.json({
      success: true,
      insight: insightText
    });
  } catch (error) {
    console.error('❌ ERROR AL GENERAR INSIGHT DE EVOLUCIÓN:', error);
    res.status(500).json({ error: 'Error al generar nota interpretativa de evolución' });
  }
};

exports.getEvolutionAttribution = async (req, res) => {
  try {
    const userId = req.user.id;
    let { track } = req.params;
    const dbTrack = track === 'facial' ? 'piel' : 'capilar';

    const query = `
      SELECT result_data
      FROM ai_diagnostics
      WHERE user_id = $1 AND track = $2
      ORDER BY created_at DESC
      LIMIT 1;
    `;
    const result = await pool.query(query, [userId, dbTrack]);
    
    if (result.rows.length === 0) {
      return res.json({ success: true, attribution: null });
    }

    const lastDiag = result.rows[0];
    const data = lastDiag.result_data;

    let attributionText = null;

    if (data.recommended_product) {
      attributionText = `Tu evolución positiva coincide con el uso sugerido del producto ${data.recommended_product.nombre} de ${data.recommended_product.marca}.`;
    } else if (data.brand_sponsorship) {
      attributionText = `Tu evolución coincide con la rutina patrocinada "${data.brand_sponsorship.nombre_rutina}" de la marca ${data.brand_sponsorship.marca}.`;
    }

    res.json({
      success: true,
      attribution: attributionText
    });
  } catch (error) {
    console.error('❌ ERROR AL OBTENER ATRIBUCIÓN COMERCIAL:', error);
    res.status(500).json({ error: 'Error al obtener la atribución del producto' });
  }
};

exports.requestMedicalValidation = async (req, res) => {
  try {
    const userId = req.user.id;
    const { ai_diagnostic_id, profesional_id } = req.body;

    if (!profesional_id) {
      return res.status(400).json({ error: 'Debes seleccionar un profesional médico.' });
    }

    const userRes = await pool.query('SELECT glowai_plan FROM usuarios WHERE id = $1', [userId]);
    const plan = userRes.rows[0]?.glowai_plan || 'free';

    if (plan !== 'premium') {
      return res.status(403).json({ error: 'Esta solicitud gratuita solo está disponible en planes Premium.' });
    }

    const insertQuery = `
      INSERT INTO validaciones_medicas (user_id, ai_diagnostic_id, profesional_id, estado, payment_reference)
      VALUES ($1, $2, $3, 'pendiente', 'premium_plan')
      RETURNING *;
    `;
    const dbRes = await pool.query(insertQuery, [userId, ai_diagnostic_id || null, profesional_id]);
    const reqId = dbRes.rows[0].id;

    simulateDoctorReview(reqId);

    res.status(201).json({
      success: true,
      message: 'Solicitud de validación médica enviada con éxito.',
      data: dbRes.rows[0]
    });
  } catch (error) {
    console.error('❌ ERROR AL SOLICITAR VALIDACIÓN MÉDICA:', error);
    res.status(500).json({ error: 'Error al solicitar validación médica' });
  }
};

exports.payMedicalValidation = async (req, res) => {
  // Sin pasarela real de pagos para validación médica: 501 en todo entorno
  // salvo opt-in explícito para tests locales (ALLOW_PAYMENT_SIMULATOR=true).
  if (process.env.ALLOW_PAYMENT_SIMULATOR !== 'true') {
    return res.status(501).json({
      error: 'PAYMENT_GATEWAY_NOT_INTEGRATED',
      message: 'La pasarela de pagos real no está integrada. No se procesan pagos simulados.'
    });
  }

  // ----- MODO TEST LOCAL ONLY (ALLOW_PAYMENT_SIMULATOR=true) -----
  // Código heredado mantenido SOLO para tests de integración que lo requieran.
  // NO debe usarse en staging/producción.
  try {
    const userId = req.user.id;
    const { ai_diagnostic_id, profesional_id } = req.body;

    if (!profesional_id) {
      return res.status(400).json({ error: 'Debes seleccionar un profesional médico.' });
    }

    const refToken = 'wompi_val_ref_' + Math.random().toString(36).substring(2, 11).toUpperCase();

    const insertQuery = `
      INSERT INTO validaciones_medicas (user_id, ai_diagnostic_id, profesional_id, estado, payment_reference)
      VALUES ($1, $2, $3, 'pendiente', $4)
      RETURNING *;
    `;
    const dbRes = await pool.query(insertQuery, [userId, ai_diagnostic_id || null, profesional_id, refToken]);
    const reqId = dbRes.rows[0].id;

    // simulateDoctorReview ELIMINADA (código muerto: solo logueaba y no resolvía nada).
    // En tests que necesiten el flujo completo, mockear la respuesta del profesional.

    res.status(201).json({
      success: true,
      message: 'Solicitud registrada. Pago SIMULADO (solo tests locales): la referencia no proviene de la pasarela.',
      payment_reference: refToken,
      simulated: true,
      data: dbRes.rows[0]
    });
  } catch (error) {
    console.error('❌ ERROR AL PROCESAR PAGO DE VALIDACIÓN:', error);
    res.status(500).json({ error: 'Error al procesar pago de validación' });
  }
};

exports.getValidationHistory = async (req, res) => {
  try {
    const userId = req.user.id;
    const query = `
      SELECT vm.id, vm.estado, vm.nota_profesional, vm.payment_reference, vm.created_at, vm.fecha_respuesta,
             pm.nombre AS profesional_nombre, pm.especialidad AS profesional_especialidad, pm.foto_url AS profesional_foto
      FROM validaciones_medicas vm
      JOIN profesionales_medicos pm ON vm.profesional_id = pm.id
      WHERE vm.user_id = $1
      ORDER BY vm.created_at DESC;
    `;
    const result = await pool.query(query, [userId]);
    res.json({
      success: true,
      data: result.rows
    });
  } catch (error) {
    console.error('❌ ERROR AL OBTENER HISTORIAL DE VALIDACIONES:', error);
    res.status(500).json({ error: 'Error al obtener historial de validaciones' });
  }
};

exports.getValidationById = async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;
    const query = `
      SELECT vm.id, vm.estado, vm.nota_profesional, vm.payment_reference, vm.created_at, vm.fecha_respuesta,
             pm.nombre AS profesional_nombre, pm.especialidad AS profesional_especialidad, pm.foto_url AS profesional_foto
      FROM validaciones_medicas vm
      JOIN profesionales_medicos pm ON vm.profesional_id = pm.id
      WHERE vm.id = $1 AND vm.user_id = $2;
    `;
    const result = await pool.query(query, [id, userId]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Solicitud de validación no encontrada.' });
    }
    res.json({
      success: true,
      data: result.rows[0]
    });
  } catch (error) {
    console.error('❌ ERROR AL OBTENER VALIDACIÓN POR ID:', error);
    res.status(500).json({ error: 'Error al obtener detalles de la validación' });
  }
};

// ❌ ELIMINADO: simulateDoctorReview escribía a los 15 s una nota clínica ALEATORIA
// (una de tres frases) en `validaciones_medicas`, marcaba estado='revisado' y la
// firmaba como si la hubiera emitido un dermatólogo (A360-2026-09-22/C-08).
// Una revisión profesional no se puede fabricar: la solicitud queda 'pendiente'
// hasta que la responda una persona real.

// 🔹 NUEVO: Colecciones Curadas Editoriales
exports.getCuratedCollections = async (req, res) => {
  try {
    const { category } = req.query;
    if (!category) {
      return res.status(400).json({ error: 'La categoría es requerida' });
    }
    
    const dbCategory = category === 'nails' ? 'nails' : (category === 'hair' ? 'hair' : (category === 'skin' ? 'skin' : 'eyebrow'));
    const result = await pool.query(
      'SELECT id, nombre, categoria, query_base, orden_visual, exclusiva_streak FROM curated_collections WHERE categoria = $1 AND activo = TRUE ORDER BY orden_visual ASC',
      [dbCategory]
    );
    
    res.status(200).json({ success: true, data: result.rows });
  } catch (error) {
    console.error('❌ Error al obtener colecciones curadas:', error.message);
    res.status(500).json({ error: 'Error al obtener colecciones' });
  }
};

// 🔹 NUEVO: Colecciones Exclusivas por Racha de 7 días
exports.getExclusiveCollections = async (req, res) => {
  try {
    const userId = req.user.id;
    const userRes = await pool.query('SELECT streak_actual FROM usuarios WHERE id = $1', [userId]);
    if (userRes.rows.length === 0) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }
    
    const streak = userRes.rows[0].streak_actual || 0;
    if (streak < 7) {
      return res.status(403).json({ error: 'Racha insuficiente. Necesitas al menos 7 días de racha.' });
    }

    const result = await pool.query(
      'SELECT id, nombre, categoria, query_base, orden_visual, exclusiva_streak FROM curated_collections WHERE exclusiva_streak = TRUE AND activo = TRUE ORDER BY orden_visual ASC'
    );
    
    res.status(200).json({ success: true, data: result.rows });
  } catch (error) {
    console.error('❌ Error al obtener colecciones exclusivas:', error.message);
    res.status(500).json({ error: 'Error al obtener colecciones exclusivas' });
  }
};

// 🔹 NUEVO: Tarjeta Glow Up Compartible (Sólo Premium)
exports.generateGlowUpCard = async (req, res) => {
  try {
    const userId = req.user.id;
    const { favorite_design_url, track } = req.body;

    const userRes = await pool.query('SELECT glowai_plan, email, nombre FROM usuarios WHERE id = $1', [userId]);
    if (userRes.rows.length === 0) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }
    
    const user = userRes.rows[0];
    const isPremium = user.glowai_plan === 'premium';
    if (!isPremium) {
      return res.status(402).json({ error: 'La tarjeta Glow Up compartible es una característica exclusiva de GlowAI Premium.' });
    }

    const activeTrack = track || 'piel';
    const historyRes = await pool.query(
      'SELECT score_hidratacion, score_impurezas, score_luminosidad, created_at FROM ai_diagnostics WHERE user_id = $1 AND track = $2 AND score_hidratacion IS NOT NULL ORDER BY created_at ASC',
      [userId, activeTrack]
    );

    let progressDelta = "+0%";
    let scoreName = "Hidratación";
    
    if (historyRes.rows.length >= 2) {
      const first = historyRes.rows[0];
      const last = historyRes.rows[historyRes.rows.length - 1];
      
      const diffHydration = (last.score_hidratacion || 0) - (first.score_hidratacion || 0);
      const diffLuminosity = (last.score_luminosidad || 0) - (first.score_luminosidad || 0);
      
      if (Math.abs(diffHydration) >= Math.abs(diffLuminosity)) {
        progressDelta = `${diffHydration >= 0 ? '+' : ''}${diffHydration}%`;
        scoreName = "Hidratación";
      } else {
        progressDelta = `${diffLuminosity >= 0 ? '+' : ''}${diffLuminosity}%`;
        scoreName = "Luminosidad";
      }
    } else if (historyRes.rows.length === 1) {
      const diag = historyRes.rows[0];
      progressDelta = `${diag.score_hidratacion}%`;
      scoreName = "Hidratación";
    }

    res.status(200).json({
      success: true,
      data: {
        favorite_image_url: favorite_design_url || '',
        progress_metric: progressDelta,
        metric_name: scoreName,
        user_name: user.nombre || 'Usuario GlowApp',
        created_at: new Date()
      }
    });
  } catch (error) {
    console.error('❌ Error al generar tarjeta Glow Up:', error.message);
    res.status(500).json({ error: 'Error al generar la tarjeta Glow Up' });
  }
};

// 🔹 NUEVO: Middleware de cuota independiente para colorimetría
exports.checkColorimetriaQuota = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { type } = req.body;

    if (type !== 'skin-tone' && type !== 'hair-color') {
      return next(); // Solo aplica a colorimetría
    }

    const userQuery = `
      SELECT glowai_plan, colorimetria_diagnosticos_mes, colorimetria_mes_referencia
      FROM usuarios
      WHERE id = $1;
    `;
    const result = await pool.query(userQuery, [userId]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Usuario no encontrado.' });
    }

    let { glowai_plan, colorimetria_diagnosticos_mes, colorimetria_mes_referencia } = result.rows[0];

    // Reset mensual
    const ahora = new Date();
    const resetDate = new Date(colorimetria_mes_referencia || ahora);
    const diffTime = Math.abs(ahora - resetDate);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    if (diffDays >= 30) {
      await pool.query(
        `UPDATE usuarios 
         SET colorimetria_diagnosticos_mes = 0, colorimetria_mes_referencia = NOW() 
         WHERE id = $1;`,
         [userId]
      );
      colorimetria_diagnosticos_mes = 0;
    }

    // Para el plan Free, límite de 1 diagnóstico de skin-tone y 1 de hair-color
    if (glowai_plan === 'free') {
      const cycleStart = colorimetria_mes_referencia || ahora;
      const countRes = await pool.query(
        `SELECT COUNT(*) FROM ai_diagnostics 
         WHERE user_id = $1 AND type = $2 AND created_at >= $3`,
        [userId, type, cycleStart]
      );
      const count = parseInt(countRes.rows[0].count || 0);

      if (count >= 1) {
        return res.status(402).json({
          error: 'quota_exceeded',
          message: `Has alcanzado el límite mensual de 1 diagnóstico gratuito para ${type === 'skin-tone' ? 'Colorimetría Facial' : 'Colorimetría Capilar'}.`,
          upgrade_url: '/glowaipremium'
        });
      }
    }

    // Incrementar contador de control (informativo general)
    await pool.query(
      `UPDATE usuarios SET colorimetria_diagnosticos_mes = COALESCE(colorimetria_diagnosticos_mes, 0) + 1 WHERE id = $1;`,
      [userId]
    );
    
    next();

  } catch (error) {
    console.error('❌ ERROR EN MIDDLEWARE DE CUOTA COLORIMETRÍA:', error);
    res.status(500).json({ error: 'Error al verificar la cuota de colorimetría' });
  }
};

// 🔹 NUEVO: Historial de Colorimetría
exports.getColorimetriaHistorial = async (req, res) => {
  try {
    const userId = req.user.id;
    const userRes = await pool.query('SELECT glowai_plan, email FROM usuarios WHERE id = $1', [userId]);
    if (userRes.rows.length === 0) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    const { glowai_plan, email } = userRes.rows[0];
    const isPremium = glowai_plan === 'premium';

    const query = `
      SELECT id, type, result, created_at, image_url 
      FROM ai_diagnostics 
      WHERE user_id = $1 AND type IN ('skin-tone', 'hair-color') 
      ORDER BY created_at DESC;
    `;
    const result = await pool.query(query, [userId]);

    let data = result.rows;
    if (!isPremium && data.length > 1) {
      data = [data[0]];
    }

    res.status(200).json({
      success: true,
      data
    });
  } catch (error) {
    console.error('❌ Error al obtener historial de colorimetría:', error.message);
    res.status(500).json({ error: 'Error al obtener historial de colorimetría' });
  }
};

// 🔹 NUEVO: Middleware de cuota para outfits IA (GlowStyle)
exports.checkOutfitQuota = async (req, res, next) => {
  try {
    const userId = req.user.id;

    const userQuery = `
      SELECT glowai_plan, glowstyle_outfits_mes, glowstyle_mes_referencia
      FROM usuarios
      WHERE id = $1;
    `;
    const result = await pool.query(userQuery, [userId]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Usuario no encontrado.' });
    }

    let { glowai_plan, glowstyle_outfits_mes, glowstyle_mes_referencia } = result.rows[0];

    // Reset mensual para Premium
    const ahora = new Date();
    const resetDate = new Date(glowstyle_mes_referencia || ahora);
    const diffTime = Math.abs(ahora - resetDate);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays >= 30) {
      await pool.query(
        `UPDATE usuarios 
         SET glowstyle_outfits_mes = 0, glowstyle_mes_referencia = NOW() 
         WHERE id = $1;`,
         [userId]
      );
      glowstyle_outfits_mes = 0;
    }

    if (glowai_plan === 'free') {
      // Máximo 2 combinaciones gratuitas históricas
      const countRes = await pool.query(
        'SELECT COUNT(*) FROM guardarropa_outfits WHERE user_id = $1',
        [userId]
      );
      const count = parseInt(countRes.rows[0].count || 0);

      if (count >= 2) {
        return res.status(402).json({
          error: 'quota_exceeded',
          message: 'Has alcanzado el límite de 2 combinaciones de outfit gratuitas de por vida. Suscríbete a GlowAI Premium para diseñar outfits ilimitados diariamente.',
          upgrade_url: '/glowaipremium'
        });
      }
    } else {
      // Límite Premium: 20 outfits al mes
      if (glowstyle_outfits_mes >= 20) {
        return res.status(402).json({
          error: 'quota_exceeded',
          message: 'Has alcanzado el límite mensual de 20 outfits personalizados por IA en tu plan Premium.'
        });
      }
    }

    next();

  } catch (error) {
    console.error('❌ ERROR EN MIDDLEWARE DE CUOTA OUTFIT:', error);
    res.status(500).json({ error: 'Error al verificar la cuota de outfits' });
  }
};

// 🔹 NUEVO: Analizar y clasificar prenda de ropa
exports.classifyGarment = async (req, res) => {
  try {
    const userId = req.user.id;
    if (!req.file) {
      return res.status(400).json({ error: 'Debes subir una foto de la prenda.' });
    }

    if (!ai) {
      return res.status(500).json({ error: 'El servicio de IA no está configurado.' });
    }

    const fileBuffer = req.file.buffer;
    const mimeType = req.file.mimetype || 'image/jpeg';
    const base64Data = fileBuffer.toString('base64');
    const imageUri = `data:${mimeType};base64,${base64Data}`;

    const imagePart = {
      inlineData: {
        data: base64Data,
        mimeType
      }
    };

    const prompt = `Analiza detalladamente esta prenda de vestir.
Dime qué tipo de prenda es y clasifícala.
Determina su categoría estrictamente entre: "superior", "inferior", "calzado", "accesorio", "abrigo".
Identifica el color predominante.
Sugiere un estilo de ocasión adecuado entre: "urbano", "clasico", "noche", "fiesta", "casual".
Responde obligatoriamente en formato JSON válido, sin bloques de código markdown (\`\`\`json) y sin caracteres extras:
{
  "nombre": "Nombre descriptivo de la prenda (ej: Blazer Negro Sastre)",
  "categoria": "categoría",
  "color_predominante": "color",
  "estilo_sugerido": "estilo"
}`;

    const model = ai.getGenerativeModel({ model: 'gemini-3.1-flash-lite' });
    const result = await model.generateContent({
      contents: [
        {
          role: 'user',
          parts: [
            { text: prompt },
            imagePart
          ]
        }
      ]
    });

    const response = await result.response;
    let text = response.text().trim();
    
    // Extractor de JSON súper robusto
    const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/) || text.match(/```\s*([\s\S]*?)\s*```/);
    if (jsonMatch) {
      text = jsonMatch[1].trim();
    } else {
      const firstBrace = text.indexOf('{');
      const lastBrace = text.lastIndexOf('}');
      if (firstBrace !== -1 && lastBrace !== -1) {
        text = text.substring(firstBrace, lastBrace + 1).trim();
      }
    }

    const classification = JSON.parse(text);

    // Insertar en la base de datos
    const insertQuery = `
      INSERT INTO guardarropa_prendas (user_id, nombre, categoria, color_predominante, estilo_sugerido, image_url)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *;
    `;
    const dbResult = await pool.query(insertQuery, [
      userId,
      classification.nombre || 'Prenda sin nombre',
      classification.categoria || 'superior',
      classification.color_predominante || 'Desconocido',
      classification.estilo_sugerido || 'casual',
      imageUri
    ]);

    res.status(200).json({
      success: true,
      data: dbResult.rows[0]
    });

  } catch (error) {
    console.error('❌ Error al catalogar prenda:', error.message);
    res.status(500).json({ error: 'Error al catalogar la prenda de ropa: ' + error.message });
  }
};

// 🔹 NUEVO: Generar combinación de outfits inteligente
exports.generateOutfit = async (req, res) => {
  try {
    const userId = req.user.id;
    const { ocasion } = req.body; // 'urbano', 'clasico', 'noche', 'fiesta', 'casual'

    // 1. Obtener prendas del armario del usuario
    const prendasRes = await pool.query(
      'SELECT id, nombre, categoria, color_predominante, estilo_sugerido FROM guardarropa_prendas WHERE user_id = $1',
      [userId]
    );

    if (prendasRes.rows.length === 0) {
      return res.status(400).json({ error: 'Primero debes subir algunas prendas a tu clóset para generar un outfit.' });
    }

    const clóset = prendasRes.rows;

    // 2. Obtener colorimetría del usuario
    const colorimetriaRes = await pool.query(
      `SELECT result FROM ai_diagnostics 
       WHERE user_id = $1 AND type IN ('skin-tone', 'hair-color') 
       ORDER BY created_at DESC LIMIT 1`,
      [userId]
    );

    let infoColor = "Subtono: Neutro. Colores clave sugeridos: Negro, Blanco, Azul, Rojo.";
    if (colorimetriaRes.rows.length > 0) {
      const col = colorimetriaRes.rows[0].result || {};
      const subtono = col.undertone || col.skin_undertone || 'Neutro';
      const recomendados = col.recommended_colors || col.recommended_shades || [];
      infoColor = `Subtono de piel detectado: ${subtono}. Colores cromáticos ideales: ${recomendados.join(', ')}.`;
    }

    // 3. Consultar a Gemini para proponer la combinación
    const prompt = `Actúa como un Personal Stylist y Asesor de Imagen experto.
Tengo el siguiente clóset de prendas reales registradas (en formato JSON):
${JSON.stringify(clóset)}

Los datos de mi colorimetría personal son:
${infoColor}

Por favor, diseña un outfit ideal seleccionando de 2 a 4 prendas de mi clóset para la ocasión / estilo: "${ocasion || 'casual'}".
Explica en un párrafo corto en español por qué estas prendas combinan bien juntas y cómo armonizan cromáticamente con mi subtono de piel y colores clave de colorimetría.
Genera además una consulta en español de no más de 5 palabras para buscar referencias visuales inspiracionales similares en Pinterest.

Responde obligatoriamente única y estrictamente con un JSON válido en este formato:
{
  "nombre": "Nombre creativo del look (ej: Noche Elegante de Contraste)",
  "prendas_ids": ["array-de-ids-de-prendas-seleccionadas-del-closet"],
  "estilo": "estilo-seleccionado",
  "sugerencia_texto": "Tu explicación e insight de estilismo personalizada...",
  "pinterest_query": "consulta de pinterest"
}`;

    const model = ai.getGenerativeModel({ model: 'gemini-3.1-flash-lite' });
    const result = await model.generateContent(prompt);
    
    const response = await result.response;
    let text = response.text().trim();
    
    // Extractor de JSON súper robusto
    const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/) || text.match(/```\s*([\s\S]*?)\s*```/);
    if (jsonMatch) {
      text = jsonMatch[1].trim();
    } else {
      const firstBrace = text.indexOf('{');
      const lastBrace = text.lastIndexOf('}');
      if (firstBrace !== -1 && lastBrace !== -1) {
        text = text.substring(firstBrace, lastBrace + 1).trim();
      }
    }

    const recomendacion = JSON.parse(text);

    // 4. Guardar outfit en base de datos
    const insertQuery = `
      INSERT INTO guardarropa_outfits (user_id, nombre, prendas_ids, estilo, sugerencia_texto)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *;
    `;
    const outfitResult = await pool.query(insertQuery, [
      userId,
      recomendacion.nombre || 'Mi Combinación Especial',
      recomendacion.prendas_ids || [],
      ocasion || 'casual',
      recomendacion.sugerencia_texto || 'Combinación inteligente recomendada por GlowStyle.'
    ]);

    // 5. Incrementar el contador mensual en usuarios
    await pool.query(
      'UPDATE usuarios SET glowstyle_outfits_mes = COALESCE(glowstyle_outfits_mes, 0) + 1 WHERE id = $1',
      [userId]
    );

    res.status(200).json({
      success: true,
      data: {
        ...outfitResult.rows[0],
        pinterest_query: recomendacion.pinterest_query
      }
    });

  } catch (error) {
    console.error('❌ Error al generar outfit:', error.message);
    res.status(500).json({ error: 'Error al diseñar outfit por IA: ' + error.message });
  }
};

// 🔹 NUEVO: Obtener armario digital
exports.getWardrobe = async (req, res) => {
  try {
    const userId = req.user.id;
    const result = await pool.query(
      'SELECT * FROM guardarropa_prendas WHERE user_id = $1 ORDER BY created_at DESC',
      [userId]
    );

    res.status(200).json({
      success: true,
      data: result.rows
    });
  } catch (error) {
    console.error('❌ Error al obtener guardarropa:', error.message);
    res.status(500).json({ error: 'Error al obtener guardarropa' });
  }
};

// 🔹 NUEVO: Eliminar prenda del guardarropa
exports.deleteGarment = async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;

    await pool.query(
      'DELETE FROM guardarropa_prendas WHERE id = $1 AND user_id = $2',
      [id, userId]
    );

    res.status(200).json({
      success: true,
      message: 'Prenda eliminada correctamente.'
    });
  } catch (error) {
    console.error('❌ Error al eliminar prenda:', error.message);
    res.status(500).json({ error: 'Error al eliminar prenda' });
  }
};

// 🔹 NUEVO: Obtener historial de outfits sugeridos
exports.getOutfitHistorial = async (req, res) => {
  try {
    const userId = req.user.id;
    const result = await pool.query(
      'SELECT * FROM guardarropa_outfits WHERE user_id = $1 ORDER BY created_at DESC',
      [userId]
    );

    res.status(200).json({
      success: true,
      data: result.rows
    });
  } catch (error) {
    console.error('❌ Error al obtener historial de outfits:', error.message);
    res.status(500).json({ error: 'Error al obtener historial de outfits' });
  }
};
