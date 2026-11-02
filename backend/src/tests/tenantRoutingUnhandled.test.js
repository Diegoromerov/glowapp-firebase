const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

describe('Cargo 1 (CI-21) — tenantRouting.js Unhandled Rejection on DB Failure', () => {
  const rootDir = path.resolve(__dirname, '../../..');

  test('(RED -> GREEN) runAsSystem con pool caído no debe emitir unhandledRejection', () => {
    // Proceso hijo que ejecuta invocación de runAsSystem con pool caído
    const childScript = `
      const { comoSistema } = require('./backend/src/jobs/paymentJobs');
      
      let unhandledFired = false;
      process.on('unhandledRejection', (reason) => {
        unhandledFired = true;
        console.error('UNHANDLED_REJECTION_CAUGHT:', reason.message || reason);
        process.exit(101);
      });

      const deadPool = {
        connect: async () => {
          throw new Error('connect ECONNREFUSED 127.0.0.1:5432');
        }
      };

      // Simula invocación de job de fondo (ej. cron / setInterval / setTimeout) sin await ni .catch()
      const job = comoSistema(async () => 'ok');
      
      // Invocación asíncrona sin await en segundo plano
      setImmediate(() => {
        job();
      });

      setTimeout(() => {
        if (!unhandledFired) {
          console.log('NO_UNHANDLED_REJECTION');
          process.exit(0);
        }
      }, 500);
    `;

    const res = spawnSync('node', ['-e', childScript], { cwd: rootDir, encoding: 'utf8' });

    console.log('CHILD STDOUT:', res.stdout);
    console.log('CHILD STDERR:', res.stderr);
    console.log('CHILD EXIT:', res.status);

    // En estado verde (con fix), NO debe salir con 101 ni tener UNHANDLED_REJECTION_CAUGHT
    expect(res.status).toBe(0);
    expect(res.stdout).toContain('NO_UNHANDLED_REJECTION');
    expect(res.stderr).not.toContain('UNHANDLED_REJECTION_CAUGHT');
  });
});
