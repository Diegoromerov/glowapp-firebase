const crypto = require('crypto');
const { PLAN_CATALOG } = require('../config/saasCatalog');
const wompiClient = require('./wompiClient');
const invoiceService = require('./invoiceService');
const { encryptPaymentSourceId, decryptPaymentSourceId } = require('./wompiBillingCrypto');

const CONSENT_VERSION = 'saas-recurring-v1';
const isEnabled = () => process.env.WOMPI_SAAS_BILLING_ENABLED === 'true';
const isCofEnabled = () => process.env.WOMPI_SAAS_COF_ENABLED === 'true';
const liveBase = () => /production\.wompi\.co/i.test(wompiClient.baseUrl);
const isCheckoutAvailable = () => isEnabled() && isCofEnabled()
  && wompiClient.isConfigured() && Boolean(String(process.env.WOMPI_SAAS_ENCRYPTION_KEY || '').trim())
  && (!liveBase() || (process.env.WOMPI_SAAS_LIVE_BILLING_ENABLED === 'true'
    && process.env.WOMPI_SAAS_LIVE_COF_CONFIRMED === 'true'));

function assertBillingEnabled() {
  if (!isEnabled()) {
    const error = new Error('El checkout SaaS con Wompi está desactivado.');
    error.status = 503;
    throw error;
  }
  if (!isCofEnabled()) {
    const error = new Error('El cobro mensual recurrente COF aún no está habilitado para Wompi SaaS.');
    error.status = 503;
    throw error;
  }
  if (liveBase() && process.env.WOMPI_SAAS_LIVE_BILLING_ENABLED !== 'true') {
    const error = new Error('La facturación Wompi en producción está desactivada.');
    error.status = 503;
    throw error;
  }
  if (liveBase() && isCofEnabled() && process.env.WOMPI_SAAS_LIVE_COF_CONFIRMED !== 'true') {
    const error = new Error('La recurrencia COF no está confirmada para este comercio.');
    error.status = 503;
    throw error;
  }
  if (!wompiClient.isConfigured()) {
    const error = new Error('Wompi no está configurado completamente.');
    error.status = 503;
    throw error;
  }
  if (!String(process.env.WOMPI_SAAS_ENCRYPTION_KEY || '').trim()) {
    const error = new Error('WOMPI_SAAS_ENCRYPTION_KEY es necesaria para proteger la fuente de pago.');
    error.status = 503;
    throw error;
  }
}

function nextPeriod(start = new Date()) {
  const end = new Date(start);
  const day = end.getUTCDate();
  end.setUTCDate(1);
  end.setUTCMonth(end.getUTCMonth() + 1);
  const daysInTargetMonth = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1, 0)).getUTCDate();
  end.setUTCDate(Math.min(day, daysInTargetMonth));
  return { start, end };
}

function getPlanPriceInCents(plan, { allowExistingPlan = false } = {}) {
  const definition = PLAN_CATALOG[plan];
  if (!definition || (!allowExistingPlan && definition.commerciallyAvailable === false) || !Number.isSafeInteger(definition.priceCop) || definition.priceCop <= 0) {
    const error = new Error('El plan no tiene un precio COP habilitado para compra.');
    error.status = 400;
    throw error;
  }
  return definition.priceCop * 100;
}

