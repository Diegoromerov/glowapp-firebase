# Variables de entorno — Railway `glowapp`

Configura el servicio del panel con estas variables:

| Variable | Valor |
| --- | --- |
| `BACKEND_INTERNAL_URL` | `http://glowapp-api.railway.internal:3000` |
| `JWT_SECRET` | `${{glowapp-api.JWT_SECRET}}` (referencia de Railway al secreto del servicio `glowapp-api`; no copiar el valor) |
| `NODE_ENV` | `production` |

`NEXT_PUBLIC_API_URL` queda eliminada del contrato. El panel se comunica con el backend a través de su BFF de mismo origen.

No se incluyen valores reales ni credenciales en este documento.
