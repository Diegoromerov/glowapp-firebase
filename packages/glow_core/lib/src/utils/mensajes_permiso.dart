// Ítem 12 — qué decirle al usuario cuando niega un permiso.
//
// Un "permiso denegado" a secas deja al usuario sin salida: no sabe dónde se
// cambia ni que la app puede volver a intentarlo. El mensaje depende del
// sistema, porque el camino para revertirlo es distinto en cada uno.
//
// Es una función pura a propósito: se puede probar sin cámara, sin navegador y
// sin dispositivo.

/// Devuelve el texto que se le muestra al usuario tras negar [recurso].
///
/// [recurso] es lo que se estaba pidiendo ("cámara", "ubicación",
/// "notificaciones"). [esWeb] cambia la instrucción: en el navegador el permiso
/// se revierte desde el candado de la barra de direcciones; en Android, desde
/// los ajustes de la aplicación.
String mensajePermisoDenegado(
  String recurso, {
  required bool esWeb,
  bool permanente = false,
}) {
  final r = recurso.trim().isEmpty ? 'este permiso' : recurso.trim();

  if (esWeb) {
    return 'El navegador bloqueó el acceso a $r. Pulsa el candado de la barra '
        'de direcciones, permite $r y vuelve a intentar.';
  }
  if (permanente) {
    return 'El acceso a $r está bloqueado. Ábrelo en Ajustes → Aplicaciones → '
        'GlowApp → Permisos, actívalo y vuelve a intentar.';
  }
  return 'Necesitamos acceso a $r para continuar. Puedes permitirlo en Ajustes '
      '→ Aplicaciones → GlowApp → Permisos.';
}

/// Códigos con los que el plugin de cámara reporta una denegación.
///
/// `CameraAccessDeniedWithoutPrompt` y `CameraAccessRestricted` se colaban como
/// "no se pudo abrir la cámara", que es un mensaje que no ayuda a nadie.
const Set<String> codigosCamaraDenegada = {
  'cameraPermission',
  'CameraAccessDenied',
  'CameraAccessDeniedWithoutPrompt',
  'CameraAccessRestricted',
};

/// ¿El código de error corresponde a un permiso negado?
bool esDenegacionDeCamara(String? codigo) =>
    codigo != null && codigosCamaraDenegada.contains(codigo);
