// Cifra datos de retiro históricos. Ejecutar con la clave nueva ya configurada:
// node backend/scripts/encryptPayoutData.js (desde la carpeta backend)
const { migrationPool } = require('../src/config/db');
const payoutData = require('../src/services/payoutSensitiveDataService');

async function migrate() {
  if (!migrationPool) throw new Error('Configura DATABASE_URL_ADMIN para ejecutar esta migración de datos.');
  const probe = 'payout-key-check';
  if (payoutData.decrypt(payoutData.encrypt(probe)) !== probe) throw new Error('No se pudo validar la clave de cifrado de retiros.');
  const client = await migrationPool.connect();
  let wallets = 0;
  let withdrawals = 0;
  try {
    await client.query('BEGIN');
    const walletRows = await client.query(
      `SELECT provider_id, numero_cuenta, titular_nombre, titular_documento_num,
              cuenta_anterior_numero, cuenta_anterior_titular_nombre, cuenta_anterior_documento_num
         FROM provider_wallet
        WHERE numero_cuenta IS NOT NULL OR titular_nombre IS NOT NULL OR titular_documento_num IS NOT NULL
           OR cuenta_anterior_numero IS NOT NULL OR cuenta_anterior_titular_nombre IS NOT NULL OR cuenta_anterior_documento_num IS NOT NULL
        FOR UPDATE`
    );
    for (const row of walletRows.rows) {
      const fields = ['numero_cuenta', 'titular_nombre', 'titular_documento_num', 'cuenta_anterior_numero', 'cuenta_anterior_titular_nombre', 'cuenta_anterior_documento_num'];
      const values = fields.map((field) => payoutData.encrypt(payoutData.decrypt(row[field])));
      await client.query(
        `UPDATE provider_wallet SET numero_cuenta=$2, titular_nombre=$3, titular_documento_num=$4,
          cuenta_anterior_numero=$5, cuenta_anterior_titular_nombre=$6, cuenta_anterior_documento_num=$7
          WHERE provider_id=$1`, [row.provider_id, ...values]
      );
      wallets++;
    }
    const withdrawalRows = await client.query('SELECT id, numero_cuenta FROM retiros WHERE numero_cuenta IS NOT NULL FOR UPDATE');
    for (const row of withdrawalRows.rows) {
      await client.query('UPDATE retiros SET numero_cuenta=$2 WHERE id=$1', [row.id, payoutData.encrypt(payoutData.decrypt(row.numero_cuenta))]);
      withdrawals++;
    }
    await client.query('COMMIT');
    console.info(`[PAYOUT DATA] Migración completada: ${wallets} wallets y ${withdrawals} retiros procesados; no se imprimieron datos sensibles.`);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    await migrationPool.end();
  }
}

migrate().catch((error) => {
  console.error('[PAYOUT DATA] Migración fallida:', error.message);
  process.exitCode = 1;
});
