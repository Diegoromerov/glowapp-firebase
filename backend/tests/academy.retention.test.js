// backend/tests/academy.retention.test.js
// La app promete por escrito (consentimiento Ley 1581) eliminar las evidencias
// biométricas "una vez cumplida su finalidad". Hasta la auditoría 2026-09-22 no
// existía ningún proceso que lo hiciera: estos tests fijan el cálculo de la
// retención y que el borrado conserve la constancia y el consentimiento.
jest.mock('../src/config/db', () => ({ pool: { query: jest.fn() } }));

const { fechaLimite, mesesDeRetencion, purgar } = require('../scripts/purgeAcademyEvidence');

describe('retención de evidencias de la Academia', () => {
  test('12 meses por defecto y valores inválidos caen al default', () => {
    const original = process.env.ACADEMY_RETENTION_MONTHS;
    delete process.env.ACADEMY_RETENTION_MONTHS;
    expect(mesesDeRetencion()).toBe(12);
    expect(mesesDeRetencion('6')).toBe(6);
    expect(mesesDeRetencion('0')).toBe(12);
    expect(mesesDeRetencion('no-numero')).toBe(12);
    if (original === undefined) delete process.env.ACADEMY_RETENTION_MONTHS;
    else process.env.ACADEMY_RETENTION_MONTHS = original;
  });

  test('la fecha de corte retrocede los meses pedidos', () => {
    const ahora = new Date('2026-09-22T12:00:00Z');
    expect(fechaLimite(12, ahora).toISOString().slice(0, 10)).toBe('2025-09-22');
    expect(fechaLimite(6, ahora).toISOString().slice(0, 10)).toBe('2026-03-22');
  });

  test('en simulación no escribe nada', async () => {
    const client = { query: jest.fn().mockResolvedValue({ rows: [{ total: 3 }], rowCount: 3 }) };
    const resultado = await purgar({ aplicar: false, meses: 12, client });

    expect(resultado).toEqual({ purgadas: 0, candidatas: 3 });
    expect(client.query).toHaveBeenCalledTimes(1);
  });

  test('al aplicar limpia foto y respuestas pero solo de las antiguas', async () => {
    const client = {
      query: jest.fn()
        .mockResolvedValueOnce({ rows: [{ total: 2 }] })
        .mockResolvedValueOnce({ rowCount: 2 }),
    };
    const resultado = await purgar({ aplicar: true, meses: 12, client });

    expect(resultado.purgadas).toBe(2);

    const update = client.query.mock.calls[1][0];
    expect(update).toContain('SET evidencia_foto_url = NULL');
    // respuestas_texto es NOT NULL en el esquema: se marca como purgado, no como NULL
    expect(update).toContain(`respuestas_texto = '{"purgado":true}'::jsonb`);
    expect(update).toContain('WHERE enviado_at < $1');
    // Nunca borra la fila ni toca el consentimiento: solo vacía la evidencia
    expect(update).not.toMatch(/DELETE/i);
    expect(update).not.toMatch(/academy_consentimientos/);
  });
});
