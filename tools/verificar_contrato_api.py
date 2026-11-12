#!/usr/bin/env python3
"""Compara las rutas que llaman las apps Flutter contra las que publica el backend.

Exit 0 = todas existen. Exit 1 = lista las que no, con el archivo donde se llaman.
"""
import re
import sys
import pathlib

RAIZ = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else pathlib.Path('.')
BACKEND = RAIZ / 'backend/src/routes'

# Map of route file -> mount prefix from index.js
ROUTE_MOUNTS = {
    'authRoutes.js': '/api/auth',
    'configRoutes.js': '/api',
    'paymentRoutes.js': '/api',
    'bookingRoutes.js': '/api',
    'serviceRoutes.js': '/api',
    'chatRoutes.js': '/api',
    'productRoutes.js': '/api',
    'providerRoutes.js': '/api',
    'ownerRoutes.js': '/api/owner',
    'inventoryRoutes.js': '/api/provider',
    'ticketRoutes.js': '/api',
    'disputeRoutes.js': '/api',
    'eventRegistrationRoutes.js': '/api',
    'salonRoutes.js': '/api/salon',
    'userPreferencesRoutes.js': '/api/users',
    'userDeliveryAddressRoutes.js': '/api/users',
    'designsRoutes.js': '/api/designs',
    'niaBeautyRoutes.js': '/api/nia-beauty',
    'biometricConsentRoutes.js': '/api/consent',
    'consentRoutes.js': '/api/consent',
    'biometricRoutes.js': '/api/biometric',
    'glowCycleRoutes.js': '/api/glow-cycle',
    'vtoRoutes.js': '/api/vto',
    'colorRoutes.js': '/api/color',
    'academyRoutes.js': '/api/academy',
    # Alta en E5: el mapa no las tenía y el verificador reportaba como «faltantes»
    # rutas que sí existen. `/r/:codigo` se monta fuera de /api a propósito.
    'rewardsRoutes.js': '/api/rewards',
    'referralLinkRoutes.js': '/r',
    'adminAuthRoutes.js': '/api/admin/auth',
    'academyAdminRoutes.js': '/api/admin/academy',
    'adminPreciosRoutes.js': '/api/admin',
    'adminTicketRoutes.js': '/api/admin',
    'adminUploadRoutes.js': '/api/admin',
    'glowProRoutes.js': '/api/glow-pro',
    'eventRoutes.js': '/api/events',
    'analyticsRoutes.js': '/api/analytics',
    'metricsRoutes.js': '/api/metrics',
    'portfolioRoutes.js': '/api/portfolio',
    'communityRoutes.js': '/api/community',
    'mentorshipRoutes.js': '/api/mentorship',
    'xpLogRoutes.js': '/api/xp-logs',
    'businessRoutes.js': '/api/v1/business',
    'membershipRoutes.js': '/api/v1/memberships',
    'saasBootstrapRoutes.js': '/api/saas/bootstrap',
    'saasTeamRoutes.js': '/api/saas/team',
    'saasUsageRoutes.js': '/api/saas/usage',
    'saasBillingRoutes.js': '/api/saas/billing',
    'saasApiKeyRoutes.js': '/api/saas/api-keys',
    'superAdminRoutes.js': '/api/superadmin',
    'shortcutRoutes.js': '/api',
    'v1/beautyRoutes.js': '/api/v1/beauty',
    'v1/beautyScanRoutes.js': '/api/v1/beauty-scan',
    'v1/workforceRoutes.js': '/api/v1/workforce',
}

# Direct routes defined in index.js (not in route files)
DIRECT_ROUTES = {
    '/api/upload',
    '/api/sos',
    '/api/users/profile',
    '/api/users/avatar',
    '/api/providers/status',
    '/api/admin/events/stream',
    '/api/admin/metrics',
    '/api/admin/sos/resolve/:id',
    '/api/admin/users',
    '/api/admin/users/:id/toggle-status',
    '/api/admin/users/:id/verify',
    '/api/social/log-share',
    '/api/social/accounts',
    '/api/health',
    '/api/test-db',
    '/api/debug-db',
    '/api/debug-schema',
    '/api/tiles/:z/:x/:y.png',
}

