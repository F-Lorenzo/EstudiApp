import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { sql, value } from "./db";

/**
 * El recorrido completo de EstudiApp, de punta a punta, con la app y un Supabase reales (ROADMAP, Fase 4, ítem 4):
 *
 *   registro del docente → perfil → aprobación de la administración → cuenta de cobro y horarios → registro del
 *   alumno → búsqueda → reserva → pago (simulado) → clase → calificación → opinión pública
 *
 * Lo que no se puede hacer desde la app se hace en la base, como desde el SQL Editor (`db.ts`): dar el rol de
 * administración, vincular una cuenta de Mercado Pago de mentira (sin Mercado Pago no hay cómo) y adelantar el
 * reloj para que la clase ya haya pasado (sin Daily, la asistencia se anota con la función que usa el servidor).
 */

const PASSWORD = "clave-de-prueba-123";
const DOCENTE = { name: "Marina Prueba", email: "docente.e2e@estudiapp.test" };
const ALUMNO = { name: "Tomás Ensayo", email: "alumno.e2e@estudiapp.test" };
const ADMIN = { name: "Equipo Prueba", email: "admin.e2e@estudiapp.test" };

/** El id de una cuenta por su email. */
const idOf = (email: string) => value(`select id from auth.users where email = '${email}'`);
let bookingId = "";

test.describe.configure({ mode: "serial" });

async function register(page: Page, role: "alumno" | "docente", who: { name: string; email: string }) {
  await page.goto(`/registro/${role}`);
  await page.fill('input[name="fullName"]', who.name);
  await page.fill('input[name="email"]', who.email);
  await page.fill('input[name="password"]', PASSWORD);
  await page.fill('input[name="confirmPassword"]', PASSWORD);
  await page.check('input[name="terms"]');
  await page.getByRole("button", { name: /Crear mi cuenta/ }).click();
  await expect(page).toHaveURL(/\/registro\/confirmar-email/);
}

async function login(browser: Browser, email: string): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("/login");
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', PASSWORD);
  await page.getByRole("button", { name: /Ingresar/ }).click();
  await expect(page).not.toHaveURL(/\/login/);
  return page;
}

test("el docente se registra y completa su perfil", async ({ browser, page }) => {
  await register(page, "docente", DOCENTE);
  const docente = await login(browser, DOCENTE.email);

  await docente.goto("/docente/perfil");
  await docente.fill('[name="fullName"]', DOCENTE.name);
  await docente.fill(
    '[name="bio"]',
    "Doy clases de matemática hace diez años. Empiezo por lo que ya sabés y avanzamos con ejercicios a tu ritmo.",
  );
  await docente.getByRole("button", { name: /Continuar/ }).click();
  await docente.getByRole("button", { name: /^Matemática/ }).click();
  await docente.fill('[name="nivelAcademico"]', "Profesora de Matemática (UBA)");
  await docente.getByRole("button", { name: /Continuar/ }).click();
  await docente.fill('[name="tarifaPorClase"]', "15000");
  await docente.fill('[name="contactoVerificacion"]', "+54 11 5555-0000");
  await docente.getByRole("button", { name: /Guardar perfil/ }).click();
  await expect(docente.getByText("Perfil en revisión")).toBeVisible();

  expect(value(`select verification_status from public.tutor_profiles tp join auth.users u on u.id = tp.id where u.email = '${DOCENTE.email}'`)).toBe("pendiente");
  // Un perfil pendiente no aparece en el catálogo.
  await page.goto("/docentes");
  await expect(page.getByText(DOCENTE.name)).toHaveCount(0);
});

