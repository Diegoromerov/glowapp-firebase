const path = require('path');

/**
 * ORDEN A · FASE A RONDA 7 — Cargo 2: «el timeout del guardián, probado»
 *
 * `smokeSurfaces.js` ya falla explícito por timeout (líneas 210-214: mensaje + `SIGTERM` + `exit(1)`),
 * pero ese camino NUNCA se había medido: el helper no estaba exportado ni admitía inyección, así que
 * ningún test podía recorrerlo.
 *
 * Este test recorre EL CAMINO REAL del código (la función que arranca el hijo y sondea /api/health),
 * con las dependencias inyectadas para poder hacer que el hijo sea inalcanzable sin depender de la red:
 *  (a) NO cuelga: termina dentro del timeout,
 *  (b) sale ≠0,
 *  (c) MATA el hijo (SIGTERM).
 */
const smoke = require('../../scripts/smokeSurfaces');

function hijoFalso() {
  const registros = { matado: null, señales: [] };
  return {
    registros,
    stdout: { on: () => {} },
    stderr: { on: () => {} },
    kill: (señal) => { registros.matado = señal; registros.señales.push(señal); return true; }
  };
}

describe('Cargo 2 — timeout del guardián de superficies', () => {
  test('(a)(b)(c) hijo que nunca responde ⇒ no cuelga, sale ≠0 y lo mata', async () => {
    const hijo = hijoFalso();
    let codigoSalida = null;
    const inicio = Date.now();

    const resultado = await smoke.startRealServerAndAwaitChecked({
      spawn: () => hijo,
      makeRequest: async () => ({ status: 0, headers: {}, error: 'ECONNREFUSED' }),
      exit: (codigo) => { codigoSalida = codigo; },
      maxWaitMs: 600
    });

    const transcurrido = Date.now() - inicio;
    expect(codigoSalida).toBe(1);                        // (b) ≠0
    expect(hijo.registros.matado).toBe('SIGTERM');       // (c) mata el hijo
    expect(resultado.timedOut).toBe(true);
    expect(transcurrido).toBeLessThan(600 + 2000);       // (a) no cuelga
  }, 20000);

  test('control: si el estado se comprueba, NO mata al hijo ni sale ≠0', async () => {
    const hijo = hijoFalso();
    let salio = false;

    const resultado = await smoke.startRealServerAndAwaitChecked({
      spawn: () => hijo,
      makeRequest: async () => ({
        status: 200,
        headers: {},
        body: { status: 'OK', database: { pgAvailable: true } }
      }),
      exit: () => { salio = true; },
      maxWaitMs: 5000
    });

    expect(salio).toBe(false);
    expect(hijo.registros.matado).toBeNull();
    expect(resultado.healthRes.body.database.pgAvailable).toBe(true);
  }, 20000);

  test('(c bis) el hijo se mata UNA sola vez, con SIGTERM', async () => {
    const hijo = hijoFalso();
    await smoke.startRealServerAndAwaitChecked({
      spawn: () => hijo,
      makeRequest: async () => ({ status: 0, headers: {} }),
      exit: () => {},
      maxWaitMs: 300
    });
    expect(hijo.registros.señales).toEqual(['SIGTERM']);
  }, 20000);
});
