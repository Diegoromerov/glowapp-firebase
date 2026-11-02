// backend/src/services/authorizationService.js

/**
 * 🛡️ RECURSOS RBAC DE GLOWAPP SAAS
 */
const RESOURCES = Object.freeze({
  BUSINESS_PROFILE: 'BUSINESS_PROFILE',
  ESTABLISHMENT: 'ESTABLISHMENT',
  SERVICE: 'SERVICE',
  PROVIDER: 'PROVIDER',
  BOOKING: 'BOOKING',
  CLIENT: 'CLIENT',
  TRANSACTION: 'TRANSACTION',
  MEMBERSHIP: 'MEMBERSHIP',
  SETTINGS: 'SETTINGS'
});

/**
 * ⚡ ACCIONES RBAC DE GLOWAPP SAAS
 */
const ACTIONS = Object.freeze({
  // CRUD Estándar
  READ: 'READ',
  CREATE: 'CREATE',
  UPDATE: 'UPDATE',
  DELETE: 'DELETE',
  
  // Acciones Específicas
  MANAGE_MEMBERS: 'MANAGE_MEMBERS',
  CHANGE_ROLE: 'CHANGE_ROLE',
  TRANSFER_OWNERSHIP: 'TRANSFER_OWNERSHIP',
  DELETE_BUSINESS: 'DELETE_BUSINESS',
  PUBLISH_SERVICE: 'PUBLISH_SERVICE',
  CONFIRM_BOOKING: 'CONFIRM_BOOKING'
});

/**
 * 👥 ROLES DEFINIDOS EN MEMBERSHIP
 */
const ROLES = Object.freeze({
  OWNER: 'OWNER',
  ADMIN: 'ADMIN',
  MANAGER: 'MANAGER',
  MEMBER: 'MEMBER',
  VIEWER: 'VIEWER'
});

/**
 * 📋 MATRIZ DE PERMISOS (ROLE -> SET OF 'RESOURCE:ACTION')
 * Principio: Deny-by-default. Lo que no está explícitamente listado está prohibido.
 */
