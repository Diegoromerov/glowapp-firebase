// E-05 (D-GL-027) — Caja del salón.
// Se prueba el controlador con una base falsa: lo que importa aquí son las
// reglas (alcance por rol, validación del dinero, constancia), no el driver.

const { crearControladorCaja } = require('../controllers/cajaController');

function resMock() {
  const r = { statusCode: 200, body: null };
  r.status = (c) => {
    r.statusCode = c;
    return r;
  };
  r.json = (b) => {
    r.body = b;
    return r;
  };
  return r;
}

function reqMock({ sub_rol, userId = 7, salonId = 1, body = {}, query = {}, params = {} }) {
  return {
    user: { id: userId, tenant_id: 'tenant-1' },
    salonId,
    salonMembership: { sub_rol },
    body,
    query,
    params,
  };
}

/** Base falsa: responde según la forma de la consulta. */
function dbFalso({ totales, porConcepto = [], salon = [{ tenant_id: 'tenant-1' }], insert = [], constancia = [] } = {}) {
  const llamadas = [];
  return {
    llamadas,
    query: async (sql, params) => {
      const limpio = sql.replace(/\s+/g, ' ').trim();
      llamadas.push({ sql: limpio, params });
      // El inquilino se resuelve en business_profiles (fuente única, D-GL-027).
      if (/FROM business_profiles WHERE id = left/i.test(limpio)) return { rows: salon };
      if (/GROUP BY tipo, concepto/i.test(limpio)) return { rows: porConcepto };
      if (/COALESCE\(SUM\(CASE WHEN tipo = 'INGRESO'/i.test(limpio)) return { rows: [totales] };
      if (/INSERT INTO caja_movimientos/i.test(limpio)) return { rows: insert };
      if (/JOIN salones s ON s\.id = m\.salon_id/i.test(limpio)) return { rows: constancia };
      return { rows: [] };
    },
  };
}

describe('Caja — resumen por rol', () => {
  it('el dueño ve la caja completa y el neto es ingresos menos gastos', async () => {
    const db = dbFalso({
      totales: { ingresos: '150000.00', gastos: '50000.00', movimientos: 3 },
      porConcepto: [
        { tipo: 'INGRESO', concepto: 'SERVICIO', total: '150000.00', n: 2 },
        { tipo: 'GASTO', concepto: 'INSUMO', total: '50000.00', n: 1 },
      ],
    });
    const res = resMock();
    await crearControladorCaja(db).resumen(reqMock({ sub_rol: 'DUEÑO' }), res);

    expect(res.statusCode).toBe(200);
    expect(res.body.alcance).toBe('SALON');
    expect(res.body.ingresos).toBe(150000);
    expect(res.body.gastos).toBe(50000);
    expect(res.body.neto).toBe(100000);
    expect(res.body.puede_registrar).toBe(true);
    expect(res.body.por_concepto).toHaveLength(2);
    // Sin filtro de persona: la consulta no menciona persona_id.
    expect(db.llamadas[0].sql).not.toContain('persona_id');
  });

  it('un colaborador sólo ve lo atribuido a su persona, no la caja del salón', async () => {
    const db = dbFalso({
      totales: { ingresos: '20000.00', gastos: '0.00', movimientos: 1 },
    });
    const res = resMock();
    await crearControladorCaja(db).resumen(
      reqMock({ sub_rol: 'EMPLEADO', userId: 42 }),
      res
    );

    expect(res.body.alcance).toBe('PROPIO');
    expect(res.body.puede_registrar).toBe(false);
    expect(db.llamadas[0].sql).toContain('persona_id = $4');
    expect(db.llamadas[0].params[3]).toBe(42);
  });

  it('rechaza un rango de fechas inválido en vez de devolver ceros', async () => {
    const res = resMock();
    await crearControladorCaja(dbFalso()).resumen(
      reqMock({ sub_rol: 'DUEÑO', query: { desde: '2026-13-45', hasta: 'nada' } }),
      res
    );
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/Rango de fechas/i);
  });
});

describe('Caja — registro de movimientos', () => {
  const base = {
    sub_rol: 'ADMINISTRADOR',
    body: { tipo: 'INGRESO', concepto: 'SERVICIO', monto: 100000, metodo_pago: 'EFECTIVO' },
  };

  it('registra un ingreso y emite constancia propia del salón', async () => {
    const db = dbFalso({
      insert: [{
        id: 'm-1', tipo: 'INGRESO', concepto: 'SERVICIO', monto: '100000.00',
        metodo_pago: 'EFECTIVO', constancia_ref: 'CJ-1-20261026-AB12',
        fecha_movimiento: new Date('2026-10-26T15:00:00Z'),
      }],
    });
    const res = resMock();
    await crearControladorCaja(db).registrar(reqMock(base), res);

    expect(res.statusCode).toBe(201);
    expect(res.body.movimiento.monto).toBe(100000);
    expect(res.body.movimiento.constancia_ref).toMatch(/^CJ-1-\d{8}-[0-9A-F]{4}$/);
    // El tenant sale del salón, no del cliente.
    expect(db.llamadas[1].params[0]).toBe('tenant-1');
  });

  it('rechaza monto cero o negativo', async () => {
    for (const monto of [0, -5, 'abc']) {
      const res = resMock();
      await crearControladorCaja(dbFalso()).registrar(
        reqMock({ ...base, body: { ...base.body, monto } }),
        res
      );
      expect(res.statusCode).toBe(400);
      expect(res.body.error).toMatch(/monto/i);
    }
  });

  it('rechaza conceptos y métodos que no existen', async () => {
    const res1 = resMock();
    await crearControladorCaja(dbFalso()).registrar(
      reqMock({ ...base, body: { ...base.body, concepto: 'CRIPTOMONEDA' } }),
      res1
    );
    expect(res1.statusCode).toBe(400);

    const res2 = resMock();
    await crearControladorCaja(dbFalso()).registrar(
      reqMock({ ...base, body: { ...base.body, metodo_pago: 'TRUEQUE' } }),
      res2
    );
    expect(res2.statusCode).toBe(400);
  });

  it('un colaborador no registra dinero aunque llame al endpoint', async () => {
    const res = resMock();
    await crearControladorCaja(dbFalso()).registrar(
      reqMock({ ...base, sub_rol: 'EMPLEADO' }),
      res
    );
    expect(res.statusCode).toBe(403);
    expect(res.body.mi_rol).toBe('EMPLEADO');
  });
});

describe('Caja — constancia', () => {
  const fila = {
    id: 'm-1', tipo: 'INGRESO', concepto: 'SERVICIO', descripcion: 'Corte',
    monto: '80000.00', moneda: 'COP', metodo_pago: 'TARJETA', persona_id: 42,
    constancia_ref: 'CJ-1-20261026-AB12', fecha_movimiento: new Date('2026-10-26T15:00:00Z'),
    nombre_salon: 'Salón Fontibón', direccion: 'Calle 1', ciudad: 'Bogotá',
  };

  it('declara que es constancia y no factura electrónica', async () => {
    const res = resMock();
    await crearControladorCaja(dbFalso({ constancia: [fila] })).constancia(
      reqMock({ sub_rol: 'DUEÑO', params: { movimientoId: 'm-1' } }),
      res
    );
    expect(res.statusCode).toBe(200);
    expect(res.body.constancia.comprobante).toBe('CONSTANCIA_DE_PAGO');
    expect(res.body.constancia.factura_electronica).toBe(false);
    expect(res.body.constancia.monto).toBe(80000);
  });

  it('un colaborador no obtiene la constancia de otro', async () => {
    const res = resMock();
    await crearControladorCaja(dbFalso({ constancia: [fila] })).constancia(
      reqMock({ sub_rol: 'EMPLEADO', userId: 99, params: { movimientoId: 'm-1' } }),
      res
    );
    expect(res.statusCode).toBe(403);
  });
});
