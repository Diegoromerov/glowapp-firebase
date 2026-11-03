// src/models/AppLocale.js
const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const AppLocale = sequelize.define('AppLocale', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  locale_code: { type: DataTypes.STRING(10), allowNull: false, unique: true },
  language_name: { type: DataTypes.STRING(100), allowNull: false },
  created_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW }
}, {
  tableName: 'app_locales',
  timestamps: false
});

module.exports = AppLocale;
