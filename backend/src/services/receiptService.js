// backend/src/services/receiptService.js
//
// Ítem 31: recibo de una cita pagada. Una sola fuente de verdad para el HTML,
// de modo que el recibo que ve el usuario y el que se manda por correo digan
// exactamente lo mismo.
//
// Los importes vienen CONGELADOS en la reserva (subtotal_base, iva_valor,
// tarifa_iva_aplicada): el recibo reproduce lo causado ese día, no lo que
// resultaría si el prestador cambiara de condición después.

const MONEDA = 'COP';

function dinero(valor) {
  const n = Number(valor);
  if (!Number.isFinite(n)) return '—';
  return '$' + n.toLocaleString('es-CO', { maximumFractionDigits: 0 });
}

function fecha(valor) {
  if (!valor) return '—';
  const d = new Date(valor);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('es-CO', {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone: 'America/Bogota',
  });
}

const ESTADOS = {
  paid: 'Pagado',
  pending: 'Pendiente de pago',
  failed: 'Pago fallido',
  refunded: 'Reembolsado',
};

/**
 * Construye el recibo de una reserva.
 *
 * @param {Object} reserva  fila con los datos de la cita ya resueltos
 * @returns {{asunto: string, html: string, texto: string}}
 */
function construirRecibo(reserva) {
  const {
    id,
    cliente,
    prestador,
    servicio,
    fechaCita,
    valorBruto,
    subtotalBase,
    ivaValor,
    tarifaIva,
    propina,
    metodoPago,
    paymentStatus,
    estado,
  } = reserva;

  const bruto = Number(valorBruto) || 0;
  const base = subtotalBase !== null && subtotalBase !== undefined
    ? Number(subtotalBase)
    : bruto - (Number(ivaValor) || 0);
  const iva = Number(ivaValor) || 0;
  const tarifa = Number(tarifaIva) || 0;
  const propi = Number(propina) || 0;
  const total = bruto + propi;
  const referencia = String(id || '').slice(0, 8).toUpperCase();
  const asunto = `Recibo de tu cita ${referencia} · GlowApp`;

  const filas = [
    ['Servicio', servicio || '—'],
    ['Prestador', prestador || '—'],
    ['Fecha y hora', fecha(fechaCita)],
    ['Medio de pago', metodoPago || 'Wompi'],
    ['Estado del pago', ESTADOS[paymentStatus] || paymentStatus || '—'],
    ['Estado de la cita', estado || '—'],
  ];

  const importes = [
    ['Subtotal (base gravable)', dinero(base)],
    ...(iva > 0
      ? [[`IVA ${(tarifa ? tarifa * 100 : 19).toFixed(0)}% (incluido)`, dinero(iva)]]
      : [['IVA', 'No aplica']]),
    ...(propi > 0 ? [['Propina', dinero(propi)]] : []),
    ['Total pagado', dinero(total)],
  ];

  const html = `<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${asunto}</title>
<style>
  body { margin:0; background:#FDFBF7; color:#1F1A15;
         font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif; }
  main { max-width:640px; margin:0 auto; padding:32px 22px 56px; }
  .marca { font-size:12px; letter-spacing:2px; text-transform:uppercase; color:#8A6A2F; font-weight:700; }
  h1 { font-family:Georgia,serif; font-size:24px; margin:8px 0 4px; }
  .ref { color:#6B6158; font-size:13px; }
  table { width:100%; border-collapse:collapse; margin:22px 0; }
  th, td { text-align:left; padding:9px 0; border-bottom:1px solid #EFE8DE; font-size:14px; }
  th { color:#6B6158; font-weight:600; width:52%; }
  td.total { font-weight:700; font-size:16px; }
  .pie { margin-top:26px; font-size:12px; color:#8C7E74; line-height:1.6; }
  @media print { body { background:#fff; } main { padding:0; } }
</style></head>
<body><main>
  <div class="marca">GlowApp</div>
  <h1>Recibo de tu cita</h1>
  <div class="ref">Referencia ${referencia} · ${fecha(fechaCita)}</div>

  <table>
    <tbody>
      ${filas.map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join('\n      ')}
    </tbody>
  </table>

  <table>
    <tbody>
      ${importes
        .map(([k, v], i) =>
          `<tr><th>${k}</th><td class="${i === importes.length - 1 ? 'total' : ''}">${v}</td></tr>`)
        .join('\n      ')}
    </tbody>
  </table>

  <p class="pie">
    Importes en ${MONEDA}. El IVA se muestra discriminado porque el precio al
    consumidor ya lo incluía; no se suma aparte. Este recibo no sustituye a la
    factura electrónica cuando el prestador esté obligado a emitirla.<br>
    Cliente: ${cliente || '—'} · Dudas: soporte@glowapp.co
  </p>
</main></body></html>`;

  const texto = [
    `Recibo de tu cita ${referencia}`,
    '',
    ...filas.map(([k, v]) => `${k}: ${v}`),
    '',
    ...importes.map(([k, v]) => `${k}: ${v}`),
    '',
    'Importes en COP. El IVA ya estaba incluido en el precio.',
    'Dudas: soporte@glowapp.co',
  ].join('\n');

  return { asunto, html, texto };
}

module.exports = { construirRecibo };
