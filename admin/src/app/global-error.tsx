'use client';

/**
 * Límite de error raíz (App Router).
 *
 * Sin este archivo, cualquier excepción en un componente cliente muestra la
 * página genérica de Next ("Application error: a client-side exception has
 * occurred"), que no dice QUÉ falló. Aquí se muestra el mensaje y el digest
 * para poder diagnosticar sin abrir la consola.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="es">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'grid',
          placeItems: 'center',
          padding: '2rem',
          fontFamily:
            "Inter, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
          background: '#0a0c0d',
          color: '#f3f4f5',
        }}
      >
        <div
          style={{
            maxWidth: '42rem',
            width: '100%',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: '12px',
            background: '#1c1f22',
            padding: '1.5rem',
          }}
        >
          <h1 style={{ margin: 0, fontSize: '1.125rem', fontWeight: 600 }}>
            Se produjo un error al cargar el panel
          </h1>
          <p style={{ margin: '0.5rem 0 1rem', color: '#b8bcc3', fontSize: '0.875rem' }}>
            Copia el mensaje siguiente para diagnosticarlo.
          </p>

          <pre
            style={{
              margin: 0,
              padding: '0.75rem',
              borderRadius: '8px',
              background: '#121517',
              border: '1px solid rgba(255,255,255,0.08)',
              color: '#f3f4f5',
              fontSize: '0.8125rem',
              whiteSpace: 'pre-wrap',
              overflowWrap: 'anywhere',
            }}
          >
            {error?.message || 'Error desconocido (sin mensaje)'}
            {error?.digest ? `\n\ndigest: ${error.digest}` : ''}
          </pre>

          <details style={{ marginTop: '0.75rem' }}>
            <summary
              style={{ cursor: 'pointer', color: '#b8bcc3', fontSize: '0.8125rem', marginBottom: '0.5rem' }}
            >
              Traza tecnica (desplegar y copiar para diagnosticar)
            </summary>
            <pre
              style={{
                margin: 0,
                padding: '0.75rem',
                borderRadius: '8px',
                background: '#121517',
                border: '1px solid rgba(255,255,255,0.08)',
                color: '#b8bcc3',
                fontSize: '0.75rem',
                whiteSpace: 'pre-wrap',
                overflowWrap: 'anywhere',
                maxHeight: '22rem',
                overflow: 'auto',
              }}
            >
              {[
                `url: ${typeof window !== 'undefined' ? window.location.href : '(ssr)'}`,
                `digest: ${error?.digest ?? '-'}`,
                '',
                error?.stack ?? '(sin stack)',
              ].join('\n')}
            </pre>
          </details>

          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}>
            <button
              onClick={() => reset()}
              style={{
                padding: '0.5rem 0.875rem',
                borderRadius: '6px',
                border: '1px solid #c5a052',
                background: '#c5a052',
                color: '#0a0c0d',
                fontWeight: 600,
                fontSize: '0.875rem',
                cursor: 'pointer',
              }}
            >
              Reintentar
            </button>
            <button
              onClick={() => window.location.reload()}
              style={{
                padding: '0.5rem 0.875rem',
                borderRadius: '6px',
                border: '1px solid rgba(255,255,255,0.12)',
                background: 'transparent',
                color: '#f3f4f5',
                fontWeight: 500,
                fontSize: '0.875rem',
                cursor: 'pointer',
              }}
            >
              Recargar
            </button>
            <a
              href="/login"
              style={{
                padding: '0.5rem 0.875rem',
                borderRadius: '6px',
                border: '1px solid rgba(255,255,255,0.12)',
                color: '#f3f4f5',
                fontWeight: 500,
                fontSize: '0.875rem',
                textDecoration: 'none',
              }}
            >
              Ir a login
            </a>
          </div>
        </div>
      </body>
    </html>
  );
}
