const { pool } = require('./backend/src/config/db'); // Ajusta la ruta a tu config de DB
const axios = require('axios');
require('dotenv').config();

// Configuración para generar embeddings con DeepSeek
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
const EMBEDDING_MODEL = 'deepseek-embedding'; // O el modelo específico que uses para vectores
const EMBEDDING_URL = 'https://api.deepseek.com/v1/embeddings';

// Base de datos extraída de tu Guía Estratégica v1.0
const beautyData = [
  {
    title: "¿Qué es la Niacinamida y por qué debería usarla?",
    category: "Ingredientes > Actives Skincare",
    content: "La niacinamida (Vitamina B3) es como el 'manager' de tu barrera cutánea. Regula la grasa, reduce poros visibles y calma la inflamación. Es ideal para pieles grasas, mixtas o sensibles. Concentración ideal: 2-5%. Compatible con casi todo, incluido el retinol.",
    metadata: { skin_types: ["Oily", "Combination", "Sensitive"], concerns: ["Acne", "Pores"], evidence_level: "High" }
  },
  {
    title: "¿Cómo empiezo a usar retinol sin irritar mi piel?",
    category: "Ingredientes > Actives Skincare",
    content: "El retinol aumenta la renovación celular pero puede ser fuerte. Empieza con una concentración baja (0.01-0.03%) solo 2 veces por semana en la noche. Aplica sobre piel seca y siempre usa SPF 30+ al día siguiente. Evítalo si estás embarazada.",
    metadata: { skin_types: ["Normal", "Dry"], concerns: ["Aging"], safety_notes: "No usar en embarazo. Solo noche." }
  },
  {
    title: "¿Por qué mi cabello absorbe agua tan rápido y se siente áspero?",
    category: "Técnicas > Hair Treatments",
    content: "Probablemente tienes alta porosidad. Imagina tu cabello como una esponja con 'agujeros'. Necesita proteínas (queratina hidrolizada) para reparar y aceites pesados (coco, babasú) para sellar la hidratación. Evita humectantes puros sin sellador.",
    metadata: { hair_porosity: "High", key_ingredients: ["Proteins", "Heavy Oils"] }
  },
  {
    title: "¿Es seguro el PPD en los tintes de pelo?",
    category: "Regulación > Ingredient Safety",
    content: "El PPD es el alérgeno #1 en tintes. Puede causar dermatitis grave. La regulación exige un test de parche 48h antes de cada uso. Si tienes historial de alergias, busca alternativas sin PPD o con PTD.",
    metadata: { allergen_risk: "High", regulatory_status: "Restricted (Max 2%)" }
  },
  {
    title: "¿Los serums de pestañas con prostaglandinas son seguros?",
    category: "Salud > Lash & Brow Services",
    content: "Son muy eficaces pero tienen riesgos serios: pueden oscurecer el párpado, hundir la zona orbital (pérdida de grasa) y cambiar el color del iris. Úsalos con precaución y bajo supervisión.",
    metadata: { risk_level: "High", side_effects: ["Orbital fat loss", "Iris darkening"] }
  }
];

async function generateEmbedding(text) {
  try {
    const response = await axios.post(
      EMBEDDING_URL,
      { model: EMBEDDING_MODEL, input: text },
      { headers: { 'Authorization': `Bearer ${DEEPSEEK_API_KEY}`, 'Content-Type': 'application/json' } }
    );
    return response.data.data[0].embedding;
  } catch (error) {
    console.error(`Error generando embedding para: ${text.substring(0, 30)}...`, error.response?.data || error.message);
    return null;
  }
}

async function seedKnowledgeV3() {
  try {
    console.log('🌱 Iniciando siembra de Base de Conocimiento GlowApp (v3 con Vectores)...');
    
    for (const item of beautyData) {
      console.log(`Generando vector para: ${item.title}`);
      const embedding = await generateEmbedding(item.content);
      
      if (embedding) {
        const query = `
          INSERT INTO beauty_knowledge_embeddings (title, category, content, metadata, embedding)
          VALUES ($1, $2, $3, $4, $5::vector)
          ON CONFLICT (title) DO UPDATE SET 
            content = EXCLUDED.content, 
            metadata = EXCLUDED.metadata, 
            embedding = EXCLUDED.embedding;
        `;
        await pool.query(query, [item.title, item.category, item.content, item.metadata, embedding]);
        console.log(`✅ Guardado: ${item.title}`);
      }
    }
    
    console.log('✅ Base de conocimientos y vectores actualizados con éxito.');
  } catch (error) {
    console.error('❌ Error crítico en la siembra:', error);
  } finally {
    pool.end();
  }
}

seedKnowledgeV3();