const PERMISSIONS_MATRIX = {
  [ROLES.OWNER]: new Set([
    // BusinessProfile & Settings
    `${RESOURCES.BUSINESS_PROFILE}:${ACTIONS.READ}`,
    // CREATE cubre el Generador Documental (`POST /business/documents/generate`,
    // businessRoutes.js:75). Sin esta entrada el OWNER recibía 403 al generar
    // cualquier documento, y como eso deja `createdDocId` en null, arrastraba en
    // cascada download/sign/version/audit (4 suites rojas ~28 tests).
    `${RESOURCES.BUSINESS_PROFILE}:${ACTIONS.CREATE}`,
    `${RESOURCES.BUSINESS_PROFILE}:${ACTIONS.UPDATE}`,
    `${RESOURCES.BUSINESS_PROFILE}:${ACTIONS.DELETE_BUSINESS}`,
    `${RESOURCES.BUSINESS_PROFILE}:${ACTIONS.TRANSFER_OWNERSHIP}`,
    `${RESOURCES.SETTINGS}:${ACTIONS.READ}`,
    `${RESOURCES.SETTINGS}:${ACTIONS.UPDATE}`,

    // Establishment
    `${RESOURCES.ESTABLISHMENT}:${ACTIONS.READ}`,
    `${RESOURCES.ESTABLISHMENT}:${ACTIONS.CREATE}`,
    `${RESOURCES.ESTABLISHMENT}:${ACTIONS.UPDATE}`,
    `${RESOURCES.ESTABLISHMENT}:${ACTIONS.DELETE}`,

    // Memberships
    `${RESOURCES.MEMBERSHIP}:${ACTIONS.READ}`,
    `${RESOURCES.MEMBERSHIP}:${ACTIONS.CREATE}`,
    `${RESOURCES.MEMBERSHIP}:${ACTIONS.UPDATE}`,
    `${RESOURCES.MEMBERSHIP}:${ACTIONS.DELETE}`,
    `${RESOURCES.MEMBERSHIP}:${ACTIONS.MANAGE_MEMBERS}`,
    `${RESOURCES.MEMBERSHIP}:${ACTIONS.CHANGE_ROLE}`,

    // Services
    `${RESOURCES.SERVICE}:${ACTIONS.READ}`,
    `${RESOURCES.SERVICE}:${ACTIONS.CREATE}`,
    `${RESOURCES.SERVICE}:${ACTIONS.UPDATE}`,
    `${RESOURCES.SERVICE}:${ACTIONS.DELETE}`,
    `${RESOURCES.SERVICE}:${ACTIONS.PUBLISH_SERVICE}`,

    // Providers
    `${RESOURCES.PROVIDER}:${ACTIONS.READ}`,
    `${RESOURCES.PROVIDER}:${ACTIONS.CREATE}`,
    `${RESOURCES.PROVIDER}:${ACTIONS.UPDATE}`,
    `${RESOURCES.PROVIDER}:${ACTIONS.DELETE}`,

    // Bookings
    `${RESOURCES.BOOKING}:${ACTIONS.READ}`,
    `${RESOURCES.BOOKING}:${ACTIONS.CREATE}`,
    `${RESOURCES.BOOKING}:${ACTIONS.UPDATE}`,
    `${RESOURCES.BOOKING}:${ACTIONS.DELETE}`,
    `${RESOURCES.BOOKING}:${ACTIONS.CONFIRM_BOOKING}`,

    // Clients
    `${RESOURCES.CLIENT}:${ACTIONS.READ}`,
    `${RESOURCES.CLIENT}:${ACTIONS.CREATE}`,
    `${RESOURCES.CLIENT}:${ACTIONS.UPDATE}`,
    `${RESOURCES.CLIENT}:${ACTIONS.DELETE}`,

    // Transactions
    `${RESOURCES.TRANSACTION}:${ACTIONS.READ}`,
    `${RESOURCES.TRANSACTION}:${ACTIONS.CREATE}`,
    `${RESOURCES.TRANSACTION}:${ACTIONS.UPDATE}`
  ]),

  [ROLES.ADMIN]: new Set([
    // BusinessProfile & Settings (Sin TRANSFER_OWNERSHIP ni DELETE_BUSINESS)
    `${RESOURCES.BUSINESS_PROFILE}:${ACTIONS.READ}`,
    `${RESOURCES.BUSINESS_PROFILE}:${ACTIONS.UPDATE}`,
    `${RESOURCES.SETTINGS}:${ACTIONS.READ}`,
    `${RESOURCES.SETTINGS}:${ACTIONS.UPDATE}`,

    // Establishment
    `${RESOURCES.ESTABLISHMENT}:${ACTIONS.READ}`,
    `${RESOURCES.ESTABLISHMENT}:${ACTIONS.CREATE}`,
    `${RESOURCES.ESTABLISHMENT}:${ACTIONS.UPDATE}`,
    `${RESOURCES.ESTABLISHMENT}:${ACTIONS.DELETE}`,

    // Memberships (Gestión operativa de miembros, pero no transferir propiedad)
    `${RESOURCES.MEMBERSHIP}:${ACTIONS.READ}`,
    `${RESOURCES.MEMBERSHIP}:${ACTIONS.CREATE}`,
    `${RESOURCES.MEMBERSHIP}:${ACTIONS.UPDATE}`,
    `${RESOURCES.MEMBERSHIP}:${ACTIONS.DELETE}`,
    `${RESOURCES.MEMBERSHIP}:${ACTIONS.MANAGE_MEMBERS}`,
    `${RESOURCES.MEMBERSHIP}:${ACTIONS.CHANGE_ROLE}`,

    // Services
    `${RESOURCES.SERVICE}:${ACTIONS.READ}`,
    `${RESOURCES.SERVICE}:${ACTIONS.CREATE}`,
    `${RESOURCES.SERVICE}:${ACTIONS.UPDATE}`,
    `${RESOURCES.SERVICE}:${ACTIONS.DELETE}`,
    `${RESOURCES.SERVICE}:${ACTIONS.PUBLISH_SERVICE}`,

    // Providers
    `${RESOURCES.PROVIDER}:${ACTIONS.READ}`,
    `${RESOURCES.PROVIDER}:${ACTIONS.CREATE}`,
    `${RESOURCES.PROVIDER}:${ACTIONS.UPDATE}`,
    `${RESOURCES.PROVIDER}:${ACTIONS.DELETE}`,

    // Bookings
    `${RESOURCES.BOOKING}:${ACTIONS.READ}`,
    `${RESOURCES.BOOKING}:${ACTIONS.CREATE}`,
    `${RESOURCES.BOOKING}:${ACTIONS.UPDATE}`,
    `${RESOURCES.BOOKING}:${ACTIONS.DELETE}`,
    `${RESOURCES.BOOKING}:${ACTIONS.CONFIRM_BOOKING}`,

    // Clients
    `${RESOURCES.CLIENT}:${ACTIONS.READ}`,
    `${RESOURCES.CLIENT}:${ACTIONS.CREATE}`,
    `${RESOURCES.CLIENT}:${ACTIONS.UPDATE}`,
    `${RESOURCES.CLIENT}:${ACTIONS.DELETE}`,

    // Transactions
    `${RESOURCES.TRANSACTION}:${ACTIONS.READ}`,
    `${RESOURCES.TRANSACTION}:${ACTIONS.CREATE}`
  ]),

  [ROLES.MANAGER]: new Set([
    // BusinessProfile & Settings (Solo lectura)
    `${RESOURCES.BUSINESS_PROFILE}:${ACTIONS.READ}`,
    `${RESOURCES.SETTINGS}:${ACTIONS.READ}`,
    `${RESOURCES.ESTABLISHMENT}:${ACTIONS.READ}`,

    // Memberships (Solo lectura de quién está en el equipo)
    `${RESOURCES.MEMBERSHIP}:${ACTIONS.READ}`,

    // Services (Gestión completa de catálogo operativo)
    `${RESOURCES.SERVICE}:${ACTIONS.READ}`,
    `${RESOURCES.SERVICE}:${ACTIONS.CREATE}`,
    `${RESOURCES.SERVICE}:${ACTIONS.UPDATE}`,
    `${RESOURCES.SERVICE}:${ACTIONS.PUBLISH_SERVICE}`,

    // Providers
    `${RESOURCES.PROVIDER}:${ACTIONS.READ}`,
    `${RESOURCES.PROVIDER}:${ACTIONS.CREATE}`,
    `${RESOURCES.PROVIDER}:${ACTIONS.UPDATE}`,

    // Bookings
    `${RESOURCES.BOOKING}:${ACTIONS.READ}`,
    `${RESOURCES.BOOKING}:${ACTIONS.CREATE}`,
    `${RESOURCES.BOOKING}:${ACTIONS.UPDATE}`,
    `${RESOURCES.BOOKING}:${ACTIONS.CONFIRM_BOOKING}`,

    // Clients
    `${RESOURCES.CLIENT}:${ACTIONS.READ}`,
    `${RESOURCES.CLIENT}:${ACTIONS.CREATE}`,
    `${RESOURCES.CLIENT}:${ACTIONS.UPDATE}`,

    // Transactions
    `${RESOURCES.TRANSACTION}:${ACTIONS.READ}`
  ]),

  [ROLES.MEMBER]: new Set([
    // BusinessProfile / Establishment
    `${RESOURCES.BUSINESS_PROFILE}:${ACTIONS.READ}`,
    `${RESOURCES.ESTABLISHMENT}:${ACTIONS.READ}`,

    // Services (Lectura de catálogo para agendar)
    `${RESOURCES.SERVICE}:${ACTIONS.READ}`,

    // Providers
    `${RESOURCES.PROVIDER}:${ACTIONS.READ}`,

    // Bookings (Operación de citas asignadas)
    `${RESOURCES.BOOKING}:${ACTIONS.READ}`,
    `${RESOURCES.BOOKING}:${ACTIONS.CREATE}`,
    `${RESOURCES.BOOKING}:${ACTIONS.CONFIRM_BOOKING}`,

    // Clients
    `${RESOURCES.CLIENT}:${ACTIONS.READ}`,
    `${RESOURCES.CLIENT}:${ACTIONS.CREATE}`,

    // Transactions
    `${RESOURCES.TRANSACTION}:${ACTIONS.READ}`
  ]),

  [ROLES.VIEWER]: new Set([
    // Solo lectura de recursos públicos/operativos
    `${RESOURCES.BUSINESS_PROFILE}:${ACTIONS.READ}`,
    `${RESOURCES.ESTABLISHMENT}:${ACTIONS.READ}`,
    `${RESOURCES.SERVICE}:${ACTIONS.READ}`,
    `${RESOURCES.PROVIDER}:${ACTIONS.READ}`,
    `${RESOURCES.BOOKING}:${ACTIONS.READ}`,
    `${RESOURCES.CLIENT}:${ACTIONS.READ}`,
    `${RESOURCES.TRANSACTION}:${ACTIONS.READ}`
  ])
};

