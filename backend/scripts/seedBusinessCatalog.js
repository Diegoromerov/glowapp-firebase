/**
 * Siembra el catálogo del Business Engine: verticales, requisitos y plantillas.
 *
 * Por qué existe: ese catálogo vivía SOLO en `src/db/seed_business_data.js`,
 * importado únicamente como fallback en memoria del repositorio, y ningún script
 * lo escribía en la base. Como `business_profiles.vertical_id` tiene FK a
 * `business_verticals`, con la tabla vacía TODO `createProfile` fallaba con
 *
 *   insert or update on table "business_profiles" violates foreign key
 *   constraint "business_profiles_vertical_id_fkey"
 *
 * y el repositorio, al atrapar el error, seguía sirviendo datos desde memoria:
 * la API parecía funcionar (devolvía perfil y tareas) mientras no guardaba
 * absolutamente nada. El catálogo es la fuente de verdad de esas 10 filas, así
 * que se persiste desde aquí en vez de duplicarlo en SQL.
 *
 * Idempotente (ON CONFLICT DO UPDATE) y se ejecuta al arrancar, justo después de
 * las migraciones, para que una base nueva quede usable sin pasos manuales.
 */
const { verticals, requirements, documentTemplates } = require('../src/db/seed_business_data');

// El catálogo es global, no de un inquilino: se guarda bajo el mismo centinela
// que el resto del motor usa para lo que no pertenece a un tenant concreto.
const TENANT_GLOBAL = 'default';

async function seedBusinessCatalog(pool) {
  for (const v of verticals) {
    await pool.query(
      `INSERT INTO business_verticals (id, code, name, description)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO UPDATE
         SET code = EXCLUDED.code, name = EXCLUDED.name, description = EXCLUDED.description`,
      [v.id, v.code, v.name, v.description ?? null]
    );
  }

  for (const r of requirements) {
    await pool.query(
      `INSERT INTO business_requirements
         (id, vertical_id, code, title, description, legal_basis, jurisdiction,
          domain_context, evidence_required, frequency_months, tenant_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (id) DO UPDATE
         SET vertical_id = EXCLUDED.vertical_id,
             code = EXCLUDED.code,
             title = EXCLUDED.title,
             description = EXCLUDED.description,
             legal_basis = EXCLUDED.legal_basis,
             jurisdiction = EXCLUDED.jurisdiction,
             domain_context = EXCLUDED.domain_context,
             evidence_required = EXCLUDED.evidence_required,
             frequency_months = EXCLUDED.frequency_months`,
      [
        r.id,
        r.vertical_id ?? null,
        r.code,
        r.title,
        r.description ?? null,
        r.legal_basis ?? null,
        r.jurisdiction ?? null,
        r.domain_context,
        r.evidence_required ?? null,
        r.frequency_months ?? null,
        TENANT_GLOBAL,
      ]
    );
  }

  for (const t of documentTemplates) {
    await pool.query(
      `INSERT INTO document_templates (id, code, title, category, template_body, disclaimer)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (id) DO UPDATE
         SET code = EXCLUDED.code,
             title = EXCLUDED.title,
             category = EXCLUDED.category,
             template_body = EXCLUDED.template_body,
             disclaimer = EXCLUDED.disclaimer`,
      [t.id, t.code, t.title, t.category, t.template_body, t.disclaimer ?? null]
    );
  }

  return {
    verticals: verticals.length,
    requirements: requirements.length,
    templates: documentTemplates.length,
  };
}

module.exports = { seedBusinessCatalog };
