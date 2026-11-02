const { Sequelize } = require('sequelize');
require('dotenv').config({ path: '../backend/.env' });
const fs = require('fs');
const path = require('path');

function splitSqlStatements(sql) {
  const statements = [];
  let start = 0;
  let inSingleQuote = false;
  let inDollarQuote = false;
  let dollarTag = null;

  for (let i = 0; i < sql.length; i++) {
    const c = sql[i];

    if (inSingleQuote) {
      if (c === "'" && i + 1 < sql.length && sql[i + 1] === "'") {
        // Escaped single quote, skip next character
        i++;
      } else if (c === "'") {
        inSingleQuote = false;
      }
    } else if (inDollarQuote) {
      if (c === '$') {
        // Check if we have the closing tag
        const tagEnd = i + 1 + dollarTag.length;
        if (tagEnd < sql.length && 
            sql.substring(i + 1, i + 1 + dollarTag.length) === dollarTag && 
            sql[tagEnd] === '$') {
          inDollarQuote = false;
          // Skip over the dollar tag and the trailing '$'
          i = tagEnd; // because we will increment i at the end of the loop
        }
      }
    } else {
      if (c === "'") {
        inSingleQuote = true;
      } else if (c === '$') {
        // Look ahead for the next '$' to get the tag
        let j = i + 1;
        while (j < sql.length && sql[j] !== '$') {
          j++;
        }
        if (j < sql.length) {
          dollarTag = sql.substring(i + 1, j);
          inDollarQuote = true;
          // Skip to the character after the second '$'
          i = j; // because we will increment i at the end
        }
        // else: not a dollar quote, treat as regular character
      } else if (c === ';') {
        // Check if this semicolon is a statement terminator: followed by whitespace and then newline or end
        let j = i + 1;
        while (j < sql.length && (sql[j] === ' ' || sql[j] === '\\t' || sql[j] === '\\r' || sql[j] === '\\n')) {
          j++;
        }
        if (j === sql.length || sql[j] === '\\n') {
          // Statement terminator found
          statements.push(sql.substring(start, i));
          start = j; // next statement starts after the whitespace and newline
        }
        // else: not a statement terminator, so we continue
      }
    }
  }

  // Push the last statement
  if (start < sql.length) {
    statements.push(sql.substring(start));
  }

  return statements.filter(stmt => stmt.trim() !== '');
}

const connectionString = process.env.DATABASE_URL;
let sequelize;

if (connectionString) {
  sequelize = new Sequelize(connectionString, {
    dialect: 'postgres',
    dialectOptions: {
      ssl: {
        require: true,
        rejectUnauthorized: false
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

async function runMigrations() {
  try {
    await sequelize.authenticate();
    console.log('✅ Database connection established');

    const migrationsDir = path.join(__dirname, 'migrations');
    const migrationFiles = [
      '059_create_tipo_trabajador_enum.sql',
      '060_add_worker_type_to_usuarios.sql',
      '055_create_tenants_table.sql',
      '056_add_tenant_id_to_core_tables.sql',
      '057_backfill_tenant_id.sql',
      '058_enable_rls_policies.sql'
    ];

    for (const file of migrationFiles) {
      const filePath = path.join(migrationsDir, file);
      console.log(`🔄 Running migration: ${file}`);
      const sql = fs.readFileSync(filePath, 'utf8');
      const statements = splitSqlStatements(sql);

      for (const statement of statements) {
        if (statement.trim() !== '') {
          await sequelize.query(statement);
        }
      }

      console.log(`✅ Migration completed: ${file}`);
    }

    console.log('🎉 All migrations completed successfully');
  } catch (error) {
    console.error('❌ Error running migrations:', error);
    process.exit(1);
  } finally {
    await sequelize.close();
  }
}

runMigrations();