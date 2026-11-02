// src/models/CommunityComment.js
const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const CommunityComment = sequelize.define('CommunityComment', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  post_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'community_posts', key: 'id' } },
  user_id: { type: DataTypes.INTEGER, allowNull: false },
  content: { type: DataTypes.TEXT },
  created_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW }
}, {
  tableName: 'community_comments',
  timestamps: false
});

module.exports = CommunityComment;