async function startCheckout(client, { tenantId, userId, userEmail, plan, paymentToken, acceptRecurring, acceptTerms, acceptPersonalData, ip }) {
  assertBillingEnabled();
  if (!acceptRecurring || !acceptTerms || !acceptPersonalData) {
    const error = new Error('Debes aceptar expresamente los términos, el tratamiento de datos y el cobro periódico.');
    error.status = 400;
    throw error;
  }
  if (typeof paymentToken !== 'string' || !/^tok_[A-Za-z0-9_-]+$/.test(paymentToken)) {
    const error = new Error('Token de tarjeta Wompi inválido.');
    error.status = 400;
    throw error;
  }
  if (typeof userEmail !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(userEmail)) {
    const error = new Error('La cuenta debe tener un correo válido para facturación.');
    error.status = 400;
    throw error;
  }
  const acceptance = await wompiClient.getAcceptanceTokens();
  const amount = getPlanPriceInCents(plan);
  const { rows: existing } = await client.query(
    `SELECT id, status, reference FROM saas_billing_attempts
     WHERE tenant_id = $1 AND status IN ('CREATED','PENDING','UNKNOWN') LIMIT 1`, [tenantId]);
  if (existing.length) {
    const error = new Error('Ya hay un pago pendiente o en conciliación. Consulta su estado antes de intentar otro.');
    error.status = 409;
    error.attempt = { id: existing[0].id, status: existing[0].status, reference: existing[0].reference };
    throw error;
  }

  const { rows: currentRows } = await client.query(
    `SELECT * FROM subscriptions WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 1`, [tenantId]);
  const current = currentRows[0] || null;
  const order = ['FREE_TRIAL', 'FREEMIUM', 'BASIC', 'GROWTH', 'PRO', 'ENTERPRISE'];
  if (current && order.indexOf(plan) <= order.indexOf(current.plan)) {
    const error = new Error('El checkout solo permite subir de nivel.');
    error.status = 400;
    throw error;
  }
  const period = nextPeriod();
  const reference = `wompi_saas_${String(tenantId).replace(/[^A-Za-z0-9]/g, '').slice(0, 18)}_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`;
  // Create the reusable source before opening the attempt row; a source alone
  // does not charge the card. This also keeps the DB transaction bounded to one
  // Wompi network call at a time.
  const source = await wompiClient.createPaymentSource({
    customerEmail: userEmail, type: 'CARD', token: paymentToken,
    acceptanceToken: acceptance.acceptanceToken,
    personalDataAuthToken: acceptance.personalDataAuthToken,
  });
  const encryptedSource = encryptPaymentSourceId(source.id);
  const createdAt = new Date();
  const consentIp = typeof ip === 'string' && ip.length < 64 ? ip : null;
  const { rows } = await client.query(
    `INSERT INTO saas_billing_attempts
       (tenant_id, subscription_id, plan, purpose, status, reference, amount_in_cents,
        period_start, period_end, consent_at, consent_user_id, consent_ip, consent_version, billing_email,
        payment_source_ciphertext, payment_source_type)
     VALUES ($1,$2,$3,$4,'CREATED',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'CARD') RETURNING id`,
    [tenantId, current?.id || null, plan, current ? 'PLAN_CHANGE' : 'INITIAL', reference, amount,
      period.start, period.end, createdAt, userId, consentIp, CONSENT_VERSION, userEmail, encryptedSource]);
  const attemptId = rows[0].id;

  try {
    const transaction = await wompiClient.createTransaction({
      amountInCents: amount, currency: 'COP', reference, customerEmail: userEmail,
      acceptanceToken: acceptance.acceptanceToken,
      personalDataAuthToken: acceptance.personalDataAuthToken,
      paymentSourceId: source.id, recurrent: isCofEnabled(), ip: consentIp,
    });
    await client.query(
      `UPDATE saas_billing_attempts SET status='PENDING', wompi_transaction_id=$2,
         payment_source_ciphertext=$3, resolved_at=NULL WHERE id=$1`,
      [attemptId, transaction.id, encryptedSource]);
    return { attemptId, reference, status: transaction.status, message: 'El pago está pendiente de confirmación de Wompi.' };
  } catch (error) {
    // A transport timeout may hide a successful charge. Keep the reference locked
    // for reconciliation; a new checkout must never blindly charge a second time.
    const uncertain = !error.status || error.status >= 500 || /timeout|ECONN|socket|network/i.test(error.message);
    await client.query(
      `UPDATE saas_billing_attempts SET status=$2, error_code=$3, error_message=$4,
         payment_source_ciphertext=CASE WHEN $2='ERROR' THEN NULL ELSE payment_source_ciphertext END,
         resolved_at=CASE WHEN $2='ERROR' THEN NOW() ELSE NULL END WHERE id=$1`,
      [attemptId, uncertain ? 'UNKNOWN' : 'ERROR', error.status ? `WOMPI_${error.status}` : 'WOMPI_UNCERTAIN', String(error.message).slice(0, 500)]);
    throw error;
  }
}

