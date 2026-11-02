// C:\beauty-app\backend\src\controllers\oauthController.js
const { OAuth2Client } = require('google-auth-library');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const { pool } = require('../config/db');
const { getJwtSecret, toApiRole } = require('../config/jwt');

const DEFAULT_CLIENT_ID = '374223351186-0fukntsog02r0p1tofd2aju3c7lsr86j.apps.googleusercontent.com';

exports.googleSignIn = async (req, res) => {
  try {
    const { idToken, accessToken, role_intent } = req.body;
    if (!idToken && !accessToken) {
      return res.status(400).json({ error: 'Falta el idToken o accessToken de Google' });
    }

    let payload; // Declaración explícita: evita ReferenceError en modo estricto

    // Permitir token de prueba estrictamente en testing o con ALLOW_MOCK_AUTH === 'true'
    if ((process.env.NODE_ENV === 'test' || process.env.ALLOW_MOCK_AUTH === 'true') && idToken && idToken.startsWith('test_google_token_')) {
      const tokenSuffix = idToken.replace('test_google_token_', '');
      payload = {
        email: `${tokenSuffix}@gmail.com`,
        name: `User Google ${tokenSuffix}`,
        sub: `google_test_id_${tokenSuffix}`
      };
    } else if (idToken) {
      // PATH 1: Verificar idToken directamente (más seguro)
      const activeClientId = (process.env.GOOGLE_CLIENT_ID || DEFAULT_CLIENT_ID).trim();
      const oauthClient = new OAuth2Client(activeClientId);
      const ticket = await oauthClient.verifyIdToken({
        idToken: idToken,
        audience: [
          activeClientId,
          '374223351186-0fukntsog02r0p1tofd2aju3c7lsr86j.apps.googleusercontent.com',
          '374223351186-hi0m9k8778gfkg69spbkimgk73t51g5q.apps.googleusercontent.com',
          '466897054371-qaec2ipcc0pea91obs0ejcb9tene7kma.apps.googleusercontent.com'
        ].filter(Boolean)
      });
      payload = ticket.getPayload();
    } else {
      // PATH 2: Verificar accessToken via Google userinfo / tokeninfo API (fallback para GIS web flow)
      // google_sign_in_web 6.x con popup a veces solo devuelve accessToken, no idToken
      let userData;
      try {
        const userInfoRes = await axios.get('https://www.googleapis.com/oauth2/v3/userinfo', {
          headers: { Authorization: `Bearer ${accessToken}` }
        });
        userData = userInfoRes.data;
      } catch (err) {
        const tokenInfoRes = await axios.get(
          `https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(accessToken)}`
        ).catch(err2 => {
          throw new Error(`accessToken inválido: ${err2.response?.data?.error_description || err2.response?.data?.error || err2.message || err.message}`);
        });
        userData = tokenInfoRes.data;
      }

      if (!userData || !userData.email) {
        throw new Error('Google no devolvió email en la verificación del token');
      }
      payload = {
        email: userData.email,
        name: userData.name || userData.email,
        sub: userData.sub || userData.user_id
      };
    }

    const { email, name, sub: googleId } = payload;
    const cleanEmail = email.toLowerCase().trim();

    // Buscar si el usuario ya existe
    let userQuery = await pool.query('SELECT * FROM usuarios WHERE email = $1', [cleanEmail]);
    let user;

    if (userQuery.rows.length === 0) {
      // Determinar el rol según la intención enviada desde la UI
      const validRoles = ['CLIENTE', 'PRESTADOR', 'SALON'];
      const targetRole = (role_intent && validRoles.includes(role_intent.toUpperCase())) 
        ? role_intent.toUpperCase() 
        : null;
      const onboardingCompleto = targetRole === 'CLIENTE';

      const insertQuery = await pool.query(
        `INSERT INTO usuarios (nombre, email, auth_provider, provider_id, rol, onboarding_completo) 
         VALUES ($1, $2, 'GOOGLE', $3, $4, $5) 
         RETURNING id, nombre, email, rol, onboarding_completo`,
        [name || 'Usuario Google', cleanEmail, googleId, targetRole, onboardingCompleto]
      );
      user = insertQuery.rows[0];
    } else {
      user = userQuery.rows[0];
      // Vincular/actualizar proveedor
      if (user.auth_provider !== 'GOOGLE') {
        await pool.query(
          'UPDATE usuarios SET auth_provider = $1, provider_id = $2 WHERE id = $3',
          ['GOOGLE', googleId, user.id]
        );
        user.auth_provider = 'GOOGLE';
        user.provider_id = googleId;
      }
    }

    // Generar JWT
    const appToken = jwt.sign(
      { id: user.id, email: user.email, role: toApiRole(user.rol), rol: user.rol },
      getJwtSecret(),
      { expiresIn: '24h' }
    );

    res.status(200).json({
      success: true,
      token: appToken,
      user: {
        id: user.id.toString(),
        full_name: user.nombre,
        email: user.email,
        role: toApiRole(user.rol),
        onboarding_completo: user.onboarding_completo
      }
    });

  } catch (error) {
    console.error('❌ ERROR GOOGLE SIGN-IN:', error.message);
    res.status(401).json({ 
      error: 'Autenticación de Google inválida o fallida',
      details: error.message
    });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Facebook
// ─────────────────────────────────────────────────────────────────────────────
const GRAPH_VERSION = process.env.FACEBOOK_GRAPH_VERSION || 'v21.0';

/// POST /api/auth/facebook
///
/// Verifica el accessToken contra la Graph API y emite el JWT de GlowApp, con el
/// mismo contrato de respuesta que /api/auth/google.
///
/// La verificación es en dos pasos a propósito:
///   1. /debug_token con el app token: confirma que el token está vivo y que
///      pertenece a NUESTRA app (app_id). Sin esto, un token de cualquier otra
///      app de Facebook pasaría el /me y se emitiría un JWT por una cuenta ajena.
///   2. /me con el token del usuario: identidad y email.
///
/// Si FACEBOOK_APP_ID/SECRET no están definidos responde 501 en vez de aceptar el
/// token sin comprobarlo.
exports.facebookSignIn = async (req, res) => {
  try {
    const { accessToken, role_intent } = req.body;
    if (!accessToken) {
      return res.status(400).json({ error: 'Falta el accessToken de Facebook' });
    }

    const appId = (process.env.FACEBOOK_APP_ID || '').trim();
    const appSecret = (process.env.FACEBOOK_APP_SECRET || '').trim();
    const mockAllowed = process.env.NODE_ENV === 'test' || process.env.ALLOW_MOCK_AUTH === 'true';

    let fbUser;

    if (mockAllowed && accessToken.startsWith('test_facebook_token_')) {
      const sufijo = accessToken.replace('test_facebook_token_', '');
      fbUser = {
        id: `facebook_test_id_${sufijo}`,
        name: `User Facebook ${sufijo}`,
        email: `${sufijo}@facebook.com`,
      };
    } else {
      if (!appId || !appSecret) {
        return res.status(501).json({
          error: 'Facebook no configurado',
          details: 'Definir FACEBOOK_APP_ID y FACEBOOK_APP_SECRET en el servicio',
        });
      }

      const debug = await axios.get(`https://graph.facebook.com/${GRAPH_VERSION}/debug_token`, {
        params: { input_token: accessToken, access_token: `${appId}|${appSecret}` },
        timeout: 10000,
      });
      const info = debug.data && debug.data.data;
      if (!info || info.is_valid !== true) {
        throw new Error('accessToken inválido o expirado');
      }
      if (String(info.app_id) !== appId) {
        throw new Error(`El token pertenece a otra app de Facebook (${info.app_id})`);
      }

      const perfil = await axios.get(`https://graph.facebook.com/${GRAPH_VERSION}/me`, {
        params: { fields: 'id,name,email,picture.type(large)', access_token: accessToken },
        timeout: 10000,
      });
      fbUser = perfil.data;
    }

    if (!fbUser || !fbUser.id) {
      throw new Error('Facebook no devolvió identidad');
    }
    if (!fbUser.email) {
      return res.status(422).json({
        error: 'Facebook no devolvió email',
        details: 'La cuenta debe autorizar el permiso "email" al iniciar sesión',
      });
    }

    const cleanEmail = String(fbUser.email).toLowerCase().trim();
    const nombre = fbUser.name || 'Usuario Facebook';
    const providerId = String(fbUser.id);

    let userQuery = await pool.query('SELECT * FROM usuarios WHERE email = $1', [cleanEmail]);
    let user;

    if (userQuery.rows.length === 0) {
      const validRoles = ['CLIENTE', 'PRESTADOR', 'SALON'];
      const targetRole = role_intent && validRoles.includes(role_intent.toUpperCase())
        ? role_intent.toUpperCase()
        : null;
      const onboardingCompleto = targetRole === 'CLIENTE';

      const insertQuery = await pool.query(
        `INSERT INTO usuarios (nombre, email, auth_provider, provider_id, rol, onboarding_completo)
         VALUES ($1, $2, 'FACEBOOK', $3, $4, $5)
         RETURNING id, nombre, email, rol, onboarding_completo`,
        [nombre, cleanEmail, providerId, targetRole, onboardingCompleto]
      );
      user = insertQuery.rows[0];
    } else {
      user = userQuery.rows[0];
      if (user.auth_provider !== 'FACEBOOK') {
        await pool.query(
          'UPDATE usuarios SET auth_provider = $1, provider_id = $2 WHERE id = $3',
          ['FACEBOOK', providerId, user.id]
        );
        user.auth_provider = 'FACEBOOK';
        user.provider_id = providerId;
      }
    }

    const appToken = jwt.sign(
      { id: user.id, email: user.email, role: toApiRole(user.rol), rol: user.rol },
      getJwtSecret(),
      { expiresIn: '24h' }
    );

    return res.status(200).json({
      success: true,
      token: appToken,
      user: {
        id: user.id.toString(),
        full_name: user.nombre,
        email: user.email,
        role: toApiRole(user.rol),
        onboarding_completo: user.onboarding_completo,
      },
    });
  } catch (error) {
    console.error('❌ ERROR FACEBOOK SIGN-IN:', error.message);
    return res.status(401).json({
      error: 'Autenticación de Facebook inválida o fallida',
      details: error.message,
    });
  }
};
