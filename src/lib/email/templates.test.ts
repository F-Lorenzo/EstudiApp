import { describe, expect, it } from "vitest";
import { escapeHtml } from "./layout";
import { EMAIL_KINDS, formatMoney, renderEmail, type RenderedEmail } from "./templates";

const BASE_URL = "https://estudiapp.example";
const BOOKING = "b0000000-0000-4000-8000-000000000001";

// 21:00 UTC = 18:00 en Buenos Aires (UTC-3, sin horario de verano). Martes 20 de octubre de 2026.
const STARTS = "2026-10-20T21:00:00+00:00";
const ENDS = "2026-10-20T22:00:00+00:00";

const base = {
  student_name: "Lucía Pérez",
  tutor_name: "Martín Gómez",
  subject: "Matemática",
  starts_at: STARTS,
  ends_at: ENDS,
  price: 10000,
};

/** Los números salen con espacio de no separación (NBSP): para comparar se pasa a espacio común. */
const plain = (value: string) => value.split(String.fromCharCode(0xa0)).join(" ");

function render(kind: string, payload: unknown, extra: { toName?: string | null; baseUrl?: string | null } = {}): RenderedEmail {
  const result = renderEmail({ kind, payload, toName: "Lucía Pérez", baseUrl: BASE_URL, ...extra });
  if (!result.ok) throw new Error(`no se pudo armar el email: ${result.reason}`);
  return { ...result.email, html: plain(result.email.html), text: plain(result.email.text), subject: plain(result.email.subject) };
}

/** Los recordatorios necesitan además la reserva y a quién va; los de perfil no llevan horario. */
const reminderExtra = { booking_id: BOOKING, recipient_role: "alumno" };
const PROFILE_KINDS = ["perfil_aprobado", "perfil_rechazado", "perfil_reabierto"];
const BOOKING_KINDS = EMAIL_KINDS.filter((kind) => !PROFILE_KINDS.includes(kind));
const sample = (kind: string, payload: Record<string, unknown> = base) =>
  kind.startsWith("recordatorio") ? { ...reminderExtra, ...payload } : payload;

const hrefs = (html: string) => [...html.matchAll(/href="([^"]*)"/g)].map((match) => match[1]);

describe("reserva_confirmada (alumno)", () => {
  const email = render("reserva_confirmada", { ...base, amount_paid: 10000 });

  it("tiene asunto, HTML y texto con docente, materia, día, horario argentino y monto pagado", () => {
    expect(email.subject).toBe("Tu clase con Martín Gómez está confirmada");
    for (const body of [email.html, email.text]) {
      expect(body).toContain("Hola Lucía,");
      expect(body).toContain("Martín Gómez");
      expect(body).toContain("Matemática");
      expect(body).toContain("Martes 20 de octubre");
      expect(body).toContain("18:00 – 19:00 h");
      expect(body).toContain("$ 10.000");
    }
  });

  it("explica la política de cancelación con las reglas decididas (24 h, 2 h)", () => {
    expect(email.text).toContain("24 horas o más");
    expect(email.text).toContain("100 %");
    expect(email.text).toContain("50 %");
    expect(email.text).toContain("2 horas");
  });

  it("enlaza a las próximas clases, a la política de cancelación y no inventa un enlace a una reserva sin id", () => {
    expect(hrefs(email.html)).toEqual([`${BASE_URL}/alumno/proximas-clases`, `${BASE_URL}/cancelacion`, BASE_URL]);
    expect(email.text).toContain(`Ver mis próximas clases: ${BASE_URL}/alumno/proximas-clases`);
  });

  it("si la base manda el id de la reserva, el botón lleva a esa reserva", () => {
    const withId = render("reserva_confirmada", { ...base, amount_paid: 10000, booking_id: BOOKING });
    expect(hrefs(withId.html)[0]).toBe(`${BASE_URL}/alumno/reservas/${BOOKING}`);
  });

  it("ignora un id de reserva que no es un UUID (no se arma un enlace con cualquier cosa)", () => {
    const hostile = render("reserva_confirmada", { ...base, amount_paid: 10000, booking_id: "../../admin?x=1" });
    expect(hrefs(hostile.html)[0]).toBe(`${BASE_URL}/alumno/proximas-clases`);
    expect(hostile.html).not.toContain("admin");
  });

  it("sin docente ni materia ni monto igual sale un email correcto", () => {
    const minimal = render("reserva_confirmada", { starts_at: STARTS, ends_at: ENDS });
    expect(minimal.subject).toBe("Tu clase está confirmada");
    expect(minimal.text).toContain("con tu docente");
    expect(minimal.text).not.toContain("Materia");
    expect(minimal.text).not.toContain("Total pagado");
  });

  it("si no hay monto pagado usa el precio de la reserva", () => {
    expect(render("reserva_confirmada", base).text).toContain("Total pagado: $ 10.000");
  });
});

