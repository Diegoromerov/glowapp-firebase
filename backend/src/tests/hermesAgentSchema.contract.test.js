// backend/src/tests/hermesAgentSchema.contract.test.js
//
// Contrato de esquema de la tool de Aura `search_nearby_services`.
//
// Regresion corregida: findNearbyServices leia `s.tag_especialidad`, columna que
// pertenece a `productos`, no a `services`. En produccion la tool fallaba SIEMPRE
// con «column s.tag_especialidad does not exist» y, como el error se devolvia como
// {status:'error'} sin propagar, Aura respondia sin catalogo geografico y ningun
// test lo detectaba porque el pool estaba mockeado sin mirar el SQL.
//
// Este test no necesita base de datos: captura el SQL que se envia al pool y
// fija que las columnas existan en `services` (migracion 054).

const mockQuery = jest.fn();

jest.mock('../config/db', () => ({ pool: { query: (...args) => mockQuery(...args) } }));

const hermesAgent = require('../services/agents/hermesAgent');

describe('hermesAgent.findNearbyServices (contrato de esquema)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockQuery.mockResolvedValue({ rows: [] });
  });

  const sqlEnviado = () => mockQuery.mock.calls[0][0];

  test('lee services.category y nunca services.tag_especialidad', async () => {
    await hermesAgent.findNearbyServices({
      latitude: 4.6735,
      longitude: -74.1422,
      category: 'Uñas',
      maxDistanceKm: 5,
    });

    const sql = sqlEnviado();
    expect(sql).not.toMatch(/s\.tag_especialidad/);
    expect(sql).toMatch(/s\.category/);
    // columnas que services SI tiene (054_create_core_tables.sql)
    for (const columna of ['s.name', 's.price', 's.duration_minutes', 's.is_active']) {
      expect(sql).toContain(columna);
    }
  });

  test('sin categoria no filtra por columna inexistente', async () => {
    await hermesAgent.findNearbyServices({ latitude: 4.6735, longitude: -74.1422 });

    const sql = sqlEnviado();
    expect(sql).not.toMatch(/tag_especialidad/);
    expect(mockQuery.mock.calls[0][1]).toHaveLength(3);
  });

  test('con categoria pasa el patron como cuarto parametro', async () => {
    await hermesAgent.findNearbyServices({
      latitude: 4.6735,
      longitude: -74.1422,
      category: 'Cabello',
    });

    const parametros = mockQuery.mock.calls[0][1];
    expect(parametros).toHaveLength(4);
    expect(parametros[3]).toBe('%cabello%');
  });

  test('devuelve success y foundCount cuando la base responde', async () => {
    mockQuery.mockResolvedValue({
      rows: [{ service_id: 1, name: 'Balayage', category: 'Cabello', provider_id: 3 }],
    });

    const resultado = await hermesAgent.findNearbyServices({
      latitude: 4.6735,
      longitude: -74.1422,
      category: 'Cabello',
    });

    expect(resultado.status).toBe('success');
    expect(resultado.foundCount).toBe(1);
    expect(resultado.services[0].category).toBe('Cabello');
  });

  test('un fallo real de base sigue reportandose como error, no como catalogo vacio', async () => {
    mockQuery.mockRejectedValue(new Error('column s.category does not exist'));

    const resultado = await hermesAgent.findNearbyServices({
      latitude: 4.6735,
      longitude: -74.1422,
      category: 'Cabello',
    });

    expect(resultado.status).toBe('error');
    expect(resultado.message).toContain('does not exist');
  });
});
