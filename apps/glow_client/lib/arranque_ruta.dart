/// Ruta con la que abrió la app, leída de la URL una sola vez.
///
/// Vive fuera de `main.dart` para que las pantallas puedan consultarla sin
/// importar el punto de entrada. Sirve para no montar cosas que son del mapa
/// (el tour) cuando la app abrió directo en otra pantalla por un enlace: el tour
/// se pintaba encima del login y tapaba el formulario.
String? rutaInicialDeLaUrl;
