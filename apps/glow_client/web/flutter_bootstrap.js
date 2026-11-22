{{flutter_js}}
{{flutter_build_config}}

// Detecta antes de iniciar Flutter el fallo de compilación WebGL que CanvasKit
// reporta en algunos navegadores/controladores. En esos equipos usa el backend
// de software; el resto conserva la aceleración gráfica normal.
function canvasKitShaderNeedsSoftwareFallback() {
  let gl;
  let shader;
  try {
    const canvas = document.createElement('canvas');
    gl = canvas.getContext('webgl2');
    if (!gl) return true;

    shader = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(shader, `#version 300 es
precision mediump float;
precision mediump sampler2D;
out mediump vec4 sk_FragColor;
uniform sampler2D uTextureSampler_0_S0;
in highp vec2 vlocalCoord_S0;
void main() {
  sk_FragColor = texture(uTextureSampler_0_S0, vlocalCoord_S0, -0.475);
}`);
    gl.compileShader(shader);
    const compiled = gl.getShaderParameter(shader, gl.COMPILE_STATUS);
    if (!compiled) {
      console.warn(
        '[GlowApp] WebGL no compila el shader de CanvasKit; usando renderizado de software.',
      );
    }
    return !compiled;
  } catch (error) {
    console.warn(
      '[GlowApp] No se pudo comprobar WebGL; usando renderizado de software.',
      error,
    );
    return true;
  } finally {
    if (gl && shader) gl.deleteShader(shader);
    const loseContext = gl?.getExtension('WEBGL_lose_context');
    loseContext?.loseContext();
  }
}

_flutter.loader.load({
  config: {
    canvasKitForceCpuOnly: canvasKitShaderNeedsSoftwareFallback(),
  },
  serviceWorkerSettings: {
    serviceWorkerVersion: {{flutter_service_worker_version}},
  },
});
