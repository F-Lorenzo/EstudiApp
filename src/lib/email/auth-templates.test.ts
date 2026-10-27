import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AUTH_TEMPLATES, renderAuthTemplate } from "./auth-templates";

const DIR = path.join(process.cwd(), "supabase/email-templates");
const byName = (name: string) => AUTH_TEMPLATES.find((t) => t.supabaseName === name)!;
const hrefs = (html: string) => [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1].replaceAll("&amp;", "&"));

describe("plantillas de Supabase Auth", () => {
  it("los archivos para pegar están al día (si falla: npm run auth-emails)", () => {
    for (const template of AUTH_TEMPLATES) {
      expect(fs.readFileSync(path.join(DIR, template.file), "utf8"), template.file).toBe(renderAuthTemplate(template));
    }
    expect(fs.readdirSync(DIR).filter((f) => f.endsWith(".html")).sort()).toEqual(AUTH_TEMPLATES.map((t) => t.file).sort());
  });

  it("cada enlace pasa por /auth/confirm con su tipo escrito fijo", () => {
    const expected: Record<string, string> = {
      "Confirm signup": "type=email",
      "Reset password": "type=recovery",
      "Change email address": "type=email_change",
      "Magic link": "type=email",
      "Invite user": "type=invite&next=/actualizar-password",
    };
    for (const [name, query] of Object.entries(expected)) {
      expect(hrefs(renderAuthTemplate(byName(name)))).toEqual([`{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&${query}`]);
    }
  });

  it("nunca usa {{ .ConfirmationURL }}, que saltea la app", () => {
    for (const template of AUTH_TEMPLATES) expect(renderAuthTemplate(template)).not.toContain("ConfirmationURL");
  });

  it("el código de verificación y el email nuevo llegan a la plantilla", () => {
    expect(renderAuthTemplate(byName("Reauthentication"))).toContain("{{ .Token }}");
    expect(renderAuthTemplate(byName("Change email address"))).toContain("{{ .NewEmail }}");
  });

  it("no invitan a responder (Supabase no permite «Responder a»)", () => {
    for (const template of AUTH_TEMPLATES) expect(renderAuthTemplate(template)).not.toMatch(/respond(é|iendo|enos)/i);
  });
});
