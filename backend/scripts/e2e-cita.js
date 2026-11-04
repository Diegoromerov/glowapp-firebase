// E2E del ciclo completo de una cita contra el entorno real:
// reserva -> pago -> reprogramación -> servicio completado -> propina
// y, en paralelo, reserva -> pago -> cancelación.
//
// Usa un usuario de prueba (cliente 1) y limpia todo lo que crea. No completa el
// OTP a propósito: eso acredita la billetera del prestador y el ledger es
// append-only, así que dejaría un movimiento imposible de borrar.
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { Client } = require('pg');

const db = () => new Client({ connectionString: process.env.DATABASE_URL });
const PORT = (process.env.PORT || 8080).replace(/^tcp:\/\//, '').split(':')[0];
const BASE = `http://127.0.0.1:${PORT}`;

const tok = (p) => jwt.sign(p, process.env.JWT_SECRET, { expiresIn: '15m' });
const HC = { Authorization: `Bearer ${tok({ id: 1, email: 'e2e@glowapp.test', role: 'client', rol: 'CLIENTE' })}`, 'X-App-Audience': 'client', 'Content-Type': 'application/json' };

const resultados = [];
function check(nombre, ok, detalle) {
  resultados.push({ nombre, ok, detalle });
  console.log(`${ok ? 'PASS' : 'FALLO'} · ${nombre}${detalle ? ' · ' + detalle : ''}`);
}

async function crearReserva(provider_id, service_id, dias) {
  // Si dos corridas caen en la misma franja, la segunda recibe 409 por solape.
  // Se reintenta con otro desplazamiento en vez de leerlo como fallo del flujo.
  for (let intento = 0; intento < 3; intento++) {
    const desplazamiento = dias + intento * 7 + Math.floor(Math.random() * 5);
    const r = await fetch(`${BASE}/api/bookings`, {
      method: 'POST', headers: HC,
      body: JSON.stringify({
        provider_id,
        service_ids: [service_id],
        scheduled_at: new Date(Date.now() + desplazamiento * 86400e3).toISOString(),
        service_address: 'Calle 1 # 2-3, Bogota',
      }),
    });
    const b = await r.json();
    const id = b.booking_id || b.id;
    if (r.status === 200 && id) return { status: r.status, id, body: b };
    if (r.status !== 409) return { status: r.status, id: null, body: b };
  }
  return { status: 409, id: null, body: { error: 'sin franja libre tras 3 intentos' } };
}

async function pagarYConfirmar(bookingId, valorBruto, providerId) {
  // 1. token de aceptación + tarjeta de prueba (sandbox)
  const m = await (await fetch(`${process.env.WOMPI_BASE_URL}/merchants/${process.env.WOMPI_PUBLIC_KEY}`)).json();
  const acceptance = m?.data?.presigned_acceptance?.acceptance_token;
  const t = await fetch(`${process.env.WOMPI_BASE_URL}/tokens/cards`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.WOMPI_PUBLIC_KEY}` },
    body: JSON.stringify({ number: '4242424242424242', cvc: '123', exp_month: '12', exp_year: '29', card_holder: 'E2E TEST' }),
  });
  const card = (await t.json())?.data?.id;

  const pay = await fetch(`${BASE}/api/bookings/${bookingId}/pay`, {
    method: 'POST', headers: HC,
    body: JSON.stringify({ payment_method: 'CARD', payment_method_token: card, installments: 1, acceptance_token: acceptance }),
  });
  const payBody = await pay.json();
  if (pay.status !== 202) return { ok: false, detalle: `pay ${pay.status} ${payBody.error || ''}`, ref: null };

  // 2. evento firmado de Wompi (lo que enviaría la pasarela al aprobar)
  const ref = payBody.reference;
  const event = {
    event: 'transaction.updated',
    data: { transaction: { id: payBody.wompi_transaction_id, status: 'APPROVED', amount_in_cents: Math.round(valorBruto * 100), reference: ref } },
    signature: { properties: ['transaction.id', 'transaction.status', 'transaction.amount_in_cents'] },
    timestamp: Math.floor(Date.now() / 1000),
    sent_at: new Date().toISOString(),
  };
  const valores = event.signature.properties.map((p) => { const [a, b] = p.split('.'); return event.data[a][b]; });
  const checksum = crypto.createHash('sha256').update(`${valores.join('')}${event.timestamp}${process.env.WOMPI_EVENTS_SECRET}`).digest('hex');
  event.signature.checksum = checksum;

  const hook = await fetch(`${BASE}/api/payments/store-webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Event-Checksum': checksum, 'X-App-Audience': 'client' },
    body: JSON.stringify(event),
  });
  const hookBody = await hook.text();
  return { ok: hook.status === 200, detalle: `pay 202 · webhook ${hook.status} ${hookBody.slice(0, 40)}`, ref };
}

