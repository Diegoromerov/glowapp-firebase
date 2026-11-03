const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const Booking = sequelize.define('Booking', {
  id: {
    type: DataTypes.UUID,
    primaryKey: true,
    defaultValue: DataTypes.UUIDV4
  },
  client_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    field: 'client_id'
  },
  provider_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    field: 'provider_id'
  },
  service_id: {
    type: DataTypes.UUID,
    allowNull: false,
    field: 'service_id'
  },
  business_profile_id: {
    type: DataTypes.STRING(36),
    allowNull: true,
    field: 'business_profile_id'
  },
  scheduled_at: {
    type: DataTypes.DATE,
    allowNull: false,
    field: 'scheduled_at'
  },
  valor_bruto: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false,
    field: 'valor_bruto'
  },
  comision_plataforma: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: true,
    field: 'comision_plataforma'
  },
  impuestos_estado: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: true,
    field: 'impuestos_estado'
  },
  pago_neto_prestador: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: true,
    field: 'pago_neto_prestador'
  },
  tarifa_reserva: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: true,
    field: 'tarifa_reserva'
  },
  // Desglose del IVA (migración 086). Declararlas aquí es OBLIGATORIO: Sequelize
  // sólo persiste los atributos declarados en el modelo, así que sin esto
  // `Booking.create` descartaría estos campos en silencio y el desglose nunca
  // llegaría a la base de datos.
  subtotal_base: {
    type: DataTypes.DECIMAL(12, 2),
    allowNull: true,
    field: 'subtotal_base'
  },
  iva_valor: {
    type: DataTypes.DECIMAL(12, 2),
    allowNull: true,
    field: 'iva_valor'
  },
  tarifa_iva_aplicada: {
    type: DataTypes.DECIMAL(5, 4),
    allowNull: true,
    field: 'tarifa_iva_aplicada'
  },
  service_address: {
    type: DataTypes.TEXT,
    allowNull: true,
    field: 'service_address'
  },
  notes: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  estado: {
    type: DataTypes.STRING(30),
    allowNull: false,
    defaultValue: 'PENDIENTE_PAGO',
    field: 'estado'
  },
  payment_status: {
    type: DataTypes.STRING(20),
    allowNull: true,
    field: 'payment_status'
  },
  pin_verificacion: {
    type: DataTypes.STRING(10),
    allowNull: true,
    field: 'pin_verificacion'
  },
  productos_adicionales: {
    type: DataTypes.JSONB,
    allowNull: true,
    field: 'productos_adicionales'
  },
  // Columnas del ciclo del dinero (migraciones 097 y 098). Faltaban en el
  // modelo: `rescheduleBooking` hacía `booking.reschedule_count = veces + 1` y
  // Sequelize descartaba la propiedad, así que la reprogramación gratuita era
  // infinita y `reschedule_count` se quedaba en 0 en la base.
  reschedule_count: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
    field: 'reschedule_count'
  },
  propina: {
    type: DataTypes.DECIMAL(12, 2),
    allowNull: true,
    field: 'propina'
  },
  cancelado_por: {
    type: DataTypes.STRING,
    allowNull: true,
    field: 'cancelado_por'
  },
  cancelado_at: {
    type: DataTypes.DATE,
    allowNull: true,
    field: 'cancelado_at'
  }
}, {
  tableName: 'bookings',
  timestamps: false
});

module.exports = Booking;