describe("nueva_reserva_docente", () => {
  const email = render(
    "nueva_reserva_docente",
    { ...base, amount_paid: 10000, tutor_amount: 8800 },
    { toName: "Martín Gómez" },
  );

  it("avisa al docente con el alumno, el horario y lo que le corresponde", () => {
    expect(email.subject).toBe("Nueva reserva de Lucía Pérez para el martes 20 de octubre");
    expect(email.text).toContain("Hola Martín,");
    expect(email.text).toContain("Alumno: Lucía Pérez");
    expect(email.text).toContain("Horario: 18:00 – 19:00 h (hora de Argentina)");
    expect(email.text).toContain("Pagó el alumno: $ 10.000");
    expect(email.text).toContain("Te corresponde: $ 8.800 (después de la comisión de EstudiApp)");
  });

  it("lleva al panel del docente", () => {
    expect(hrefs(email.html)).toEqual([`${BASE_URL}/docente`, BASE_URL]);
  });

  it("sin nombre del alumno ni montos sigue siendo claro", () => {
    const minimal = render("nueva_reserva_docente", { starts_at: STARTS, ends_at: ENDS });
    expect(minimal.subject).toBe("Tenés una nueva reserva para el martes 20 de octubre");
    expect(minimal.text).toContain("Un alumno reservó una clase con vos");
    expect(minimal.text).not.toContain("Te corresponde");
  });
});

