/**
 * Guard de las políticas RLS (T-112).
 *
 * Una política que llama current_setting('app.tenant_id') sin el segundo
 * argumento no deniega: revienta. Postgres responde
 *
 *   ERROR: unrecognized configuration parameter "app.tenant_id"
 *
 * y lo que debía ser un 403 se convierte en un 500, o —si alguien atrapa la
 * excepción— en «no hay datos» sin rastro. Este test impide que vuelva a
 * entrar una política con esa forma, venga de la migración que venga.
 *
 * Sin base de datos disponible, el test se omite: no es un test de lógica,
 * es una comprobación del esquema vivo.
 */

const { Pool } = require('pg');

const CONN = process.env.DATABASE_URL_ADMIN || process.env.DATABASE_URL || process.env.TEST_DATABASE_URL;
const describir = CONN ? describe : describe.skip;

const PATRON_INSEGURO = /current_setting\('app\.tenant_id'::text\)/;
const PATRON_SEGURO = /current_setting\('app\.tenant_id'::text, true\)/;

describir('RLS — políticas con contexto ausente (T-112)', () => {
  let pool;
  let politicas = [];

  beforeAll(async () => {
    pool = new Pool({ connectionString: CONN, ssl: false });
    const { rows } = await pool.query(`
      SELECT schemaname, tablename, policyname, qual, with_check
        FROM pg_policies
       WHERE schemaname = 'public'
    `);
    politicas = rows;
  });

  afterAll(async () => {
    if (pool) await pool.end();
  });

  test('hay políticas cargadas, así que la consulta no está vacía por error', () => {
    expect(politicas.length).toBeGreaterThan(0);
  });

  test('ninguna política usa current_setting sin missing_ok', () => {
    const culpables = politicas
      .filter((p) => {
        const expr = `${p.qual || ''} ${p.with_check || ''}`;
        return PATRON_INSEGURO.test(expr) && !PATRON_SEGURO.test(expr);
      })
      .map((p) => `${p.tablename}.${p.policyname}`);

    expect(culpables).toEqual([]);
  });

  test('toda política que compara contra el inquilino tolera que falte', () => {
    // El patrón inseguro es exactamente el de las políticas de la 058. Si una
    // nueva se escribe a mano con la forma vieja, este test la señala.
    const conTenant = politicas.filter((p) =>
      `${p.qual || ''} ${p.with_check || ''}`.includes('tenant_id')
    );
    expect(conTenant.length).toBeGreaterThan(0);
    for (const p of conTenant) {
      const expr = `${p.qual || ''} ${p.with_check || ''}`;
      if (expr.includes("current_setting('app.tenant_id'")) {
        expect(`${p.tablename}.${p.policyname}: ${expr}`).toContain(', true');
      }
    }
  });
});
