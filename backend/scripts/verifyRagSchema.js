#!/usr/bin/env node
/**
 * backend/scripts/verifyRagSchema.js
 * Script de verificación de esquema RAG post-deploy
 * Detecta drift entre esquema esperado y real en beauty_knowledge_embeddings
 * 
 * Uso: node scripts/verifyRagSchema.js
 * Requiere: DATABASE_URL en variables de entorno
 * Exit codes: 0 = OK, 1 = Fallo verificación
 */

const { Pool } = require('pg');

const EXPECTED_SCHEMA = {
  tableName: 'beauty_knowledge_embeddings',
  embedding: {
    columnName: 'embedding',
    expectedDimension: 1024,
    expectedType: 'vector',
  },
  indexes: {
    hnsw: {
      name: 'idx_beauty_knowledge_embedding_hnsw',
      method: 'hnsw',
      operatorClass: 'vector_cosine_ops',
    },
    // Fallback aceptable si HNSW no está disponible
    ivfflat: {
      name: 'idx_beauty_knowledge_embedding_ivfflat',
      method: 'ivfflat',
      operatorClass: 'vector_cosine_ops',
    },
  },
  metadataColumns: [
    { name: 'category', type: 'character varying', maxLength: 100 },
    { name: 'skin_type', type: 'character varying', maxLength: 50 },
    { name: 'season_station', type: 'character varying', maxLength: 20 },
    { name: 'age_range', type: 'character varying', maxLength: 20 },
    { name: 'ingredients', type: 'text[]' },
    { name: 'contraindications', type: 'text[]' },
  ],
  metadataIndexes: [
    'idx_beauty_knowledge_category',
    'idx_beauty_knowledge_skin_type',
    'idx_beauty_knowledge_season_station',
    'idx_beauty_knowledge_age_range',
    'idx_beauty_knowledge_ingredients',
    'idx_beauty_knowledge_contraindications',
  ],
};

class SchemaVerifier {
  constructor() {
    this.errors = [];
    this.warnings = [];
    this.pool = null;
  }

