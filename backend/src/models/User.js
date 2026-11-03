const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const User = sequelize.define('User', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  nombre: {
    type: DataTypes.STRING(100),
    allowNull: false
  },
  email: {
    type: DataTypes.STRING(100),
    allowNull: false,
    unique: true
  },
  password_hash: {
    type: DataTypes.STRING(255),
    allowNull: true,
    field: 'password_hash'
  },
  phone: {
    type: DataTypes.STRING(20),
    allowNull: true
  },
  foto_url: {
    type: DataTypes.TEXT,
    allowNull: true,
    field: 'foto_url'
  },
  auth_provider: {
    type: DataTypes.STRING(50),
    allowNull: false,
    defaultValue: 'LOCAL',
    field: 'auth_provider'
  },
  provider_id: {
    type: DataTypes.STRING(255),
    allowNull: true,
    field: 'provider_id'
  },
  rol: {
        type: DataTypes.STRING(20),
        allowNull: true
      },
      worker_type: {
        type: DataTypes.ENUM('EMPLEADO', 'PRESTADOR_SERVICIO', 'ADMIN_SALON', 'OTRO'),
        allowNull: true,
        field: 'worker_type'
      },
      onboarding_completo: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
    field: 'onboarding_completo'
  },
  is_active: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
    field: 'is_active'
  },
  habeas_data_accepted_at: {
    type: DataTypes.DATE,
    allowNull: true,
    field: 'habeas_data_accepted_at'
  },
  habeas_data_ip: {
    type: DataTypes.STRING(45),
    allowNull: true,
    field: 'habeas_data_ip'
  },
  // Responsabilidad de IVA derivada del RUT (migración 087). Declarar estas
  // columnas es OBLIGATORIO: Sequelize descarta en silencio lo que no declara.
  rut_numero: {
    type: DataTypes.STRING(20),
    allowNull: true,
    field: 'rut_numero'
  },
  rut_responsabilidad_codigo: {
    type: DataTypes.SMALLINT,
    allowNull: true,
    field: 'rut_responsabilidad_codigo'
  },
  responsable_iva_override: {
    type: DataTypes.BOOLEAN,
    allowNull: true,
    field: 'responsable_iva_override'
  },
  responsabilidad_iva_fuente: {
    type: DataTypes.STRING(10),
    allowNull: true,
    field: 'responsabilidad_iva_fuente'
  },
  responsabilidad_iva_actualizada_at: {
    type: DataTypes.DATE,
    allowNull: true,
    field: 'responsabilidad_iva_actualizada_at'
  },
  responsabilidad_iva_cambiada_por: {
    type: DataTypes.INTEGER,
    allowNull: true,
    field: 'responsabilidad_iva_cambiada_por'
  }
}, {
  tableName: 'usuarios',
  timestamps: false
});

module.exports = User;
