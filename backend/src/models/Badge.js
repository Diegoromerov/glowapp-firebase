// src/models/Badge.js
const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const Badge = sequelize.define('Badge', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  name: { type: DataTypes.STRING(255), allowNull: false },
  description: { type: DataTypes.TEXT },
  image_url: { type: DataTypes.STRING(512) }
}, {
  tableName: 'badges',
  timestamps: false
});

module.exports = Badge;