describe("reserva_cancelada", () => {
  const student = (extra: Record<string, unknown>) =>
    render("reserva_cancelada", { ...base, amount_paid: 10000, ...extra });
  const tutor = (extra: Record<string, unknown>) =>
    render("reserva_cancelada", { ...base, ...extra }, { toName: "Martín Gómez" });

  describe("copia del alumno", () => {
    it("cancela el alumno con 24 h o más: 100 % y el monto, y promete otro email cuando se haga", () => {
      const email = student({ cancelled_by: "alumno", reason: "Cancelada por el alumno", refund_percent: 100, refund_amount: 10000 });
      expect(email.subject).toBe("Cancelaste tu clase del martes 20 de octubre");
      expect(email.text).toContain("Cancelaste tu clase con Martín Gómez");
      expect(email.text).toContain("Cancelaste con 24 horas o más de anticipación, así que te devolvemos el 100 % de lo que pagaste ($ 10.000).");
      expect(email.text).toContain("te mandamos otro email");
    });

    it("cancela el alumno con menos de 24 h: 50 %", () => {
      const email = student({ cancelled_by: "alumno", refund_percent: 50, refund_amount: 5000 });
      expect(email.text).toContain("menos de 24 horas de anticipación, así que te devolvemos el 50 % de lo que pagaste ($ 5.000).");
    });

    it("cancela el alumno con menos de 2 h: aclara que no hay reembolso y NO promete otro email", () => {
      const email = student({ cancelled_by: "alumno", refund_percent: 0, refund_amount: 0 });
      expect(email.text).toContain("no tiene reembolso");
      expect(email.text).toContain("Total pagado: $ 10.000");
      expect(email.text).not.toContain("te devolvemos");
      expect(email.text).not.toContain("te mandamos otro email");
    });

    it("cancela el docente: 100 %, el motivo que escribió y la disculpa", () => {
      const email = student({ cancelled_by: "docente", reason: "Me enfermé", refund_percent: 100, refund_amount: 10000 });
      expect(email.subject).toBe("Se canceló tu clase del martes 20 de octubre");
      expect(email.text).toContain("Martín Gómez tuvo que cancelar la clase del martes 20 de octubre, 18:00 – 19:00 h. Lamentamos el inconveniente.");
      expect(email.text).toContain("Motivo: Me enfermé");
      expect(email.text).toContain("Te devolvemos el 100 % de lo que pagaste ($ 10.000).");
    });

    it("cancela la administración", () => {
      const email = student({ cancelled_by: "administracion", reason: "Cancelada por la administración", refund_percent: 100, refund_amount: 10000 });
      expect(email.text).toContain("La administración de EstudiApp canceló tu clase con Martín Gómez");
      expect(email.text).not.toContain("Motivo:");
    });

    it("el motivo por defecto que pone la base («Cancelada por el alumno») no se muestra como si fuera un motivo", () => {
      for (const reason of ["Cancelada por el alumno", "Cancelada por el docente", "cancelada por la administración."]) {
        expect(student({ cancelled_by: "docente", reason, refund_percent: 100, refund_amount: 10000 }).text).not.toContain("Motivo:");
      }
    });

    it("sin datos de reembolso no inventa un porcentaje", () => {
      const email = render("reserva_cancelada", { ...base, amount_paid: 10000, cancelled_by: "alumno" });
      expect(email.text).toContain("Si te corresponde un reembolso, te avisamos por email");
      expect(email.text).not.toMatch(/\d+ %/);
    });

    it("quien canceló desconocido da un mensaje neutro", () => {
      const email = student({ cancelled_by: "otro", refund_percent: 100, refund_amount: 10000 });
      expect(email.text).toContain("Se canceló tu clase con Martín Gómez");
    });

    it("sugiere buscar otra clase y linkea la política", () => {
      const email = student({ cancelled_by: "docente", refund_percent: 100, refund_amount: 10000 });
      expect(hrefs(email.html)).toEqual([`${BASE_URL}/docentes`, `${BASE_URL}/cancelacion`, BASE_URL]);
    });
  });

  describe("copia del docente", () => {
    it("cancela el alumno: se libera el horario y NO aparece ninguna plata del alumno", () => {
      const email = tutor({ cancelled_by: "alumno", reason: "Cancelada por el alumno" });
      expect(email.subject).toBe("Lucía Pérez canceló la clase del martes 20 de octubre");
      expect(email.text).toContain("Hola Martín,");
      expect(email.text).toContain("Lucía Pérez canceló la clase del martes 20 de octubre, 18:00 – 19:00 h. El horario vuelve a quedar disponible en tu agenda.");
      expect(email.text).not.toMatch(/\$|reembolso|devolv/i);
      expect(email.text).not.toContain("Motivo:");
    });

    it("cancela el docente: confirma, avisa que al alumno se le devuelve el 100 % y muestra su motivo", () => {
      const email = tutor({ cancelled_by: "docente", reason: "Me enfermé" });
      expect(email.subject).toBe("Cancelaste la clase del martes 20 de octubre");
      expect(email.text).toContain("Confirmamos que cancelaste la clase con Lucía Pérez");
      expect(email.text).toContain("se le devuelve el 100 %");
      expect(email.text).toContain("Motivo: Me enfermé");
    });

    it("cancela la administración", () => {
      const email = tutor({ cancelled_by: "administracion", reason: "Por una queja" });
      expect(email.text).toContain("La administración de EstudiApp canceló la clase con Lucía Pérez");
      expect(email.text).toContain("Motivo: Por una queja");
    });

    it("lleva al panel", () => {
      expect(hrefs(tutor({ cancelled_by: "alumno" }).html)).toEqual([`${BASE_URL}/docente`, BASE_URL]);
    });
  });

  it("distingue las dos copias por la plata: si hay monto pagado o reembolso es la del alumno, aunque sea 0", () => {
    expect(student({ cancelled_by: "alumno", refund_percent: 0, refund_amount: 0 }).text).toContain("Total pagado");
    expect(tutor({ cancelled_by: "alumno" }).text).not.toContain("Total pagado");
  });
});

