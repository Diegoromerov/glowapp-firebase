const { Pool } = require('pg');

async function main() {
  if (!process.env.DATABASE_URL_ADMIN) {
    throw new Error('DATABASE_URL_ADMIN es obligatorio para verificar el catálogo DIVIPOLA');
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL_ADMIN });
  try {
    const result = await pool.query(`
      SELECT COUNT(*)::int AS total,
             COUNT(DISTINCT dane_code)::int AS codigos_unicos,
             COUNT(*) FILTER (WHERE activo)::int AS activos,
             COUNT(*) FILTER (WHERE zona_envio_id IS NULL)::int AS sin_zona,
             COUNT(*) FILTER (WHERE tipo_municipio = 'Municipio')::int AS municipios,
             COUNT(*) FILTER (WHERE tipo_municipio = 'Área no municipalizada')::int AS areas_no_municipalizadas,
             COUNT(*) FILTER (WHERE tipo_municipio = 'Isla')::int AS islas,
             COUNT(*) FILTER (WHERE dane_code = '99999')::int AS codigos_ficticios
        FROM municipios_dane
    `);
    const row = result.rows[0];
    const esperado = {
      total: 1122,
      codigos_unicos: 1122,
      activos: 1122,
      sin_zona: 0,
      municipios: 1103,
      areas_no_municipalizadas: 18,
      islas: 1,
      codigos_ficticios: 0
    };
    const errores = Object.entries(esperado)
      .filter(([campo, valor]) => row[campo] !== valor)
      .map(([campo, valor]) => `${campo}: esperado ${valor}, recibido ${row[campo]}`);

    if (errores.length) throw new Error(errores.join('; '));
    console.log('OK catálogo DIVIPOLA:', JSON.stringify(row));
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error('ERROR catálogo DIVIPOLA:', error.message);
  process.exitCode = 1;
});
