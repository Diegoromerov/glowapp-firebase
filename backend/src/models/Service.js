const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const Service = sequelize.define('Service', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  provider_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    field: 'provider_id'
  },
  business_profile_id: {
    type: DataTypes.STRING(36),
    allowNull: true,
    field: 'business_profile_id'
  },
  name: {
    type: DataTypes.STRING(100),
    allowNull: false
  },
  description: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  price: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false
  },
  duration_minutes: {
    type: DataTypes.INTEGER,
    allowNull: false,
    field: 'duration_minutes'
  },
  category: {
    type: DataTypes.STRING(50),
    allowNull: true
  },
  is_active: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
    field: 'is_active'
  }
}, {
  tableName: 'services',
  timestamps: false // La tabla existente no tiene timestamps definidos por Sequelize por defecto
});

module.exports = Service;