describe("reembolso_realizado", () => {
  it("por una cancelación: monto, porcentaje y la aclaración del plazo", () => {
    const email = render("reembolso_realizado", { ...base, refund_amount: 5000, refund_percent: 50, reason: "cancelacion" });
    expect(email.subject).toBe("Ya te devolvimos $ 5.000");
    expect(email.text).toContain("Ya hicimos el reembolso de tu clase cancelada con Martín Gómez del martes 20 de octubre");
    expect(email.text).toContain("Reembolso: $ 5.000");
    expect(email.text).toContain("Porcentaje: 50 %");
    expect(email.text).toContain("puede tardar unos días");
    expect(hrefs(email.html)).toEqual([`${BASE_URL}/alumno`, BASE_URL]);
  });

  it("por un pago que no se pudo aceptar: dice que se devolvió completo y no culpa al alumno", () => {
    const email = render("reembolso_realizado", { ...base, refund_amount: 10000, refund_percent: 100, reason: "pago_no_aceptable" });
    expect(email.subject).toBe("Te devolvimos tu pago");
    expect(email.text).toContain("No pudimos confirmar tu reserva con Martín Gómez del martes 20 de octubre con ese pago, así que te devolvimos el importe completo ($ 10.000).");
    expect(email.text).toContain("volver a reservar");
    expect(hrefs(email.html)).toEqual([`${BASE_URL}/docentes`, BASE_URL]);
  });

  it("un motivo desconocido se trata como cancelación", () => {
    const email = render("reembolso_realizado", { ...base, refund_amount: 5000, refund_percent: 50, reason: "otra_cosa" });
    expect(email.subject).toBe("Ya te devolvimos $ 5.000");
  });

  it("sin monto no inventa uno", () => {
    const email = render("reembolso_realizado", { starts_at: STARTS, ends_at: ENDS, reason: "cancelacion" });
    expect(email.subject).toBe("Hicimos tu reembolso");
    expect(email.text).not.toContain("$");
  });
});

describe("escape de HTML con datos de personas", () => {
  const hostile = {
    ...base,
    student_name: '<script>alert("yo")</script>',
    tutor_name: '"><img src=x onerror=alert(1)>',
    subject: "<b>Álgebra</b> & más",
    amount_paid: 10000,
    tutor_amount: 8800,
    cancelled_by: "docente",
    reason: "<a href='https://malo.example'>hacé clic</a>",
    refund_percent: 100,
    refund_amount: 10000,
  };
  const payloads: [string, Record<string, unknown>][] = [
    ["reserva_confirmada", hostile],
    ["nueva_reserva_docente", hostile],
    ["reserva_cancelada", hostile],
    ["reserva_cancelada", { ...hostile, amount_paid: undefined, refund_percent: undefined, refund_amount: undefined }],
    ["reembolso_realizado", { ...hostile, reason: "cancelacion" }],
    ["reembolso_realizado", { ...hostile, reason: "pago_no_aceptable" }],
  ];

  it.each(payloads)("%s: ninguna etiqueta de un nombre o un motivo llega viva al HTML", (kind, payload) => {
    const { html } = render(kind, payload, { toName: "<i>Eve</i> Mallory" });
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/<img/i);
    expect(html).not.toMatch(/<b>|<i>|<a href='/i);
    expect(html).not.toContain("onerror=alert(1)>");
    expect(html).not.toContain("malo.example'");
    // Y no hubo escape de más: los datos legítimos se leen.
    expect(html).toContain("&lt;");
  });

  it("el nombre del destinatario se escapa en el saludo", () => {
    // El saludo usa la primera palabra del nombre.
    const { html, text } = render("reserva_confirmada", base, { toName: "<img/src=x> Pérez" });
    expect(html).toContain("Hola &lt;img/src=x&gt;,");
    expect(html).not.toContain("<img");
    expect(text).toContain("Hola <img/src=x>,"); // el texto plano no es HTML: no se escapa
  });

  it("escapeHtml cubre & < > comillas", () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");
  });

  it("un destinatario con comillas no puede salirse de un atributo (los enlaces salen del origen configurado, no de datos)", () => {
    const { html } = render("reserva_confirmada", { ...base, booking_id: `${BOOKING}" onclick="x` });
    for (const href of hrefs(html)) expect(href.startsWith(BASE_URL)).toBe(true);
    expect(html).not.toContain('onclick="x');
  });
});

