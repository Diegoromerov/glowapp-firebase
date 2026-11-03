const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const Membership = sequelize.define('Membership', {
  id: {
    type: DataTypes.STRING(36),
    primaryKey: true,
    defaultValue: DataTypes.UUIDV4
  },
  user_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    field: 'user_id'
  },
  business_profile_id: {
    type: DataTypes.STRING(36),
    allowNull: false,
    field: 'business_profile_id'
  },
  role: {
    type: DataTypes.ENUM('OWNER', 'ADMIN', 'MANAGER', 'MEMBER', 'VIEWER'),
    allowNull: false,
    defaultValue: 'MEMBER',
    field: 'role'
  },
  status: {
    type: DataTypes.ENUM('INVITED', 'ACTIVE', 'SUSPENDED', 'REVOKED'),
    allowNull: false,
    defaultValue: 'ACTIVE',
    field: 'status'
  },
  invited_at: {
    type: DataTypes.DATE,
    allowNull: true,
    field: 'invited_at'
  },
  accepted_at: {
    type: DataTypes.DATE,
    allowNull: true,
    field: 'accepted_at'
  },
  created_by_user_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    field: 'created_by_user_id'
  }
}, {
  tableName: 'memberships',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  indexes: [
    {
      unique: true,
      fields: ['user_id', 'business_profile_id']
    }
  ]
});

module.exports = Membership;
