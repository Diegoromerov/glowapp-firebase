// backend/src/services/biometric/prompts.js
const HANDS_ANALYSIS_PROMPT = `
Eres un experto en cuidado de manos. Analiza esta imagen de manos y devuelve ÚNICAMENTE un objeto JSON con esta estructura:

{
  "manchas_solares": "leve" | "moderado" | "severo",
  "sequedad": "leve" | "moderada" | "severa",
  "cuticulas": "sanas" | "dañadas" | "inflamadas",
  "uñas": "sanas" | "estriadas" | "quebradizas",
  "edad_aparente": 30
}

No incluyas texto adicional, solo el JSON.
`;

const RECOMMENDATION_PROMPT = `
Tienes los siguientes datos biométricos de una usuaria de GlowApp:

**Datos del rostro (YouCam):**
- Hidratación: {hydration}%
- Arrugas: {wrinkles}%
- Manchas: {spots}%
- Poros: {pores}%
- Subtono: {subtono}
- Edad biológica: {bioAge} años

**Datos de manos (Gemini Vision):**
- Manchas solares: {handSpots}
- Sequedad: {handDryness}
- Cutículas: {cuticles}
- Uñas: {nails}

Genera una respuesta en español con:
1. Un diagnóstico amable y claro (máximo 3 párrafos).
2. Una rutina AM de 3 pasos para el rostro.
3. Una rutina PM de 2 pasos para el rostro.
4. Una rutina de 2 pasos para las manos.
5. Lista de 3 ingredientes activos clave recomendados (ej. "ácido hialurónico", "retinol").
6. Una frase final motivadora.

Formato: Usa Markdown simple (negritas, viñetas).
No incluyas información médica ni diagnósticos clínicos.
`;

module.exports = { HANDS_ANALYSIS_PROMPT, RECOMMENDATION_PROMPT };
