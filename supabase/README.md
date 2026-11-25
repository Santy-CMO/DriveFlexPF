# Configurar inventario y pedidos DriveFlex

La web actual es estática; para guardar reservas y sincronizar disponibilidad entre visitantes necesita un backend. Esta implementación usa Supabase (Postgres, Auth y Realtime).

## Instalación

1. Crea un proyecto en [Supabase](https://supabase.com/) y abre **SQL Editor**.
2. Ejecuta el contenido de `supabase/schema.sql`. Incluye las tablas `vehicles` y `reservations`, reglas de solapamiento para que una unidad no se rente dos veces, funciones seguras para reservar, datos demo y publicación Realtime.
3. En **Project Settings → API**, copia el Project URL y la clave **anon/public**. Copia `supabase-config.js` y reemplaza los dos valores de ejemplo. La clave anon es pública por diseño; las políticas SQL y las funciones autorizadas protegen los datos. **Nunca uses `service_role` en el navegador.**
4. Publica el sitio como estático (por ejemplo, GitHub Pages) y comprueba que `reservas.html` y `dashboard.html` se sirvan desde la misma carpeta que los demás archivos.
5. En Supabase **Authentication → Users**, crea el usuario administrador con correo y contraseña. Después, en SQL Editor, autorízalo:

```sql
insert into public.admin_users (user_id)
select id from auth.users where email = 'admin@tudominio.com'
on conflict (user_id) do nothing;
```

La tabla admin_users es la lista de acceso. No publiques ni compartas la contraseña.

## Uso

- `reservas.html`: muestra existencias por modelo, deshabilita en el calendario los días sin unidades y crea el pedido de manera atómica. Las altas/cambios de pedidos actualizan el stock en tiempo real para los clientes conectados.
- `dashboard.html`: requiere iniciar sesión con un usuario incluido en `admin_users`; permite revisar pedidos y cambiar su estado. Los estados pendiente, confirmado y rentado reservan las fechas. Cancelado y completado liberan la unidad.
- Ajusta las unidades demo en `vehicles` desde Supabase o agrega las tuyas. `unit_code` debe ser único. No guardes placas/datos que no necesites.

Para enlazar el flujo desde las páginas actuales, agrega un enlace a `reservas.html` en la navegación de `index.html`, `catalogo.html` y `contacto.html`.

## Consideraciones antes de producción

El cliente está preparado para una demo funcional, no sustituye medidas antifraude. Configura CAPTCHA/rate limiting en un endpoint confiable antes de aceptar reservas públicas, políticas de privacidad/retención de datos y copias de seguridad. La solicitud queda como **pendiente** y bloquea fechas hasta que se cancele o complete. La confirmación del pedido y el cobro deben manejarse por procesos seguros separados.