describe("asuntos de una sola línea", () => {
  // Los caracteres invisibles se arman por código para que no dependan de cómo se guarde el archivo.
  const LS = String.fromCharCode(0x2028);
  const PS = String.fromCharCode(0x2029);
  const NUL = String.fromCharCode(0);
  const injection = `Ana\r\nBcc: robo@malo.example\nContent-Type: text/html${LS}x${NUL}y${PS}`;
  const hasLineBreak = (value: string) => [...value].some((char) => ["\r", "\n", NUL, LS, PS].includes(char));

  it.each([...EMAIL_KINDS])("%s: un nombre con saltos de línea no parte el asunto", (kind) => {
    const payload = {
      ...base,
      student_name: injection,
      tutor_name: injection,
      amount_paid: 10000,
      refund_percent: 100,
      refund_amount: 10000,
      cancelled_by: "docente",
      reason: injection,
    };
    const { subject } = render(kind, sample(kind, payload));
    expect(hasLineBreak(subject)).toBe(false);
    expect(subject.length).toBeLessThanOrEqual(150);
  });

  it("el asunto de la copia del docente de una cancelación también", () => {
    const { subject } = render("reserva_cancelada", { ...base, student_name: injection, cancelled_by: "alumno" });
    expect(hasLineBreak(subject)).toBe(false);
  });

  it("un nombre larguísimo no revienta el asunto", () => {
    const { subject } = render("reserva_confirmada", { ...base, tutor_name: "X".repeat(5000) });
    expect(subject.length).toBeLessThanOrEqual(150);
  });
});

describe("recordatorio_24h", () => {
  const alumno = render("recordatorio_24h", { ...base, ...reminderExtra });
  const docente = render("recordatorio_24h", { ...base, booking_id: BOOKING, recipient_role: "docente" }, { toName: "Martín Gómez" });

  it("al alumno le recuerda la clase con su docente, el día y el horario", () => {
    expect(alumno.subject).toBe("Mañana tenés clase con Martín Gómez");
    for (const body of [alumno.html, alumno.text]) {
      expect(body).toContain("Hola Lucía,");
      expect(body).toContain("Martes 20 de octubre");
      expect(body).toContain("18:00 – 19:00 h");
      expect(body).toContain("Matemática");
    }
    expect(alumno.text).toContain("La sala se abre 10 minutos antes");
  });

  it("al alumno le explica qué pasa si cancela ahora (menos de 24 horas: 50 %)", () => {
    expect(alumno.text).toContain("50 %");
    expect(alumno.text).toContain("menos de 2 horas no hay reembolso");
    expect(hrefs(alumno.html)).toEqual([`${BASE_URL}/alumno/reservas/${BOOKING}`, `${BASE_URL}/cancelacion`, BASE_URL]);
  });

  it("al docente le nombra al alumno y lo lleva a su panel", () => {
    expect(docente.subject).toBe("Mañana tenés clase con Lucía Pérez");
    expect(docente.text).toContain("Hola Martín,");
    expect(docente.text).toContain("Alumno: Lucía Pérez");
    expect(docente.text).toContain("se le devuelve el 100 %");
    expect(hrefs(docente.html)).toEqual([`${BASE_URL}/docente`, BASE_URL]);
  });

  it("no muestra datos de dinero", () => {
    expect(alumno.text).not.toContain("$");
    expect(docente.text).not.toContain("$");
  });
});

