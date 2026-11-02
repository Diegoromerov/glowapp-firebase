#!/usr/bin/env node
/**
 * E2E de las reglas del dinero — F1 a F8.
 *
 * Ejercita la API real y la base real: crea cuentas y datos de prueba con un
 * sufijo único, comprueba cada regla aprobada y borra todo al final. No usa
 * mocks a propósito: los tres defectos que encontró este arnés (contrato 500,
 * reprogramación infinita, IVA cobrado dos veces) pasaban las pruebas unitarias.
 *
 *   API_URL=http://localhost:8080 \
 *   DATABASE_URL=postgres://postgres:pass@localhost:5432/glow \
 *   node scripts/e2e/reglas.js
 *
 * Variables:
 *   API_URL              base de la API           (por defecto http://127.0.0.1:$PORT || 8080)
 *   DATABASE_URL         cadena de conexión       (obligatoria)
 *   E2E_PASSWORD         contraseña de las cuentas de prueba (por defecto Prueba123!)
 *   E2E_ALLOW_NON_LOCAL  'true' para permitir destinos que no sean localhost
 *
 * Sale con código 2 si alguna verificación falla.
 */

const { Client } = require('pg');
const path = require('path');

// ─── Entorno ────────────────────────────────────────────────────────────────

const API = process.env.API_URL || `http://127.0.0.1:${process.env.PORT || 8080}`;
const DB = process.env.DATABASE_URL;
// Sin valor por defecto: el escáner verifyNoVersionedSecrets.js marca cualquier
// literal como credencial versionada, y tiene razón. Se exige explícita.
const PASSWORD = process.env.E2E_PASSWORD;
const SUFIJO = Date.now().toString(36);

if (!DB) {
  console.error('Falta DATABASE_URL. El arnés necesita leer la base para comprobar los splits.');
  process.exit(1);
}
if (!PASSWORD) {
  console.error('Falta E2E_PASSWORD: contraseña de las cuentas efímeras que crea el arnés.');
  process.exit(1);
}

const esLocal = /localhost|127\.0\.0\.1|::1/.test(API);
if (!esLocal && process.env.E2E_ALLOW_NON_LOCAL !== 'true') {
  console.error(`Destino no local (${API}). Este arnés escribe y borra datos: ` +
    'exporta E2E_ALLOW_NON_LOCAL=true si de verdad quieres correrlo ahí.');
  process.exit(1);
}

// Bcrypt de una contraseña fija de pruebas. El repo prohíbe hashes versionados,
// así que si bcryptjs está disponible se calcula en caliente.
function hashPassword(pw) {
  try {
    return require('bcryptjs').hashSync(pw, 10);
  } catch (_) {
    throw new Error('Falta bcryptjs para crear las cuentas de prueba (npm ci en backend).');
  }
}

// ─── Utilidades ─────────────────────────────────────────────────────────────

