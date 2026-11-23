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
  sub_rol: {
    type: DataTypes.STRING(50),
    allowNull: true,
    field: 'sub_rol'
  },
  status: {
    type: DataTypes.STRING(20),
    allowNull: false,
    defaultValue: 'ACTIVE',
    field: 'status',
    validate: { isIn: [['PENDING', 'INVITED', 'ACTIVE', 'SUSPENDED', 'REVOKED', 'REMOVED', 'EXPIRED']] }
  },
  invite_email: {
    type: DataTypes.STRING(254),
    allowNull: true,
    field: 'invite_email'
  },
  invite_token_hash: {
    type: DataTypes.STRING(64),
    allowNull: true,
    field: 'invite_token_hash'
  },
  invite_expires_at: {
    type: DataTypes.DATE,
    allowNull: true,
    field: 'invite_expires_at'
  },
  removed_at: {
    type: DataTypes.DATE,
    allowNull: true,
    field: 'removed_at'
  },
  removed_by: {
    type: DataTypes.INTEGER,
    allowNull: true,
    field: 'removed_by'
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
