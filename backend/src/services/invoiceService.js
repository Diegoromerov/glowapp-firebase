// backend/src/services/invoiceService.js
const { pool } = require('../config/db');
const fs = require('fs');
const path = require('path');

// PDFKit import opcional - si no está instalado, usa fallback simple
let PDFDocument;
try {
  PDFDocument = require('pdfkit');
} catch (e) {
  PDFDocument = null;
  console.warn('[invoiceService] pdfkit no instalado, usando fallback HTML');
}

/**
 * Genera número de factura secuencial por tenant
 */
async function generateInvoiceNumber(client, tenantId) {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  
  // Buscar último número para este tenant en el mes
  const query = `
    SELECT invoice_number FROM invoices
    WHERE tenant_id = $1
      AND invoice_number LIKE $2
    ORDER BY invoice_number DESC
    LIMIT 1;
  `;
  const pattern = `INV-${year}${month}-%`;
  const { rows } = await client.query(query, [tenantId, pattern]);
  
  let sequence = 1;
  if (rows.length > 0) {
    const lastNum = rows[0].invoice_number;
    const lastSeq = parseInt(lastNum.split('-').pop(), 10);
    sequence = lastSeq + 1;
  }
  
  return `INV-${year}${month}-${String(sequence).padStart(4, '0')}`;
}

/**
 * Obtiene datos del tenant para factura
 */
async function getTenantInvoiceData(client, tenantId) {
  const query = `
    SELECT bp.*, u.email as owner_email
    FROM business_profiles bp
    LEFT JOIN usuarios u ON u.id = bp.provider_id
    WHERE bp.id = $1;
  `;
  const { rows } = await client.query(query, [tenantId]);
  return rows[0] || null;
}

/**
 * Crea factura desde suscripción (mensual/prorrateo)
 */
async function createInvoiceFromSubscription(clientOrNull, subscription, stripeInvoice = null) {
  const client = clientOrNull || await pool.connect();
  const shouldRelease = !clientOrNull;
  
  try {
    if (!clientOrNull) await client.query('BEGIN');

    const tenantId = subscription.tenant_id;
    const tenant = await getTenantInvoiceData(client, tenantId);
    if (!tenant) throw new Error(`Tenant ${tenantId} no encontrado`);

    const invoiceNumber = await generateInvoiceNumber(client, tenantId);
    
    // Calcular monto
    let amount = 0;
    let currency = 'COP';
    let description = `Suscripción ${subscription.plan} - Período ${formatDate(subscription.current_period_start)} a ${formatDate(subscription.current_period_end)}`;

    if (stripeInvoice) {
      // Desde webhook Stripe
      amount = stripeInvoice.amount_paid / 100; // centavos a COP/USD
      currency = stripeInvoice.currency.toUpperCase();
    } else {
      // Desde plan en BD
      amount = getPlanPrice(subscription.plan, currency);
    }

    const taxRate = 0.19; // IVA Colombia 19%
    const subtotal = amount / (1 + taxRate);
    const tax = amount - subtotal;

    const periodStart = subscription.current_period_start;
    const periodEnd = subscription.current_period_end;
    const dueDate = new Date(periodEnd);
    dueDate.setDate(dueDate.getDate() + 5); // 5 días de gracia

    // Insertar factura
    const insertQuery = `
      INSERT INTO invoices (
        tenant_id, invoice_number, stripe_invoice_id, wompi_invoice_id,
        status, currency, subtotal, tax, total, amount_paid,
        period_start, period_end, due_date, paid_at,
        billing_name, billing_email, billing_address, billing_tax_id,
        items, metadata
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
      RETURNING *;
    `;

    const stripeInvoiceId = subscription.stripe_subscription_id ? `stripe_${subscription.stripe_subscription_id}` : null;
    const wompiInvoiceId = subscription.wompi_subscription_id ? `wompi_${subscription.wompi_subscription_id}` : null;
    const status = stripeInvoice?.status === 'paid' ? 'paid' : 'pending';

    const items = [{
      description,
      quantity: 1,
      unit_price: subtotal,
      tax_rate: taxRate,
      total: amount
    }];

    const result = await client.query(insertQuery, [
      tenantId,
      invoiceNumber,
      stripeInvoiceId,
      wompiInvoiceId,
      status,
      currency,
      Math.round(subtotal * 100) / 100,
      Math.round(tax * 100) / 100,
      Math.round(amount * 100) / 100,
      status === 'paid' ? Math.round(amount * 100) / 100 : 0,
      periodStart,
      periodEnd,
      dueDate,
      status === 'paid' ? new Date() : null,
      tenant.name,
      tenant.owner_email || tenant.email,
      tenant.address || '',
      tenant.tax_id || '',
      JSON.stringify(items),
      JSON.stringify({ plan: subscription.plan, source: 'subscription' })
    ]);

    const invoice = result.rows[0];

    // Generar PDF
    await generateInvoicePDF(invoice, tenant);

    if (!clientOrNull) await client.query('COMMIT');
    return invoice;

  } catch (error) {
    if (!clientOrNull) await client.query('ROLLBACK');
    console.error('[invoiceService] Error creating invoice:', error.message);
    throw error;
  } finally {
    if (shouldRelease) client.release();
  }
}

