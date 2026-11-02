const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

const apiKey = process.env.GEMINI_API_KEY;
console.log('Gemini API Key:', apiKey ? 'FOUND (starts with ' + apiKey.substring(0, 8) + ')' : 'MISSING');

if (!apiKey) {
  console.error('No API key found in env.');
  process.exit(1);
}

const ai = new GoogleGenerativeAI(apiKey);

async function test() {
  try {
    // Usar una imagen mock (1x1 transparente) en Base64
    const base64Data = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
    const mimeType = 'image/png';
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
    console.log('Llamando a Gemini...');
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
    console.log('Respuesta cruda de Gemini:\n', text);

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

    console.log('Texto JSON procesado:', text);
    const parsed = JSON.parse(text);
    console.log('JSON parseado con éxito:', parsed);
  } catch (error) {
    console.error('Error durante el test:', error);
  }
}

test();