describe("recordatorio_1h", () => {
  const alumno = render("recordatorio_1h", { ...base, ...reminderExtra });
  const docente = render("recordatorio_1h", { ...base, booking_id: BOOKING, recipient_role: "docente" });

  it("dice a qué hora empieza y lleva a la sala de cada uno", () => {
    expect(alumno.subject).toBe("Tu clase con Martín Gómez empieza a las 18:00");
    expect(docente.subject).toBe("Tu clase con Lucía Pérez empieza a las 18:00");
    expect(hrefs(alumno.html)[0]).toBe(`${BASE_URL}/alumno/sala/${BOOKING}`);
    expect(hrefs(docente.html)[0]).toBe(`${BASE_URL}/docente/sala/${BOOKING}`);
    expect(alumno.text).toContain(`Ir a la sala: ${BASE_URL}/alumno/sala/${BOOKING}`);
  });

  it("al docente le recuerda que tiene que estar al menos 10 minutos (si no, se reembolsa)", () => {
    expect(docente.text).toContain("al menos 10 minutos");
    expect(docente.text).toContain("100 %");
    expect(alumno.text).not.toContain("al menos 10 minutos");
  });

  it("sin nombres no inventa", () => {
    const email = render("recordatorio_1h", { starts_at: STARTS, ends_at: ENDS, ...reminderExtra });
    expect(email.subject).toBe("Tu clase con tu docente empieza a las 18:00");
  });
});

describe("perfil_aprobado", () => {
  it("si ya vinculó Mercado Pago, lo manda a cargar horarios", () => {
    const email = render("perfil_aprobado", { tutor_name: "Martín Gómez", can_receive_payments: true }, { toName: "Martín Gómez" });
    expect(email.subject).toBe("Tu perfil docente fue aprobado");
    expect(email.text).toContain("Hola Martín,");
    expect(hrefs(email.html)[0]).toBe(`${BASE_URL}/docente/disponibilidad`);
    expect(email.text).not.toContain("Mercado Pago");
  });

  it("si todavía no, le pide vincularlo primero (sin eso no lo pueden reservar)", () => {
    for (const payload of [{ can_receive_payments: false }, {}]) {
      const email = render("perfil_aprobado", payload);
      expect(email.text).toContain("vinculá tu cuenta de Mercado Pago");
      expect(hrefs(email.html)[0]).toBe(`${BASE_URL}/docente/cuenta-de-cobro`);
    }
  });
});

describe("perfil_rechazado", () => {
  it("muestra el motivo escapado y lleva a corregir el perfil", () => {
    const email = render("perfil_rechazado", { reason: "El respaldo <b>no</b> se abre" });
    expect(email.subject).toBe("Revisamos tu perfil docente");
    expect(email.text).toContain("Motivo: El respaldo <b>no</b> se abre");
    expect(email.html).toContain("Motivo: El respaldo &lt;b&gt;no&lt;/b&gt; se abre");
    expect(email.html).not.toContain("<b>no</b>");
    expect(hrefs(email.html)[0]).toBe(`${BASE_URL}/docente/perfil`);
  });

  it("sin motivo, sale igual sin la línea del motivo", () => {
    expect(render("perfil_rechazado", {}).text).not.toContain("Motivo");
  });
});

describe("perfil_rechazado como baja", () => {
  it("si el perfil estaba aprobado, dice que fue dado de baja, con el motivo y que sus clases siguen", () => {
    const email = render("perfil_rechazado", { reason: "Denuncia de un alumno", was_approved: true });
    expect(email.subject).toBe("Tu perfil docente fue dado de baja");
    expect(email.text).toContain("Motivo: Denuncia de un alumno");
    expect(email.text).toContain("ya tenías confirmadas siguen en pie");
    expect(hrefs(email.html)[0]).toBe(`${BASE_URL}/docente/perfil`);
  });

  it("un was_approved raro se ignora y sale como rechazo", () => {
    expect(render("perfil_rechazado", { reason: "x", was_approved: "sí" }).subject).toBe("Revisamos tu perfil docente");
  });
});

