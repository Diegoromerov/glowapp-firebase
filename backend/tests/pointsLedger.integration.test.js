// backend/tests/pointsLedger.integration.test.js
//
// Comportamiento real del libro de puntos contra Postgres: FEFO, concurrencia y
// vencimiento no se pueden probar con la base mockeada. Como no hay staging, este
// test corre contra una base levantada desde la cadena de migraciones
// (`bash backend/scripts/verificar-cadena-migraciones.sh`, que deja el contenedor
// `glowapp-verify` en el puerto 55434) o contra cualquier base con la 142 aplicada.
//
// Sin DATABASE_URL_ADMIN el suite se omite: no es un test de lógica, es una
// comprobación del esquema y de los bloqueos vivos.
const { Pool } = require('pg');
const pointsService = require('../src/services/pointsService');

const CONN =
  process.env.DATABASE_URL_ADMIN || process.env.DATABASE_URL || process.env.TEST_DATABASE_URL;
const describir = CONN ? describe : describe.skip;

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

describir('libro de puntos sobre Postgres real', () => {
  let pool;
  let userId;
  let pedidos = [];

  beforeAll(async () => {
    pool = new Pool({ connectionString: CONN });
    const tabla = await pool.query("SELECT to_regclass('public.points_lots') AS t");
    if (!tabla.rows[0].t) {
      throw new Error('La migración 142 no está aplicada en esta base: corre la cadena primero');
    }

    const email = `puntos-${Date.now()}@test.local`;
    const u = await pool.query(
      `INSERT INTO usuarios (email, password_hash, nombre, auth_provider, provider_id)
       VALUES ($1, 'x', 'Prueba Libro de Puntos', 'LOCAL', $1) RETURNING id`,
      [email]
    );
    userId = u.rows[0].id;

    for (let i = 0; i < 3; i += 1) {
      const o = await pool.query(
        `INSERT INTO pedidos_tienda
           (comprador_id, rol_comprador, subtotal, iva, total, nombre_entrega,
            direccion_entrega, tenant_id)
         VALUES ($1, 'CLIENTE', 0, 0, 0, 'Prueba', 'Prueba', app_platform_tenant_id())
         RETURNING id`,
        [userId]
      );
      pedidos.push(o.rows[0].id);
    }
  });

  afterAll(async () => {
    if (!pool) return;
    await pool.query('DELETE FROM points_movements WHERE user_id = $1', [userId]);
    await pool.query('DELETE FROM points_lots WHERE user_id = $1', [userId]);
    await pool.query('DELETE FROM pedidos_tienda WHERE comprador_id = $1', [userId]);
    await pool.query('DELETE FROM usuarios WHERE id = $1', [userId]);
    await pool.end();
  });

  beforeEach(async () => {
    await pool.query('DELETE FROM points_movements WHERE user_id = $1', [userId]);
    await pool.query('DELETE FROM points_lots WHERE user_id = $1', [userId]);
  });

  test('un pedido acredita una sola vez aunque se repita el webhook', async () => {
    const primero = await pointsService.acreditar({
      userId,
      puntos: 500,
      origen: 'referido:compra',
      referenciaId: pedidos[0],
      cliente: pool,
    });
    const segundo = await pointsService.acreditar({
      userId,
      puntos: 500,
      origen: 'referido:compra',
      referenciaId: pedidos[0],
      cliente: pool,
    });

    expect(primero.acreditado).toBe(true);
    expect(segundo.acreditado).toBe(false);

    const s = await pointsService.saldo({ userId, cliente: pool });
    expect(s.saldo).toBe(500);
  });

  test('el lote nace con vencimiento a 12 meses', async () => {
    await pointsService.acreditar({
      userId,
      puntos: 500,
      origen: 'referido:compra',
      referenciaId: pedidos[0],
      cliente: pool,
    });

    const r = await pool.query(
      `SELECT date_trunc('second', vence_en) = date_trunc('second', creado_en + INTERVAL '12 months') AS ok
         FROM points_lots WHERE user_id = $1`,
      [userId]
    );
    expect(r.rows[0].ok).toBe(true);
  });

  test('lo vencido no cuenta para el saldo', async () => {
    await pointsService.acreditar({
      userId,
      puntos: 500,
      origen: 'referido:compra',
      referenciaId: pedidos[0],
      cliente: pool,
    });
    // Se envejece el lote 13 meses: el saldo tiene que ignorarlo.
    await pool.query(
      `UPDATE points_lots
          SET creado_en = NOW() - INTERVAL '13 months',
              vence_en = NOW() - INTERVAL '1 month'
        WHERE user_id = $1`,
      [userId]
    );

    const s = await pointsService.saldo({ userId, cliente: pool });
    expect(s.saldo).toBe(0);
  });

  test('comprometer consume primero el lote que vence antes (FEFO)', async () => {
    const corto = await pointsService.acreditar({
      userId,
      puntos: 300,
      origen: 'referido:compra',
      referenciaId: pedidos[0],
      cliente: pool,
    });
    const largo = await pointsService.acreditar({
      userId,
      puntos: 500,
      origen: 'referido:compra',
      referenciaId: pedidos[1],
      cliente: pool,
    });
    // El lote de 300 vence antes que el de 500.
    await pool.query(
      `UPDATE points_lots SET vence_en = NOW() + INTERVAL '2 months' WHERE id = $1`,
      [corto.lotId]
    );
    await pool.query(
      `UPDATE points_lots SET vence_en = NOW() + INTERVAL '10 months' WHERE id = $1`,
      [largo.lotId]
    );

    const cliente = await pool.connect();
    try {
      await cliente.query('BEGIN');
      const r = await pointsService.comprometer({
        userId,
        pedidoId: pedidos[2],
        puntos: 500,
        cliente,
      });
      await cliente.query('COMMIT');

      expect(r.aplicado).toBe(500);
      expect(r.desglose).toEqual([
        { lotId: corto.lotId, puntos: 300 },
        { lotId: largo.lotId, puntos: 200 },
      ]);
    } finally {
      cliente.release();
    }

    const s = await pointsService.saldo({ userId, cliente: pool });
    expect(s.saldo).toBe(300);
    expect(s.enEspera).toBe(500);
  });

  test('dos canjes simultáneos no gastan dos veces el mismo punto', async () => {
    const lote = await pointsService.acreditar({
      userId,
      puntos: 500,
      origen: 'referido:compra',
      referenciaId: pedidos[0],
      cliente: pool,
    });
    // Si esto falla, el problema es del setup (lote ya existente), no del bloqueo.
    expect(lote.acreditado).toBe(true);

    const a = await pool.connect();
    const b = await pool.connect();
    try {
      await a.query('BEGIN');
      // Se resuelve el resultado, no el turno: el invariante es que UNO gane y el
      // otro reciba SALDO_INSUFICIENTE, sin importar cuál llegue primero al
      // bloqueo. Atarlo al orden hacía el test frágil por tiempos.
      const pa = pointsService
        .comprometer({ userId, pedidoId: pedidos[1], puntos: 400, cliente: a })
        .then((r) => ({ ok: true, r }), (e) => ({ ok: false, e }));
      await esperar(150); // deja que A intente tomar el bloqueo antes que B

      await b.query('BEGIN');
      const pb = pointsService
        .comprometer({ userId, pedidoId: pedidos[2], puntos: 400, cliente: b })
        .then((r) => ({ ok: true, r }), (e) => ({ ok: false, e }));

      const ra = await pa;
      await a.query(ra.ok ? 'COMMIT' : 'ROLLBACK');

      const rb = await pb;
      await b.query(rb.ok ? 'COMMIT' : 'ROLLBACK');

      expect([ra.ok, rb.ok].filter(Boolean)).toHaveLength(1);
      const perdedor = ra.ok ? rb : ra;
      expect(perdedor.e).toMatchObject({ code: 'SALDO_INSUFICIENTE' });
    } finally {
      a.release();
      b.release();
    }

    const r = await pool.query(
      `SELECT COALESCE(SUM(puntos_restantes), 0)::int AS restantes
         FROM points_lots WHERE user_id = $1`,
      [userId]
    );
    expect(r.rows[0].restantes).toBe(100);
    expect(r.rows[0].restantes).toBeGreaterThanOrEqual(0);
  });

  test('un pedido que no se paga devuelve los puntos', async () => {
    await pointsService.acreditar({
      userId,
      puntos: 500,
      origen: 'referido:compra',
      referenciaId: pedidos[0],
      cliente: pool,
    });

    const cliente = await pool.connect();
    try {
      await cliente.query('BEGIN');
      await pointsService.comprometer({ userId, pedidoId: pedidos[1], puntos: 500, cliente });
      await cliente.query('COMMIT');

      const liberado = await pointsService.liberar({ pedidoId: pedidos[1], cliente: pool });
      expect(liberado.liberados).toBe(500);
    } finally {
      cliente.release();
    }

    const s = await pointsService.saldo({ userId, cliente: pool });
    expect(s.saldo).toBe(500);
    expect(s.enEspera).toBe(0);
  });

  test('revertir un premio no devuelve más de lo que queda', async () => {
    await pointsService.acreditar({
      userId,
      puntos: 500,
      origen: 'referido:compra',
      referenciaId: pedidos[0],
      cliente: pool,
    });

    const cliente = await pool.connect();
    try {
      await cliente.query('BEGIN');
      await pointsService.comprometer({ userId, pedidoId: pedidos[1], puntos: 400, cliente });
      await cliente.query('COMMIT');
    } finally {
      cliente.release();
    }

    const r = await pointsService.revertir({
      origen: 'referido:compra',
      referenciaId: pedidos[0],
      puntos: 500,
      cliente: pool,
    });

    expect(r).toEqual({ revertido: 100, noCubierto: 400 });
    const s = await pointsService.saldo({ userId, cliente: pool });
    expect(s.saldo).toBe(0);
  });
});
