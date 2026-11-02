// src/models/EventRegistration.js
const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const EventRegistration = sequelize.define('EventRegistration', {
  event_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'events', key: 'id' } },
  user_id: { type: DataTypes.INTEGER, allowNull: false },
  registration_time: { type: DataTypes.DATE, defaultValue: DataTypes.NOW }
}, {
  tableName: 'event_registrations',
  timestamps: false,
  primaryKey: false
});

module.exports = EventRegistration;