describe("perfil_reabierto", () => {
  it("le avisa que su perfil volvió a revisión y no le muestra notas internas", () => {
    const email = render("perfil_reabierto", { tutor_name: "Martín Gómez", reason: "nota interna" }, { toName: "Martín Gómez" });
    expect(email.subject).toBe("Tu perfil docente volvió a revisión");
    expect(email.text).toContain("Hola Martín,");
    expect(email.text).not.toContain("nota interna");
    expect(hrefs(email.html)[0]).toBe(`${BASE_URL}/docente/perfil`);
  });
});

describe("formato argentino", () => {
  it("los montos salen en pesos con punto de miles y coma decimal, y centavos solo si hay", () => {
    expect(plain(formatMoney(10000))).toBe("$ 10.000");
    expect(plain(formatMoney(1234567))).toBe("$ 1.234.567");
    expect(plain(formatMoney(5000.5))).toBe("$ 5.000,50");
    expect(plain(formatMoney(0))).toBe("$ 0");
  });

  it("acepta los montos como número o como texto numérico (así viaja un numeric de Postgres)", () => {
    const email = render("reserva_confirmada", { ...base, amount_paid: "12500.50" });
    expect(email.text).toContain("Total pagado: $ 12.500,50");
  });

  it("un monto que no se entiende se omite en vez de mostrar «NaN»", () => {
    const email = render("reserva_confirmada", { ...base, amount_paid: "mucho", price: -5 });
    expect(email.text).not.toMatch(/NaN|Infinity|undefined|null/);
    expect(email.text).not.toContain("Total pagado");
  });

  it("las horas se muestran en horario de Buenos Aires, no en UTC", () => {
    // 01:30 UTC del 21 es 22:30 del 20 en Argentina.
    const email = render("reserva_confirmada", { ...base, starts_at: "2026-10-21T01:30:00+00:00", ends_at: "2026-10-21T02:30:00+00:00" });
    expect(email.text).toContain("Martes 20 de octubre");
    expect(email.text).toContain("22:30 – 23:30 h");
  });

  it("entiende el formato con que Postgres serializa las fechas, con cualquier offset", () => {
    const email = render("reserva_confirmada", { ...base, starts_at: "2026-10-20T18:00:00-03:00", ends_at: "2026-10-20T19:00:00-03:00" });
    expect(email.text).toContain("18:00 – 19:00 h");
  });
});

describe("enlaces", () => {
  it("sin dirección del sitio salen sin botones ni enlaces", () => {
    for (const baseUrl of [null, undefined, "", "no es una url"]) {
      const email = render("reserva_confirmada", base, { baseUrl });
      expect(hrefs(email.html)).toEqual([]);
      expect(email.text).not.toContain("http");
    }
  });

  it("solo se usan direcciones https (o http en localhost)", () => {
    for (const baseUrl of ["javascript:alert(1)", "http://malo.example", "ftp://x.example", "data:text/html,hola"]) {
      expect(hrefs(render("reserva_confirmada", base, { baseUrl }).html)).toEqual([]);
    }
    expect(hrefs(render("reserva_confirmada", base, { baseUrl: "http://localhost:3000" }).html)[0]).toBe("http://localhost:3000/alumno/proximas-clases");
  });

  it("se queda con el origen: una ruta o parámetros en la dirección configurada no se arrastran", () => {
    const email = render("nueva_reserva_docente", base, { baseUrl: "https://estudiapp.example/ruta?x=1#y" });
    expect(hrefs(email.html)[0]).toBe("https://estudiapp.example/docente");
  });
});

