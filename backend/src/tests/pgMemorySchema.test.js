process.env.USE_PG_MEM = 'true';
const pgMemory = require('../config/pgMemory');
const { pool } = require('../config/db');

// VALORES UUID REALES: `transactions.id` y `transactions.booking_id` son UUID en el modelo
// Sequelize (src/models/Transaction.js) y en el harness (src/config/pgMemory.js). Insertar
// una cadena arbitraria ('tx-test-123') funciona con Postgres solo si la columna fuese TEXT;
// pg-mem la rechaza con "cannot cast type text to uuid", que es el comportamiento correcto.
//
// El harness SÍ declara la FK `transactions.booking_id → bookings(id)`, así que la reserva
// referenciada debe existir: una transacción sin su reserva no es un estado alcanzable.
const TX_ID = '11111111-1111-4111-8111-111111111111';
const BOOKING_ID = '22222222-2222-4222-8222-222222222222';

describe('pgMemory schema verification', () => {
  test('debe permitir INSERT y SELECT en la tabla transactions en modo memoria', async () => {
    expect(pgMemory.enabled).toBe(true);

    await pool.query(
      `INSERT INTO bookings (id, client_id, provider_id, valor_bruto, estado)
       VALUES ($1, 1, 2, 50000.00, 'COMPLETADA')`,
      [BOOKING_ID]
    );

    await pool.query(
      `INSERT INTO transactions (id, booking_id, client_id, provider_id, amount, status)
       VALUES ($1, $2, 1, 2, 50000.00, 'APPROVED')`,
      [TX_ID, BOOKING_ID]
    );

    const resSelect = await pool.query(`SELECT * FROM transactions WHERE id = $1`, [TX_ID]);
    expect(resSelect.rows).toHaveLength(1);
    expect(resSelect.rows[0].id).toBe(TX_ID);
    expect(resSelect.rows[0].status).toBe('APPROVED');
    expect(parseFloat(resSelect.rows[0].amount)).toBe(50000);
  });
});
