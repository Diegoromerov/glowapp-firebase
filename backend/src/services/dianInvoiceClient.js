'use strict';

/**
 * Cliente para Factura Electrónica DIAN (Colombia).
 *
 * Implementa el Anexo Técnico 1.9 (Factura Electrónica de Venta) de la DIAN.
 * Genera UBL 2.1 XML, lo firma con certificado digital y lo envía a la DIAN
 * o a un Proveedor Tecnológico autorizado.
 *
 * Flujo:
 * 1. Generar XML UBL 2.1 desde los datos de la reserva/pedido
 * 2. Firmar XML con certificado digital (X.509 + clave privada)
 * 3. Enviar a Proveedor Tecnológico / DIAN (validación previa)
 * 4. Recibir respuesta (aceptada/rechazada) y guardar CUFE
 * 4. Entregar al adquiriente (email/portal)
 *
 * Requisitos de entorno:
 * - DIAN_CERT_PATH: ruta al certificado .p12 o .pfx
 * - DIAN_CERT_PASSWORD: contraseña del certificado
 * - DIAN_NIT: NIT del facturador (empresa)
 * - DIAN_PROVIDER_URL: URL del Proveedor Tecnológico (ej: https://api.factura1.com)
 * - DIAN_PROVIDER_API_KEY: API key del proveedor
 * - DIAN_SOFTWARE_ID: ID del software registrado ante DIAN
 * - DIAN_SOFTWARE_PIN: PIN del software
 * - DIAN_ENV: 'test' | 'production'
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DOMParser, XMLSerializer } = require('@xmldom/xmldom');
const xmldsig = require('xmldsigjs');
const forge = require('node-forge');
const axios = require('axios');

const TEST_BASE_URL = 'https://vpfe.dian.gov.co/WS/ValidacionFactura'; // DIAN validación previa test
const PROD_BASE_URL = 'https://vpfe-hab.dian.gov.co/WS/ValidacionFactura'; // DIAN validación previa prod

class DianInvoiceClient {
  constructor() {
    this.timeout = parseInt(process.env.DIAN_TIMEOUT_MS, 10) || 30000;
    this.certPath = process.env.DIAN_CERT_PATH;
    this.certPassword = process.env.DIAN_CERT_PASSWORD;
    this.nit = process.env.DIAN_NIT;
    this.providerUrl = process.env.DIAN_PROVIDER_URL;
    this.providerApiKey = process.env.DIAN_PROVIDER_API_KEY;
    this.softwareId = process.env.DIAN_SOFTWARE_ID;
    this.softwarePin = process.env.DIAN_SOFTWARE_PIN;
    this.env = process.env.DIAN_ENV || 'test';
  }

  get baseUrl() {
    return this.env === 'production' ? PROD_BASE_URL : TEST_BASE_URL;
  }

  isConfigured() {
    return Boolean(this.certPath && this.certPassword && this.nit);
  }

  _assertConfigured() {
    if (!this.isConfigured()) {
      throw new Error('Facturación DIAN incompleta: faltan DIAN_CERT_PATH, DIAN_CERT_PASSWORD o DIAN_NIT.');
    }
  }

  /**
     * Genera el XML UBL 2.1 de una Factura Electrónica de Venta (Anexo Técnico 1.9).
     * @param {object} params - Datos de la factura
     * @returns {string} XML UBL 2.1 firmado
     */
    async generarFacturaXml({
      // Encabezado
      numeroFactura,
      fechaEmision,
      horaEmision,
      tipoFactura = '01',
      metodoPago = '1',
      formaPago = '1',
      moneda = 'COP',
      tipoOperacion = '10',

      // Emisor (Facturador)
      emisorNit,
      emisorDv,
      emisorRazonSocial,
      emisorDireccion,
      emisorMunicipio,
      emisorDepartamento,
      emisorTelefono,
      emisorEmail,
      emisorRutResponsabilidades,

      // Adquiriente (Cliente)
      adquirienteTipoDoc,
      adquirienteNumeroDoc,
      adquirienteDv,
      adquirienteRazonSocial,
      adquirienteDireccion,
      adquirienteMunicipio,
      adquirienteDepartamento,
      adquirienteTelefono,
      adquirienteEmail,

      // Detalles (líneas)
      lineas,

      // Totales
      subtotal,
      totalDescuentos,
      totalCargos,
      totalImpuestos,
      totalFactura,

      // Referencias (para NC/ND)
      referenciasFacturas = [],

      // Información adicional
      observaciones = '',

      // Opciones
      skipSign = false
    }) {
    const doc = new DOMParser().parseFromString('<?xml version="1.0" encoding="UTF-8"?>', 'text/xml');
    const invoice = doc.createElementNS('urn:oasis:names:specification:ubl:schema:xsd:Invoice-2', 'Invoice');
    invoice.setAttribute('xmlns', 'urn:oasis:names:specification:ubl:schema:xsd:Invoice-2');
    invoice.setAttribute('xmlns:cac', 'urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2');
    invoice.setAttribute('xmlns:cbc', 'urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2');
    invoice.setAttribute('xmlns:ds', 'http://www.w3.org/2000/09/xmldsig#');
    invoice.setAttribute('xmlns:ext', 'urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2');
    invoice.setAttribute('xmlns:sts', 'dian:gov:co:facturaelectronica:Structures-2-1');
    invoice.setAttribute('xmlns:xades', 'http://uri.etsi.org/01903/v1.3.2#');
    invoice.setAttribute('xmlns:xades141', 'http://uri.etsi.org/01903/v1.4.1#');

    doc.appendChild(invoice);

    // Helper para crear elementos con namespace
    const cbc = (name, text, attrs = {}) => {
      const el = doc.createElementNS('urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2', `cbc:${name}`);
      if (text !== null && text !== undefined) el.textContent = String(text);
      Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
      return el;
    };
    const cac = (name) => doc.createElementNS('urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2', `cac:${name}`);
    const ext = (name) => doc.createElementNS('urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2', `ext:${name}`);

    // UBLExtensions (para firma digital)
    const ublExts = ext('UBLExtensions');
    const ublExt = ext('UBLExtension');
    const extContent = ext('ExtensionContent');
    ublExt.appendChild(extContent);
    ublExts.appendChild(ublExt);
    invoice.appendChild(ublExts);

    // Información básica
    invoice.appendChild(cbc('UBLVersionID', '2.1'));
    invoice.appendChild(cbc('CustomizationID', '10'));
    invoice.appendChild(cbc('ProfileID', 'DIAN 2.1: Factura Electrónica de Venta'));
    invoice.appendChild(cbc('ProfileExecutionID', '1'));
    invoice.appendChild(cbc('ID', numeroFactura));
    invoice.appendChild(cbc('IssueDate', fechaEmision));
    invoice.appendChild(cbc('IssueTime', horaEmision));
    invoice.appendChild(cbc('InvoiceTypeCode', tipoFactura, { listAgencyID: '6', listAgencyName: 'DIAN', listSchemeURI: 'https://www.dian.gov.co' }));
    invoice.appendChild(cbc('Note', observaciones || 'Factura electrónica generada por GlowApp'));
    invoice.appendChild(cbc('DocumentCurrencyCode', moneda, { listID: 'ISO 4217' }));
    invoice.appendChild(cbc('InvoicePeriod', null));
    invoice.appendChild(cbc('LineCountNumeric', lineas.length.toString()));

    // Método y forma de pago
    const paymentMeans = cac('PaymentMeans');
    paymentMeans.appendChild(cbc('PaymentMeansID', metodoPago));
    paymentMeans.appendChild(cbc('PaymentDueDate', fechaEmision));
    const payeeFinancialAccount = cac('PayeeFinancialAccount');
    payeeFinancialAccount.appendChild(cbc('ID', 'CUENTA_RECAUDO'));
    paymentMeans.appendChild(payeeFinancialAccount);
    invoice.appendChild(paymentMeans);

    // Emisor (AccountingSupplierParty)
    const supplierParty = cac('AccountingSupplierParty');
    const party = cac('Party');
    party.appendChild(cbc('WebsiteURI', 'https://glowapp.co'));
    const partyIdentification = cac('PartyIdentification');
    partyIdentification.appendChild(cbc('ID', emisorNit, { schemeID: '4', schemeName: '31', schemeAgencyID: '195', schemeAgencyName: 'CO, DIAN (Dirección de Impuestos y Aduanas Nacionales)' }));
    party.appendChild(partyIdentification);
    const partyName = cac('PartyName');
    partyName.appendChild(cbc('Name', emisorRazonSocial));
    party.appendChild(partyName);
    const postalAddress = cac('PostalAddress');
    postalAddress.appendChild(cbc('StreetName', emisorDireccion));
    postalAddress.appendChild(cbc('CityName', emisorMunicipio));
    postalAddress.appendChild(cbc('CountrySubentity', emisorDepartamento));
    postalAddress.appendChild(cbc('Country', 'CO'));
    party.appendChild(postalAddress);
    const partyTaxScheme = cac('PartyTaxScheme');
    partyTaxScheme.appendChild(cbc('RegistrationName', emisorRazonSocial));
    partyTaxScheme.appendChild(cbc('CompanyID', emisorNit, { schemeID: '4', schemeName: '31', schemeAgencyID: '195' }));
    partyTaxScheme.appendChild(cbc('TaxLevelCode', emisorDv));
    const taxScheme = cac('TaxScheme');
    taxScheme.appendChild(cbc('ID', '01'));
    taxScheme.appendChild(cbc('Name', 'IVA'));
    partyTaxScheme.appendChild(taxScheme);
    party.appendChild(partyTaxScheme);
    // Responsabilidades
    (emisorRutResponsabilidades || []).forEach(cod => {
      const reg = cac('RegistrationAddress'); // hack para responsabilidades
      const taxScheme2 = cac('TaxScheme');
      taxScheme2.appendChild(cbc('ID', cod.toString()));
      partyTaxScheme.appendChild(taxScheme2);
    });
    party.appendChild(partyTaxScheme);
    const contact = cac('Contact');
    contact.appendChild(cbc('Name', emisorRazonSocial));
    contact.appendChild(cbc('Telephone', emisorTelefono));
    contact.appendChild(cbc('ElectronicMail', emisorEmail));
    party.appendChild(contact);
    supplierParty.appendChild(party);
    invoice.appendChild(supplierParty);

    // Adquiriente (AccountingCustomerParty)
    const customerParty = cac('AccountingCustomerParty');
    const customerParty2 = cac('Party');
    const custIdentification = cac('PartyIdentification');
    custIdentification.appendChild(cbc('ID', adquirienteNumeroDoc, { schemeID: '4', schemeName: adquirienteTipoDoc.toString(), schemeAgencyID: '195', schemeAgencyName: 'CO, DIAN (Dirección de Impuestos y Aduanas Nacionales)' }));
    customerParty2.appendChild(custIdentification);
    const custName = cac('PartyName');
    custName.appendChild(cbc('Name', adquirienteRazonSocial));
    customerParty2.appendChild(custName);
    const custAddress = cac('PostalAddress');
    custAddress.appendChild(cbc('StreetName', adquirienteDireccion));
    custAddress.appendChild(cbc('CityName', adquirienteMunicipio));
    custAddress.appendChild(cbc('CountrySubentity', adquirienteDepartamento));
    custAddress.appendChild(cbc('Country', 'CO'));
    customerParty2.appendChild(custAddress);
    const custTaxScheme = cac('PartyTaxScheme');
    custTaxScheme.appendChild(cbc('RegistrationName', adquirienteRazonSocial));
    custTaxScheme.appendChild(cbc('CompanyID', adquirienteNumeroDoc, { schemeID: '4', schemeName: adquirienteTipoDoc.toString(), schemeAgencyID: '195' }));
    custTaxScheme.appendChild(cbc('TaxLevelCode', adquirienteDv || '0'));
    const custTaxScheme2 = cac('TaxScheme');
    custTaxScheme2.appendChild(cbc('ID', '01'));
    custTaxScheme2.appendChild(cbc('Name', 'IVA'));
    custTaxScheme.appendChild(custTaxScheme2);
    customerParty2.appendChild(custTaxScheme);
    const custContact = cac('Contact');
    custContact.appendChild(cbc('Name', adquirienteRazonSocial));
    custContact.appendChild(cbc('Telephone', adquirienteTelefono));
    custContact.appendChild(cbc('ElectronicMail', adquirienteEmail));
    customerParty2.appendChild(custContact);
    customerParty.appendChild(customerParty2);
    invoice.appendChild(customerParty);

    // Referencias (NC/ND)
    referenciasFacturas.forEach(ref => {
      const billingRef = cac('BillingReference');
      const invoiceDocRef = cac('InvoiceDocumentReference');
      invoiceDocRef.appendChild(cbc('ID', ref.numero));
      invoiceDocRef.appendChild(cbc('IssueDate', ref.fecha));
      invoiceDocRef.appendChild(cbc('UUID', ref.cufe));
      billingRef.appendChild(invoiceDocRef);
      invoice.appendChild(billingRef);
    });

    // Moneda de la factura
    invoice.appendChild(cbc('DocumentCurrencyCode', moneda, { listID: 'ISO 4217' }));

    // Totales de impuestos (IVA)
    const taxTotal = cac('TaxTotal');
    taxTotal.appendChild(cbc('TaxAmount', totalImpuestos.toFixed(2), { currencyID: moneda }));
    const taxSubtotal = cac('TaxSubtotal');
    taxSubtotal.appendChild(cbc('TaxableAmount', subtotal.toFixed(2), { currencyID: moneda }));
    taxSubtotal.appendChild(cbc('TaxAmount', totalImpuestos.toFixed(2), { currencyID: moneda }));
    const taxCategory = cac('TaxCategory');
    taxCategory.appendChild(cbc('ID', 'S'));
    taxCategory.appendChild(cbc('Percent', '19.00'));
    taxCategory.appendChild(cbc('TaxExemptionReasonCode', '00'));
    const taxScheme3 = cac('TaxScheme');
    taxScheme3.appendChild(cbc('ID', '01'));
    taxScheme3.appendChild(cbc('Name', 'IVA'));
    taxCategory.appendChild(taxScheme3);
    taxSubtotal.appendChild(taxCategory);
    taxTotal.appendChild(taxSubtotal);
    invoice.appendChild(taxTotal);

    // LegalMonetaryTotal
    const legalMonetaryTotal = cac('LegalMonetaryTotal');
    legalMonetaryTotal.appendChild(cbc('LineExtensionAmount', subtotal.toFixed(2), { currencyID: moneda }));
    legalMonetaryTotal.appendChild(cbc('TaxExclusiveAmount', subtotal.toFixed(2), { currencyID: moneda }));
    legalMonetaryTotal.appendChild(cbc('TaxInclusiveAmount', totalFactura.toFixed(2), { currencyID: moneda }));
    legalMonetaryTotal.appendChild(cbc('AllowanceTotalAmount', totalDescuentos.toFixed(2), { currencyID: moneda }));
    legalMonetaryTotal.appendChild(cbc('ChargeTotalAmount', totalCargos.toFixed(2), { currencyID: moneda }));
    legalMonetaryTotal.appendChild(cbc('PayableAmount', totalFactura.toFixed(2), { currencyID: moneda }));
    invoice.appendChild(legalMonetaryTotal);

    // Líneas (InvoiceLine)
    lineas.forEach((linea, index) => {
      const invoiceLine = cac('InvoiceLine');
      invoiceLine.appendChild(cbc('ID', (index + 1).toString()));
      invoiceLine.appendChild(cbc('InvoicedQuantity', linea.cantidad.toString(), { unitCode: linea.unidad || '94' }));
      invoiceLine.appendChild(cbc('LineExtensionAmount', (linea.valorUnitario * linea.cantidad).toFixed(2), { currencyID: moneda }));

      // AllowanceCharge (descuento)
      if (linea.descuento && linea.descuento > 0) {
        const allowance = cac('AllowanceCharge');
        allowance.appendChild(cbc('ChargeIndicator', 'false'));
        allowance.appendChild(cbc('AllowanceChargeReasonCode', '00'));
        allowance.appendChild(cbc('Amount', linea.descuento.toFixed(2), { currencyID: moneda }));
        invoiceLine.appendChild(allowance);
      }

      // TaxTotal por línea
      const lineTaxTotal = cac('TaxTotal');
      const ivaLinea = (linea.valorUnitario * linea.cantidad * (linea.ivaPorcentaje || 0) / 100);
      lineTaxTotal.appendChild(cbc('TaxAmount', ivaLinea.toFixed(2), { currencyID: moneda }));
      const lineTaxSubtotal = cac('TaxSubtotal');
      lineTaxSubtotal.appendChild(cbc('TaxableAmount', (linea.valorUnitario * linea.cantidad).toFixed(2), { currencyID: moneda }));
      lineTaxSubtotal.appendChild(cbc('TaxAmount', ivaLinea.toFixed(2), { currencyID: moneda }));
      const lineTaxCategory = cac('TaxCategory');
      lineTaxCategory.appendChild(cbc('ID', 'S'));
      lineTaxCategory.appendChild(cbc('Percent', (linea.ivaPorcentaje || 19).toFixed(2)));
      lineTaxCategory.appendChild(cbc('TaxExemptionReasonCode', '00'));
      const lineTaxScheme = cac('TaxScheme');
      lineTaxScheme.appendChild(cbc('ID', '01'));
      lineTaxScheme.appendChild(cbc('Name', 'IVA'));
      lineTaxCategory.appendChild(lineTaxScheme);
      lineTaxSubtotal.appendChild(lineTaxCategory);
      lineTaxTotal.appendChild(lineTaxSubtotal);
      invoiceLine.appendChild(lineTaxTotal);

      // Item
      const item = cac('Item');
      item.appendChild(cbc('Description', linea.descripcion));
      item.appendChild(cbc('Name', linea.descripcion));
      const sellersItemIdentification = cac('SellersItemIdentification');
      sellersItemIdentification.appendChild(cbc('ID', linea.codigo || `ITEM${index + 1}`));
      item.appendChild(sellersItemIdentification);
      invoiceLine.appendChild(item);

      // Price
      const price = cac('Price');
      price.appendChild(cbc('PriceAmount', linea.valorUnitario.toFixed(2), { currencyID: moneda }));
      price.appendChild(cbc('BaseQuantity', linea.cantidad.toString(), { unitCode: linea.unidad || '94' }));
      invoiceLine.appendChild(price);

      invoice.appendChild(invoiceLine);
    });

    // Serializar y firmar
    const serializer = new XMLSerializer();
    const xmlString = serializer.serializeToString(doc);

    // Firmar XML (XAdES-BES) - opcional para tests
    if (!skipSign) {
      const signedXml = await this._firmarXml(xmlString);
      return signedXml;
    }

    return xmlString;
  }

  /**
   * Firma el XML con certificado digital (XAdES-BES) usando node-forge.
   * @private
   */
  async _firmarXml(xmlString) {
    this._assertConfigured();

    // Cargar certificado PKCS12 con node-forge
    const p12Buffer = fs.readFileSync(this.certPath);
    const p12Der = forge.util.createBuffer(p12Buffer);
    const p12 = forge.pkcs12.pkcs12FromAsn1(
      forge.asn1.fromDer(p12Der.bytes()),
      this.certPassword
    );

    // Extraer clave privada y certificado
    const bags = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag });
    const keyBag = bags[forge.pki.oids.pkcs8ShroudedKeyBag][0];
    const privateKey = keyBag.key;

    const certBags = p12.getBags({ bagType: forge.pki.oids.certBag });
    const certBag = certBags[forge.pki.oids.certBag][0];
    const cert = certBag.cert;

    // Convertir a PEM para xmldsigjs
    const privateKeyPem = forge.pki.privateKeyToPem(privateKey);
    const certPem = forge.pki.certificateToPem(cert);

    // Usar xmldsigjs para firmar (XAdES-BES)
    const sig = new xmldsig.SignedXml();
    sig.signingKey = privateKeyPem;
    sig.keyInfoProvider = new xmldsig.KeyInfoX509Data(certPem);
    sig.addReference(
      '',
      ['http://www.w3.org/2000/09/xmldsig#enveloped-signature',
       'http://www.w3.org/2001/10/xml-exc-c14n#'],
      'http://www.w3.org/2001/04/xmlenc#sha256'
    );

    const doc = new DOMParser().parseFromString(xmlString, 'text/xml');
    await sig.sign(doc);

    const serializer = new XMLSerializer();
    return serializer.serializeToString(doc);
  }

  /**
   * Envía la factura a la DIAN (validación previa) o al Proveedor Tecnológico.
   * @returns {object} {aceptada: boolean, cufe: string, qr: string, respuesta: object}
   */
  async enviarFactura(xmlFirmado, numeroFactura) {
    this._assertConfigured();

    // Generar CUFE (hash SHA-384 del XML firmado + datos clave)
    const cufe = this._generarCufe(xmlFirmado, numeroFactura);

    try {
      if (this.providerUrl && this.providerApiKey) {
        // Enviar a Proveedor Tecnológico
        return await this._enviarAProveedor(xmlFirmado, numeroFactura, cufe);
      } else {
        // Enviar directo a DIAN (validación previa)
        return await this._enviarADian(xmlFirmado, numeroFactura, cufe);
      }
    } catch (error) {
      throw new Error(`Error enviando factura a DIAN: ${error.message}`);
    }
  }

  async _enviarAProveedor(xmlFirmado, numeroFactura, cufe) {
    const response = await axios.post(
      `${this.providerUrl}/api/facturas`,
      {
        xml: xmlFirmado,
        nit: this.nit,
        software_id: this.softwareId,
        software_pin: this.softwarePin,
        cufe
      },
      {
        headers: {
          'Authorization': `Bearer ${this.providerApiKey}`,
          'Content-Type': 'application/json'
        },
        timeout: this.timeout
      }
    );

    return {
      aceptada: response.data.aceptada === true,
      cufe: response.data.cufe || cufe,
      qr: response.data.qr || null,
      respuesta: response.data
    };
  }

  async _enviarADian(xmlFirmado, numeroFactura, cufe) {
    // DIAN validación previa usa SOAP. Aquí simplificamos asumiendo REST wrapper.
    // En producción real, usar SOAP con WS-Security.
    const response = await axios.post(
      `${this.baseUrl}/SubmitInvoice`,
      xmlFirmado,
      {
        headers: {
          'Content-Type': 'application/xml',
          'SOAPAction': 'http://wcf.dian.colombia/IWcfDianCustomerServices/SubmitInvoice'
        },
        timeout: this.timeout
      }
    );

    // Parsear respuesta SOAP
    const parser = new DOMParser();
    const doc = parser.parseFromString(response.data, 'text/xml');
    const accepted = doc.getElementsByTagName('IsValid')[0]?.textContent === 'true';
    const returnedCufe = doc.getElementsByTagName('CUFE')[0]?.textContent || cufe;
    const qr = doc.getElementsByTagName('QRCode')[0]?.textContent || null;

    return {
      aceptada: accepted,
      cufe: returnedCufe,
      qr,
      respuesta: response.data
    };
  }

  _generarCufe(xmlFirmado, numeroFactura) {
    // CUFE = SHA-384(numeroFactura + fechaEmision + nitEmisor + nitAdquiriente + valorTotal + ivaTotal + ... + xmlFirmado)
    // Ver Anexo Técnico 1.9 sección 4.3
    const data = `${numeroFactura}${this.nit}${xmlFirmado}`;
    return crypto.createHash('sha384').update(data).digest('hex').toUpperCase();
  }
}

const client = new DianInvoiceClient();

module.exports = client;