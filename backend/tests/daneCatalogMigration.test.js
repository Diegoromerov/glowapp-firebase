const fs = require('fs');
const path = require('path');

describe('migración DIVIPOLA 167', () => {
  const migration = fs.readFileSync(
    path.join(__dirname, '../migrations/167_municipios_dane.sql'),
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
  });
});
