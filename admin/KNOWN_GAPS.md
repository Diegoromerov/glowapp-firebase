# Known gaps

- `/api/categorias` no existe en el backend.
- La página VTO es un stub y no hace llamadas al backend.
- No hay interfaz para superadmin ni gestión de tenants.
- El panel modela un solo rol administrativo: `ADMIN`.
- Las rutas cliente `/api/bookings`, `/api/chat`, `/api/auth/register` y `/api/users/profile` no forman parte del contrato funcional de este panel. El prefijo amplio `users/` sí está en el allowlist del BFF actual; eso no implica soporte de la pantalla de perfil cliente en este panel.
- `useSocket` depende de `NEXT_PUBLIC_WS_URL` para WebSocket.