async function processWebhook(client, event, checksum) {
  if (event?.event !== 'transaction.updated') return { ignored: true };
  const verified = wompiClient.verifyEventChecksum(event, checksum);
  if (!verified.valid) {
    const error = new Error(`Checksum Wompi inválido: ${verified.reason}`);
    error.status = 401;
    throw error;
  }
  const payload = event?.data?.transaction;
  const reference = String(payload?.reference || '');
  if (!reference.startsWith('wompi_saas_')) return { ignored: true };
  const { rows } = await client.query(
    `SELECT * FROM saas_billing_attempts WHERE reference=$1 FOR UPDATE`, [reference]);
  const attempt = rows[0];
  if (!attempt) return { ignored: true, missing: true };
  if (['APPROVED', 'DECLINED', 'ERROR'].includes(attempt.status)) return { duplicate: true };

  // The signed event locates the attempt; the authenticated Wompi API response
  // is the source of truth for amount, currency, reference and final status.
  const authoritative = await wompiClient.getTransaction(payload.id);
  if (authoritative.reference !== attempt.reference || authoritative.amountInCents !== attempt.amount_in_cents || authoritative.currency !== 'COP') {
    const error = new Error('Los datos de la transacción Wompi no coinciden con el intento SaaS.');
    error.status = 409;
    throw error;
  }
  const status = String(authoritative.status || '').toUpperCase();
  const cardBrand = String(authoritative.paymentMethodExtra?.brand || '').toUpperCase();
  const cardLastFour = /^\d{4}$/.test(String(authoritative.paymentMethodExtra?.last_four || ''))
    ? String(authoritative.paymentMethodExtra.last_four) : null;
  const cardSupportsCof = ['VISA', 'MASTERCARD'].includes(cardBrand);
  if (status === 'PENDING') {
    await client.query(`UPDATE saas_billing_attempts SET status='PENDING', wompi_transaction_id=$2 WHERE id=$1`, [attempt.id, authoritative.id]);
    return { pending: true };
  }
  if (status !== 'APPROVED') {
    const finalStatus = ['DECLINED', 'VOIDED'].includes(status) ? 'DECLINED' : 'ERROR';
    await client.query(
      `UPDATE saas_billing_attempts SET status=$2, wompi_transaction_id=$3,
         error_code=$4, error_message=$5, payment_source_ciphertext=NULL, resolved_at=NOW() WHERE id=$1`,
      [attempt.id, finalStatus, authoritative.id, status, String(authoritative.statusMessage || '').slice(0, 500)]);
    if (attempt.purpose === 'RENEWAL') {
      await client.query(`UPDATE subscriptions SET status='past_due', billing_retry_count=billing_retry_count+1,
        billing_next_retry_at=NOW()+INTERVAL '2 days' WHERE id=$1`, [attempt.subscription_id]);
    }
    return { declined: true };
  }

  await client.query(
    `UPDATE saas_billing_attempts SET status='APPROVED', wompi_transaction_id=$2,
       card_brand=$3,card_last_four=$4,payment_source_ciphertext=NULL,resolved_at=NOW() WHERE id=$1`,
    [attempt.id, authoritative.id, cardBrand || null, cardLastFour]);
  const sourceCiphertext = isCofEnabled() && cardSupportsCof ? attempt.payment_source_ciphertext : null;
  const cancelAtPeriodEnd = !sourceCiphertext;
  const existingSub = (await client.query(
    `SELECT id FROM subscriptions WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 1 FOR UPDATE`, [attempt.tenant_id])).rows[0];
  const { rows: subRows } = existingSub ? await client.query(
    `UPDATE subscriptions SET plan=$2,status='active',current_period_start=$3,current_period_end=$4,
       cancel_at_period_end=$5,billing_provider='wompi',billing_email=$6,billing_consent_at=$7,
       billing_consent_user_id=$8,billing_consent_ip=$9,billing_consent_version=$10,
       wompi_payment_source_ciphertext=$11,wompi_payment_source_type=CASE WHEN $11 IS NULL THEN NULL ELSE 'CARD' END,
       wompi_card_brand=$12,wompi_card_last_four=$13,billing_retry_count=0,
       billing_next_retry_at=NULL,updated_at=NOW() WHERE id=$1 RETURNING *`,
    [existingSub.id, attempt.plan, attempt.period_start, attempt.period_end, cancelAtPeriodEnd, attempt.billing_email,
      attempt.consent_at, attempt.consent_user_id, attempt.consent_ip, attempt.consent_version, sourceCiphertext, cardBrand || null, cardLastFour]
  ) : await client.query(
    `INSERT INTO subscriptions (tenant_id, plan, status, current_period_start, current_period_end,
       cancel_at_period_end, metadata, billing_provider, billing_email, billing_consent_at,
       billing_consent_user_id, billing_consent_ip, billing_consent_version,
       wompi_payment_source_ciphertext, wompi_payment_source_type, billing_retry_count,wompi_card_brand,wompi_card_last_four)
     VALUES ($1,$2,'active',$3,$4,$5,'{}'::jsonb,'wompi',$6,$7,$8,$9,$10,$11,$12,0,$13,$14) RETURNING *`,
    [attempt.tenant_id, attempt.plan, attempt.period_start, attempt.period_end, cancelAtPeriodEnd,
      attempt.billing_email || null, attempt.consent_at, attempt.consent_user_id, attempt.consent_ip,
      attempt.consent_version, sourceCiphertext, sourceCiphertext ? 'CARD' : null, cardBrand || null, cardLastFour]);
  const subscription = subRows[0];
  await client.query(`UPDATE business_profiles SET saas_plan=$1,updated_at=NOW() WHERE id=$2`, [attempt.plan, attempt.tenant_id]);
  await invoiceService.createInvoiceFromSubscription(client, subscription, {
    id: authoritative.id, amount_in_cents: authoritative.amountInCents,
    currency: 'COP', status: 'APPROVED',
  }, 'wompi');
  return { approved: true, tenantId: attempt.tenant_id };
}

