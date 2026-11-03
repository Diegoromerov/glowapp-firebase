// src/models/MentorshipSession.js
const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const MentorshipSession = sequelize.define('MentorshipSession', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  mentor_id: { type: DataTypes.INTEGER, allowNull: false },
  mentee_id: { type: DataTypes.INTEGER, allowNull: false },
  scheduled_at: { type: DataTypes.DATE, allowNull: false },
  status: { type: DataTypes.ENUM('scheduled', 'completed', 'canceled'), defaultValue: 'scheduled' },
  notes: { type: DataTypes.TEXT }
}, {
  tableName: 'mentorship_sessions',
  timestamps: false
});

module.exports = MentorshipSession;
