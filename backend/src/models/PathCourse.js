// src/models/PathCourse.js
const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const PathCourse = sequelize.define('PathCourse', {
  path_id: { type: DataTypes.INTEGER, references: { model: 'learning_paths', key: 'id' } },
  course_id: { type: DataTypes.INTEGER, references: { model: 'academy_courses', key: 'id' } },
  position: { type: DataTypes.INTEGER, allowNull: false },
  prerequisite_course_id: { type: DataTypes.INTEGER, references: { model: 'academy_courses', key: 'id' } }
}, {
  tableName: 'path_courses',
  timestamps: false,
  primaryKey: false
});

module.exports = PathCourse;
