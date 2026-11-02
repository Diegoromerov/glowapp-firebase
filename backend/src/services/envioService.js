// Cálculo del envío del checkout de tienda.
//
// Política vigente (D-GL-011 v2, aprobada 2026-10-18):
//   · El transporte lo paga el comprador en todas las líneas y canales.
//   · Sobre la tarifa del operador se cobra una retención de gestión de
//     1.000 COP por envío, que queda para la plataforma (D-GL-015).
//   · Envío gratis SOLO por encima del umbral de la zona:
//     300.000 en Bogotá y 480.000 en el resto del país.
//   · La única excepción sin umbral es la entrega en la cita, donde el pedido
//     viaja con el profesional y no hay trayecto de courier.
//
// La tarifa y el umbral viven en `zonas_envio`; este módulo no escribe ninguna
// constante de precio. Antes el checkout cobraba 12.000 fijos sin importar
// zona, peso ni valor del pedido, y las 21 zonas cargadas no se usaban.

const RETENCION_ENVIO = 1000;

// Peso estimado cuando el pedido no lo declara: medio kilo por unidad.
const PESO_POR_UNIDAD_KG = 0.5;
const PESO_MINIMO_KG = 0.5;

const ZONA_COMODIN = 'OTRO';

/** Minúsculas y sin tildes, para comparar nombres de ciudad con direcciones escritas a mano. */
const normalizar = (texto) =>
  (texto || '')
    .toString()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();

/**
 * Resuelve zona, tarifa y envío final de un pedido.
 *
 * @param {object}  opciones
 * @param {object}  opciones.client         Cliente pg dentro de la transacción.
 * @param {string}  [opciones.ciudad]       Ciudad declarada en el checkout.
 * @param {string}  [opciones.direccion]    Dirección de entrega (se usa para inferir la ciudad).
 * @param {number}  [opciones.pesoKg]       Peso declarado del pedido.
 * @param {number}  opciones.subtotal       Valor de la mercancía, sin IVA ni envío.
 * @param {number}  [opciones.unidades]     Total de unidades, para estimar el peso.
 * @param {boolean} [opciones.entregaEnCita] Si el pedido se entrega en la cita.
 */
async function calcularEnvio({
  client,
  ciudad,
  direccion,
  pesoKg,
  subtotal,
  unidades,
  entregaEnCita = false
}) {
  const detalle = {
    zona: null,
    transportadora: null,
    tarifa_operador: 0,
    retencion: 0,
    envio: 0,
    gratis: false,
    motivo: null
  };

  if (entregaEnCita) {
    detalle.motivo = 'entrega_en_cita';
    return detalle;
  }

  const { rows: zonas } = await client.query(
    `SELECT ciudad, departamento, codigo_postal_prefijo, tarifa_base,
            tarifa_por_kg, gratis_desde_monto, transportadora_default
       FROM zonas_envio
      WHERE activa = true
      ORDER BY ciudad;`
  );

  if (zonas.length === 0) {
    throw new Error('No hay zonas de envío activas configuradas');
  }

  const ciudadNormalizada = normalizar(ciudad);
  const direccionNormalizada = normalizar(direccion);

  let zona = null;
  let motivo = null;

  if (ciudadNormalizada) {
    zona = zonas.find((z) => normalizar(z.ciudad) === ciudadNormalizada) || null;
    if (zona) motivo = 'ciudad_declarada';
  }

  if (!zona && direccionNormalizada) {
    zona =
      zonas.find(
        (z) =>
          normalizar(z.ciudad) !== normalizar(ZONA_COMODIN) &&
          normalizar(z.ciudad).length > 3 &&
          direccionNormalizada.includes(normalizar(z.ciudad))
      ) || null;
    if (zona) motivo = 'ciudad_inferida_de_la_direccion';
  }

  if (!zona) {
    zona =
      zonas.find((z) => normalizar(z.ciudad) === normalizar(ZONA_COMODIN)) ||
      zonas[zonas.length - 1];
    motivo = 'zona_comodin';
  }

  const unidadesPedido = Number(unidades) > 0 ? Number(unidades) : 1;
  const peso = Math.max(
    PESO_MINIMO_KG,
    Number(pesoKg) > 0 ? Number(pesoKg) : unidadesPedido * PESO_POR_UNIDAD_KG
  );

  const tarifa = Math.round(
    Number(zona.tarifa_base) + Number(zona.tarifa_por_kg) * peso
  );

  const umbral = Number(zona.gratis_desde_monto) || 0;
  const gratis = umbral > 0 && Number(subtotal) >= umbral;

  detalle.zona = zona.ciudad;
  detalle.transportadora = zona.transportadora_default;
  detalle.tarifa_operador = tarifa;
  detalle.retencion = gratis ? 0 : RETENCION_ENVIO;
  detalle.envio = gratis ? 0 : tarifa + RETENCION_ENVIO;
  detalle.gratis = gratis;
  detalle.motivo = gratis ? 'umbral_de_zona_alcanzado' : motivo;
  detalle.peso_kg = peso;

  return detalle;
}

module.exports = { calcularEnvio, RETENCION_ENVIO };
