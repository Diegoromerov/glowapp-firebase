const { resolverPrecio, rolACodigoLista } = require('../services/precioService');
const { pool } = require('../config/db');

jest.mock('../config/db', () => ({
  pool: {
    query: jest.fn()
  }
}));

describe('precioService - resolverPrecio', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('rolACodigoLista mapea correctamente roles de API y BD', () => {
    expect(rolACodigoLista('client')).toBe('cliente');
    expect(rolACodigoLista('CLIENTE')).toBe('cliente');
    expect(rolACodigoLista('provider')).toBe('profesional');
    expect(rolACodigoLista('PRESTADOR')).toBe('profesional');
    expect(rolACodigoLista('salon')).toBe('negocio');
    expect(rolACodigoLista('SALON')).toBe('negocio');
    expect(rolACodigoLista('admin')).toBe('cliente');
  });

  test('devuelve sin_precio si no existe la lista activa o no hay fila de precio', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ id: 1, codigo: 'profesional', incluye_iva: false }] });
    pool.query.mockResolvedValueOnce({ rows: [] });

    const res = await resolverPrecio({ rol: 'provider', productoId: 101, cantidad: 1 });
    expect(res).toEqual({
      estado: 'sin_precio',
      lista: 'profesional',
      unidad_minima: 1
    });
  });

  test('lanza error MINIMO_NO_CUMPLIDO cuando la cantidad es menor a la unidad mínima', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ id: 3, codigo: 'negocio', incluye_iva: false }] });
    pool.query.mockResolvedValueOnce({ rows: [{ precio: '36000.00', unidad_minima: 6 }] });

    await expect(resolverPrecio({ rol: 'salon', productoId: 101, cantidad: 5 })).rejects.toMatchObject({
      code: 'MINIMO_NO_CUMPLIDO',
      unidad_minima: 6,
      lista: 'negocio'
    });
  });

  test('resuelve precio felizmente cuando cumple la unidad mínima', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ id: 3, codigo: 'negocio', incluye_iva: false }] });
    pool.query.mockResolvedValueOnce({ rows: [{ precio: '36000.00', unidad_minima: 6 }] });

    const res = await resolverPrecio({ rol: 'salon', productoId: 101, cantidad: 6 });
    expect(res).toEqual({
      lista: 'negocio',
      precio: 36000,
      unidad_minima: 6,
      incluye_iva: false
    });
  });
});
