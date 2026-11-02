// E-06 (D-GL-027) — Inventario operable y alquileres.
// Base falsa: lo que se prueba son las reglas (stock que no puede quedar
// negativo, un recurso con un solo alquiler activo, alcance por rol).

const { crearControladorOps } = require('../controllers/salonOpsController');

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

function reqMock({ sub_rol = 'DUEÑO', salonId = 1, userId = 7, body = {}, params = {}, query = {} } = {}) {
  return {
    user: { id: userId, tenant_id: 'tenant-1' },
    salonId,
    salonMembership: { sub_rol },
    body,
    params,
    query,
  };
}

function dbFalso(opts = {}) {
  const llamadas = [];
  const estado = {
    items: opts.items ?? [],
    item: opts.item ?? null,
    salones: opts.salones ?? [{ tenant_id: 'tenant-1' }],
    recurso: opts.recurso ?? null,
    updateRows: opts.updateRows ?? [],
    recursos: opts.recursos ?? [],
    alquileres: opts.alquileres ?? [],
    errorEn: opts.errorEn ?? null,
  };
  return {
    llamadas,
    estado,
    query: async (sql, params) => {
      const limpio = sql.replace(/\s+/g, ' ').trim();
      llamadas.push({ sql: limpio, params });
      if (estado.errorEn && limpio.includes(estado.errorEn)) {
        const e = new Error('duplicate key value violates unique constraint');
        e.code = '23505';
        throw e;
      }
      if (/FROM business_profiles WHERE id = left/i.test(limpio)) return { rows: estado.salones };
      if (/FROM inventario_salon WHERE salon_id/i.test(limpio)) return { rows: estado.items };
      if (/FROM inventario_salon WHERE id = \$1 AND salon_id/i.test(limpio)) {
        return { rows: estado.item ? [estado.item] : [] };
      }
      if (/INSERT INTO inventario_salon/i.test(limpio)) return { rows: [opts.insertRow] };
      if (/UPDATE inventario_salon/i.test(limpio)) return { rows: estado.updateRows };
      if (/INSERT INTO inventario_movimientos/i.test(limpio)) return { rows: [] };
      if (/FROM inventario_movimientos/i.test(limpio)) return { rows: [] };
      if (/SELECT id, tenant_id, canon_mensual, estado FROM recursos_alquilables/i.test(limpio)) {
        return { rows: estado.recurso ? [estado.recurso] : [] };
      }
      if (/FROM recursos_alquilables r/i.test(limpio)) return { rows: estado.recursos };
      if (/INSERT INTO recursos_alquilables/i.test(limpio)) return { rows: [opts.recursoRow] };
      if (/INSERT INTO alquileres/i.test(limpio)) return { rows: [opts.alquilerRow] };
      if (/FROM alquileres a/i.test(limpio)) return { rows: estado.alquileres };
      return { rows: [] };
    },
  };
}

describe('Inventario — lectura y alta', () => {
  it('marca stock bajo y dice si el rol puede editar', async () => {
    const db = dbFalso({
      items: [
        { id: 'i1', nombre: 'Shampoo', categoria: 'INSUMO', unidad: 'LITRO', stock_actual: '1.00', stock_minimo: '5.00', costo_unitario: '18000.00', proveedor: null, stock_bajo: true },
        { id: 'i2', nombre: 'Toallas', categoria: 'HERRAMIENTA', unidad: 'UNIDAD', stock_actual: '20.00', stock_minimo: '5.00', costo_unitario: null, proveedor: null, stock_bajo: false },
      ],
    });
    const res = resMock();
    await crearControladorOps(db).listarInventario(reqMock({ sub_rol: 'EMPLEADO' }), res);

    expect(res.body.total).toBe(2);
    expect(res.body.stock_bajo).toBe(1);
    expect(res.body.puede_editar).toBe(false);
    expect(res.body.items[0].stock_actual).toBe(1);
  });

  it('rechaza un insumo con nombre demasiado corto', async () => {
    const res = resMock();
    await crearControladorOps(dbFalso()).crearItem(reqMock({ body: { nombre: 'x' } }), res);
    expect(res.statusCode).toBe(400);
  });

  it('rechaza categorías que no existen', async () => {
    const res = resMock();
    await crearControladorOps(dbFalso()).crearItem(
      reqMock({ body: { nombre: 'Tinte', categoria: 'MAGIA' } }),
      res
    );
    expect(res.statusCode).toBe(400);
    expect(res.body.validas).toContain('INSUMO');
  });

  it('un colaborador no crea insumos', async () => {
    const res = resMock();
    await crearControladorOps(dbFalso()).crearItem(
      reqMock({ sub_rol: 'EMPLEADO', body: { nombre: 'Tinte' } }),
      res
    );
    expect(res.statusCode).toBe(403);
  });

  it('un insumo duplicado devuelve 409, no 500', async () => {
    const db = dbFalso({ errorEn: 'INSERT INTO inventario_salon' });
    const res = resMock();
    await crearControladorOps(db).crearItem(reqMock({ body: { nombre: 'Shampoo' } }), res);
    expect(res.statusCode).toBe(409);
  });
});

