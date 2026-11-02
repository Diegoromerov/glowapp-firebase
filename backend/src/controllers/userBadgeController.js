// src/controllers/userBadgeController.js
const { UserBadge } = require('../models');

module.exports = {
  // List all badges earned by the authenticated user
  async list(req, res) {
    try {
      const badges = await UserBadge.findAll({ where: { user_id: req.user.id } });
      res.json(badges);
    } catch (err) {
      console.error('Error fetching user badges:', err);
      res.status(500).json({ error: 'Error fetching user badges.' });
    }
  },

  // Grant a new badge to the authenticated user
  async create(req, res) {
    try {
      const { badge_id } = req.body;
      if (!badge_id) return res.status(400).json({ error: 'badge_id is required' });
      const newBadge = await UserBadge.create({ user_id: req.user.id, badge_id });
      res.status(201).json(newBadge);
    } catch (err) {
      console.error('Error creating user badge:', err);
      res.status(500).json({ error: 'Error creating user badge.' });
    }
  }
};
