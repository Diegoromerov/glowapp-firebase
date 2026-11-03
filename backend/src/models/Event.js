// src/models/Event.js
const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const Event = sequelize.define('Event', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  title: { type: DataTypes.STRING(255), allowNull: false },
  description: { type: DataTypes.TEXT },
  location: { type: DataTypes.STRING(255) },
  start_time: { type: DataTypes.DATE, allowNull: false },
  end_time: { type: DataTypes.DATE },
  created_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW }
}, {
  tableName: 'events',
  timestamps: false
});

module.exports = Event;
