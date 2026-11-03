// src/models/UserBadge.js
const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const UserBadge = sequelize.define('UserBadge', {
  user_id: { type: DataTypes.INTEGER, allowNull: false, primaryKey: true },
  badge_id: { type: DataTypes.INTEGER, allowNull: false, primaryKey: true, references: { model: 'badges', key: 'id' } },
  earned_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW }
}, {
  tableName: 'user_badges',
  timestamps: false
});

module.exports = UserBadge;
