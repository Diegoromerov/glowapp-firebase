# Pruebas de integración que necesitan una base de datos real

Aquí no hay `*.test.js`: nada de esta carpeta entra en el gate de jest, a propósito.
Estas pruebas necesitan un Postgres de verdad y un rol propio, así que se corren a mano.

## Por qué existe esta carpeta

El backend trae `src/config/pgMemory.js`, un harness en memoria que sustituye la base por
**pg-mem** cuando `NODE_ENV=test` o `JEST_WORKER_ID` está definido. Ese harness declara el
esquema **permisivo a propósito**: sin claves foráneas y sin `CHECK`.

Consecuencia que importa: **cualquier prueba de restricciones bajo pg-mem es vacua.** Un
valor que el `CHECK` de producción rechaza pasa sin ruido. Esa es exactamente la clase de
defecto que dejó el botón "Atender" de SOS sin hacer nada (el código escribía un valor que
la tabla no admitía y el fallo llegaba como 500).

Por eso estas pruebas fuerzan la base real con `USE_PG_MEM=false` — es la bandera de casa
para pedir PostgreSQL (`pideBaseReal()` en `pgMemory.js`) — y **abortan si el motor no es
PostgreSQL**, en lugar de dar un verde que no significa nada.

## PQRSF Fase 2 — endpoints de gestión desde el panel

Ejercita los seis endpoints del controlador de verdad (bandeja con filtros, métricas,
esquema, detalle con hilo, cambio de estado y prioridad, y respuesta del operador) y
comprueba lo escrito en la base, no solo lo que devolvió la respuesta. 26 casos.

### Preparar

El contenedor `glow-ci-pg` sirve (requiere superusuario). **No hay credenciales en este
repositorio**: elegí vos la clave del rol desechable y pasala por entorno.

```bash
export PQRSF_TEST_DB_PASSWORD='<clave-que-elijas>'

docker exec -i glow-ci-pg psql -U postgres -c \
  "CREATE ROLE f2test LOGIN PASSWORD '$PQRSF_TEST_DB_PASSWORD';"
docker exec -i glow-ci-pg psql -U postgres -c "CREATE DATABASE f2test OWNER f2test;"

M=backend/migrations
for f in backend/tests/integracion/pqrsfF2.stubs.sql \
         $M/007_soporte_y_pqrsf.sql $M/045_add_arco_suppresion_ticket_type.sql \
         $M/081_pqrsf_sla_y_autor.sql backend/tests/integracion/pqrsfF2.seed.sql; do
  docker exec -i glow-ci-pg psql -U postgres -d f2test -v ON_ERROR_STOP=1 -f - < "$f"
done
docker exec -i glow-ci-pg psql -U postgres -d f2test \
  -c "GRANT ALL ON SCHEMA public TO f2test; GRANT ALL ON ALL TABLES IN SCHEMA public TO f2test;"
```

### Correr

```bash
PQRSF_TEST_DB_PASSWORD='<clave-que-elijas>' \
  node backend/tests/integracion/pqrsfF2.integracion.js

# o con una URL completa, si preferís otra base:
PQRSF_TEST_DATABASE_URL='postgres://usuario:clave@host:5432/base' \
  node backend/tests/integracion/pqrsfF2.integracion.js
```

Los casos **mutan** el estado (cierran tickets, responden), así que una segunda corrida
sobre la misma base falla por datos y no por código: volvé a aplicar el esquema y la semilla
antes de repetir.

### Limpiar

```bash
docker exec -i glow-ci-pg psql -U postgres -c "DROP DATABASE f2test;"
docker exec -i glow-ci-pg psql -U postgres -c "DROP ROLE f2test;"
```
