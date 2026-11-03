const geminiService = require('../services/geminiService');
const rateLimiter = require('../middleware/rateLimiter');

exports.analyzeSkin = [
  rateLimiter,
  async (req, res) => {
    try {
      const { image } = req.body; // Base64 o URL
      const result = await geminiService.analyzeImage(image, 'skin');
      res.json({ success: true, analysis: result });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
];