const RESULTADOS = [];
const rec = (nombre, ok, detalle) => {
  RESULTADOS.push({ nombre, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${nombre}  ::  ${detalle}`);
};
const omitir = (nombre, motivo) => {
  RESULTADOS.push({ nombre, ok: null });
  console.log(`SKIP  ${nombre}  ::  ${motivo}`);
};

async function llamar(metodo, ruta, cuerpo, token) {
  const res = await fetch(API + ruta, {
    method: metodo,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined
  });
  let json = null;
  try { json = await res.json(); } catch (_) { /* respuesta sin cuerpo */ }
  return { status: res.status, body: json };
}

/** Fecha futura con minutos distintos por llamada: dos corridas no chocan de horario. */
let secuenciaMinuto = 0;
function fechaFutura(dias, hora) {
  const t = new Date();
  t.setDate(t.getDate() + dias);
  t.setHours(hora, (secuenciaMinuto += 7) % 60, 0, 0);
  return t.toISOString();
}

const idDe = (r) => r.body?.booking_id || r.body?.data?.id || r.body?.id;

// ─── Estado de la corrida ───────────────────────────────────────────────────

let pg;
const creado = { usuarios: [], perfil: null, servicios: [], reservas: [], pedidos: [], stock: {} };

async function preparar() {
  const hash = hashPassword(PASSWORD);
  const q = async (sql, p) => (await pg.query(sql, p)).rows;

  const cli = await q(
    `INSERT INTO usuarios (email, nombre, auth_provider, provider_id, password_hash, rol,
                           tenant_id, onboarding_completo, is_active, responsable_iva, tarifa_iva, phone)
     VALUES ($1,'E2E Cliente','LOCAL',$2,$3,'CLIENTE',1,true,true,false,0,'3000000000') RETURNING id`,
    [`e2e.cliente.${SUFIJO}@glowapp.test`, `e2e-cli-${SUFIJO}`, hash]
  );
  const pro = await q(
    `INSERT INTO usuarios (email, nombre, auth_provider, provider_id, password_hash, rol,
                           tenant_id, onboarding_completo, is_active, responsable_iva, tarifa_iva, phone)
     VALUES ($1,'E2E Prestador','LOCAL',$2,$3,'PRESTADOR',1,true,true,false,0,'3000000001') RETURNING id`,
    [`e2e.prestador.${SUFIJO}@glowapp.test`, `e2e-pro-${SUFIJO}`, hash]
  );

  creado.usuarios = [cli[0].id, pro[0].id];
  creado.perfil = pro[0].id;

  // `active_start_hour` es `time` en producción y `integer` en bases donde
  // `index.js` creó la columna al arrancar. El arnés tiene que servir en las dos.
  const tipoHorario = (await q(
    `SELECT data_type FROM information_schema.columns
      WHERE table_name = 'perfiles_prestador' AND column_name = 'active_start_hour'`
  ))[0]?.data_type || 'integer';
  const esHora = String(tipoHorario).includes('time');
  const inicio = esHora ? "'09:00'::time" : '9';
  const fin = esHora ? "'19:00'::time" : '19';

  await q(
    `INSERT INTO perfiles_prestador (id, business_name, description, estatus_verificacion, is_active,
       rating_avg, rating_count, ubicacion, cancelaciones_tardias, tenant_id, active_start_hour, active_end_hour)
     VALUES ($1,'E2E Studio','Perfil efímero del arnés E2E','APROBADO',true,4.8,10,
       ST_SetSRID(ST_MakePoint(-74.15,4.66),4326)::geography,0,1,
       ${inicio},${fin})`,
    [creado.perfil]
  );

  for (const [nombre, precio, minutos, categoria] of [
    ['E2E Corte', 100000, 60, 'Cabello'],
    ['E2E Color', 250000, 120, 'Cabello'],
    ['E2E Barberia', 40000, 30, 'Barberia']
  ]) {
    const s = await q(
      `INSERT INTO services (provider_id, name, description, price, duration_minutes, category, is_active, tenant_id)
       VALUES ($1,$2,'Servicio del arnés E2E',$3,$4,$5,true,1) RETURNING id`,
      [creado.perfil, nombre, precio, minutos, categoria]
    );
    creado.servicios.push(s[0].id);
  }
}

async function limpiar() {
  try {
    await pg.query('BEGIN');
    // El ledger de la billetera es append-only y el borrado de reservas dispara
    // triggers que intentan escribir en él: sin saltarse la replicación, el
    // cleanup falla y deja basura en la base.
    await pg.query('SET LOCAL session_replication_role = replica');
    const reservas = creado.reservas.length ? creado.reservas : [null];
    // `wallet_transactions.provider_id` es uuid en producción e integer en las
    // bases que crea `index.js`: se compara como texto para servir en ambas.
    const reservasTxt = reservas.map((r) => (r === null ? null : String(r)));
    const tx = await pg.query(
      'SELECT id FROM wallet_transactions WHERE provider_id::text = $1::text OR booking_id::text = ANY($2::text[])',
      [String(creado.perfil), reservasTxt]
    );
    const txIds = tx.rows.map((r) => String(r.id));
    await pg.query('DELETE FROM wallet_ledger_events WHERE provider_id::text = $1::text OR tx_id::text = ANY($2::text[])', [String(creado.perfil), txIds]);
    await pg.query('DELETE FROM wallet_transactions WHERE provider_id::text = $1::text OR booking_id::text = ANY($2::text[])', [String(creado.perfil), reservasTxt]);
    await pg.query('DELETE FROM propinas WHERE booking_id::text = ANY($1::text[])', [reservasTxt]);
    await pg.query('DELETE FROM reembolsos WHERE booking_id::text = ANY($1::text[])', [reservasTxt]);
    await pg.query('DELETE FROM bookings WHERE id::text = ANY($1::text[])', [reservasTxt]);
    // Los ids son uuid en producción e integer en las bases que crea
    // `index.js`. Comparar como texto evita el "uuid = integer".
    for (const p of creado.pedidos) await pg.query('DELETE FROM pedidos_tienda WHERE id::text = $1::text', [String(p)]);
    for (const [productoId, unidades] of Object.entries(creado.stock)) {
      await pg.query('UPDATE productos SET stock = $1 WHERE id::text = $2::text', [unidades, String(productoId)]);
    }
    if (creado.servicios.length) await pg.query('DELETE FROM services WHERE id::text = ANY($1::text[])', [creado.servicios.map(String)]);
    if (creado.perfil) await pg.query('DELETE FROM perfiles_prestador WHERE id::text = $1::text', [String(creado.perfil)]);
    if (creado.usuarios.length) await pg.query('DELETE FROM usuarios WHERE id::text = ANY($1::text[])', [creado.usuarios.map(String)]);
    await pg.query('COMMIT');
    console.log('CLEANUP  ::  datos de prueba borrados');
  } catch (e) {
    await pg.query('ROLLBACK').catch(() => {});
    console.error('CLEANUP ERROR  ::  ' + e.message);
  }
}

// ─── Bloques ────────────────────────────────────────────────────────────────

async function autenticacion() {
  const cli = await llamar('POST', '/api/auth/login', { email: `e2e.cliente.${SUFIJO}@glowapp.test`, password: PASSWORD });
  const pro = await llamar('POST', '/api/auth/login', { email: `e2e.prestador.${SUFIJO}@glowapp.test`, password: PASSWORD });
  const tc = cli.body?.token;
  const tp = pro.body?.token;
  rec('A1 login del cliente', cli.status === 200 && !!tc, `HTTP ${cli.status}`);
  rec('A2 login del prestador', pro.status === 200 && !!tp, `HTTP ${pro.status}`);
  return { tc, tp };
}

async function contrato(tp) {
  const get = await llamar('GET', '/api/provider/contract', null, tp);
  rec('B1 GET del contrato responde 200', get.status === 200, `HTTP ${get.status} ${JSON.stringify(get.body).slice(0, 90)}`);

  const post = await llamar('POST', '/api/provider/contract/accept', { version: '2026-10', independencia: true }, tp);
  rec('B2 aceptación del contrato', post.status === 200, `HTTP ${post.status}`);

  const fila = (await pg.query(
    'SELECT contrato_aceptado_at IS NOT NULL AS c, independencia_aceptada_at IS NOT NULL AS i FROM perfiles_prestador WHERE id = $1',
    [creado.perfil]
  )).rows[0];
  rec('B3 aceptación persistida en base', !!(fila && fila.c && fila.i), JSON.stringify(fila || {}));
}

async function reservaYSplit(tc, servicioId) {
  const r = await llamar('POST', '/api/bookings', {
    provider_id: creado.perfil, service_id: servicioId, scheduled_at: fechaFutura(3, 10),
    service_address: 'Calle 100 #15-20, Bogotá', notes: 'E2E split'
  }, tc);
  const id = idDe(r);
  if (id) creado.reservas.push(id);
  rec('C1 crear reserva', [200, 201].includes(r.status) && !!id, `HTTP ${r.status} ${JSON.stringify(r.body).slice(0, 90)}`);
  if (!id) return null;

  const s = (await pg.query(
    'SELECT valor_bruto, comision_plataforma, impuestos_estado, pago_neto_prestador FROM bookings WHERE id = $1', [id]
  )).rows[0];
  rec('C2 split 20/0/80', Number(s.comision_plataforma) === 20000 && Number(s.impuestos_estado) === 0 && Number(s.pago_neto_prestador) === 80000,
    `bruto=${s.valor_bruto} comisión=${s.comision_plataforma} impuestos=${s.impuestos_estado} neto=${s.pago_neto_prestador}`);
  return id;
}

async function propina(tc, tp, reservaId) {
  const antes = await llamar('POST', `/api/bookings/${reservaId}/tip`, { monto: 10000 }, tc);
  rec('D1 propina antes de completar rechazada', antes.status === 409, `HTTP ${antes.status}`);

  // El cierre de servicio es PATCH /status; no existe POST /complete.
  const fin = await llamar('PATCH', `/api/bookings/${reservaId}/status`, { status: 'COMPLETADA' }, tp);
  rec('D2 completar el servicio', [200, 201].includes(fin.status), `HTTP ${fin.status}`);

  const ok = await llamar('POST', `/api/bookings/${reservaId}/tip`, { monto: 10000 }, tc);
  const filas = (await pg.query('SELECT monto FROM propinas WHERE booking_id = $1', [reservaId])).rows;
  rec('D3 propina de 10.000 completa', [200, 201].includes(ok.status) && filas.length === 1 && Number(filas[0].monto) === 10000,
    `HTTP ${ok.status} filas=${filas.length}`);

  const otra = await llamar('POST', `/api/bookings/${reservaId}/tip`, { monto: 5000 }, tc);
  rec('D4 segunda propina rechazada', [400, 409].includes(otra.status), `HTTP ${otra.status}`);
}

async function reprogramacion(tc, servicioId) {
  const r = await llamar('POST', '/api/bookings', {
    provider_id: creado.perfil, service_id: servicioId, scheduled_at: fechaFutura(6, 11),
    service_address: 'Calle 100 #15-20, Bogotá'
  }, tc);
  const id = idDe(r);
  if (!id) { omitir('E1-E3 reprogramación', 'no se pudo crear la reserva'); return; }
  creado.reservas.push(id);

  const primera = await llamar('PATCH', `/api/bookings/${id}/reschedule`, { scheduled_at: fechaFutura(7, 12) }, tc);
  const segunda = await llamar('PATCH', `/api/bookings/${id}/reschedule`, { scheduled_at: fechaFutura(8, 13) }, tc);
  const fila = (await pg.query('SELECT reschedule_count FROM bookings WHERE id = $1', [id])).rows[0];

  rec('E1 primera reprogramación aceptada', [200, 201].includes(primera.status), `HTTP ${primera.status}`);
  rec('E2 segunda reprogramación bloqueada', segunda.status === 409, `HTTP ${segunda.status}`);
  rec('E3 contador persistido', Number(fila.reschedule_count) === 1, `reschedule_count=${fila.reschedule_count}`);
}

async function cancelaciones(tc, servicioId) {
  const tramo = async (nombre, fecha, esperado) => {
    const r = await llamar('POST', '/api/bookings', {
      provider_id: creado.perfil, service_id: servicioId, scheduled_at: fecha,
      service_address: 'Calle 100 #15-20, Bogotá'
    }, tc);
    const id = idDe(r);
    if (!id) { omitir(nombre, 'no se pudo crear la reserva'); return; }
    creado.reservas.push(id);

    // El reembolso solo se crea sobre reservas pagadas.
    await pg.query("UPDATE bookings SET payment_status='paid', estado='CONFIRMADA' WHERE id = $1", [id]);
    const c = await llamar('PATCH', `/api/bookings/${id}/cancel`, { motivo: 'E2E ' + nombre }, tc);
    const dev = (await pg.query('SELECT monto, porcentaje_devolucion FROM reembolsos WHERE booking_id = $1', [id])).rows[0];

    rec(nombre, c.status < 300 && dev && Number(dev.porcentaje_devolucion) === esperado,
      `HTTP ${c.status} reembolso=${JSON.stringify(dev || null)}`);
  };

  const enDosHoras = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
  const enOchoHoras = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString();
  await tramo('F1 cancelación >24 h devuelve 100 %', fechaFutura(4, 10), 100);
  await tramo('F2 cancelación 2–24 h devuelve 50 %', enOchoHoras, 50);
  await tramo('F3 cancelación <2 h devuelve 0 %', enDosHoras, 0);
}

async function checkout(tc) {
  // El precio que cobra el checkout sale de `precios_producto` para la lista del
  // rol, no de `productos.precio_al_publico`. Si la base no tiene precios de
  // lista cargados, todo el bloque se omite con el motivo a la vista: un 403
  // repetido no enseña nada.
  // D-GL-011 v2: el umbral vive en la tabla, y la migración 094 lo sembraba con
  // valores de un borrador anterior. Este chequeo es el guardia de esa regla.
  const zonas = (await pg.query(
    "SELECT ciudad, gratis_desde_monto FROM zonas_envio WHERE lower(ciudad) LIKE 'bogot%' OR lower(ciudad) = 'cali'"
  )).rows;
  const bogota = zonas.find((z) => /bogot/i.test(z.ciudad));
  const cali = zonas.find((z) => /cali/i.test(z.ciudad));
  rec('G0 umbrales cargados según D-GL-011',
    (!bogota || Number(bogota.gratis_desde_monto) === 300000) && (!cali || Number(cali.gratis_desde_monto) === 480000),
    `Bogotá=${bogota?.gratis_desde_monto ?? 'sin zona'} Cali=${cali?.gratis_desde_monto ?? 'sin zona'}`);

  const lista = (await pg.query(
    `SELECT id FROM listas_precios WHERE codigo = 'cliente' AND estado = 'ACTIVA' LIMIT 1`
  )).rows[0];
  if (!lista) {
    omitir('G envío e IVA', 'no hay lista de precios activa para el rol cliente');
    return;
  }
  const productos = (await pg.query(
    `SELECT pr.producto_id AS id, pr.precio, p.stock
       FROM precios_producto pr
       JOIN productos p ON p.id = pr.producto_id
      WHERE pr.lista_id = $1 AND (pr.vigente_hasta IS NULL OR pr.vigente_hasta > NOW())
        AND pr.precio > 0 AND p.stock > 0
      ORDER BY pr.precio DESC LIMIT 100`,
    [lista.id]
  )).rows;
  if (!productos.length) {
    omitir('G envío e IVA', 'la base no tiene precios de lista cargados para el rol cliente');
    return;
  }

  const pedir = async (prod, cantidad, ciudad, departamento) => {
    // El checkout descuenta stock y el cleanup borra el pedido, pero no devuelve
    // las unidades: se guarda el stock inicial para restaurarlo.
    if (!creado.stock[prod.id]) creado.stock[prod.id] = Number(prod.stock);
    const r = await llamar('POST', '/api/store/checkout', {
      nombre_entrega: 'E2E Cliente', direccion_entrega: 'Calle 100 #15-20', ciudad,
      departamento, codigo_postal: '110111', items: [{ producto_id: prod.id, cantidad }]
    }, tc);
    const o = r.body?.data?.order || {};
    if (o.id) creado.pedidos.push(o.id);
    return { status: r.status, o, error: r.body?.error };
  };

  // Producto que sirva para cruzar el umbral de Bogotá (300.000) con el stock real.
  // Se busca un producto que cruce el umbral con una cantidad razonable y que
  // tenga stock suficiente: cantidad <= stock. Comparar dinero contra stock es
  // el error que dejaba este bloque siempre en SKIP.
  const paraBogota = productos.find((p) => {
    const precio = Number(p.precio);
    const cantidad = Math.ceil(300000 / precio);
    return precio < 300000 && cantidad >= 2 && cantidad <= 12 && cantidad <= Number(p.stock);
  });
  if (!paraBogota) {
    omitir('G1-G2 umbral Bogotá', 'ningún producto del catálogo alcanza 300.000 con el stock disponible');
  } else {
    const precio = Number(paraBogota.precio);
    const cantidad = Math.ceil(300000 / precio);
    const bajo = await pedir(paraBogota, 1, 'Bogotá', 'Cundinamarca');
    rec('G1 Bogotá bajo el umbral cobra envío', bajo.status < 300 && Number(bajo.o.envio) > 1000,
      `HTTP ${bajo.status} envío=${bajo.o.envio} mercancía=${precio}`);

    const alto = await pedir(paraBogota, cantidad, 'Bogotá', 'Cundinamarca');
    rec('G2 Bogotá sobre 300.000 no cobra envío', alto.status < 300 && Number(alto.o.envio) === 0,
      `HTTP ${alto.status} envío=${alto.o.envio} mercancía=${precio * cantidad}`);

    // IVA: el precio de vitrina ya lo incluye, así que base + IVA deben dar ese precio.
    const sub = Number(bajo.o.subtotal), iva = Number(bajo.o.iva), total = Number(bajo.o.total), envio = Number(bajo.o.envio);
    rec('G3 IVA incluido, no sumado encima', Math.abs(sub + iva - (precio)) <= 1 && Math.abs(total - (precio + envio)) <= 1,
      `base=${sub} iva=${iva} total=${total} (esperado ${precio + envio})`);

    rec('G4 retención de gestión de 1.000', envio > 1000, `envío=${envio} (tarifa del operador + 1.000)`);
    if (bajo.o.envio?.retencion != null) {
      rec('G4b retención declarada', Number(bajo.o.envio.retencion) === 1000, `retención=${bajo.o.envio.retencion}`);
    }
  }

  // Umbral nacional (480.000) — necesita un producto con stock suficiente.
  const paraNacional = productos.find((p) => {
    const precio = Number(p.precio);
    const q = Math.ceil(480000 / precio);
    return precio < 480000 && q >= 2 && q <= 12 && q <= Number(p.stock);
  });
  if (!paraNacional) {
    omitir('G5-G6 umbral nacional', 'ningún producto del catálogo alcanza 480.000 con stock ≤ 20 unidades');
  } else {
    const precio = Number(paraNacional.precio);
    const cantidad = Math.ceil(480000 / precio);
    const bajo = await pedir(paraNacional, cantidad - 1, 'Cali', 'Valle del Cauca');
    const alto = await pedir(paraNacional, cantidad, 'Cali', 'Valle del Cauca');
    rec('G5 Cali bajo 480.000 cobra envío', bajo.status < 300 && Number(bajo.o.envio) > 1000,
      `HTTP ${bajo.status} envío=${bajo.o.envio} mercancía=${precio * (cantidad - 1)}`);
    rec('G6 Cali sobre 480.000 no cobra envío', alto.status < 300 && Number(alto.o.envio) === 0,
      `HTTP ${alto.status} envío=${alto.o.envio} mercancía=${precio * cantidad}`);
  }
}

async function billetera(tp) {
  const st = await llamar('GET', '/api/wallet/statement', null, tp);
  const datos = JSON.stringify(st.body?.data || st.body || {});
  rec('I1 estado de cuenta del prestador', st.status === 200 && /disponible|custodia|pendiente/i.test(datos),
    `HTTP ${st.status} ${datos.slice(0, 90)}`);
}

// ─── Ejecución ──────────────────────────────────────────────────────────────

(async () => {
  pg = new Client({ connectionString: DB, ssl: false });
  await pg.connect();
  try {
    await preparar();
    console.log(`SETUP  ::  cuentas de prueba ${SUFIJO} creadas en ${API}`);

    const { tc, tp } = await autenticacion();
    if (!tc || !tp) throw new Error('No se pudo autenticar: revisa E2E_PASSWORD y que las cuentas se hayan creado.');

    const servicios = (await pg.query('SELECT id, name FROM services WHERE provider_id = $1 ORDER BY price', [creado.perfil])).rows;
    const corte = servicios.find((s) => s.name === 'E2E Corte');

    await contrato(tp);
    const reservaId = await reservaYSplit(tc, corte.id);
    if (reservaId) await propina(tc, tp, reservaId);
    await reprogramacion(tc, corte.id);
    await cancelaciones(tc, corte.id);
    await checkout(tc);
    await billetera(tp);
  } catch (e) {
    console.error('ERROR  ::  ' + e.message);
    RESULTADOS.push({ nombre: 'ejecución', ok: false });
  } finally {
    await limpiar();
    const pasan = RESULTADOS.filter((r) => r.ok === true).length;
    const fallan = RESULTADOS.filter((r) => r.ok === false).length;
    const omitidas = RESULTADOS.filter((r) => r.ok === null).length;
    console.log(`\nRESUMEN ${pasan}/${RESULTADOS.length} · ${fallan} fallan · ${omitidas} omitidas`);
    await pg.end();
    process.exit(fallan > 0 ? 2 : 0);
  }
})();
