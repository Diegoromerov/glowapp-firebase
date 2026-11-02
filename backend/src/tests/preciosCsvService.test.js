const { parsearPreciosCsv } = require('../services/preciosCsvService');

describe('preciosCsvService - parsearPreciosCsv (Función Pura)', () => {

  test('parsea correctamente un CSV válido con varias listas y decimales', () => {
    const csvContent = `producto_id,sku,nombre,costo,stock,precio_cliente,precio_profesional,precio_negocio,unidad_minima_negocio
1042,SH-ARG-01,Shampoo de Argán Orgánico,22000,40,45000,40500,36000,6
1043,AC-COC-02,"Acondicionador, Especial",19000,25,38000,34200,,`;

    const res = parsearPreciosCsv(csvContent);

    expect(res.errores).toHaveLength(0);
    expect(res.total_leidas).toBe(2);
    expect(res.filas).toHaveLength(2);

    expect(res.filas[0]).toEqual({
      fila: 2,
      producto_id: 1042,
      sku: 'SH-ARG-01',
      nombre: 'Shampoo de Argán Orgánico',
      costo: 22000,
      stock: 40,
      precios: {
        cliente: 45000,
        profesional: 40500,
        negocio: 36000
      },
      unidad_minima_negocio: 6
    });

    // Celda vacía en precio_negocio resulta en null ("no tocar")
    expect(res.filas[1].precios.negocio).toBeNull();
  });

  test('elimina BOM de Excel (\\ufeff) y normaliza saltos CRLF (\\r\\n)', () => {
    const csvContent = "\ufeffproducto_id,sku,nombre,precio_cliente\r\n101,SKU-1,Producto BOM,15000.50\r\n";
    const res = parsearPreciosCsv(csvContent);

    expect(res.errores).toHaveLength(0);
    expect(res.filas).toHaveLength(1);
    expect(res.filas[0].producto_id).toBe(101);
    expect(res.filas[0].precios.cliente).toBe(15000.50);
  });

  test('interpreta coma como decimal cuando no hay punto (ej. 45000,00)', () => {
    const csvContent = `producto_id,precio_cliente
101,45000,00`;

    const res = parsearPreciosCsv(csvContent);
    expect(res.errores).toHaveLength(0);
    expect(res.filas[0].precios.cliente).toBe(45000);
  });

  test('registra error de fila cuando el precio contiene símbolo $, espacios o separadores de miles', () => {
    const csvContent = `producto_id,precio_cliente,precio_profesional
101,$45000,45 000
102,"1.234,56",40000`;

    const res = parsearPreciosCsv(csvContent);
    expect(res.filas).toHaveLength(0);
    expect(res.errores).toHaveLength(3);
    expect(res.errores[0].motivo).toMatch(/símbolo \$/);
    expect(res.errores[1].motivo).toMatch(/espacios/);
    expect(res.errores[2].motivo).toMatch(/separadores de miles/);
  });

  test('registra error de fila si el precio es 0 o negativo', () => {
    const csvContent = `producto_id,precio_cliente,precio_profesional
101,0,-500`;

    const res = parsearPreciosCsv(csvContent);
    expect(res.filas).toHaveLength(0);
    expect(res.errores).toHaveLength(2);
    expect(res.errores[0].motivo).toMatch(/estrictamente mayor a 0/);
    expect(res.errores[1].motivo).toMatch(/estrictamente mayor a 0/);
  });

  test('rechaza archivos que superan el límite máximo de 5000 filas', () => {
    const header = 'producto_id,precio_cliente\n';
    const row = '101,10000\n';
    const bigCsv = header + row.repeat(5001);

    const res = parsearPreciosCsv(bigCsv);
    expect(res.filas).toHaveLength(0);
    expect(res.errores).toHaveLength(1);
    expect(res.errores[0].motivo).toMatch(/5000 filas/);
  });

  test('rechaza encabezado inválido si no contiene producto_id ni sku', () => {
    const csvContent = `nombre,costo,precio_cliente
Shampoo,10000,20000`;

    const res = parsearPreciosCsv(csvContent);
    expect(res.filas).toHaveLength(0);
    expect(res.errores).toHaveLength(1);
    expect(res.errores[0].motivo).toMatch(/producto_id/);
  });

});
