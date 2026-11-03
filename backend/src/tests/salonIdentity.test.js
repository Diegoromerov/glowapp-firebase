'use strict';

/**
 * E-02a (D-GL-027) — identidad canónica del salón.
 *
 * Por qué existe esta prueba: el hueco que cierra el servicio no se ve en un
 * `flutter analyze` ni en un smoke test de la API. Un salón creado sin
 * membership deja `req.saas` vacío y todos los endpoints SaaS responden 401
 * "Contexto SaaS requerido", con la pantalla aparentemente sana.
 */

const {
  ensureSalonOwnerIdentity,
  profileIdForSalon,
  tenantIdForSalon,
  PLANES_VALIDOS,
} = require('../services/salonIdentity');

/** Cliente falso: registra las consultas y responde lo que el test necesite. */
function fakeDb(verticales) {
  const consultas = [];
  return {
    consultas,
    async query(sql, params) {
      consultas.push({ sql, params });
      if (sql.includes('FROM business_verticals')) {
        return { rows: verticales.map((id) => ({ id })) };
      }
      return { rows: [] };
    },
  };
}

describe('E-02a — identidad del salón (business_profiles + memberships)', () => {
  test('crea el perfil con el id de convención y la membership OWNER del dueño', async () => {
    const db = fakeDb(['BELLEZA']);

    const res = await ensureSalonOwnerIdentity(db, {
      salonId: 42,
      ownerUserId: 7,
      name: 'Studio Norte',
      plan: 'PRO',
    });

    expect(res).toEqual({ provisioned: true, profileId: 'salon-42', tenantId: 'tenant-42' });

    const perfil = db.consultas.find((c) => c.sql.includes('INSERT INTO business_profiles'));
    expect(perfil).toBeDefined();
    expect(perfil.params.slice(0, 2)).toEqual(['salon-42', 7]);
    expect(perfil.params).toContain('Studio Norte');
    expect(perfil.params).toContain('PRO');
    expect(perfil.params).toContain('tenant-42');
    // Idempotencia: sin ON CONFLICT, crear el salón otra vez revienta por PK.
    expect(perfil.sql).toMatch(/ON CONFLICT \(id\) DO UPDATE/);

    const membership = db.consultas.find((c) => c.sql.includes('INSERT INTO memberships'));
    expect(membership).toBeDefined();
    expect(membership.params[1]).toBe(7);
    expect(membership.params[2]).toBe('salon-42');
    expect(membership.sql).toContain("'OWNER'");
    expect(membership.sql).toMatch(/ON CONFLICT \(user_id, business_profile_id\) DO UPDATE/);
  });

  test('prefiere la vertical de belleza cuando hay varias', async () => {
    const db = fakeDb(['OTRA', 'BELLEZA']);

    await ensureSalonOwnerIdentity(db, { salonId: 1, ownerUserId: 2 });

    const consultaVertical = db.consultas.find((c) => c.sql.includes('FROM business_verticals'));
    expect(consultaVertical.sql).toContain('BELLEZA');
    expect(consultaVertical.sql).toMatch(/ORDER BY/);
  });

  test('sin verticales no escribe nada y lo informa (no inventa un vertical_id)', async () => {
    const db = fakeDb([]);

    const res = await ensureSalonOwnerIdentity(db, { salonId: 5, ownerUserId: 9 });

    expect(res).toEqual({ provisioned: false, reason: 'NO_VERTICAL' });
    expect(db.consultas.filter((c) => c.sql.includes('INSERT'))).toHaveLength(0);
  });

  test('un plan inválido cae a FREE_TRIAL en lugar de romper el CHECK de la tabla', async () => {
    const db = fakeDb(['BELLEZA']);

    await ensureSalonOwnerIdentity(db, {
      salonId: 3,
      ownerUserId: 4,
      plan: 'PLAN_INVENTADO',
    });

    const perfil = db.consultas.find((c) => c.sql.includes('INSERT INTO business_profiles'));
    expect(perfil.params).toContain('FREE_TRIAL');
    expect(perfil.params).not.toContain('PLAN_INVENTADO');
  });

  test('exige salonId y ownerUserId', async () => {
    const db = fakeDb(['BELLEZA']);

    await expect(ensureSalonOwnerIdentity(db, { salonId: null, ownerUserId: 1 })).rejects.toThrow(
      /salonId y ownerUserId/
    );
    await expect(ensureSalonOwnerIdentity(db, { salonId: 1 })).rejects.toThrow(
      /salonId y ownerUserId/
    );
  });

  test('los ids de convención respetan el ancho de columna (36 y 64)', () => {
    expect(profileIdForSalon(123456789)).toBe('salon-123456789');
    expect(tenantIdForSalon(123456789)).toBe('tenant-123456789');
    // Un id absurdo no puede exceder VARCHAR(36) / VARCHAR(64).
    const enorme = '9'.repeat(80);
    expect(profileIdForSalon(enorme).length).toBeLessThanOrEqual(36);
    expect(tenantIdForSalon(enorme).length).toBeLessThanOrEqual(64);
    expect(PLANES_VALIDOS).toEqual(['FREE_TRIAL', 'FREEMIUM', 'BASIC', 'PRO', 'ENTERPRISE']);
  });
});
