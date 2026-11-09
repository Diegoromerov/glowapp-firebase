/**
 * Lógica pura de las métricas de PQRSF en el dashboard raíz (F5).
 *
 * POR QUÉ VIVE APARTE DE LA PANTALLA: `src/app/page.tsx` es un componente cliente y no se puede
 * importar desde `node --test`. Estas funciones sí, así que la parte con lógica —el formato de los
 * tiempos y el orden de las prioridades— se prueba de verdad y no por lectura del fuente.
 */

export interface PqrsfPrioridad {
  prioridad: string;
  total: number;
  abiertos: number;
  sin_respuesta: number;
  vencidos: number;
  minutos_medio_respuesta: number | null;
  minutos_medio_resolucion: number | null;
}

export interface PqrsfArcoAbierta {
  id: number;
  asunto?: string | null;
  estado: string;
  prioridad: string;
  fecha_creacion: string;
  limite_legal: string;
  vencido_legal: boolean;
  dias_habiles_restantes: number;
}

export interface PqrsfMetricas {
  total: number;
  abiertos: number;
  vencidos: number;
  sin_respuesta: number;
  por_estado: { estado: string; total: number }[];
  por_prioridad: PqrsfPrioridad[];
  arco: { plazo_dias_habiles: number; festivos_incluidos: boolean; abiertas: PqrsfArcoAbierta[] };
}

/**
 * Minutos a texto legible. Un valor ausente se declara «Sin datos», nunca 0: decir 0 minutos es
 * afirmar que se respondió al instante.
 */
export function formatMinutos(min: number | null | undefined): string {
  if (min === null || min === undefined || Number.isNaN(Number(min))) return 'Sin datos';
  const total = Math.max(0, Math.round(Number(min)));
  if (total < 60) return `${total} min`;
  const horas = Math.floor(total / 60);
  const resto = total % 60;
  if (horas < 24) return resto === 0 ? `${horas} h` : `${horas} h ${resto} min`;
  const dias = Math.floor(horas / 24);
  const horasResto = horas % 24;
  return horasResto === 0 ? `${dias} d` : `${dias} d ${horasResto} h`;
}

/**
 * Ordena las filas por riesgo SIN copiar la lista de prioridades. Una lista copiada en la pantalla
 * se desincroniza en cuanto una migración añade un valor (el botón «Atender» de SOS fallaba justo
 * por eso), así que el orden sale de los datos: primero las que tienen vencidos, luego las que
 * tienen sin responder, y a igualdad, más abiertos primero.
 */
export function prioridadesPorRiesgo(filas: PqrsfPrioridad[] | null | undefined): PqrsfPrioridad[] {
  const lista = Array.isArray(filas) ? [...filas] : [];
  return lista.sort(
    (a, b) =>
      (b.vencidos ?? 0) - (a.vencidos ?? 0) ||
      (b.sin_respuesta ?? 0) - (a.sin_respuesta ?? 0) ||
      (b.abiertos ?? 0) - (a.abiertos ?? 0) ||
      String(a.prioridad).localeCompare(String(b.prioridad))
  );
}
