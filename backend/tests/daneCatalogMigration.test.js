const fs = require('fs');
const path = require('path');

describe('migración incremental DIVIPOLA 178', () => {
  const migration = fs.readFileSync(
    path.join(__dirname, '../migrations/178_refresh_municipios_dane_catalog.sql'),
    'utf8'
  );

  test('incluye 1.122 códigos DANE de cinco dígitos, todos únicos y sin el fallback ficticio', () => {
    const block = migration.match(/INSERT INTO municipios_dane[\s\S]*?\bVALUES\s+([\s\S]*?)\s+ON CONFLICT/i)?.[1];
    expect(block).toBeTruthy();
    const codes = [...block.matchAll(/^\s*\('([0-9]{5})',/gm)].map((match) => match[1]);

    expect(codes).toHaveLength(1122);
    expect(new Set(codes).size).toBe(1122);
    expect(codes).not.toContain('99999');
    expect(migration).toMatch(/tipo_municipio/);
    expect(migration).toMatch(/departamento_nombre TYPE VARCHAR\(80\)/);
    expect(migration).toMatch(/BEGIN;[\s\S]*COMMIT;/);
    expect(migration).toMatch(/ON CONFLICT \(dane_code\) DO UPDATE SET/);
    expect(migration).toMatch(/zona_envio_id IS NULL/);
    expect(migration).toMatch(/z\.codigo_postal_prefijo IS NULL/);
    expect(migration).not.toMatch(/zona_envio_id = EXCLUDED\.zona_envio_id/);
  });

  test('preserva la migración histórica 167 para evitar deriva de checksum en producción', () => {
    const historical = fs.readFileSync(
      path.join(__dirname, '../migrations/167_municipios_dane.sql'),
      'utf8'
    );
    expect(historical).toContain("('99999', 'OTRO - Fallback Nacional'");
    expect(historical).not.toContain('Seed completo DIVIPOLA suministrado por DANE');
  });
});
