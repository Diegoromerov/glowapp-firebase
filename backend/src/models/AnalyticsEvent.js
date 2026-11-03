// src/models/AnalyticsEvent.js
const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const AnalyticsEvent = sequelize.define('AnalyticsEvent', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  user_id: { type: DataTypes.INTEGER },
  event_type: { type: DataTypes.STRING(100), allowNull: false },
  metadata: { type: DataTypes.JSONB },
  occurred_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW }
}, {
  tableName: 'analytics_events',
  timestamps: false
});

module.exports = AnalyticsEvent;