test("la administración aprueba el perfil y el docente aparece en el catálogo", async ({ browser, page }) => {
  // La cuenta de administración se crea como cualquier otra y el rol se da desde la base (como en el SQL Editor):
  // desde la app nadie puede darse ese rol (migración 0006).
  await register(page, "alumno", ADMIN);
  sql(`update public.profiles set role = 'administrador' where id = '${idOf(ADMIN.email)}'`);

  const admin = await login(browser, ADMIN.email);
  await admin.goto("/admin/docentes/pendientes");
  await admin.getByRole("link", { name: new RegExp(DOCENTE.name) }).click();
  await admin.getByRole("button", { name: /Aprobar perfil/ }).click();
  // Vuelve a la lista, que queda vacía.
  await expect(admin.getByText("No hay solicitudes pendientes.")).toBeVisible();

  const tutorId = idOf(DOCENTE.email);
  await admin.goto(`/admin/docentes/${tutorId}`);
  await expect(admin.getByText("El perfil es visible en el catálogo.")).toBeVisible();
  expect(value(`select verification_status from public.tutor_profiles where id = '${tutorId}'`)).toBe("aprobado");
  // La decisión queda en el registro y el docente tiene su email en la bandeja.
  expect(value(`select count(*) from public.audit_log where target_id = '${tutorId}' and action = 'aprobar' and actor_kind = 'administracion'`)).toBe("1");
  expect(value(`select count(*) from public.email_outbox where recipient_id = '${tutorId}' and kind = 'perfil_aprobado'`)).toBe("1");

  await admin.goto("/admin/registro");
  await expect(admin.getByText(DOCENTE.name).first()).toBeVisible();

  await page.goto("/docentes");
  await expect(page.getByText(DOCENTE.name).first()).toBeVisible();
});

test("el docente vincula su cuenta de cobro y publica horarios", async ({ browser }) => {
  const tutorId = idOf(DOCENTE.email);
  // Sin Mercado Pago no hay cómo vincular una cuenta de verdad: se anota una de mentira, como en las pruebas de la base.
  sql(`insert into public.mp_credentials (tutor_id, mp_user_id, access_token, refresh_token, expires_at)
       values ('${tutorId}', 'e2e-vendedor', 'relleno-no-valido', 'relleno-no-valido', now() + interval '100 days')`);

  const docente = await login(browser, DOCENTE.email);
  // La semana que viene, para que ningún horario esté demasiado cerca.
  await docente.goto("/docente/disponibilidad?semana=1");
  const closed = docente.getByRole("button", { name: /cerrado, tocar para abrir/ });
  await closed.nth(10).click();
  await closed.nth(10).click();
  await docente.getByRole("button", { name: /Guardar cambios \(2\)/ }).click();
  await expect(docente.getByText(/Listo:/)).toBeVisible();
  expect(value(`select count(*) from public.availability_slots where tutor_id = '${tutorId}'`)).toBe("2");
});

