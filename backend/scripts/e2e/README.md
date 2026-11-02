# Arnés E2E de las reglas del dinero

Ejercita la API **real** contra una base **real**: crea cuentas y datos de prueba,
comprueba las reglas aprobadas (split, cancelación, propina, reprogramación, envío
e IVA) y borra todo al final.

No usa mocks a propósito. Los tres defectos que este arnés encontró —contrato con
500, reprogramación infinita e IVA cobrado dos veces— pasaban las pruebas unitarias
y solo aparecieron al ejecutar el flujo completo.

## Uso

```bash
cd backend
DATABASE_URL="postgres://postgres:pass@localhost:5432/glow" \
API_URL="http://localhost:8080" \
npm run e2e
```

| Variable | Para qué |
|---|---|
| `DATABASE_URL` | Obligatoria. El arnés lee la base para verificar los splits |
| `API_URL` | Base de la API. Por defecto `http://127.0.0.1:$PORT` |
| `E2E_PASSWORD` | **Obligatoria.** Contraseña de las cuentas efímeras (sin valor por defecto: un literal en el código lo marca el escáner de secretos) |
| `E2E_ALLOW_NON_LOCAL` | `true` para permitir un destino que no sea localhost |

Sale con **código 2** si alguna verificación falla, así que sirve en CI.

## Qué comprueba

| Bloque | Verificación |
|---|---|
| A | Login de cliente y prestador |
| B | Contrato: GET 200, aceptación 200 y persistida |
| C | Reserva creada y split **20 / 0 / 80** |
| D | Propina rechazada antes de completar, aceptada después, única |
| E | Reprogramación: primera 200, segunda **409**, contador en 1 |
| F | Cancelación **>24 h 100 %**, **2–24 h 50 %**, **<2 h 0 %** |
| G | Envío: umbral Bogotá 300.000 y nacional 480.000, retención de 1.000, IVA incluido |
| I | Estado de cuenta del prestador con sus saldos |

## Advertencias

- **Escribe y borra.** Nunca contra producción sin `E2E_ALLOW_NON_LOCAL=true`, y
  aun así: las cuentas de prueba aparecen unos segundos en el directorio.
- El cleanup corre con `session_replication_role = replica` porque el ledger de la
  billetera es append-only y el borrado de reservas dispara triggers que escriben
  en él.
- Si el catálogo no alcanza los umbrales con el stock disponible, los casos de
  envío salen **SKIP**, no PASS: un omitido no es una regla verificada.
- El checkout **descuenta stock**. El cleanup borra el pedido y restaura las
  unidades; aun así el arnés se niega a correr contra producción sin pedirlo.