(async () => {
  const d0 = db(); await d0.connect();
  const origen = await d0.query("select service_id, provider_id, valor_bruto from bookings where client_id=1 and valor_bruto > 0 limit 1");
  await d0.end();
  const { service_id, provider_id } = origen.rows[0];

  const creadas = [];

  // ── FLUJO 1: reserva ───────────────────────────────────────────────────────
  const a = await crearReserva(provider_id, service_id, 11);
  creadas.push(a.id);
  check('reserva creada', a.status === 200 && !!a.id, `HTTP ${a.status}`);

  const lista1 = await (await fetch(`${BASE}/api/bookings/client`, { headers: HC })).json();
  const enLista = (lista1.data || []).find((x) => x.id === a.id);
  check('aparece en Mis citas como pendiente de pago',
    enLista?.status === 'PENDIENTE_PAGO', `estado ${enLista?.status}`);
  check('el payload trae service_id y provider_id para reprogramar',
    !!enLista?.service_id && !!enLista?.provider_id, `${enLista?.service_id} / ${enLista?.provider_id}`);

  const valor = Number(enLista?.total_amount || 0);

  // ── FLUJO 2: pago ──────────────────────────────────────────────────────────
  const pago = await pagarYConfirmar(a.id, valor, provider_id);
  check('pago creado en Wompi y webhook aceptado', pago.ok, pago.detalle);

  const d1 = db(); await d1.connect();
  const tras = await d1.query('select estado, payment_status from bookings where id=$1', [a.id]);
  await d1.end();
  check('la cita queda CONFIRMADA y pagada',
    tras.rows[0]?.estado === 'CONFIRMADA' && tras.rows[0]?.payment_status === 'paid',
    JSON.stringify(tras.rows[0]));

  // ── FLUJO 3: reprogramación ────────────────────────────────────────────────
  const nueva = new Date(Date.now() + 13 * 86400e3).toISOString();
  const re1 = await fetch(`${BASE}/api/bookings/${a.id}/reschedule`, {
    method: 'PATCH', headers: HC, body: JSON.stringify({ scheduled_at: nueva }),
  });
  check('reprogramación aceptada', re1.status === 200, `HTTP ${re1.status}`);

  const d2 = db(); await d2.connect();
  const re = await d2.query('select scheduled_at, reschedule_count from bookings where id=$1', [a.id]);
  const reOk = Math.abs(new Date(re.rows[0].scheduled_at).getTime() - new Date(nueva).getTime()) < 60000;
  check('la fecha cambió y el contador subió a 1',
    reOk && Number(re.rows[0].reschedule_count) === 1, JSON.stringify(re.rows[0]));

  const re2 = await fetch(`${BASE}/api/bookings/${a.id}/reschedule`, {
    method: 'PATCH', headers: HC, body: JSON.stringify({ scheduled_at: new Date(Date.now() + 15 * 86400e3).toISOString() }),
  });
  check('segunda reprogramación rechazada (409)', re2.status === 409, `HTTP ${re2.status}`);

  // ── FLUJO 4: servicio completado + propina ─────────────────────────────────
  // Se marca COMPLETADA por SQL a propósito: pasar por el OTP acredita la
  // billetera y ese movimiento es inmutable (ledger append-only).
  await d2.query("update bookings set estado='COMPLETADA', completed_at=now() where id=$1", [a.id]);
  await d2.end();

  const prop = await fetch(`${BASE}/api/bookings/${a.id}/tip`, {
    method: 'POST', headers: HC, body: JSON.stringify({ monto: 5000 }),
  });
  const propBody = await prop.json().catch(() => ({}));
  check('propina registrada', prop.status === 200 || prop.status === 201,
    `HTTP ${prop.status} ${propBody.error || ''}`.trim());

  const d3 = db(); await d3.connect();
  const tips = await d3.query('select monto, estado from propinas where booking_id=$1', [a.id]);
  check('la propina queda en base', tips.rows.length === 1, JSON.stringify(tips.rows[0] || null));
  await d3.end();

  // ── FLUJO 5: cancelación (otra cita) ───────────────────────────────────────
  const b = await crearReserva(provider_id, service_id, 17);
  creadas.push(b.id);
  // Sin este control, un fallo al crear la reserva seguía con id undefined y el
  // 400 real se disfrazaba de 500 dentro de Postgres.
  check('reserva para cancelación creada', b.status === 200 && !!b.id, `HTTP ${b.status}`);
  if (!b.id) {
    check('cancelación aceptada', false, 'no se pudo crear la reserva');
    check('la cita queda CANCELADA', false, 'no se pudo crear la reserva');
    return terminar(creadas);
  }

  const lista2 = await (await fetch(`${BASE}/api/bookings/client`, { headers: HC })).json();
  const valorB = Number((lista2.data || []).find((x) => x.id === b.id)?.total_amount || 0);
  await pagarYConfirmar(b.id, valorB, provider_id);

  const canc = await fetch(`${BASE}/api/bookings/${b.id}/cancel`, { method: 'PATCH', headers: HC });
  const cancBody = await canc.json().catch(() => ({}));
  check('cancelación aceptada', canc.status === 200, `HTTP ${canc.status} ${cancBody.error || ''}`.trim());

  const d4 = db(); await d4.connect();
  const cb = await d4.query('select estado from bookings where id=$1', [b.id]);
  check('la cita queda CANCELADA', cb.rows[0]?.estado === 'CANCELADA', cb.rows[0]?.estado);
  await d4.end();

  return terminar(creadas);
})().catch((e) => { console.error('ERR', e.message); process.exit(2); });

async function terminar(creadas) {
  // ── limpieza ───────────────────────────────────────────────────────────────
  const d5 = db(); await d5.connect();
  for (const id of creadas.filter(Boolean)) {
    await d5.query('delete from propinas where booking_id=$1', [id]);
    await d5.query('delete from reviews where booking_id=$1', [id]);
    await d5.query('delete from otp_validaciones where booking_id=$1', [id]);
    await d5.query('delete from wallet_transactions where booking_id=$1', [id]).catch(() => {});
    await d5.query('delete from transactions where booking_id=$1', [id]);
    await d5.query('delete from bookings where id=$1', [id]).catch((e) => console.log('no se pudo borrar', id, e.message.slice(0, 60)));
  }
  const restos = await d5.query('select count(*)::int n from bookings where id = ANY($1::uuid[])', [creadas.filter(Boolean)]);
  await d5.end();

  const fallos = resultados.filter((r) => !r.ok);
  console.log('\n──────────────────────────────');
  console.log(`E2E: ${resultados.length - fallos.length}/${resultados.length} OK`);
  console.log('restos de prueba:', restos.rows[0].n);
  if (fallos.length) {
    console.log('fallos:', fallos.map((f) => f.nombre).join(' | '));
    process.exit(1);
  }
}
