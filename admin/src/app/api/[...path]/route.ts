// admin-dashboard/src/app/api/[...path]/route.ts
import { NextRequest, NextResponse } from 'next/server.js';
import { jwtVerify } from 'jose';

// The local backend's .env.example uses port 3000; keep deployment overrides first.
const BACKEND_URL = process.env.BACKEND_INTERNAL_URL || process.env.BACKEND_URL || 'http://localhost:3000';
const BACKEND_AUDIENCE = 'admin';

function backendFetch(url: string | URL, init: RequestInit = {}) {
  const headers = Object.fromEntries(new Headers(init.headers).entries());
  headers['x-app-audience'] = BACKEND_AUDIENCE;
  return fetch(url, { ...init, headers });
}

function getJwtSecretKey() {
  const JWT_SECRET = process.env.JWT_SECRET;
  if (!JWT_SECRET || JWT_SECRET.trim().length < 32) {
    return null;
  }
  return new TextEncoder().encode(JWT_SECRET);
}

// Prefijos de rutas permitidos en el proxy BFF para el dashboard administrativo
const ALLOWED_PATH_PREFIXES = [
  'admin/',
  'glow-admin/',
  'metrics/',
  'services/',
  'portfolio/',
  'users/',
  'precios/',
  'productos/',
  'vto/',
  'business/',
  // El panel llama a /api/v1/business/* (cola de cumplimiento, plantillas,
  // evidencias, generacion de documentos). Sin este prefijo el proxy los
  // rechazaba con 404 y /admin/business no cargaba ningun dato.
  'v1/business/',
  'academia/',
  'store/orders',
  'envios'
];

/**
 * Validación de CSRF para métodos de mutación (POST, PUT, PATCH, DELETE)
 */
