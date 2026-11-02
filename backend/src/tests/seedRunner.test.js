const bcrypt = require('bcryptjs');
const { executeSeed } = require('../utils/seedRunner');

describe('seedRunner — Fail-closed seeding without hardcoded passwords', () => {
  test('Sin SEED_PASSWORD: la siembra falla cerrado (excepción explícita sin insertar filas ni contraseñas por defecto)', async () => {
    const mockPool = { query: jest.fn() };
    const envWithoutPassword = { NODE_ENV: 'development', SEED_DATABASE: 'true' };

    await expect(
      executeSeed({ pool: mockPool, env: envWithoutPassword })
    ).rejects.toThrow('SEED_PASSWORD variable de entorno es requerida');

    expect(mockPool.query).not.toHaveBeenCalled();
  });

  test('Con SEED_PASSWORD dada: genera hashes válidos y ninguna cuenta autentica con password123', async () => {
    let executedSql = '';
    const mockPool = {
      query: jest.fn().mockImplementation(async (sql) => {
        executedSql = sql;
        return { rows: [] };
      })
    };

    const envWithPassword = { NODE_ENV: 'development', SEED_DATABASE: 'true', SEED_PASSWORD: 'MyCustomDevPass123!' };

    const result = await executeSeed({ pool: mockPool, env: envWithPassword });

    expect(result.seeded).toBe(true);
    expect(mockPool.query).toHaveBeenCalledTimes(1);

    // Extraer un hash generado en executedSql
    const match = executedSql.match(/\$2[aby]\$\d{2}\$[A-Za-z0-9./]{53}/);
    expect(match).not.toBeNull();
    const generatedHash = match[0];

    // Asertar que NINGUNA cuenta autentica con 'password123'
    expect(bcrypt.compareSync('password123', generatedHash)).toBe(false);

    // Asertar que autentica correctamente con la clave proporcionada
    expect(bcrypt.compareSync('MyCustomDevPass123!', generatedHash)).toBe(true);
  });
});
