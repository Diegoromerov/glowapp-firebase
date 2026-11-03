// src/models/UserLevel.js
const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const UserLevel = sequelize.define('UserLevel', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  user_id: { type: DataTypes.INTEGER, allowNull: false },
  level: { type: DataTypes.STRING(20), allowNull: false },
  total_xp: { type: DataTypes.INTEGER, allowNull: false },
  badge_id: { type: DataTypes.INTEGER },
  updated_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW }
}, {
  tableName: 'user_levels',
  timestamps: false
});

module.exports = UserLevel;
