const { wrapRouterAsync } = require('../utils/expressAsync');
// src/routes/userLevelRoutes.js
const express = require('express');
const router = express.Router();
const { UserLevel } = require('../models');
const { authMiddleware } = require('../middleware/auth');

// Obtener todos los niveles de usuario
router.get('/', authMiddleware, async (req, res) => {
  try {
    const levels = await UserLevel.findAll();
    res.json(levels);
  } catch (err) {
    console.error('Error fetching user levels:', err);
    res.status(500).json({ error: 'Error interno al obtener niveles de usuario' });
  }
});

// Crear nuevo nivel
router.post('/', authMiddleware, async (req, res) => {
  try {
    const newLevel = await UserLevel.create(req.body);
    res.status(201).json(newLevel);
  } catch (err) {
    console.error('Error creating user level:', err);
    res.status(400).json({ error: err.message });
  }
});

// Obtener nivel por ID
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const level = await UserLevel.findByPk(req.params.id);
    if (!level) return res.status(404).json({ error: 'Nivel no encontrado' });
    res.json(level);
  } catch (err) {
    console.error('Error fetching user level:', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

// Actualizar nivel
router.put('/:id', authMiddleware, async (req, res) => {
  try {
    const [updated] = await UserLevel.update(req.body, { where: { id: req.params.id } });
    if (!updated) return res.status(404).json({ error: 'Nivel no encontrado' });
    const updatedLevel = await UserLevel.findByPk(req.params.id);
    res.json(updatedLevel);
  } catch (err) {
    console.error('Error updating user level:', err);
    res.status(400).json({ error: err.message });
  }
});

// Eliminar nivel
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const deleted = await UserLevel.destroy({ where: { id: req.params.id } });
    if (!deleted) return res.status(404).json({ error: 'Nivel no encontrado' });
    res.status(204).send();
  } catch (err) {
    console.error('Error deleting user level:', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

wrapRouterAsync(router);
module.exports = router;
