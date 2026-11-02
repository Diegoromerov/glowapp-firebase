'use strict';

/**
 * Tests para el cliente de Factura Electrónica DIAN.
 * Mocks: no requiere certificado real ni conexión a DIAN.
 */

describe('dianInvoiceClient — Factura Electrónica DIAN', () => {
  let dianInvoiceClient;

  beforeEach(() => {
    // Resetear módulos y configurar env ANTES de require
    jest.resetModules();
    process.env.DIAN_CERT_PATH = '/fake/path/cert.p12';
    process.env.DIAN_CERT_PASSWORD = 'test123';
    process.env.DIAN_NIT = '900123456';
    process.env.DIAN_DV = '7';
    process.env.DIAN_RAZON_SOCIAL = 'GlowApp S.A.S.';
    process.env.DIAN_ENV = 'test';
    dianInvoiceClient = require('../services/dianInvoiceClient');
  });

  describe('isConfigured', () => {
    test('retorna true cuando las vars requeridas están presentes', () => {
      expect(dianInvoiceClient.isConfigured()).toBe(true);
    });

    test('retorna false si falta DIAN_CERT_PATH', () => {
      delete process.env.DIAN_CERT_PATH;
      jest.resetModules();
      const client = require('../services/dianInvoiceClient');
      expect(client.isConfigured()).toBe(false);
    });

    test('retorna false si falta DIAN_CERT_PASSWORD', () => {
      delete process.env.DIAN_CERT_PASSWORD;
      jest.resetModules();
      const client = require('../services/dianInvoiceClient');
      expect(client.isConfigured()).toBe(false);
    });

    test('retorna false si falta DIAN_NIT', () => {
      delete process.env.DIAN_NIT;
      jest.resetModules();
      const client = require('../services/dianInvoiceClient');
      expect(client.isConfigured()).toBe(false);
    });
  });

  describe('generarFacturaXml', () => {
    test('genera XML UBL 2.1 válido con estructura esperada', async () => {
      const xml = await dianInvoiceClient.generarFacturaXml({
        numeroFactura: 'FAC-TEST-001',
        fechaEmision: '2026-10-15',
        horaEmision: '10:30:00',
        tipoFactura: '01',
        metodoPago: '1',
        formaPago: '1',
        moneda: 'COP',
        tipoOperacion: '10',

        // Emisor
        emisorNit: '900123456',
        emisorDv: '7',
        emisorRazonSocial: 'GlowApp S.A.S.',
        emisorDireccion: 'Calle 100 # 7-21',
        emisorMunicipio: '11001',
        emisorDepartamento: '11',
        emisorTelefono: '+57 1 234 5678',
        emisorEmail: 'facturacion@glowapp.co',
        emisorRutResponsabilidades: [48],

        // Adquiriente
        adquirienteTipoDoc: 13,
        adquirienteNumeroDoc: '1234567890',
        adquirienteDv: '0',
        adquirienteRazonSocial: 'Juan Pérez',
        adquirienteDireccion: 'Carrera 50 # 20-30',
        adquirienteMunicipio: '11001',
        adquirienteDepartamento: '11',
        adquirienteTelefono: '300 123 4567',
        adquirienteEmail: 'juan@test.co',

        // Líneas
        lineas: [
          {
            cantidad: 1,
            unidad: '94',
            descripcion: 'Corte de cabello',
            valorUnitario: 50000,
            ivaPorcentaje: 19,
            codigo: 'SERV-001'
          }
        ],

        // Totales
        subtotal: 50000,
        totalDescuentos: 0,
        totalCargos: 0,
        totalImpuestos: 9500,
        totalFactura: 59500,

        observaciones: 'Test factura',
        skipSign: true
      });

      // Verificaciones básicas del XML
      expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
      expect(xml).toContain('Invoice');
      expect(xml).toContain('urn:oasis:names:specification:ubl:schema:xsd:Invoice-2');
      expect(xml).toContain('FAC-TEST-001');
      expect(xml).toContain('900123456');
      expect(xml).toContain('GlowApp S.A.S.');
      expect(xml).toContain('Juan Pérez');
      expect(xml).toContain('Corte de cabello');
      expect(xml).toContain('50000');
      expect(xml).toContain('59500');
      expect(xml).toContain('9500');
      // skipSign: true → no hay firma digital
      // expect(xml).toContain('ds:Signature'); // Firma digital presente
    });

    test('incluye múltiples líneas con IVA por línea', async () => {
      const xml = await dianInvoiceClient.generarFacturaXml({
        numeroFactura: 'FAC-TEST-002',
        fechaEmision: '2026-10-15',
        horaEmision: '10:30:00',
        tipoFactura: '01',
        metodoPago: '1',
        formaPago: '1',
        moneda: 'COP',
        tipoOperacion: '10',

        emisorNit: '900123456',
        emisorDv: '7',
        emisorRazonSocial: 'GlowApp S.A.S.',
        emisorDireccion: 'Calle 100 # 7-21',
        emisorMunicipio: '11001',
        emisorDepartamento: '11',
        emisorTelefono: '+57 1 234 5678',
        emisorEmail: 'facturacion@glowapp.co',
        emisorRutResponsabilidades: [48],

        adquirienteTipoDoc: 13,
        adquirienteNumeroDoc: '1234567890',
        adquirienteDv: '0',
        adquirienteRazonSocial: 'Juan Pérez',
        adquirienteDireccion: 'Carrera 50 # 20-30',
        adquirienteMunicipio: '11001',
        adquirienteDepartamento: '11',
        adquirienteTelefono: '300 123 4567',
        adquirienteEmail: 'juan@test.co',

        lineas: [
          { cantidad: 2, unidad: '94', descripcion: 'Corte', valorUnitario: 30000, ivaPorcentaje: 19, codigo: 'S1' },
          { cantidad: 1, unidad: '94', descripcion: 'Tinte', valorUnitario: 40000, ivaPorcentaje: 19, codigo: 'S2' }
        ],

        subtotal: 100000,
        totalDescuentos: 0,
        totalCargos: 0,
        totalImpuestos: 19000,
        totalFactura: 119000,

        observaciones: 'Test multi-linea',
        skipSign: true
      });

      expect(xml).toContain('Corte');
      expect(xml).toContain('Tinte');
      expect(xml).toContain('100000');
      expect(xml).toContain('119000');
    });
  });

  describe('_generarCufe', () => {
    test('genera CUFE consistente (SHA-384 hex uppercase)', () => {
      const xml = '<Invoice>test</Invoice>';
      const numero = 'FAC-001';
      const cufe1 = dianInvoiceClient._generarCufe(xml, numero);
      const cufe2 = dianInvoiceClient._generarCufe(xml, numero);

      expect(cufe1).toBe(cufe2);
      expect(cufe1).toMatch(/^[A-F0-9]{96}$/); // SHA-384 = 96 chars hex
    });
  });
});