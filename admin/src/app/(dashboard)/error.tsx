'use client';

import React from 'react';

/**
 * Límite de error por segmento. Se renderiza dentro del layout de la app
 * (conserva el CSS del tema) y evita la página genérica de Next, mostrando
 * el mensaje real del fallo.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="content-area">
      <div className="card">
        <div className="card-header">
          <div>
            <h2 className="card-title">Se produjo un error en esta pantalla</h2>
            <p className="card-subtitle">
              Copia el mensaje siguiente para diagnosticarlo.
            </p>
          </div>
        </div>
        <div className="card-content space-y-4">
          <pre
            className="code"
            style={{
              margin: 0,
              padding: '0.75rem',
              borderRadius: '8px',
              background: 'var(--bg-panel)',
              border: '1px solid var(--border-standard)',
              whiteSpace: 'pre-wrap',
              overflowWrap: 'anywhere',
            }}
          >
            {error?.message || 'Error desconocido (sin mensaje)'}
            {error?.digest ? `\n\ndigest: ${error.digest}` : ''}
          </pre>
          <details>
            <summary
              style={{ cursor: 'pointer', color: 'var(--text-muted)', fontSize: '0.8125rem', marginBottom: '0.5rem' }}
            >
              Traza tecnica (desplegar y copiar para diagnosticar)
            </summary>
            <pre
              className="code"
              style={{
                margin: 0,
                padding: '0.75rem',
                borderRadius: '8px',
                background: 'var(--bg-panel)',
                border: '1px solid var(--border-standard)',
                whiteSpace: 'pre-wrap',
                overflowWrap: 'anywhere',
                maxHeight: '22rem',
                overflow: 'auto',
                fontSize: '0.75rem',
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
          <div className="flex items-center gap-3">
            <button onClick={() => reset()} className="btn btn-primary">
              Reintentar
            </button>
            <button
              onClick={() => window.location.reload()}
              className="btn btn-secondary"
            >
              Recargar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
