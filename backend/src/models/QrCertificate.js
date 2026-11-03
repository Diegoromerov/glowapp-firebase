// src/models/QrCertificate.js
const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const QrCertificate = sequelize.define('QrCertificate', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  user_id: { type: DataTypes.INTEGER, allowNull: false },
  certificate_id: { type: DataTypes.INTEGER, allowNull: false },
  qr_code_data: { type: DataTypes.STRING(1024) },
  created_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW }
}, {
  tableName: 'qr_certificates',
  timestamps: false
});

module.exports = QrCertificate;