/**
 * Crea factura de prorrateo (upgrade mid-cycle)
 */
async function createProrationInvoice(client, newSubscription, oldPlan, newPlan) {
  const tenantId = newSubscription.tenant_id;
  const invoiceNumber = await generateInvoiceNumber(client, tenantId);
  
  // Calcular diferencia de precio prorrateada
  const oldPrice = getPlanPrice(oldPlan, newSubscription.currency || 'COP');
  const newPrice = getPlanPrice(newPlan, newSubscription.currency || 'COP');
  const daysRemaining = calculateDaysRemaining(newSubscription.current_period_end);
  const prorationFactor = daysRemaining / 30; // asumiendo mes de 30 días
  const proratedAmount = (newPrice - oldPrice) * prorationFactor;
  
  if (proratedAmount <= 0) return null; // no facturar downgrade mid-cycle

  const tenant = await getTenantInvoiceData(client, tenantId);
  const currency = newSubscription.currency || 'COP';
  const taxRate = currency === 'COP' ? 0.19 : 0;
  const subtotal = proratedAmount / (1 + taxRate);
  const tax = proratedAmount - subtotal;

  const insertQuery = `
    INSERT INTO invoices (
      tenant_id, invoice_number, stripe_invoice_id, wompi_invoice_id,
      status, currency, subtotal, tax, total, amount_paid,
      period_start, period_end, due_date,
      billing_name, billing_email, billing_address, billing_tax_id,
      items, metadata
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
    RETURNING *;
  `;

  const description = `Prorrateo upgrade ${oldPlan} → ${newPlan} (${daysRemaining} días restantes)`;
  const items = [{
    description,
    quantity: 1,
    unit_price: subtotal,
    tax_rate: taxRate,
    total: proratedAmount
  }];

  const result = await client.query(insertQuery, [
    tenantId,
    invoiceNumber,
    null, null,
    'pending',
    currency,
    Math.round(subtotal * 100) / 100,
    Math.round(tax * 100) / 100,
    Math.round(proratedAmount * 100) / 100,
    0,
    new Date(),
    newSubscription.current_period_end,
    new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
    tenant.name,
    tenant.owner_email,
    tenant.address || '',
    tenant.tax_id || '',
    JSON.stringify(items),
    JSON.stringify({ type: 'proration', oldPlan, newPlan, daysRemaining })
  ]);

  const invoice = result.rows[0];
  await generateInvoicePDF(invoice, tenant);
  return invoice;
}

/**
 * Genera PDF de factura (usa pdfkit si disponible, sino HTML)
 */
async function generateInvoicePDF(invoice, tenant) {
  const outputDir = path.join(__dirname, '../../invoices');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  const outputPath = path.join(outputDir, `${invoice.invoice_number}.pdf`);

  if (PDFDocument) {
    return await generatePDFWithKit(invoice, tenant, outputPath);
  } else {
    return await generatePDFHtml(invoice, tenant, outputPath);
  }
}

/**
 * PDF con pdfkit (calidad profesional)
 */
