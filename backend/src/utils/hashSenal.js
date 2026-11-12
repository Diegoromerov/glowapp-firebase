// src/utils/hashSenal.js
//
// Hash de señales del visitante (IP, user-agent, id de dispositivo) para el
// antifraude del programa de referidos.
//
// Se guarda el HASH, nunca el dato en claro: alcanza para detectar que dos
// cuentas comparten origen sin acumular datos personales. Es la misma función en
// el enlace de invitación y en el registro, para que las dos huellas sean
// comparables.
const crypto = require('crypto');

/// Hash estable y corto de un valor. Devuelve `null` si no hay valor: un hash de
/// cadena vacía sería idéntico para todas las peticiones y marcaría a todo el
/// mundo como sospechoso.
function hashSenal(valor) {
  const limpio = String(valor || '').trim();
  if (!limpio) return null;
  return crypto.createHash('sha256').update(limpio).digest('hex').slice(0, 64);
}

/// Huellas de una petición de registro. El dispositivo combina user-agent y un
/// id de instalación si la app lo envía; sin ese id el user-agent solo ya separa
/// plataformas, pero no dos teléfonos iguales.
function huellasDePeticion(req) {
  const ua = String(req.header('user-agent') || '');
  const dispositivo = req.header('x-device-id');
  return {
    ipHash: hashSenal(req.ip),
    deviceHash: hashSenal(dispositivo ? `${ua}|${dispositivo}` : ua),
  };
}

module.exports = { hashSenal, huellasDePeticion };