  async connect() {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      throw new Error('DATABASE_URL no está configurada en variables de entorno');
    }
    this.pool = new Pool({ connectionString: databaseUrl });
  }

  async disconnect() {
    if (this.pool) {
      await this.pool.end();
    }
  }

  addError(message) {
    this.errors.push(message);
  }

  addWarning(message) {
    this.warnings.push(message);
  }

  async verifyTableExists() {
    const query = `
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE table_name = $1
      ) as exists;
    `;
    const res = await this.pool.query(query, [EXPECTED_SCHEMA.tableName]);
    if (!res.rows[0].exists) {
      this.addError(`Tabla ${EXPECTED_SCHEMA.tableName} NO EXISTE`);
      return false;
    }
    return true;
  }

  async verifyEmbeddingColumn() {
    const query = `
      SELECT 
        a.atttypmod as dimension,
        t.typname as type
      FROM pg_attribute a
      JOIN pg_class c ON a.attrelid = c.oid
      JOIN pg_type t ON a.atttypid = t.oid
      WHERE c.relname = $1 
      AND a.attname = $2
      AND a.attnum > 0;
    `;
    const res = await this.pool.query(query, [
      EXPECTED_SCHEMA.tableName,
      EXPECTED_SCHEMA.embedding.columnName,
    ]);

    if (res.rows.length === 0) {
      this.addError(`Columna embedding NO EXISTE en ${EXPECTED_SCHEMA.tableName}`);
      return false;
    }

    const actualDimension = res.rows[0].dimension;
    const actualType = res.rows[0].type;

    if (actualType !== EXPECTED_SCHEMA.embedding.expectedType) {
      this.addError(`Tipo embedding incorrecto: esperado ${EXPECTED_SCHEMA.embedding.expectedType}, actual ${actualType}`);
    }

    if (actualDimension !== EXPECTED_SCHEMA.embedding.expectedDimension) {
      this.addError(`Dimensión embedding incorrecta: esperado ${EXPECTED_SCHEMA.embedding.expectedDimension}, actual ${actualDimension}`);
      return false;
    }

    console.log(`✅ Embedding: tipo=${actualType}, dimensión=${actualDimension}`);
    return true;
  }

  async verifyVectorIndexes() {
    const query = `
      SELECT indexname, pg_get_indexdef(indexrelid) as definition
      FROM pg_indexes
      WHERE tablename = $1
      AND indexname LIKE '%embedding%';
    `;
    const res = await this.pool.query(query, [EXPECTED_SCHEMA.tableName]);

    const foundIndexes = res.rows.map(r => r.indexname);
    const hnswIndex = res.rows.find(r => r.indexname === EXPECTED_SCHEMA.indexes.hnsw.name);
    const ivfflatIndex = res.rows.find(r => r.indexname === EXPECTED_SCHEMA.indexes.ivfflat.name);

    if (hnswIndex) {
      if (hnswIndex.definition.includes('vector_cosine_ops')) {
        console.log(`✅ Índice HNSW encontrado: ${hnswIndex.indexname} con vector_cosine_ops`);
      } else {
        this.addWarning(`Índice HNSW existe pero sin vector_cosine_ops: ${hnswIndex.definition}`);
      }
    } else if (ivfflatIndex) {
      if (ivfflatIndex.definition.includes('vector_cosine_ops')) {
        console.log(`✅ Índice IVFFlat encontrado (fallback): ${ivfflatIndex.indexname} con vector_cosine_ops`);
      } else {
        this.addWarning(`Índice IVFFlat existe pero sin vector_cosine_ops: ${ivfflatIndex.definition}`);
      }
    } else {
      this.addError('NO hay índice vectorial (HNSW ni IVFFlat) en columna embedding');
      return false;
    }
    return true;
  }

  async verifyMetadataColumns() {
    const query = `
      SELECT column_name, data_type, character_maximum_length, udt_name
      FROM information_schema.columns
      WHERE table_name = $1
      AND column_name IN ('category', 'skin_type', 'season_station', 'age_range', 'ingredients', 'contraindications');
    `;
    const res = await this.pool.query(query, [EXPECTED_SCHEMA.tableName]);

    const foundColumns = new Map(res.rows.map(r => [r.column_name, r]));
    let allFound = true;

    for (const expected of EXPECTED_SCHEMA.metadataColumns) {
      const found = foundColumns.get(expected.name);
      if (!found) {
        this.addError(`Columna metadata faltante: ${expected.name}`);
        allFound = false;
        continue;
      }

      const typeMatch = this.compareType(found, expected);
      if (!typeMatch) {
        this.addWarning(`Columna ${expected.name}: tipo inesperado (esperado ${expected.type}, actual ${found.data_type || found.udt_name})`);
      } else {
        console.log(`✅ Columna metadata: ${expected.name} (${found.data_type})`);
      }
    }

    return allFound;
  }

  compareType(found, expected) {
    // types: character varying, text, ARRAY
    const actualType = found.udt_name || found.data_type;
    const expectedType = expected.type;
    
    if (expectedType === 'text[]' && actualType === '_text') return true;
    if (expectedType === 'character varying' && actualType === 'varchar') return true;
    return actualType === expectedType;
  }

  async verifyMetadataIndexes() {
    const query = `
      SELECT indexname
      FROM pg_indexes
      WHERE tablename = $1
      AND indexname LIKE 'idx_beauty_knowledge_%';
    `;
    const res = await this.pool.query(query, [EXPECTED_SCHEMA.tableName]);

    const foundIndexes = new Set(res.rows.map(r => r.indexname));
    let allFound = true;

    for (const expected of EXPECTED_SCHEMA.metadataIndexes) {
      if (foundIndexes.has(expected)) {
        console.log(`✅ Índice metadata: ${expected}`);
      } else {
        this.addError(`Índice metadata faltante: ${expected}`);
        allFound = false;
      }
    }

    return allFound;
  }

  async run() {
    console.log('=== VERIFICACIÓN ESQUEMA RAG (beauty_knowledge_embeddings) ===\n');

    try {
      await this.connect();

      const tableExists = await this.verifyTableExists();
      if (!tableExists) return false;

      await this.verifyEmbeddingColumn();
      await this.verifyVectorIndexes();
      await this.verifyMetadataColumns();
      await this.verifyMetadataIndexes();

      // Imprimir warnings
      for (const w of this.warnings) {
        console.log(`⚠️  ${w}`);
      }

      if (this.errors.length > 0) {
        console.log('\n❌ VERIFICACIÓN FALLÓ:');
        for (const e of this.errors) {
          console.log(`  - ${e}`);
        }
        return false;
      }

      console.log('\n✅ VERIFICACIÓN EXITOSA: Esquema RAG correcto');
      return true;

    } catch (error) {
      this.addError(`Error inesperado: ${error.message}`);
      console.log('\n❌ VERIFICACIÓN FALLÓ CON EXCEPCIÓN:');
      console.error(error);
      return false;
    } finally {
      await this.disconnect();
    }
  }
}

// Ejecutar si se llama directamente
if (require.main === module) {
  const verifier = new SchemaVerifier();
  verifier.run().then(success => {
    process.exit(success ? 0 : 1);
  });
}

module.exports = { SchemaVerifier, EXPECTED_SCHEMA };