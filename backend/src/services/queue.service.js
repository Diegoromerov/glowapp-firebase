// backend/src/services/queue.service.js
const logger = require('../config/logger');
const redisClient = require('../config/redis');

class QueueService {
  constructor() {
    this.inMemoryQueue = [];
    this.isProcessing = false;
  }

  /**
   * Encola una tarea asíncrona para procesamiento en segundo plano
   */
  async enqueue(taskName, taskData, handler) {
    const job = {
      id: 'job_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
      taskName,
      taskData,
      handler,
      createdAt: new Date().toISOString(),
    };

    // 1. Intentar registrar la tarea en Redis si está disponible
    try {
      if (redisClient && redisClient.isOpen) {
        await redisClient.lPush('beauty:queue:jobs', JSON.stringify({ id: job.id, taskName, taskData }));
      }
    } catch (_) {}

    // 2. Agregar a la cola de procesamiento en memoria
    this.inMemoryQueue.push(job);
    logger.info(`📥 [QUEUE SERVICE] Tarea encolada: ${taskName} (ID: ${job.id})`);

    // Iniciar procesamiento en background si no está corriendo
    this.processNext();
    return job.id;
  }

  async processNext() {
    if (this.isProcessing || this.inMemoryQueue.length === 0) return;
    this.isProcessing = true;

    const job = this.inMemoryQueue.shift();
    try {
      logger.info(`⚙️ [QUEUE SERVICE] Ejecutando tarea: ${job.taskName} (ID: ${job.id})`);
      if (typeof job.handler === 'function') {
        await job.handler(job.taskData);
      }
      logger.info(`✅ [QUEUE SERVICE] Tarea completada: ${job.taskName} (ID: ${job.id})`);
    } catch (err) {
      logger.error(`❌ [QUEUE SERVICE] Error procesando tarea ${job.taskName}:`, err.message);
    } finally {
      this.isProcessing = false;
      if (this.inMemoryQueue.length > 0) {
        setImmediate(() => this.processNext());
      }
    }
  }
}

module.exports = new QueueService();