function generatePDFWithKit(invoice, tenant, outputPath) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    const stream = fs.createWriteStream(outputPath);
    doc.pipe(stream);

    // Header
    doc.fontSize(24).font('Helvetica-Bold').text('GLOWAPP', { align: 'left' });
    doc.fontSize(10).font('Helvetica').text('Factura de Venta', { align: 'left' });
    doc.moveDown();

    // Info factura
    doc.fontSize(10);
    doc.text(`Número: ${invoice.invoice_number}`);
    doc.text(`Fecha: ${formatDate(invoice.created_at)}`);
    doc.text(`Período: ${formatDate(invoice.period_start)} - ${formatDate(invoice.period_end)}`);
    doc.text(`Vence: ${formatDate(invoice.due_date)}`);
    doc.text(`Estado: ${invoice.status.toUpperCase()}`);
    doc.moveDown();

    // Cliente
    doc.font('Helvetica-Bold').text('Facturar a:');
    doc.font('Helvetica').text(tenant.name);
    doc.text(tenant.owner_email);
    if (tenant.address) doc.text(tenant.address);
    if (tenant.tax_id) doc.text(`NIT: ${tenant.tax_id}`);
    doc.moveDown();

    // Tabla items
    doc.font('Helvetica-Bold');
    const colX = [50, 150, 350, 420, 500];
    doc.text('Descripción', colX[0], doc.y);
    doc.text('Cant.', colX[1], doc.y);
    doc.text('Precio Unit.', colX[2], doc.y);
    doc.text('IVA', colX[3], doc.y);
    doc.text('Total', colX[4], doc.y);
    doc.moveDown(0.5);

    doc.font('Helvetica');
    const items = typeof invoice.items === 'string' ? JSON.parse(invoice.items) : invoice.items;
    items.forEach(item => {
      doc.text(item.description.substring(0, 50), colX[0], doc.y);
      doc.text(item.quantity.toString(), colX[1], doc.y);
      doc.text(formatCurrency(item.unit_price, invoice.currency), colX[2], doc.y);
      doc.text(`${(item.tax_rate * 100).toFixed(0)}%`, colX[3], doc.y);
      doc.text(formatCurrency(item.total, invoice.currency), colX[4], doc.y);
      doc.moveDown(0.5);
    });

    doc.moveDown();
    // Totales
    doc.font('Helvetica-Bold');
    doc.text(`Subtotal: ${formatCurrency(invoice.subtotal, invoice.currency)}`, { align: 'right' });
    doc.text(`IVA (${(taxRate * 100).toFixed(0)}%): ${formatCurrency(invoice.tax, invoice.currency)}`, { align: 'right' });
    doc.fontSize(14).text(`TOTAL: ${formatCurrency(invoice.total, invoice.currency)}`, { align: 'right' });

    doc.end();

    stream.on('finish', () => resolve(outputPath));
    stream.on('error', reject);
  });
}

/**
 * Fallback: HTML simple convertido a PDF via puppeteer (si disponible) o guardado como .html
 */
