# Variables de entorno — Railway `glowapp` staging

Configura el servicio del panel con estas variables:

| Variable | Valor |
| --- | --- |
| `BACKEND_INTERNAL_URL` | `http://glowapp-api-staging.railway.internal:3000` |
| `JWT_SECRET` | `${{glowapp-api-staging.JWT_SECRET}}` (referencia al secreto del servicio API de staging; no copiar el valor) |
| `NODE_ENV` | `production` |

`NEXT_PUBLIC_API_URL` queda eliminada del contrato. El panel se comunica con el backend a través de su BFF de mismo origen.

La raíz del servicio `admin-dashboard-staging` debe ser `/admin`. Estas variables aplican solo al entorno `staging`; no las copies a producción.

No se incluyen valores reales ni credenciales en este documento.
