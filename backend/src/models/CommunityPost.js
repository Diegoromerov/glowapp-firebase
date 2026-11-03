// src/models/CommunityPost.js
const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const CommunityPost = sequelize.define('CommunityPost', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  user_id: { type: DataTypes.INTEGER, allowNull: false },
  title: { type: DataTypes.STRING(255), allowNull: false },
  content: { type: DataTypes.TEXT },
  created_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW }
}, {
  tableName: 'community_posts',
  timestamps: false
});

module.exports = CommunityPost;
