// Escribe las plantillas de los emails de Supabase Auth en supabase/email-templates/, listas para pegar en
// Supabase → Authentication → Emails → Templates. Salen de src/lib/email/auth-templates.ts (la misma maqueta que los
// avisos de la app). Uso: npm run auth-emails
import fs from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";

// El código de src/ importa sin extensión («./layout»), como pide Next.js; Node necesita «./layout.ts».
registerHooks({
  resolve(specifier, context, next) {
    if (/^\.\.?\//.test(specifier) && !/\.[cm]?[jt]s$/.test(specifier) && context.parentURL?.includes("/src/")) {
      return next(`${specifier}.ts`, context);
    }
    return next(specifier, context);
  },
});
const { AUTH_TEMPLATES, renderAuthTemplate } = await import("../src/lib/email/auth-templates.ts");

const dir = fileURLToPath(new URL("../supabase/email-templates/", import.meta.url));
fs.mkdirSync(dir, { recursive: true });
for (const template of AUTH_TEMPLATES) {
  fs.writeFileSync(`${dir}${template.file}`, renderAuthTemplate(template));
  console.log(`${template.file}  ←  ${template.supabaseName}  (asunto: «${template.subject}»)`);
}
