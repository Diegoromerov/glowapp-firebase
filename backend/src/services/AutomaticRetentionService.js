// src/services/AutomaticRetentionService.js
const { Pool } = require('pg');
require('dotenv').config();
const { pool } = require('../config/db');
const crypto = require('crypto');

class AutomaticRetentionService {
  constructor() {
    this.pool = pool;
  }

  /**
   * Run retention policies for configured data types.
   * @param {Object} options
   * @param {boolean} options.dryRun - If true, only counts records that would be affected.
   * @returns {Promise<Object>} Counts of affected records per table.
   */
  async runRetention({ dryRun = true } = {}) {
    // Safety guard: check if retention is enabled via environment variable
    const retentionEnabled = process.env.RETENTION_ENABLED === 'true';
    const nodeEnv = process.env.NODE_ENV || 'development';
    const maxRowsPerRun = parseInt(process.env.MAX_ROWS_PER_RUN) || 1000;
    const dryRunEnv = process.env.RETENTION_DRY_RUN === 'true';
    let effectiveDryRun = dryRun || dryRunEnv;

    // If not enabled and not forced dry-run via env, we can still run if dryRun option is true?
    // According to safety guard, if RETENTION_ENABLED is not true, we should not perform modifications.
    // We allow dry-run regardless.
    // If not enabled and not forced dry-run via env, we can still run if dryRun option is true?
    // According to safety guard, if RETENTION_ENABLED is not true, we should not perform modifications.
    // We allow dry-run regardless.
    if (!retentionEnabled) {
      console.log('[RETENTION] Retention is disabled via RETENTION_ENABLED. Skipping modifications.');
      effectiveDryRun = true;
    }

    // Generate an execution ID for audit trail
    const executionId = crypto.randomUUID();
    const startedAt = new Date();

    // Advisory lock to prevent concurrent executions
    const lockId = 123456; // Arbitrary lock ID for retention job
    let lockObtained = false;
    let client;

    try {
      client = await this.pool.connect();
      // Try to obtain advisory lock with timeout (we'll use a simple attempt; pg_advisory_xact_lock is automatic until end of transaction)
      // We'll use pg_try_advisory_lock which returns boolean immediately.
      const lockResult = await client.query('SELECT pg_try_advisory_lock($1) AS obtained', [lockId]);
      lockObtained = lockResult.rows[0].obtained;
      if (!lockObtained) {
        console.log(`[RETENTION] Could not obtain advisory lock (${lockId}). Another instance may be running.`);
        // We still want to run dry-run? Probably not, because we cannot guarantee exclusivity.
        // We'll return early with empty results.
        await client.release();
        return { executionId, lockObtained: false, message: 'Lock not obtained' };
      }
      // Lock obtained, we can proceed. We'll keep the client for the duration and release at the end.

      const results = {};
      const auditDetails = []; // To collect detail records for audit trail

      // Helper to run a query and return count or execute, with LIMIT for safety
      // Helper to run a query and return count or execute, with LIMIT for safety
      const runQuery = async (sql, values = [], isModify = false) => {
        // Apply LIMIT if we have maxRowsPerRun and not in dry-run
        let finalSql = sql;
        if (!effectiveDryRun && maxRowsPerRun > 0) {
          // Remove any trailing semicolon to avoid syntax errors
          finalSql = sql.trim().replace(/;$/g, '');
          if (!isModify) {
            // For SELECT queries, we can simply append LIMIT
            finalSql = finalSql + ' LIMIT $1';
          } else {
            // For modification queries (DELETE/UPDATE), we need to use a subquery to limit the rows
            // We assume the SQL is either DELETE FROM table WHERE condition or UPDATE table SET ... WHERE condition
            let isDelete = false;
            let isUpdate = false;
            let tableName = '';
            let condition = '';
            let setClause = '';

            if (finalSql.toUpperCase().startsWith('DELETE FROM')) {
              isDelete = true;
              // Extract table name and condition: DELETE FROM table WHERE condition
              const match = finalSql.match(/DELETE FROM\s+(\w+)\s+WHERE\s+(.*)/i);
              if (match) {
                tableName = match[1];
                condition = match[2];
              }
            } else if (finalSql.toUpperCase().startsWith('UPDATE')) {
              isUpdate = true;
              // Extract table name, SET clause, and condition: UPDATE table SET ... WHERE condition
              const match = finalSql.match(/UPDATE\s+(\w+)\s+SET\s+(.*)\s+WHERE\s+(.*)/i);
              if (match) {
                tableName = match[1];
                setClause = match[2]; // the SET ... part
                condition = match[3]; // the WHERE condition
              }
            }

            if (!tableName) {
              throw new Error('Could not determine table name for modification query');
            }

            // If no condition, we should not proceed (safety)
            if (!condition) {
              throw new Error('Modification query must have a WHERE condition for safety');
            }

            // Build the limited IDs query
            const limitedSql = `SELECT id FROM ${tableName} WHERE ${condition} LIMIT $1`;
            // Build the modification query
            if (isDelete) {
              finalSql = `WITH limited AS (${limitedSql}) DELETE FROM ${tableName} WHERE id IN (SELECT id FROM limited)`;
            } else if (isUpdate) {
              finalSql = `WITH limited AS (${limitedSql}) UPDATE ${tableName} SET ${setClause} WHERE id IN (SELECT id FROM limited)`;
            }
          }
          values = [...values, maxRowsPerRun]; // The LIMIT value
        }
        console.log('runQuery: finalSql:', finalSql);
        console.log('runQuery: values:', values);
        const res = await client.query(finalSql, values);
        // For modify operations, res.rowCount is the number of rows affected.
        // For select, we want res.rows.length (or res.rowCount if it's a count query).
        if (isModify) {
          return res.rowCount || 0;
        } else {
          // For select queries that return a count (like SELECT COUNT(*)), res.rowCount is 1 and res.rows[0] contains the count.
          // For select queries that return rows, we want the number of rows.
          if (res.rows.length === 1 && res.rows[0].count !== undefined) {
            return parseInt(res.rows[0].count);
          }
          return res.rows.length;
        }
      };
      // 1. imagenes_biometricas_originales (user_photos) - delete after 24h
      try {
        const sqlCount = effectiveDryRun
          ? `SELECT COUNT(*) FROM user_photos WHERE created_at < NOW() - INTERVAL '24 hours'`
          : ``;
        const sqlDelete = effectiveDryRun
          ? ``
          : `DELETE FROM user_photos WHERE created_at < NOW() - INTERVAL '24 hours'`;
        const count = effectiveDryRun
          ? await runQuery(sqlCount)
          : await runQuery(sqlDelete, [], true);
        results.user_photos = count;
        auditDetails.push({
          category: 'user_photos',
          operation: effectiveDryRun ? 'DRY-RUN' : 'DELETE',
          evaluatedCount: count,
          affectedCount: effectiveDryRun ? 0 : count,
          errorMessage: null
        });
        console.log(`[RETENTION] ${effectiveDryRun ? 'DRY-RUN' : 'EXEC'} user_photos: ${count} records ${effectiveDryRun ? 'would be' : 'were'} deleted (older than 24h)`);
      } catch (err) {
        console.error('[RETENTION] Error processing user_photos:', err.message);
        results.user_photos = err.message;
        auditDetails.push({
          category: 'user_photos',
          operation: effectiveDryRun ? 'DRY-RUN' : 'DELETE',
          evaluatedCount: 0,
          affectedCount: 0,
          errorMessage: err.message
        });
      }

      // 2. historial_biometrico (biometric_history) - REMOVED per D1 to protect face_scores and hands_diagnosis
      // Intentionally left blank.

      // 3. analytics_identificables (analytics_events with user_id) - anonymize after 30d (set user_id to NULL)
      try {
        const sqlCount = effectiveDryRun
          ? `SELECT COUNT(*) FROM analytics_events WHERE user_id IS NOT NULL AND occurred_at < NOW() - INTERVAL '30 days'`
          : ``;
        const sqlUpdate = effectiveDryRun
          ? ``
          : `UPDATE analytics_events SET user_id = NULL WHERE user_id IS NOT NULL AND occurred_at < NOW() - INTERVAL '30 days'`;
        const count = effectiveDryRun
          ? await runQuery(sqlCount)
          : await runQuery(sqlUpdate, [], true);
        results.analytics_events_identifiable = count;
        auditDetails.push({
          category: 'analytics_events_identifiable',
          operation: effectiveDryRun ? 'DRY-RUN' : 'ANONYMIZE',
          evaluatedCount: count,
          affectedCount: effectiveDryRun ? 0 : count,
          errorMessage: null
        });
        console.log(`[RETENTION] ${effectiveDryRun ? 'DRY-RUN' : 'EXEC'} analytics_events (identifiable): ${count} records ${effectiveDryRun ? 'would be' : 'were'} anonymized (user_id set NULL, older than 30d)`);
      } catch (err) {
        console.error('[RETENTION] Error processing analytics_events (identifiable):', err.message);
        results.analytics_events_identifiable = err.message;
        auditDetails.push({
          category: 'analytics_events_identifiable',
          operation: effectiveDryRun ? 'DRY-RUN' : 'ANONYMIZE',
          evaluatedCount: 0,
          affectedCount: 0,
          errorMessage: err.message
        });
      }

      // 4. analytics_no_identificables (analytics_events without user_id) - anonymize after 90d (no-op, but we count for consistency)
      try {
        const sqlCount = effectiveDryRun
          ? `SELECT COUNT(*) FROM analytics_events WHERE user_id IS NULL AND occurred_at < NOW() - INTERVAL '90 days'`
          : ``;
        const sqlUpdate = effectiveDryRun
          ? ``
          : `UPDATE analytics_events SET user_id = NULL WHERE user_id IS NULL AND occurred_at < NOW() - INTERVAL '90 days'`;
        const count = effectiveDryRun
          ? await runQuery(sqlCount)
          : await runQuery(sqlUpdate, [], true);
        results.analytics_events_non_identifiable = count;
        auditDetails.push({
          category: 'analytics_events_non_identifiable',
          operation: effectiveDryRun ? 'DRY-RUN' : 'ANONYMIZE',
          evaluatedCount: count,
          affectedCount: effectiveDryRun ? 0 : count,
          errorMessage: null
        });
        console.log(`[RETENTION] ${effectiveDryRun ? 'DRY-RUN' : 'EXEC'} analytics_events (non-identifiable): ${count} records ${effectiveDryRun ? 'would be' : 'were'} anonymized (user_id already NULL, older than 90d)`);
      } catch (err) {
        console.error('[RETENTION] Error processing analytics_events (non-identifiable):', err.message);
        results.analytics_events_non_identifiable = err.message;
        auditDetails.push({
          category: 'analytics_events_non_identifiable',
          operation: effectiveDryRun ? 'DRY-RUN' : 'ANONYMIZE',
          evaluatedCount: 0,
          affectedCount: 0,
          errorMessage: err.message
        });
      }

      // 5. biometric_access_log - anonymize after 365d (set user_id to NULL)
      try {
        const sqlCount = effectiveDryRun
          ? `SELECT COUNT(*) FROM biometric_access_log WHERE accessed_at < NOW() - INTERVAL '365 days'`
          : ``;
        const sqlUpdate = effectiveDryRun
          ? ``
          : `UPDATE biometric_access_log SET user_id = NULL WHERE accessed_at < NOW() - INTERVAL '365 days'`;
        const count = effectiveDryRun
          ? await runQuery(sqlCount)
          : await runQuery(sqlUpdate, [], true);
        results.biometric_access_log = count;
        auditDetails.push({
          category: 'biometric_access_log',
          operation: effectiveDryRun ? 'DRY-RUN' : 'ANONYMIZE',
          evaluatedCount: count,
          affectedCount: effectiveDryRun ? 0 : count,
          errorMessage: null
        });
        console.log(`[RETENTION] ${effectiveDryRun ? 'DRY-RUN' : 'EXEC'} biometric_access_log: ${count} records ${effectiveDryRun ? 'would be' : 'were'} anonymized (user_id set NULL, older than 365d)`);
      } catch (err) {
        console.error('[RETENTION] Error processing biometric_access_log:', err.message);
        results.biometric_access_log = err.message;
        auditDetails.push({
          category: 'biometric_access_log',
          operation: effectiveDryRun ? 'DRY-RUN' : 'ANONYMIZE',
          evaluatedCount: 0,
          affectedCount: 0,
          errorMessage: err.message
        });
      }

      // 6. auditoria_consentimiento_biometrico - anonymize after 365d (set user_id to NULL)
      try {
        const sqlCount = effectiveDryRun
          ? `SELECT COUNT(*) FROM auditoria_consentimiento_biometrico WHERE fecha_registro < NOW() - INTERVAL '365 days'`
          : ``;
        const sqlUpdate = effectiveDryRun
          ? ``
          : `UPDATE auditoria_consentimiento_biometrico SET user_id = NULL WHERE fecha_registro < NOW() - INTERVAL '365 days'`;
        const count = effectiveDryRun
          ? await runQuery(sqlCount)
          : await runQuery(sqlUpdate, [], true);
        results.auditoria_consentimiento_biometrico = count;
        auditDetails.push({
          category: 'auditoria_consentimiento_biometrico',
          operation: effectiveDryRun ? 'DRY-RUN' : 'ANONYMIZE',
          evaluatedCount: count,
          affectedCount: effectiveDryRun ? 0 : count,
          errorMessage: null
        });
        console.log(`[RETENTION] ${effectiveDryRun ? 'DRY-RUN' : 'EXEC'} auditoria_consentimiento_biometrico: ${count} records ${effectiveDryRun ? 'would be' : 'were'} anonymized (user_id set NULL, older than 365d)`);
      } catch (err) {
        console.error('[RETENTION] Error processing auditoria_consentimiento_biometrico:', err.message);
        results.auditoria_consentimiento_biometrico = err.message;
        auditDetails.push({
          category: 'auditoria_consentimiento_biometrico',
          operation: effectiveDryRun ? 'DRY-RUN' : 'ANONYMIZE',
          evaluatedCount: 0,
          affectedCount: 0,
          errorMessage: err.message
        });
      }

      // 7. logs_debug_operacionales - delete after 30d
      try {
        const sqlCount = effectiveDryRun
          ? `SELECT COUNT(*) FROM logs_debug_operacionales WHERE creado_en < NOW() - INTERVAL '30 days'`
          : ``;
        const sqlDelete = effectiveDryRun
          ? ``
          : `DELETE FROM logs_debug_operacionales WHERE creado_en < NOW() - INTERVAL '30 days'`;
        const count = effectiveDryRun
          ? await runQuery(sqlCount)
          : await runQuery(sqlDelete, [], true);
        results.logs_debug_operacionales = count;
        auditDetails.push({
          category: 'logs_debug_operacionales',
          operation: effectiveDryRun ? 'DRY-RUN' : 'DELETE',
          evaluatedCount: count,
          affectedCount: effectiveDryRun ? 0 : count,
          errorMessage: null
        });
        console.log(`[RETENTION] ${effectiveDryRun ? 'DRY-RUN' : 'EXEC'} logs_debug_operacionales: ${count} records ${effectiveDryRun ? 'would be' : 'were'} deleted (older than 30d)`);
      } catch (err) {
        console.error('[RETENTION] Error processing logs_debug_operacionales:', err.message);
        results.logs_debug_operacionales = err.message;
        auditDetails.push({
          category: 'logs_debug_operacionales',
          operation: effectiveDryRun ? 'DRY-RUN' : 'DELETE',
          evaluatedCount: 0,
          affectedCount: 0,
          errorMessage: err.message
        });
      }

      // 8. beauty_knowledge_embeddings: soft delete expired records
      try {
        const sqlCount = effectiveDryRun
          ? `SELECT COUNT(*) FROM beauty_knowledge_embeddings WHERE expires_at IS NOT NULL AND expires_at < NOW() AND deleted_at IS NULL AND id NOT IN (SELECT knowledge_id FROM legal_holds WHERE status = 'ACTIVE')`
          : ``;
        const sqlUpdate = effectiveDryRun
          ? ``
          : `UPDATE beauty_knowledge_embeddings SET deleted_at = NOW() WHERE expires_at IS NOT NULL AND expires_at < NOW() AND deleted_at IS NULL AND id NOT IN (SELECT knowledge_id FROM legal_holds WHERE status = 'ACTIVE')`;
        const count = effectiveDryRun
          ? await runQuery(sqlCount)
          : await runQuery(sqlUpdate, [], true);
        results.beauty_knowledge_embeddings_soft_delete = count;
        auditDetails.push({
          category: 'beauty_knowledge_embeddings',
          operation: effectiveDryRun ? 'DRY-RUN' : 'SOFT_DELETE',
          evaluatedCount: count,
          affectedCount: effectiveDryRun ? 0 : count,
          errorMessage: null
        });
        console.log(`[RETENTION] ${effectiveDryRun ? 'DRY-RUN' : 'EXEC'} beauty_knowledge_embeddings (soft delete): ${count} records ${effectiveDryRun ? 'would be' : 'were'} soft-deleted (expired)`);
      } catch (err) {
        console.error('[RETENTION] Error processing beauty_knowledge_embeddings (soft delete):', err.message);
        results.beauty_knowledge_embeddings_soft_delete = err.message;
        auditDetails.push({
          category: 'beauty_knowledge_embeddings',
          operation: effectiveDryRun ? 'DRY-RUN' : 'SOFT_DELETE',
          evaluatedCount: 0,
          affectedCount: 0,
          errorMessage: err.message
        });
      }

      // 9. beauty_knowledge_embeddings: purge soft-deleted records older than grace period
      try {
        const gracePeriodDays = parseInt(process.env.BEAUTY_KNOWLEDGE_GRACE_PERIOD_DAYS) || 30;
        const sqlCount = effectiveDryRun
          ? `SELECT COUNT(*) FROM beauty_knowledge_embeddings WHERE deleted_at IS NOT NULL AND deleted_at < NOW() - INTERVAL '${gracePeriodDays} days' AND id NOT IN (SELECT knowledge_id FROM legal_holds WHERE status = 'ACTIVE')`
          : ``;
        const sqlDelete = effectiveDryRun
          ? ``
          : `DELETE FROM beauty_knowledge_embeddings WHERE deleted_at IS NOT NULL AND deleted_at < NOW() - INTERVAL '${gracePeriodDays} days' AND id NOT IN (SELECT knowledge_id FROM legal_holds WHERE status = 'ACTIVE')`;
        const count = effectiveDryRun
          ? await runQuery(sqlCount)
          : await runQuery(sqlDelete, [], true);
        results.beauty_knowledge_embeddings_purge = count;
        auditDetails.push({
          category: 'beauty_knowledge_embeddings',
          operation: effectiveDryRun ? 'DRY-RUN' : 'PURGE',
          evaluatedCount: count,
          affectedCount: effectiveDryRun ? 0 : count,
          errorMessage: null
        });
        console.log(`[RETENTION] ${effectiveDryRun ? 'DRY-RUN' : 'EXEC'} beauty_knowledge_embeddings (purge): ${count} records ${effectiveDryRun ? 'would be' : 'were'} purged (soft-deleted older than ${gracePeriodDays} days)`);
      } catch (err) {
        console.error('[RETENTION] Error processing beauty_knowledge_embeddings (purge):', err.message);
        results.beauty_knowledge_embeddings_purge = err.message;
        auditDetails.push({
          category: 'beauty_knowledge_embeddings',
          operation: effectiveDryRun ? 'DRY-RUN' : 'PURGE',
          evaluatedCount: 0,
          affectedCount: 0,
          errorMessage: err.message
        });
      }

      // Insert audit trail
      try {
        const totalEvaluated = Object.values(results).reduce((sum, val) => {
          return sum + (typeof val === 'number' ? val : 0);
        }, 0);
        const totalAffected = Object.values(results).reduce((sum, val) => {
          return sum + (typeof val === 'number' && !effectiveDryRun ? val : 0);
        }, 0);
        const status = effectiveDryRun ? 'SUCCESS' :
          Object.values(results).some(v => typeof v === 'string') ? 'PARTIAL_ERROR' : 'SUCCESS';

        // Insert main audit log
        await client.query(
          `INSERT INTO retention_audit_log (execution_id, started_at, finished_at, status, total_evaluated, total_affected) `
          + `VALUES ($1, $2, $3, $4, $5, $6)`,
          [executionId, startedAt, new Date(), status, totalEvaluated, totalAffected]
        );

        // Insert detail records
        for (const detail of auditDetails) {
          await client.query(
            `INSERT INTO retention_audit_log_detail (log_id, category, operation, evaluated_count, affected_count, error_message) `
            + `SELECT id, $2, $3, $4, $5, $6 FROM retention_audit_log WHERE execution_id = $1`,
            [executionId, detail.category, detail.operation, detail.evaluatedCount, detail.affectedCount, detail.errorMessage]
          );
        }
      } catch (auditErr) {
        console.error('[RETENTION] Error writing audit trail:', auditErr.message);
        // We don't want to fail the whole job because of audit failure, but we log it.
      }

      // Release the advisory lock at the end of the transaction (by committing or ending the connection)
      // We'll release the lock explicitly and then release the client.
      await client.query('SELECT pg_advisory_unlock($1)', [lockId]);
      await client.release();

      return results;
    } catch (err) {
      console.error('[RETENTION] Fatal error in runRetention:', err.message);
      if (client) {
        try {
          // Try to release lock if we obtained it
          if (lockObtained) {
            await client.query('SELECT pg_advisory_unlock($1)', [lockId]);
          }
          await client.release();
        } catch (unlockErr) {
          console.error('[RETENTION] Error releasing lock/client:', unlockErr.message);
        }
      }
      throw err;
    }
  }
}

module.exports = AutomaticRetentionService;