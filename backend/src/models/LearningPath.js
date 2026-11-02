// src/models/LearningPath.js
const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const LearningPath = sequelize.define('LearningPath', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  name: { type: DataTypes.STRING(255), allowNull: false },
  description: { type: DataTypes.TEXT },
  level: { type: DataTypes.ENUM('beginner', 'intermediate', 'advanced') },
  estimated_hours: { type: DataTypes.INTEGER },
  badge_id: { type: DataTypes.INTEGER, references: { model: 'academy_certificates', key: 'id' } },
  created_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW }
}, {
  tableName: 'learning_paths',
  timestamps: false
});

module.exports = LearningPath;