describe("kind y payload inválidos", () => {
  it("un tipo desconocido no tiene plantilla", () => {
    expect(renderEmail({ kind: "boletin_semanal", payload: base })).toEqual({ ok: false, reason: "unknown_kind" });
    expect(renderEmail({ kind: "", payload: base })).toEqual({ ok: false, reason: "unknown_kind" });
    expect(renderEmail({ kind: "__proto__", payload: base })).toEqual({ ok: false, reason: "unknown_kind" });
  });

  it.each([
    ["nulo", null],
    ["un texto", "hola"],
    ["un arreglo", []],
    ["sin horario", { tutor_name: "Martín" }],
    ["horario inválido", { starts_at: "mañana", ends_at: ENDS }],
    ["fin inválido", { starts_at: STARTS, ends_at: 12 }],
  ])("%s: faltan datos imprescindibles", (_label, payload) => {
    for (const kind of BOOKING_KINDS) {
      expect(renderEmail({ kind, payload })).toEqual({ ok: false, reason: "invalid_payload" });
    }
  });

  it("los datos opcionales mal formados se ignoran y el email sale igual", () => {
    const email = render("reserva_confirmada", { ...base, tutor_name: 42, subject: "", student_name: {}, price: "abc", amount_paid: null });
    expect(email.subject).toBe("Tu clase está confirmada");
  });

  it("cada tipo conocido tiene plantilla", () => {
    for (const kind of EMAIL_KINDS) expect(renderEmail({ kind, payload: sample(kind) }).ok).toBe(true);
  });

  it("los de perfil no necesitan horario, pero sí un objeto", () => {
    for (const kind of PROFILE_KINDS) {
      expect(renderEmail({ kind, payload: {} }).ok).toBe(true);
      for (const payload of [null, "hola", []]) expect(renderEmail({ kind, payload })).toEqual({ ok: false, reason: "invalid_payload" });
    }
  });

  it("un recordatorio sin reserva o sin destinatario no se arma (no hay a qué sala mandar)", () => {
    for (const kind of ["recordatorio_24h", "recordatorio_1h"]) {
      expect(renderEmail({ kind, payload: base }).ok).toBe(false);
      expect(renderEmail({ kind, payload: { ...base, booking_id: BOOKING } }).ok).toBe(false);
      expect(renderEmail({ kind, payload: { ...base, booking_id: "no-uuid", recipient_role: "alumno" } }).ok).toBe(false);
      expect(renderEmail({ kind, payload: { ...base, booking_id: BOOKING, recipient_role: "admin" } }).ok).toBe(false);
    }
  });
});

describe("estructura del HTML", () => {
  const { html, text } = render("reserva_confirmada", { ...base, amount_paid: 10000 });

  it("es un documento completo, en español, de 600 px como máximo y sin recursos externos", () => {
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain('<html lang="es-AR">');
    expect(html).toContain("max-width:600px");
    expect(html).toContain('width="600"');
    expect(html).not.toMatch(/<script|<link|<img|<iframe|@import|url\(/i);
  });

  it("usa los colores de la marca y estilos en línea", () => {
    for (const color of ["#023618", "#FFFCF2", "#EB5E28", "#B02E0C", "#CCC5B9"]) expect(html).toContain(color);
    expect(html).not.toContain("<style");
  });

  it("el texto plano no tiene etiquetas ni entidades HTML", () => {
    expect(text).not.toMatch(/<\/?[a-z][^>]*>/i);
    expect(text).not.toMatch(/&(amp|lt|gt|quot|#39);/);
    expect(text.endsWith("\n")).toBe(true);
  });

  it("el título del documento y el texto oculto de vista previa están escapados y presentes", () => {
    expect(html).toContain("<title>Tu clase con Martín Gómez está confirmada</title>");
    expect(html).toContain("Martes 20 de octubre, 18:00 – 19:00 h. Recibimos tu pago.");
  });

  it("el texto plano trae los mismos datos que el HTML", () => {
    const visible = html
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ");
    for (const dato of ["Martín Gómez", "Matemática", "Martes 20 de octubre", "18:00 – 19:00 h", "$ 10.000"]) {
      expect(visible).toContain(dato);
      expect(text).toContain(dato);
    }
  });
});