function validateCsrf(req: NextRequest, isLoginRoute: boolean): { valid: boolean; error?: string } {
  const method = req.method.toUpperCase();
  if (['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    return { valid: true };
  }

  // 1. Verificación de Origin / Referer
  const origin = req.headers.get('origin') || req.headers.get('referer');
  const host = req.headers.get('host');

  if (origin && host) {
    try {
      const originHost = new URL(origin).host;
      if (originHost !== host) {
        return { valid: false, error: 'Origen no autorizado para operaciones de mutación (CSRF Origin Mismatch).' };
      }
    } catch (_) {
      return { valid: false, error: 'Formato de Origen o Referer inválido (CSRF).' };
    }
  } else if (!origin) {
    return { valid: false, error: 'Encabezado Origin/Referer requerido para mutaciones (CSRF).' };
  }

  // 2. Verificación de Encabezado Personalizado en Mutaciones (Salvo Login)
  if (!isLoginRoute) {
    const customHeader = req.headers.get('x-requested-with') || req.headers.get('x-csrf-token');
    if (!customHeader) {
      return { valid: false, error: 'Rechazado por validación CSRF. Se requiere encabezado personalizado X-Requested-With.' };
    }
  }

  return { valid: true };
}

async function handleProxyRequest(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;

  // 🛡️ Guard contra Path Traversal ('..', '%2e', etc.)
  if (path.some(segment => segment.includes('..') || segment.includes('%2e') || segment.includes('%2E'))) {
    return NextResponse.json({ error: 'Ruta inválida o intento de traversa de directorio detectado.' }, { status: 403 });
  }

  const pathStr = path.join('/');

  // 🛡️ Verificación de Lista Blanca (Allowlist)
  const isAllowedPath = ALLOWED_PATH_PREFIXES.some(prefix => pathStr.startsWith(prefix) || pathStr === prefix.slice(0, -1));
  if (!isAllowedPath) {
    return NextResponse.json({ error: 'Ruta no autorizada en proxy BFF.' }, { status: 404 });
  }

  const isLoginRoute = pathStr === 'admin/auth/login';
  const isLogoutRoute = pathStr === 'admin/auth/logout';
  const isSessionRoute = pathStr === 'admin/auth/me' || pathStr === 'admin/auth/session';

  // 🔒 1. Validación CSRF en mutaciones
  const csrf = validateCsrf(req, isLoginRoute);
  if (!csrf.valid) {
    return NextResponse.json({ error: csrf.error }, { status: 403 });
  }

  // 🔑 2. Ruta Especial: Login Admin -> Recibe credenciales, autentica contra Backend y fija cookies HttpOnly
  if (isLoginRoute && req.method.toUpperCase() === 'POST') {
    try {
      const body = await req.json();
      const backendRes = await backendFetch(`${BACKEND_URL}/api/admin/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-App-Audience': BACKEND_AUDIENCE },
        body: JSON.stringify(body)
      });

      const data = await backendRes.json();
      if (!backendRes.ok || !data.success) {
        return NextResponse.json(data, { status: backendRes.status });
      }

      const { accessToken, refreshToken, admin } = data;
      const res = NextResponse.json({ success: true, admin });

      const isProd = process.env.NODE_ENV === 'production';
      res.cookies.set('glow_access_token', accessToken, {
        httpOnly: true,
        secure: isProd,
        sameSite: 'lax',
        path: '/',
        maxAge: 15 * 60
      });

      res.cookies.set('glow_refresh_token', refreshToken, {
        httpOnly: true,
        secure: isProd,
        sameSite: 'lax',
        path: '/',
        maxAge: 8 * 3600
      });

      return res;
    } catch (err: any) {
      const cause = err?.cause as { code?: string } | undefined;
      const unavailable = cause?.code === 'ECONNREFUSED' || cause?.code === 'ENOTFOUND' || cause?.code === 'ETIMEDOUT';
      return NextResponse.json({
        error: unavailable
          ? 'No se pudo conectar con el backend de GlowApp. Verifica que esté activo en BACKEND_INTERNAL_URL/BACKEND_URL (por defecto http://localhost:3000).'
          : 'Error interno en proxy login BFF: ' + (err?.message || 'error desconocido')
      }, { status: unavailable ? 502 : 500 });
    }
  }

  // 🔑 3. Ruta Especial: Logout Admin -> Revoca en Backend y limpia cookies HttpOnly
  if (isLogoutRoute && req.method.toUpperCase() === 'POST') {
    const accessToken = req.cookies.get('glow_access_token')?.value;
    const refreshToken = req.cookies.get('glow_refresh_token')?.value;

    try {
      if (accessToken || refreshToken) {
        await backendFetch(`${BACKEND_URL}/api/admin/auth/logout`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-App-Audience': BACKEND_AUDIENCE,
            ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {})
          },
          body: JSON.stringify({ refreshToken })
        });
      }
    } catch (_) {}

    const res = NextResponse.json({ success: true, message: 'Sesión cerrada.' });
    res.cookies.set('glow_access_token', '', { httpOnly: true, path: '/', maxAge: 0 });
    res.cookies.set('glow_refresh_token', '', { httpOnly: true, path: '/', maxAge: 0 });
    res.cookies.set('glow_token', '', { path: '/', maxAge: 0 });
    res.cookies.set('adminToken', '', { path: '/', maxAge: 0 });
    return res;
  }

  // 🔑 4. Ruta Especial: Session/Me Check -> Verifica firma JWT con jose
  if (isSessionRoute && req.method.toUpperCase() === 'GET') {
    const accessToken = req.cookies.get('glow_access_token')?.value;
    if (!accessToken) {
      return NextResponse.json({ error: 'No hay sesión activa.' }, { status: 401 });
    }
    const secretKey = getJwtSecretKey();
    if (!secretKey) {
      return NextResponse.json({ error: 'Configuración de autenticación incompleta en el servidor (JWT_SECRET faltante o inválido).' }, { status: 500 });
    }
    try {
      const { payload } = await jwtVerify(accessToken, secretKey);
      if (payload.rol !== 'ADMIN') {
        return NextResponse.json({ error: 'Acceso denegado.' }, { status: 403 });
      }
      return NextResponse.json({ authenticated: true, admin: payload });
    } catch (_) {
      return NextResponse.json({ error: 'Token inválido o expirado.' }, { status: 401 });
    }
  }

  // 🌐 5. Catch-All Proxy General hacia Backend
  let accessToken = req.cookies.get('glow_access_token')?.value;
  const refreshToken = req.cookies.get('glow_refresh_token')?.value;

  const targetUrl = new URL(`/api/${pathStr}`, BACKEND_URL);
  req.nextUrl.searchParams.forEach((val, key) => {
    targetUrl.searchParams.append(key, val);
  });

  const forwardHeaders: Record<string, string> = {};
  req.headers.forEach((val, key) => {
    const lowerKey = key.toLowerCase();
    // Sanitizar encabezados del cliente: eliminar host, cookie, authorization enviada por el cliente
    if (!['host', 'cookie', 'authorization', 'connection', 'content-length', 'x-app-audience'].includes(lowerKey)) {
      forwardHeaders[key] = val;
    }
  });
  delete forwardHeaders['x-app-audience'];

  if (accessToken) {
    forwardHeaders['authorization'] = `Bearer ${accessToken}`;
  }

  // Preservar cuerpo binario/multipart de forma intacta usando ArrayBuffer
  let bodyData: ArrayBuffer | undefined = undefined;
  if (!['GET', 'HEAD'].includes(req.method.toUpperCase())) {
    try {
      const arrayBuf = await req.arrayBuffer();
      if (arrayBuf.byteLength > 0) {
        bodyData = arrayBuf;
      }
    } catch (_) {}
  }

  try {
    let backendRes = await backendFetch(targetUrl.toString(), {
      method: req.method,
      headers: { ...forwardHeaders, 'X-App-Audience': BACKEND_AUDIENCE },
      body: bodyData
    });

    let updatedAccess = false;
    let refreshFailedClearCookies = false;
    let newAccessVal = '';
    let newRefreshVal = '';

    // Auto-Refresh si el token expiró (401) y hay refresh token en cookie
    if (backendRes.status === 401 && refreshToken) {
      try {
        const refreshRes = await backendFetch(`${BACKEND_URL}/api/admin/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-App-Audience': BACKEND_AUDIENCE },
          body: JSON.stringify({ refreshToken })
        });

        if (refreshRes.ok) {
          const refreshData = await refreshRes.json();
          if (refreshData.success && refreshData.accessToken) {
            updatedAccess = true;
            newAccessVal = refreshData.accessToken;
            newRefreshVal = refreshData.refreshToken || refreshToken;

            forwardHeaders['authorization'] = `Bearer ${newAccessVal}`;
            backendRes = await backendFetch(targetUrl.toString(), {
              method: req.method,
              headers: { ...forwardHeaders, 'X-App-Audience': BACKEND_AUDIENCE },
              body: bodyData
            });
          } else {
            refreshFailedClearCookies = true;
          }
        } else {
          refreshFailedClearCookies = true;
        }
      } catch (_) {
        refreshFailedClearCookies = true;
      }
    }

    const resContentType = backendRes.headers.get('content-type') || '';
    let resBody: any;
    if (resContentType.includes('application/json')) {
      resBody = await backendRes.json();
    } else {
      resBody = await backendRes.text();
    }

    const clientRes = resContentType.includes('application/json')
      ? NextResponse.json(resBody, { status: backendRes.status })
      : new NextResponse(resBody, { status: backendRes.status, headers: { 'Content-Type': resContentType } });

    if (updatedAccess) {
      const isProd = process.env.NODE_ENV === 'production';
      clientRes.cookies.set('glow_access_token', newAccessVal, {
        httpOnly: true,
        secure: isProd,
        sameSite: 'lax',
        path: '/',
        maxAge: 15 * 60
      });
      clientRes.cookies.set('glow_refresh_token', newRefreshVal, {
        httpOnly: true,
        secure: isProd,
        sameSite: 'lax',
        path: '/',
        maxAge: 8 * 3600
      });
    } else if (refreshFailedClearCookies) {
      clientRes.cookies.set('glow_access_token', '', { httpOnly: true, path: '/', maxAge: 0 });
      clientRes.cookies.set('glow_refresh_token', '', { httpOnly: true, path: '/', maxAge: 0 });
    }

    return clientRes;
  } catch (err: any) {
    const cause = err?.cause as { code?: string } | undefined;
    const unavailable = cause?.code === 'ECONNREFUSED' || cause?.code === 'ENOTFOUND' || cause?.code === 'ETIMEDOUT';
    return NextResponse.json({
      error: unavailable
        ? 'No se pudo conectar con el backend. Verifica BACKEND_INTERNAL_URL/BACKEND_URL.'
        : 'Error interno en proxy BFF: ' + (err?.message || 'error desconocido')
    }, { status: unavailable ? 502 : 500 });
  }
}

export const GET = handleProxyRequest;
export const POST = handleProxyRequest;
export const PUT = handleProxyRequest;
export const PATCH = handleProxyRequest;
export const DELETE = handleProxyRequest;
