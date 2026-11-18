const mockSystemDb = { query: jest.fn() };
const mockTenantDb = { query: jest.fn() };
const mockPool = { query: jest.fn() };

jest.mock('../src/config/db', () => ({ pool: mockPool, systemPool: {} }));
jest.mock('../src/config/tenantRouting', () => ({
  runAsSystem: (_deps, callback) => callback(mockSystemDb),
  runInTenantTransaction: (_deps, _tenantId, callback) => callback(mockTenantDb)
}));
jest.mock('../src/services/fcmNotificationService', () => ({ sendToUser: jest.fn().mockResolvedValue(true) }));

const express = require('express');
const request = require('supertest');
const enviaWebhook = require('../src/routes/enviaWebhook');
const orderController = require('../src/controllers/orderController');

describe('logística mock E2E — pedido, fulfillment, etiqueta, pickup y entrega', () => {
  let order;
  let shipment;
  let webhookSeen;

  beforeEach(() => {
    order = { id: 'order-1', estado: 'PAGADO' };
    shipment = {
      id: 'shipment-1', pedido_id: order.id, prestador_id: 'provider-1', guia: null,
      estado: 'CREADO', preparacion_estado: 'PENDIENTE', label_pdf_url: null
    };
    webhookSeen = false;
    mockPool.query.mockReset().mockImplementation(async (sql) => {
      if (/FROM municipios_dane/i.test(sql)) {
        return { rows: [{ dane_code: '05001', zona_envio_id: 'zona-1' }] };
      }
      return { rows: [{
        id: 'zona-1', ciudad: 'Medellín', departamento: 'Antioquia', codigo_postal_prefijo: null,
        tarifa_base: '10000', tarifa_por_kg: '400', gratis_desde_monto: null,
        transportadora_default: 'Inter', dias_estimados_min: 1, dias_estimados_max: 3
      }] };
    });
    mockTenantDb.query.mockReset().mockImplementation(async (sql, params) => {
      if (/SELECT \* FROM pedidos_tienda WHERE id = \$1/i.test(sql)) return { rows: [{ ...order }] };
      if (/SELECT cantidad FROM detalles_pedido_tienda/i.test(sql)) return { rows: [{ cantidad: 1 }] };
      if (/UPDATE envios\s+SET preparacion_estado = 'PREPARADO'/i.test(sql)) {
        shipment.preparacion_estado = 'PREPARADO';
        return { rows: [{ id: shipment.id, preparacion_estado: shipment.preparacion_estado }], rowCount: 1 };
      }
      if (/SELECT pt\.\*, e\.id as envio_id/i.test(sql)) {
        return { rows: [{
          ...order,
          envio_id: shipment.id,
          guia: shipment.guia,
          envio_estado: shipment.estado,
          preparacion_estado: shipment.preparacion_estado,
          items_preparados: [{ peso_estimado_kg: 1, cantidad_preparada: 1 }],
          ciudad: 'Medellín',
          departamento: 'Antioquia',
          codigo_postal: '05001',
          destino_ciudad: 'Medellín',
          destino_departamento: 'Antioquia',
          direccion_entrega: 'Calle 1',
          total: 100000
        }] };
      }
      if (/FROM business_profiles bp/i.test(sql)) {
        return { rows: [{
          tipo_via: 'Calle', numero_principal: '1', ciudad: 'Bogotá', departamento: 'Bogotá D.C.',
          codigo_postal: '110111', dane_code: '11001'
        }] };
      }
      if (/FROM municipios_dane/i.test(sql)) {
        return { rows: [{ dane_code: params?.[0] === '11001' ? '11001' : '05001', zona_envio_id: 'zona-1' }] };
      }
      if (/FROM shipping_routing_rules/i.test(sql)) {
        return { rows: [{
          carrier: 'inter', carrier_service_code: 'inter_express', carrier_account_id: 'mock-account-id',
          prioridad: 1, peso_min_kg: 0, peso_max_kg: 50, valor_min_cop: 0,
          valor_max_cop: null, dias_maximos_entrega: 2
        }] };
      }
      if (/UPDATE envios SET\s+guia = \$1/i.test(sql)) {
        [shipment.guia, shipment.label_pdf_url, shipment.label_zpl,
          shipment.carrier_service_code, shipment.transportadora] = params;
        shipment.estado = 'CREADO';
        return { rowCount: 1, rows: [] };
      }
      if (/SELECT e\.\* FROM envios e/i.test(sql)) return { rows: [{ ...shipment }] };
      if (/UPDATE envios SET\s+pickup_scheduled_at/i.test(sql)) {
        shipment.pickup_id = params[3];
        return { rowCount: 1, rows: [] };
      }
      return { rowCount: 1, rows: [] };
    });
    mockSystemDb.query.mockReset().mockImplementation(async (sql, params) => {
      if (/INSERT INTO webhook_events/i.test(sql)) {
        if (webhookSeen) return { rows: [] };
        webhookSeen = true;
        return { rows: [{ id: 'webhook-1' }] };
      }
      if (/SELECT e\.\*, pt\.estado/i.test(sql)) {
        return { rows: [{ ...shipment, pedido_estado: order.estado, comprador_id: 'buyer-1', prestador_comisionado_id: 'provider-1' }] };
      }
      if (/UPDATE envios SET estado = \$1/i.test(sql)) {
        shipment.estado = params[0];
        return { rowCount: 1, rows: [] };
      }
      if (/UPDATE pedidos_tienda(?: pt)?/i.test(sql) && /SET estado = 'ENTREGADO'/i.test(sql)) {
        order.estado = 'ENTREGADO';
        return { rowCount: 1, rows: [] };
      }
      if (/UPDATE webhook_events SET/i.test(sql)) return { rowCount: 1, rows: [] };
      return { rowCount: 1, rows: [] };
    });
  });

  test('mantiene la guía y carrier desde fulfillment hasta webhook entregado, idempotente', async () => {
    const makeResponse = () => ({
      statusCode: 200,
      body: null,
      status(code) { this.statusCode = code; return this; },
      json(body) { this.body = body; return this; }
    });

    const prepareResponse = makeResponse();
    await orderController.prepareOrderItems({
      user: { id: 'provider-1', tenant_id: 'tenant-1' },
      params: { id: order.id },
      body: { items: [{ producto_id: 'product-1', cantidad_preparada: 1 }] }
    }, prepareResponse);
    expect(prepareResponse.statusCode).toBe(200);

    const labelResponse = makeResponse();
    await orderController.generateEnvioLabel({
      user: { id: 'provider-1', tenant_id: 'tenant-1' },
      params: { id: order.id },
      body: { peso_kg: 1.2, valor_declarado_cop: 100000 }
    }, labelResponse);
    expect(labelResponse.statusCode).toBe(200);
    expect(labelResponse.body.data).toMatchObject({ carrier: 'inter', service_code: 'inter_express' });
    expect(shipment.guia).toBe(labelResponse.body.data.tracking_number);

    const pickupResponse = makeResponse();
    await orderController.scheduleEnvioPickup({
      user: { id: 'provider-1', tenant_id: 'tenant-1' },
      params: { id: order.id },
      body: {
        ventana_inicio: '2026-12-01T09:00:00Z',
        ventana_fin: '2026-12-01T12:00:00Z',
        contacto_nombre: 'Proveedor', contacto_telefono: '3000000000'
      }
    }, pickupResponse);
    expect(pickupResponse.statusCode).toBe(200);
    expect(pickupResponse.body.data.carrier).toBe(shipment.transportadora);

    const app = express();
    app.use('/api/webhooks/envia', enviaWebhook);
    const event = {
      event: 'shipment.delivered',
      event_id: 'event-delivered-1',
      data: { tracking_number: shipment.guia, status: 'DELIVERED', timestamp: '2026-12-02T12:00:00Z' }
    };
    const delivered = await request(app).post('/api/webhooks/envia/tracking').send(event);
    expect(delivered.status).toBe(200);
    expect(delivered.body).toEqual({ received: true, processed: true });
    expect(shipment.estado).toBe('ENTREGADO');
    expect(order.estado).toBe('ENTREGADO');

    const duplicate = await request(app).post('/api/webhooks/envia/tracking').send(event);
    expect(duplicate.status).toBe(200);
    expect(duplicate.body.duplicate).toBe(true);
  });
});
