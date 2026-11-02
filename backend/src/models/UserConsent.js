// src/models/UserConsent.js
const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const UserConsent = sequelize.define('UserConsent', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  user_id: { type: DataTypes.INTEGER, allowNull: false },
  consent_type: { type: DataTypes.STRING(100), allowNull: false },
  granted_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  revoked_at: { type: DataTypes.DATE, allowNull: true }
}, {
  tableName: 'user_consents',
  timestamps: false
});

module.exports = UserConsent;
