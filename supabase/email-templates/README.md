# Plantillas de los emails de Supabase Auth

Los emails de las cuentas (confirmar el registro, recuperar la contraseña…) los manda Supabase, no la app. Estas
plantillas les dan la misma estética que los avisos de EstudiApp. **No se editan a mano:** salen de
`src/lib/email/auth-templates.ts` con `npm run auth-emails`, y una prueba falla si quedan desactualizadas.

## Cómo cargarlas

✅ Cargadas en el proyecto real el 27 de octubre de 2026. Si cambiás un texto en `auth-templates.ts`, corré
`npm run auth-emails` y volvé a pegar la plantilla que cambió.

En Supabase → **Authentication → Emails → Templates**, para cada plantilla de la tabla:

1. Elegí la pestaña con el nombre de la columna «En Supabase».
2. En **Subject**, pegá el asunto.
3. En **Message body** (modo código / Source), borrá todo y pegá el contenido completo del archivo.
4. **Save**.

| Archivo | En Supabase | Asunto | Cuándo sale |
| --- | --- | --- | --- |
| `confirmar-registro.html` | Confirm signup | Confirmá tu cuenta de EstudiApp | Al registrarse un alumno o un docente. |
| `recuperar-contrasena.html` | Reset password | Elegí una nueva contraseña | «Olvidé mi contraseña» en `/recuperar-password`. |
| `cambio-de-email.html` | Change email address | Confirmá tu nuevo email | Cuando una cuenta cambia su email. |
| `enlace-de-acceso.html` | Magic link | Tu enlace para entrar a EstudiApp | Enlace para entrar sin contraseña (la app no lo ofrece, pero Supabase lo puede mandar). |
| `invitacion.html` | Invite user | Te invitaron a EstudiApp | Al invitar a alguien desde Authentication → Users → Invite. |
| `codigo-de-verificacion.html` | Reauthentication | Tu código de verificación | Código para confirmar que sos vos antes de un cambio sensible. |

Las dos primeras son las que usa la app todos los días; las otras cuatro conviene cargarlas igual, para que ningún
email de EstudiApp salga con el diseño en inglés de Supabase.

## Qué tienen

- Las variables entre llaves (`{{ .SiteURL }}`, `{{ .TokenHash }}`, `{{ .NewEmail }}`, `{{ .Token }}`) las completa
  Supabase al enviar: van tal cual.
- Los enlaces pasan por `/auth/confirm` con el tipo escrito fijo (`type=email`, `recovery`, `email_change`, `invite`),
  que es lo que espera `src/app/auth/confirm/route.ts`. Nunca `{{ .ConfirmationURL }}`, que saltea la app. La
  invitación lleva además `next=/actualizar-password`, porque una cuenta invitada todavía no tiene contraseña.
- `{{ .SiteURL }}` es el **Site URL** de Authentication → URL Configuration: tiene que ser `https://estudiapp.app`.
- Sin imágenes (muchos clientes las bloquean) y con estilos en línea, como los avisos de la app.
- El pie dice que no hace falta responder: Supabase no permite «Responder a», y `avisos@estudiapp.app` no recibe correo.

## Probar

Pedí «Olvidé mi contraseña» en `https://estudiapp.app/recuperar-password` con tu cuenta: tiene que llegar con el
diseño nuevo y, al tocar el botón, abrir la pantalla para elegir la contraseña.
