// backend/tests/serviceSelection.test.js
const { dedupeServiceIds, missingServiceIds } = require('../src/utils/serviceSelection');

describe('dedupeServiceIds', () => {
  test('quita duplicados y conserva el orden de llegada', () => {
    expect(dedupeServiceIds(['b', 'a', 'b', 'a'])).toEqual(['b', 'a']);
  });

  test('descarta vacíos, null y undefined', () => {
    expect(dedupeServiceIds(['', '   ', null, undefined, 'x'])).toEqual(['x']);
  });

  test('no explota con entradas que no son arrays', () => {
    expect(dedupeServiceIds(null)).toEqual([]);
    expect(dedupeServiceIds('abc')).toEqual([]);
  });

  test('normaliza números a texto (ids SERIAL legados)', () => {
    expect(dedupeServiceIds([3, '3'])).toEqual(['3']);
  });
});

describe('missingServiceIds', () => {
  test('devuelve los ids pedidos que no vinieron en la consulta', () => {
    expect(missingServiceIds(['a', 'b'], [{ id: 'a' }])).toEqual(['b']);
  });

  test('sin faltantes devuelve lista vacía', () => {
    expect(missingServiceIds(['a'], [{ id: 'a' }])).toEqual([]);
  });
});