# Se escanea el arbol completo de las dos apps y de glow_core. Antes solo se
# leia `api_service.dart` del paquete y el `lib` del provider: las llamadas
# escritas directamente en las pantallas del CLIENTE (37 pantallas) nunca se
# revisaban, asi que una ruta inventada ahi pasaba como OK.
APPS = {
    'core':     RAIZ / 'packages/glow_core/lib',
    'client':   RAIZ / 'apps/glow_client/lib',
    'provider': RAIZ / 'apps/glow_provider/lib',
}

def extract_routes_from_file(filepath):
    """Extract router.METHOD('path') routes from a route file."""
    rutas = set()
    src = filepath.read_text(encoding='utf-8', errors='ignore')
    for m in re.finditer(r"router\.(get|post|put|patch|delete)\(\s*'([^']+)'", src):
        rutas.add(m.group(2).rstrip('/') or '/')
    return rutas

def rutas_backend():
    rutas = set()
    # Add routes from each mounted route file
    for route_file, prefix in ROUTE_MOUNTS.items():
        filepath = BACKEND / route_file
        if filepath.exists():
            file_routes = extract_routes_from_file(filepath)
            for r in file_routes:
                full = f'{prefix}{r}' if r != '/' else prefix
                rutas.add(full)
        else:
            print(f'Warning: Route file not found: {route_file}', file=sys.stderr)
    # Add direct routes from index.js
    rutas.update(DIRECT_ROUTES)
    return rutas

def normalizar(ruta):
    # Strip query parameters first
    ruta = ruta.split('?')[0]
    # Normalize backend params (:id, :param) and Dart interpolation ($var, ${expr})
    ruta = re.sub(r'[:{][^/}]+[}]?', ':param', ruta.rstrip('/'))
    ruta = re.sub(r'\$\w+', ':param', ruta)
    ruta = re.sub(r'\$\{[^}]+\}', ':param', ruta)
    # Clean up any remaining $ before :param (from ${widget.salonId} -> $:param)
    ruta = re.sub(r'\$:param', ':param', ruta)
    return ruta

def sin_comentarios(src):
    """Quita comentarios de Dart.

    Sin esto, una ruta mencionada en un comentario (`app.use('/api/auth', ...)`
    en la documentacion de un servicio) se contaba como llamada real.
    """
    src = re.sub(r'/\*.*?\*/', '', src, flags=re.S)
    src = re.sub(r'//[^\n]*', '', src)
    return src


def es_prefijo_conocido(llamada, backend):
    """`/api/saas` es valido si el servicio lo usa como `_basePath` y concatena.

    Solo se acepta cuando el literal es un prefijo exacto por segmentos de alguna
    ruta publicada; una ruta inventada no coincide con ninguna.
    """
    return any(b.startswith(llamada + '/') for b in backend)


def coincide(llamada, plantilla):
    """Compara segmento a segmento: `:param` solo vale donde el backend lo declara.

    Antes habia un atajo (`llamada.startswith(plantilla.replace('/:param',''))`)
    que hacia pasar CUALQUIER subruta de un prefijo con parametro: por ejemplo
    `/api/providers/inventado/slots-inexistentes` se daba por buena porque
    `/api/providers/:param` existe.
    """
    a = llamada.strip('/').split('/')
    b = plantilla.strip('/').split('/')
    if len(a) != len(b):
        return False
    return all(seg == ':param' or seg == otro for seg, otro in zip(b, a))


def main():

    
    backend = {normalizar(r) for r in rutas_backend()}
    faltantes = []
    for app, ruta in APPS.items():
        archivos = [ruta] if ruta.is_file() else list(ruta.rglob('*.dart'))
        for f in archivos:
            src = sin_comentarios(f.read_text(encoding='utf-8', errors='ignore'))
            for m in re.finditer(r"['\"]/api/([^'\"]+)", src):
                llamada = normalizar('/api/' + m.group(1))
                if llamada in backend:
                    continue
                if es_prefijo_conocido(llamada, backend):
                    continue
                if not any(coincide(llamada, b) for b in backend):
                    rel_path = str(f.relative_to(RAIZ))
                    faltantes.append((app, rel_path, llamada))
    if faltantes:
        print(f'FALTAN {len(faltantes)} rutas:')
        for app, f, r in faltantes:
            print(f'  [{app}] {r}  ({f})')
        return 1
    print(f'OK: todas las rutas usadas por las apps existen ({len(backend)} publicadas)')
    return 0

if __name__ == '__main__':
    sys.exit(main())