describe('Inventario — movimientos', () => {
  const item = { id: 'i1', tenant_id: 'tenant-1', stock_actual: '3.00' };

  it('una salida mayor que el stock se rechaza y no toca el saldo', async () => {
    const db = dbFalso({ item, updateRows: [{ id: 'i1', nombre: 'Shampoo', stock_actual: '-7.00', stock_minimo: '5.00' }] });
    const res = resMock();
    await crearControladorOps(db).registrarMovimiento(
      reqMock({ params: { itemId: 'i1' }, body: { tipo: 'SALIDA', cantidad: 10 } }),
      res
    );

    expect(res.statusCode).toBe(400);
    expect(res.body.stock_actual).toBe(3);
    // No se ejecutó ningún UPDATE: el stock quedó intacto.
    expect(db.llamadas.some((l) => /UPDATE inventario_salon/i.test(l.sql))).toBe(false);
  });

  it('una entrada suma al saldo', async () => {
    const db = dbFalso({ item, updateRows: [{ id: 'i1', nombre: 'Shampoo', stock_actual: '13.00', stock_minimo: '5.00' }] });
    const res = resMock();
    await crearControladorOps(db).registrarMovimiento(
      reqMock({ params: { itemId: 'i1' }, body: { tipo: 'ENTRADA', cantidad: 10 } }),
      res
    );

    expect(res.statusCode).toBe(201);
    expect(res.body.item.stock_actual).toBe(13);
    expect(db.llamadas.find((l) => /UPDATE inventario_salon/i.test(l.sql)).params[0]).toBe(13);
  });

  it('un ajuste fija el saldo en la cantidad contada', async () => {
    const db = dbFalso({ item, updateRows: [{ id: 'i1', nombre: 'Shampoo', stock_actual: '8.00', stock_minimo: '5.00' }] });
    const res = resMock();
    await crearControladorOps(db).registrarMovimiento(
      reqMock({ params: { itemId: 'i1' }, body: { tipo: 'AJUSTE', cantidad: 8 } }),
      res
    );

    expect(res.statusCode).toBe(201);
    expect(db.llamadas.find((l) => /UPDATE inventario_salon/i.test(l.sql)).params[0]).toBe(8);
  });

  it('rechaza tipos de movimiento inventados', async () => {
    const res = resMock();
    await crearControladorOps(dbFalso({ item })).registrarMovimiento(
      reqMock({ params: { itemId: 'i1' }, body: { tipo: 'REGALO', cantidad: 1 } }),
      res
    );
    expect(res.statusCode).toBe(400);
  });

  it('404 si el insumo no es de este salón', async () => {
    const res = resMock();
    await crearControladorOps(dbFalso()).registrarMovimiento(
      reqMock({ params: { itemId: 'ajeno' }, body: { tipo: 'ENTRADA', cantidad: 1 } }),
      res
    );
    expect(res.statusCode).toBe(404);
  });
});

describe('Alquileres', () => {
  it('no alquila un recurso que ya está ocupado', async () => {
    const db = dbFalso({ recurso: { id: 'r1', tenant_id: 'tenant-1', canon_mensual: '250000.00', estado: 'OCUPADO' } });
    const res = resMock();
    await crearControladorOps(db).crearAlquiler(
      reqMock({ body: { recurso_id: 'r1', persona_id: 42 } }),
      res
    );

    expect(res.statusCode).toBe(409);
    expect(res.body.estado).toBe('OCUPADO');
  });

  it('404 si el recurso no existe en el salón', async () => {
    const res = resMock();
    await crearControladorOps(dbFalso()).crearAlquiler(
      reqMock({ body: { recurso_id: 'r-ajeno', persona_id: 42 } }),
      res
    );
    expect(res.statusCode).toBe(404);
  });

  it('un colaborador sólo ve sus propios alquileres', async () => {
    const db = dbFalso({ alquileres: [] });
    const res = resMock();
    await crearControladorOps(db).listarAlquileres(
      reqMock({ sub_rol: 'EMPLEADO', userId: 42 }),
      res
    );

    expect(res.body.alcance).toBe('PROPIO');
    const consulta = db.llamadas[0];
    expect(consulta.sql).toContain('a.persona_id = $2');
    expect(consulta.params[1]).toBe(42);
  });

  it('administración ve todos los alquileres del salón', async () => {
    const db = dbFalso({ alquileres: [] });
    const res = resMock();
    await crearControladorOps(db).listarAlquileres(reqMock({ sub_rol: 'DUEÑO' }), res);

    expect(res.body.alcance).toBe('SALON');
    expect(db.llamadas[0].sql).not.toContain('persona_id = $2');
  });
});
