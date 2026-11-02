// backend/tests/booking.test.js
const request = require('supertest');
const express = require('express');
const bodyParser = require('body-parser');

const app = express();
app.use(bodyParser.json());

// Mock de DB de reservas
const bookingsDb = new Map();

app.post('/api/bookings', (req, res) => {
  const { provider_id, service_id, scheduled_at, service_address } = req.body;
  if (!provider_id || !service_id || !scheduled_at || !service_address) {
    return res.status(400).json({ error: 'Faltan campos obligatorios para la reserva' });
  }

  const bookingId = 'bk_' + Date.now();
  const newBooking = {
    id: bookingId,
    provider_id,
    service_id,
    scheduled_at,
    service_address,
    status: 'PENDIENTE',
  };
  bookingsDb.set(bookingId, newBooking);

  res.status(201).json({ success: true, booking: newBooking });
});

app.patch('/api/bookings/:id/cancel', (req, res) => {
  const { id } = req.params;
  const booking = bookingsDb.get(id);
  if (!booking) {
    return res.status(404).json({ error: 'Reserva no encontrada' });
  }

  booking.status = 'CANCELADO';
  bookingsDb.set(id, booking);

  res.json({ success: true, message: 'Reserva cancelada exitosamente', booking });
});

describe('Booking System Integration Tests', () => {
  let createdBookingId = '';

  test('POST /api/bookings - debe crear una nueva reserva de servicio', async () => {
    const res = await request(app)
      .post('/api/bookings')
      .send({
        provider_id: 'prov_1001',
        service_id: 'serv_55',
        scheduled_at: '2026-08-10 14:00:00',
        service_address: 'Calle 100 #15-30, Bogotá',
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.booking.id).toBeDefined();
    expect(res.body.booking.status).toBe('PENDIENTE');

    createdBookingId = res.body.booking.id;
  });

  test('PATCH /api/bookings/:id/cancel - debe cancelar una reserva existente', async () => {
    const res = await request(app)
      .patch(`/api/bookings/${createdBookingId}/cancel`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.booking.status).toBe('CANCELADO');
  });

  test('POST /api/bookings - debe validar campos requeridos', async () => {
    const res = await request(app)
      .post('/api/bookings')
      .send({
        provider_id: 'prov_1001',
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });
});