/**
 * Servicio stateless de autorización RBAC
 */
class AuthorizationService {
  /**
   * Evalúa si un rol tiene permiso para ejecutar una acción sobre un recurso.
   * @param {string} role - Rol de la membresía (OWNER, ADMIN, MANAGER, MEMBER, VIEWER)
   * @param {string} resource - Recurso objetivo (RESOURCES.*)
   * @param {string} action - Acción requerida (ACTIONS.*)
   * @returns {boolean} true si está explícitamente permitido, false de lo contrario (deny-by-default)
   */
  static can(role, resource, action) {
    if (!role || !resource || !action) return false;

    const normalizedRole = String(role).toUpperCase();
    const normalizedResource = String(resource).toUpperCase();
    const normalizedAction = String(action).toUpperCase();

    const rolePermissions = PERMISSIONS_MATRIX[normalizedRole];
    if (!rolePermissions) return false;

    const permissionKey = `${normalizedResource}:${normalizedAction}`;
    return rolePermissions.has(permissionKey);
  }

  /**
   * Obtiene todos los permisos asignados a un rol.
   * @param {string} role
   * @returns {string[]}
   */
  static getPermissionsForRole(role) {
    if (!role) return [];
    const normalizedRole = String(role).toUpperCase();
    const set = PERMISSIONS_MATRIX[normalizedRole];
    return set ? Array.from(set) : [];
  }
}

module.exports = {
  AuthorizationService,
  RESOURCES,
  ACTIONS,
  ROLES
};