async function cancelSubscription(client, tenantId, atPeriodEnd = true) {
  const { rows } = await client.query(
    `SELECT * FROM subscriptions WHERE tenant_id=$1 AND billing_provider='wompi'
       AND status IN ('active','past_due') ORDER BY created_at DESC LIMIT 1 FOR UPDATE`, [tenantId]);
  const subscription = rows[0];
  if (!subscription) return null;
  if (atPeriodEnd) {
    const { rows: updated } = await client.query(
      `UPDATE subscriptions SET cancel_at_period_end=TRUE, updated_at=NOW() WHERE id=$1 RETURNING *`, [subscription.id]);
    return updated[0];
  }
  const { rows: updated } = await client.query(
    `UPDATE subscriptions SET status='canceled', canceled_at=NOW(), cancel_at_period_end=FALSE,
       plan='FREEMIUM', wompi_payment_source_ciphertext=NULL, updated_at=NOW() WHERE id=$1 RETURNING *`, [subscription.id]);
  return updated[0];
}

async function renewDueSubscriptions(client) {
  assertBillingEnabled();
  await client.query(
    `UPDATE subscriptions SET status='canceled',plan='FREEMIUM',wompi_payment_source_ciphertext=NULL,
       updated_at=NOW() WHERE billing_provider='wompi' AND status IN ('active','past_due')
       AND cancel_at_period_end=TRUE AND current_period_end <= NOW()`);
  await client.query(
    `UPDATE business_profiles bp SET saas_plan='FREEMIUM',updated_at=NOW()
       WHERE EXISTS (SELECT 1 FROM subscriptions s WHERE s.tenant_id=bp.id AND s.billing_provider='wompi'
         AND s.status='canceled' AND s.plan='FREEMIUM' AND s.cancel_at_period_end=TRUE AND s.current_period_end <= NOW())`);
  await client.query(
    `UPDATE subscriptions SET status='canceled',plan='FREEMIUM',wompi_payment_source_ciphertext=NULL,
       updated_at=NOW() WHERE billing_provider='wompi' AND status='past_due'
       AND billing_retry_count >= 3 AND current_period_end <= NOW()-INTERVAL '14 days'`);
  await client.query(
    `UPDATE business_profiles bp SET saas_plan='FREEMIUM',updated_at=NOW()
       WHERE EXISTS (SELECT 1 FROM subscriptions s WHERE s.tenant_id=bp.id AND s.billing_provider='wompi'
         AND s.status='canceled' AND s.plan='FREEMIUM' AND s.billing_retry_count >= 3
         AND s.current_period_end <= NOW()-INTERVAL '14 days')`);
  if (!isCofEnabled()) return { processed: 0, skipped: 'WOMPI_SAAS_COF_ENABLED is disabled' };
  const { rows } = await client.query(
    `SELECT * FROM subscriptions WHERE billing_provider='wompi' AND status IN ('active','past_due')
       AND cancel_at_period_end=FALSE AND current_period_end <= NOW()
       AND billing_email IS NOT NULL
       AND wompi_payment_source_ciphertext IS NOT NULL
       AND wompi_card_brand IN ('VISA','MASTERCARD')
       AND (billing_next_retry_at IS NULL OR billing_next_retry_at <= NOW())
       AND billing_retry_count < 3 ORDER BY current_period_end LIMIT 1 FOR UPDATE SKIP LOCKED`);
  let processed = 0;
  for (const sub of rows) {
    const amount = getPlanPriceInCents(sub.plan, { allowExistingPlan: true });
    const period = nextPeriod(new Date(sub.current_period_end));
    const reference = `wompi_saas_${String(sub.tenant_id).replace(/[^A-Za-z0-9]/g, '').slice(0, 18)}_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`;
    const acceptance = await wompiClient.getAcceptanceTokens();
    const sourceId = decryptPaymentSourceId(sub.wompi_payment_source_ciphertext);
    const { rows: inserted } = await client.query(
      `INSERT INTO saas_billing_attempts (tenant_id,subscription_id,plan,purpose,status,reference,
         amount_in_cents,period_start,period_end,payment_source_ciphertext,payment_source_type,
         consent_at,consent_user_id,consent_ip,consent_version,billing_email)
       VALUES ($1,$2,$3,'RENEWAL','CREATED',$4,$5,$6,$7,$8,'CARD',$9,$10,$11,$12,$13)
       ON CONFLICT DO NOTHING RETURNING *`,
      [sub.tenant_id, sub.id, sub.plan, reference, amount, period.start, period.end,
        sub.wompi_payment_source_ciphertext, 'CARD', sub.billing_consent_at, sub.billing_consent_user_id,
        sub.billing_consent_ip, sub.billing_consent_version, sub.billing_email]);
    if (!inserted.length) continue;
    const attempt = inserted[0];
    try {
      await client.query(`UPDATE saas_billing_attempts SET updated_at=NOW() WHERE id=$1`, [attempt.id]);
      const transaction = await wompiClient.createTransaction({
        amountInCents: amount, currency: 'COP', reference, customerEmail: sub.billing_email,
        acceptanceToken: acceptance.acceptanceToken, personalDataAuthToken: acceptance.personalDataAuthToken,
        paymentSourceId: sourceId, recurrent: true,
      });
      await client.query(`UPDATE saas_billing_attempts SET status='PENDING',wompi_transaction_id=$2 WHERE id=$1`, [attempt.id, transaction.id]);
      processed++;
    } catch (error) {
      const uncertain = !error.status || error.status >= 500 || /timeout|ECONN|socket|network/i.test(error.message);
      await client.query(
        `UPDATE saas_billing_attempts SET status=$2,error_code=$3,error_message=$4,
           resolved_at=CASE WHEN $2='ERROR' THEN NOW() ELSE NULL END WHERE id=$1`,
        [attempt.id, uncertain ? 'UNKNOWN' : 'ERROR', error.status ? `WOMPI_${error.status}` : 'WOMPI_UNCERTAIN', String(error.message).slice(0, 500)]);
      if (!uncertain) {
        await client.query(
          `UPDATE subscriptions SET status='past_due',billing_retry_count=billing_retry_count+1,
             billing_next_retry_at=NOW()+INTERVAL '2 days' WHERE id=$1`, [sub.id]);
      }
    }
  }
  return { processed };
}

module.exports = {
  CONSENT_VERSION, isEnabled, isCheckoutAvailable, isCofEnabled, getPlanPriceInCents,
  startCheckout, processWebhook, cancelSubscription, renewDueSubscriptions,
};
