const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const BusinessProfile = sequelize.define('BusinessProfile', {
  id: {
    type: DataTypes.STRING(36),
    primaryKey: true,
    defaultValue: DataTypes.UUIDV4
  },
  provider_id: {
    type: DataTypes.STRING(36),
    allowNull: true
  },
  vertical_id: {
    type: DataTypes.STRING(36),
    allowNull: true
  },
  name: {
    type: DataTypes.STRING(150),
    allowNull: false
  },
  onboarding_mode: {
    type: DataTypes.STRING(30),
    defaultValue: 'NEW_BUSINESS'
  },
  lifecycle_stage: {
    type: DataTypes.STRING(30),
    defaultValue: 'IDEA'
  },
  compliance_score: {
    type: DataTypes.DECIMAL(5, 2),
    defaultValue: 0.00
  },
  city: {
    type: DataTypes.STRING(100),
    defaultValue: 'Bogotá'
  },
  country: {
    type: DataTypes.STRING(100),
    defaultValue: 'Colombia'
  },
  user_id: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  metadata: {
    type: DataTypes.JSONB,
    defaultValue: {}
  }
}, {
  tableName: 'business_profiles',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at'
});

module.exports = BusinessProfile;
