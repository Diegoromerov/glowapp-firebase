# Protección de datos de retiro

La app cifra con AES-256-GCM el número de cuenta, el nombre y el documento del titular en `provider_wallet`, los respaldos de la cuenta aprobada y los números de cuenta guardados en snapshots de `retiros`. Los endpoints descifran esos valores solo en memoria al validar, mostrar a personal autorizado o preparar la dispersión. Las respuestas del prestador muestran la cuenta enmascarada.

## Activación por ambiente

1. Generar una clave aleatoria independiente de JWT, biometría y otras claves. Acepta 32 bytes UTF-8 o 64 caracteres hexadecimales. Guardarla en el gestor de secretos como `PAYOUT_DATA_ENCRYPTION_KEY`; conservar una copia de recuperación con acceso restringido.
2. Aplicar la migración 186 antes de que el código nuevo reciba tráfico y desplegar el backend con la clave configurada. El servicio falla cerrado al intentar cifrar/descifrar si falta la clave.
3. Cuando las instancias anteriores hayan salido del tráfico, con `DATABASE_URL_ADMIN` apuntando al mismo entorno y la misma clave, ejecutar desde `backend`: `node scripts/encryptPayoutData.js`. El proceso es reejecutable; no imprime valores sensibles.
4. Confirmar que el script terminó y después monitorear configuración de cuenta, aprobación administrativa y un retiro de sandbox antes de habilitar producción.

No rotar ni reemplazar la clave sin un procedimiento de recifrado y respaldo probado. La compatibilidad con filas legadas en texto claro existe para permitir la migración; las escrituras nuevas siempre quedan cifradas.

## Plazo de revisión

`payout_account_review_sla_hours` define el objetivo en horas calendario, inicialmente 48. El API del prestador devuelve la fecha estimada y el formulario informa el plazo. Ajustarlo en `platform_config` según la capacidad operativa; no representa una garantía legal ni detiene la cola cuando vence.
