const { Sequelize } = require('sequelize');
require('dotenv').config();

const connectionString = process.env.DATABASE_URL;

let sequelize;

// Harness en memoria (src/config/pgMemory.js). Se evalúa PRIMERO a propósito: antes las ramas
// NODE_ENV==='test' y DATABASE_URL tenían prioridad sobre USE_PG_MEM, de modo que el flag se ignoraba
// en silencio y un script que creía trabajar en memoria terminaba escribiendo en la base apuntada por
// DATABASE_URL. El mismo módulo expone el adaptador que comparte el pool crudo (src/config/db.js),
// para que Sequelize y el SQL crudo hablen con la MISMA base en memoria.
const pgMemory = require('./pgMemory');

if (pgMemory.enabled) {
  sequelize = new Sequelize('postgres://', {
    dialect: 'postgres',
    dialectModule: pgMemory.adapter,
    logging: false
  });
  // pg-mem no soporta CREATE TYPE ... AS ENUM: se neutraliza el helper que Sequelize usa en sync().
  sequelize.getQueryInterface().ensureEnums = async () => {};

} else if (connectionString) {
  const isInternal = connectionString.includes('railway.internal') || connectionString.includes('localhost');
  sequelize = new Sequelize(connectionString, {
    dialect: 'postgres',
    dialectOptions: isInternal ? {} : {
      ssl: {
        require: true,
        rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false'
      }
    },
    logging: false
  });
} else {
  sequelize = new Sequelize(
    process.env.DB_NAME || 'beauty_db',
    process.env.DB_USER || 'postgres',
    process.env.DB_PASSWORD,
    {
      host: process.env.DB_HOST || 'localhost',
      port: process.env.DB_PORT || 5432,
      dialect: 'postgres',
      logging: false
    }
  );
}

const tenantRouting = require('./tenantRouting');
const conexionesConContexto = new WeakSet();

function desempacarConexion(conexion) {
  if (!conexion) return null;
  if (conexion.connectionParameters) return conexion;
  if (conexion.connection && conexion.connection.connectionParameters) return conexion.connection;
  return conexion;
}

function cablearContextoEnSequelize(instanciaSequelize) {
  if (!instanciaSequelize || !instanciaSequelize.connectionManager) return;
  const cm = instanciaSequelize.connectionManager;
  if (cm.__contextoDeInquilinoCableado) return;

  const getConnectionOriginal = cm.getConnection.bind(cm);
  const releaseConnectionOriginal = cm.releaseConnection.bind(cm);

  cm.getConnection = async function (options) {
    const conexion = await getConnectionOriginal(options);
    const real = desempacarConexion(conexion);
    if (!real || typeof real.query !== 'function') return conexion;

    const ctx = tenantRouting.getContext();
    if (ctx && ctx.system) {
      try {
        await real.query('SET ROLE app_system');
        conexionesConContexto.add(real);
      } catch (error) {
        console.warn('⚠️ Sequelize: no se pudo establecer rol app_system:', error.message);
      }
    } else if (ctx && ctx.tenantId) {
      try {
        await real.query('SELECT set_config(\'app.tenant_id\', $1, false)', [String(ctx.tenantId)]);
        conexionesConContexto.add(real);
      } catch (error) {
        console.warn('⚠️ Sequelize: no se pudo establecer app.tenant_id:', error.message);
      }
    }
    return conexion;
  };

  cm.releaseConnection = async function (conexion, force) {
    const real = desempacarConexion(conexion);
    if (real && conexionesConContexto.has(real) && typeof real.query === 'function') {
      try {
        await real.query('RESET ROLE');
        await real.query('RESET app.tenant_id');
        conexionesConContexto.delete(real);
      } catch (error) {
        console.error('❌ Sequelize: no se pudo limpiar el contexto de inquilino; se destruye la conexión:', error.message);
        return releaseConnectionOriginal(conexion, true);
      }
    }
    return releaseConnectionOriginal(conexion, force);
  };

  cm.__contextoDeInquilinoCableado = true;
}

if (sequelize) {
  cablearContextoEnSequelize(sequelize);
}

const testSequelizeConnection = async () => {
  try {
    await sequelize.authenticate();
    console.log('✅ Sequelize: Conexión exitosa a la base de datos.');
    return true;
  } catch (error) {
    console.error('❌ Sequelize: Error de conexión:', error.message);
    return false;
  }
};

module.exports = {
  sequelize,
  testSequelizeConnection,
  cablearContextoEnSequelize,
};