test("el alumno se registra, busca al docente, reserva y paga", async ({ browser, page }) => {
  await register(page, "alumno", ALUMNO);
  const alumno = await login(browser, ALUMNO.email);

  await alumno.goto("/docentes");
  const search = alumno.getByRole("searchbox");
  await search.fill("marina");
  await search.press("Enter");
  await alumno.getByRole("link", { name: new RegExp(DOCENTE.name) }).first().click();
  await expect(alumno.getByRole("heading", { name: new RegExp(DOCENTE.name) })).toBeVisible();
  await alumno.getByRole("link", { name: /Reservar una clase/ }).click();

  await expect(alumno).toHaveURL(/\/alumno\/reservar\//);
  await alumno.locator("button", { hasText: /\d{2}:\d{2}/ }).first().click();
  await alumno.getByRole("button", { name: /Reservar y continuar/ }).click();
  await expect(alumno).toHaveURL(/\/alumno\/reservas\/[0-9a-f-]{36}/);
  bookingId = alumno.url().match(/reservas\/([0-9a-f-]{36})/)![1];
  expect(value(`select status from public.bookings where id = '${bookingId}'`)).toBe("pendiente_pago");

  await alumno.getByRole("button", { name: /Simular pago aprobado/ }).click();
  await expect(alumno.getByText("Reserva confirmada")).toBeVisible();

  expect(value(`select status from public.bookings where id = '${bookingId}'`)).toBe("confirmada");
  // El pago se reparte con la comisión de la reserva (12 % de 15.000).
  expect(value(`select amount || '|' || commission_amount || '|' || tutor_amount from public.payments where booking_id = '${bookingId}' and status = 'aprobado'`)).toBe("15000.00|1800.00|13200.00");
  // Un email para el alumno y otro para el docente.
  expect(sql(`select kind from public.email_outbox where booking_id = '${bookingId}' order by kind`)).toEqual(["nueva_reserva_docente", "reserva_confirmada"]);

  // El horario ya no se ofrece a otros.
  await page.goto(`/docentes/${idOf(DOCENTE.email)}`);
  await expect(page.locator('input[name="profile-slot"]')).toHaveCount(1);
});

test("el docente ve la clase y lo que va a cobrar", async ({ browser }) => {
  const docente = await login(browser, DOCENTE.email);
  await docente.goto("/docente");
  await expect(docente.getByText(ALUMNO.name).first()).toBeVisible();

  // En «Cobros», las tres cifras: lo que pagó el alumno, la comisión y lo que le queda.
  await docente.getByRole("tab", { name: "Cobros" }).click();
  for (const amount of ["15.000", "1.800", "13.200"]) await expect(docente.getByText(new RegExp(`\\$\\s?${amount.replace(".", "\\.")}`)).first()).toBeVisible();
});

test("después de la clase, el alumno la califica y la opinión se ve en el perfil", async ({ browser, page }) => {
  // Adelantar el reloj: la clase fue ayer. La asistencia la anota la función que usa el servidor con los datos de
  // Daily (el docente estuvo toda la hora), y la clase queda completada.
  sql(`update public.bookings set starts_at = now() - interval '1 day', ends_at = now() - interval '1 day' + interval '1 hour' where id = '${bookingId}'`);
  sql(`set role service_role; select public.record_class_attendance('${bookingId}', 3600, 3500)`);
  expect(value(`select status from public.bookings where id = '${bookingId}'`)).toBe("completada");

  const alumno = await login(browser, ALUMNO.email);
  await alumno.goto("/alumno/historial");
  await alumno.getByRole("button", { name: /Calificar/ }).first().click();
  await alumno.getByRole("button", { name: "5 estrellas" }).click();
  await alumno.fill('textarea[name="comment"]', "Explica con mucha paciencia. Salí entendiendo derivadas.");
  await alumno.getByRole("button", { name: /Enviar valoración/ }).click();
  await expect(alumno.getByLabel(/Calificaste la clase con 5 de 5 estrellas/)).toBeVisible();

  // La opinión pública muestra el nombre y la inicial del apellido, nunca el nombre completo.
  await page.goto(`/docentes/${idOf(DOCENTE.email)}`);
  await expect(page.getByText("Explica con mucha paciencia. Salí entendiendo derivadas.")).toBeVisible();
  await expect(page.getByText("Tomás E.")).toBeVisible();
  await expect(page.getByText(ALUMNO.name)).toHaveCount(0);
});

test("el catálogo busca sin tildes y muestra los docentes de a 10", async ({ page }) => {
  // 11 docentes aprobados más, como desde el SQL Editor: con Marina son 12, dos páginas.
  sql(`
    insert into auth.users (id, email, raw_user_meta_data)
    select gen_random_uuid(), 'relleno' || i || '.e2e@estudiapp.test',
      jsonb_build_object('full_name', case when i = 1 then 'Joaquín Núñez' else 'Profe Relleno ' || lpad(i::text, 2, '0') end, 'role', 'docente')
    from generate_series(1, 11) i;
    update public.tutor_profiles tp
      set verification_status = 'aprobado', bio = 'Perfil de relleno para probar el catálogo.', tarifa_por_clase = 9000
      from auth.users u where u.id = tp.id and u.email like 'relleno%.e2e@estudiapp.test';
    insert into public.tutor_subjects (tutor_id, subject_id)
      select u.id, s.id from auth.users u, public.subjects s
      where u.email = 'relleno1.e2e@estudiapp.test' and s.name = 'Física';
  `);

  await page.goto("/docentes");
  await expect(page.locator(".pub-results-top p")).toHaveText(/12 docentes para vos/);
  await expect(page.locator(".pub-teacher-row")).toHaveCount(10);
  const pager = page.getByRole("navigation", { name: "Páginas de resultados" });
  await pager.getByRole("link", { name: /Siguiente/ }).click();
  await expect(page).toHaveURL(/[?&]pagina=2/);
  await expect(page.locator(".pub-teacher-row")).toHaveCount(2);
  await expect(pager.getByRole("link", { name: "Página 2 de 2" })).toHaveAttribute("aria-current", "page");

  // Sin tildes ni mayúsculas, una palabra en el nombre y otra en la materia. Buscar vuelve a la primera página.
  const search = page.getByRole("searchbox");
  await search.fill("NUNEZ fisica");
  await search.press("Enter");
  await expect(page).toHaveURL(/q=NUNEZ\+fisica/);
  await expect(page).not.toHaveURL(/pagina=/);
  await expect(page.locator(".pub-teacher-row")).toHaveCount(1);
  await expect(page.getByRole("heading", { name: "Joaquín Núñez" })).toBeVisible();
  await expect(pager).toHaveCount(0);

  // Una página que no existe lleva a la última.
  await page.goto("/docentes?pagina=9");
  await expect(page).toHaveURL(/[?&]pagina=2/);
  await expect(page.locator(".pub-teacher-row")).toHaveCount(2);
});

test("con la indexación apagada, ningún buscador indexa el sitio", async ({ page, request }) => {
  // SITE_INDEXABLE no está cargada (como hoy en producción): noindex en las páginas, robots.txt cerrado y mapa vacío.
  await page.goto("/");
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex, nofollow");
  const robots = await (await request.get("/robots.txt")).text();
  expect(robots).toMatch(/User-Agent: \*\s+Disallow: \//);
  expect(robots).not.toMatch(/Sitemap:/);
  const sitemap = await (await request.get("/sitemap.xml")).text();
  expect(sitemap).not.toContain("<url>");
});

/**
 * Accesibilidad y diseño responsive (ROADMAP, Fase 4, ítem 1), con los datos que dejó el recorrido: cada pantalla
 * principal, en escritorio y en un celular de 390 px, no puede tener problemas de accesibilidad de WCAG 2.1 AA que
 * detecte axe ni desbordar de costado.
 */
const SCREENS: { who: "anon" | "alumno" | "docente" | "admin"; paths: () => string[] }[] = [
  { who: "anon", paths: () => ["/", "/docentes", `/docentes/${idOf(DOCENTE.email)}`, "/como-funciona", "/login", "/registro/alumno", "/recuperar-password"] },
  { who: "alumno", paths: () => ["/alumno", "/alumno/historial", "/alumno/perfil", `/alumno/reservar/${idOf(DOCENTE.email)}`, `/alumno/reservas/${bookingId}`] },
  { who: "docente", paths: () => ["/docente", "/docente/disponibilidad", "/docente/perfil"] },
  { who: "admin", paths: () => ["/admin/docentes/pendientes", "/admin/docentes/activos", `/admin/docentes/${idOf(DOCENTE.email)}`, "/admin/comision", "/admin/contenido", "/admin/emails", "/admin/metricas", "/admin/registro", "/admin/sistema"] },
];
const EMAILS = { alumno: ALUMNO.email, docente: DOCENTE.email, admin: ADMIN.email };

for (const { who, paths } of SCREENS) {
  test(`accesibilidad y celular: pantallas de ${who === "anon" ? "visitante" : who}`, async ({ browser }) => {
    let storageState;
    if (who !== "anon") {
      const page = await login(browser, EMAILS[who]);
      storageState = await page.context().storageState();
      await page.context().close();
    }
    const problems: string[] = [];
    for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
      // Con «reducir movimiento» las animaciones de entrada (el hero del inicio) no corren: axe mide la pantalla quieta, no
      // un texto a medio aparecer. De paso se revisa que todo se vea con prefers-reduced-motion.
      const context = await browser.newContext({ viewport, storageState, locale: "es-AR", timezoneId: "America/Argentina/Buenos_Aires", reducedMotion: "reduce" });
      const page = await context.newPage();
      for (const path of paths()) {
        await page.goto(path, { waitUntil: "networkidle" });
        const where = `${path} (${viewport.width} px)`;
        const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
        for (const v of violations) problems.push(`${where}: ${v.id} en ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(", ")}`);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        if (overflow > 1) problems.push(`${where}: la página se desborda ${overflow} px de costado`);
      }
      await context.close();
    }
    expect(problems).toEqual([]);
  });
}

