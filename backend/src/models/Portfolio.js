// src/models/Portfolio.js
const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const Portfolio = sequelize.define('Portfolio', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  user_id: { type: DataTypes.INTEGER, allowNull: false },
  title: { type: DataTypes.STRING(255), allowNull: false },
  description: { type: DataTypes.TEXT },
  image_url: { type: DataTypes.STRING(512) },
  created_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW }
}, {
  tableName: 'portfolios',
  timestamps: false
});

module.exports = Portfolio;
