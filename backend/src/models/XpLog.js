// src/models/XpLog.js
const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const XpLog = sequelize.define('XpLog', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  user_id: { type: DataTypes.INTEGER, allowNull: false },
  xp_amount: { type: DataTypes.INTEGER, allowNull: false },
  reason: { type: DataTypes.STRING(255) },
  metadata: { type: DataTypes.JSONB },
  created_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW }
}, {
  tableName: 'xp_logs',
  timestamps: false
});

module.exports = XpLog;