async function generatePDFHtml(invoice, tenant, outputPath) {
  const items = typeof invoice.items === 'string' ? JSON.parse(invoice.items) : invoice.items;
  const taxRate = invoice.currency === 'COP' ? 0.19 : 0;

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: DejaVu Sans, Arial, sans-serif; margin: 40px; color: #111; }
    .header { display: flex; justify-content: space-between; margin-bottom: 30px; }
    .company h1 { margin: 0; font-size: 28px; color: #2563eb; }
    .invoice-info { text-align: right; }
    .section { margin-bottom: 20px; }
    .label { font-weight: bold; color: #374151; }
    table { width: 100%; border-collapse: collapse; margin-top: 10px; }
    th, td { border: 1px solid #e5e7eb; padding: 8px 12px; text-align: left; }
    th { background: #f3f4f6; font-weight: 600; }
    .totals { width: 300px; margin-left: auto; }
    .totals tr td:last-child { text-align: right; font-weight: bold; }
    .total-row td { font-size: 14px; background: #fef3c7; }
  </style>
</head>
<body>
  <div class="header">
    <div class="company">
      <h1>GLOWAPP</h1>
      <p>Plataforma de Gestión para Negocios de Belleza</p>
    </div>
    <div class="invoice-info">
      <p class="label">FACTURA DE VENTA</p>
      <p><span class="label">Número:</span> ${invoice.invoice_number}</p>
      <p><span class="label">Fecha:</span> ${formatDate(invoice.created_at)}</p>
      <p><span class="label">Período:</span> ${formatDate(invoice.period_start)} - ${formatDate(invoice.period_end)}</p>
      <p><span class="label">Vence:</span> ${formatDate(invoice.due_date)}</p>
      <p><span class="label">Estado:</span> ${invoice.status.toUpperCase()}</p>
    </div>
  </div>

  <div class="section">
    <p class="label">Facturar a:</p>
    <p>${tenant.name}</p>
    <p>${tenant.owner_email}</p>
    ${tenant.address ? `<p>${tenant.address}</p>` : ''}
    ${tenant.tax_id ? `<p>NIT: ${tenant.tax_id}</p>` : ''}
  </div>

  <table>
    <thead>
      <tr>
        <th>Descripción</th>
        <th style="width:60px;">Cant.</th>
        <th style="width:100px;">Precio Unit.</th>
        <th style="width:60px;">IVA</th>
        <th style="width:100px;">Total</th>
      </tr>
    </thead>
    <tbody>
      ${items.map(item => `
        <tr>
          <td>${item.description}</td>
          <td>${item.quantity}</td>
          <td>${formatCurrency(item.unit_price, invoice.currency)}</td>
          <td>${(item.tax_rate * 100).toFixed(0)}%</td>
          <td>${formatCurrency(item.total, invoice.currency)}</td>
        </tr>
      `).join('')}
    </tbody>
  </table>

  <table class="totals">
    <tr><td>Subtotal</td><td>${formatCurrency(invoice.subtotal, invoice.currency)}</td></tr>
    <tr><td>IVA (${(taxRate * 100).toFixed(0)}%)</td><td>${formatCurrency(invoice.tax, invoice.currency)}</td></tr>
    <tr class="total-row"><td>TOTAL</td><td>${formatCurrency(invoice.total, invoice.currency)}</td></tr>
  </table>
</body>
</html>
  `;

  const htmlPath = outputPath.replace('.pdf', '.html');
  fs.writeFileSync(htmlPath, html);
  console.log(`[invoiceService] Factura HTML guardada en ${htmlPath} (pdfkit no disponible)`);
  return htmlPath;
}

/**
 * Obtiene facturas de un tenant
 */
async function getInvoicesByTenant(tenantId, { limit = 50, offset = 0, status } = {}) {
  let query = `
    SELECT * FROM invoices
    WHERE tenant_id = $1
  `;
  const params = [tenantId];
  
  if (status) {
    query += ` AND status = $${params.length + 1}`;
    params.push(status);
  }
  
  query += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
  params.push(limit, offset);

  const { rows } = await pool.query(query, params);
  return rows;
}

/**
 * Marca factura como pagada (desde webhook)
 */
async function markInvoicePaid(invoiceId, paymentData = {}) {
  const query = `
    UPDATE invoices
    SET status = 'paid', amount_paid = $2, paid_at = NOW(), metadata = metadata || $3::jsonb
    WHERE id = $1
    RETURNING *;
  `;
  const { rows } = await pool.query(query, [
    invoiceId,
    paymentData.amount || 0,
    JSON.stringify({ payment_method: paymentData.method, transaction_id: paymentData.transactionId })
  ]);
  return rows[0];
}

/**
 * Precios de planes (COP mensuales)
 */
function getPlanPrice(plan, currency = 'COP') {
  const pricesCOP = {
    FREE_TRIAL: 0,
    FREEMIUM: 0,
    BASIC: 99000,
    PRO: 249000,
    ENTERPRISE: 599000
  };
  const pricesUSD = {
    FREE_TRIAL: 0,
    FREEMIUM: 0,
    BASIC: 25,
    PRO: 65,
    ENTERPRISE: 150
  };
  return currency === 'USD' ? (pricesUSD[plan] || 0) : (pricesCOP[plan] || 0);
}

function calculateDaysRemaining(periodEnd) {
  const end = new Date(periodEnd);
  const now = new Date();
  const diff = end - now;
  return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
}

function formatDate(date) {
  if (!date) return '';
  const d = new Date(date);
  return d.toLocaleDateString('es-CO', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

function formatCurrency(amount, currency) {
  if (currency === 'USD') {
    return `$${amount.toFixed(2)} USD`;
  }
  return `$${Math.round(amount).toLocaleString('es-CO')} COP`;
}

module.exports = {
  createInvoiceFromSubscription,
  createProrationInvoice,
  getInvoicesByTenant,
  markInvoicePaid,
  generateInvoicePDF,
  getPlanPrice
};