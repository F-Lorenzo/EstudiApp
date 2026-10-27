/**
 * Maquetación de los emails: un modelo simple (título, párrafos, datos, avisos, botón) que se convierte en
 * HTML y en texto plano. Como las dos versiones salen del MISMO modelo, nunca se desfasan.
 *
 * El HTML usa tablas y estilos en línea (lo que aguantan Gmail y Outlook), ancho máximo de 600 px y los
 * colores de la marca. Nada de imágenes: muchos clientes las bloquean por defecto. Las fuentes de la marca
 * van primero y caen a Helvetica/Arial, que es lo que realmente ven casi todos.
 *
 * TODO texto que viene de una persona (nombres, motivos) se escapa acá: ningún dato entra al HTML sin pasar
 * por `escapeHtml`.
 */

export type Block =
  | { kind: "paragraph"; text: string }
  | { kind: "facts"; rows: { label: string; value: string }[] }
  /** Recuadro para lo importante (un reembolso, un aviso). */
  | { kind: "callout"; text: string; tone?: "info" | "warning" }
  | { kind: "button"; label: string; url: string }
  /** Enlace chico, en su propia línea. */
  | { kind: "link"; label: string; url: string };

export type EmailContent = {
  /** Texto oculto que muestran las bandejas de entrada junto al asunto. */
  preheader: string;
  title: string;
  greeting: string;
  blocks: Block[];
  /** Origen del sitio (https://...), para el pie. `null` si no está configurado. */
  siteUrl: string | null;
  /** Primera frase del pie, si no es la de los avisos (las plantillas de Supabase Auth tienen la suya). */
  footer?: string;
};

const DEFAULT_FOOTER = "Este es un aviso automático de EstudiApp, que te llega porque tenés una cuenta con este email.";

// Marca (docs: README / CLAUDE.md).
const BLACK_FOREST = "#023618";
const FLORAL_WHITE = "#FFFCF2";
const SPICY_PAPRIKA = "#EB5E28";
const OXIDIZED_IRON = "#B02E0C";
const DUST_GREY = "#CCC5B9";
const TEXT = "#26332a";
const MUTED = "#5b6157";

const HEADING_FONT = "'Bricolage Grotesque','Helvetica Neue',Helvetica,Arial,sans-serif";
const BODY_FONT = "Figtree,'Helvetica Neue',Helvetica,Arial,sans-serif";

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char]);
}

function renderBlockHtml(block: Block): string {
  switch (block.kind) {
    case "paragraph":
      return `<p style="margin:0 0 16px;font-family:${BODY_FONT};font-size:16px;line-height:1.55;color:${TEXT};">${escapeHtml(block.text)}</p>`;

    case "facts":
      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px;border-top:1px solid ${DUST_GREY};">${block.rows
        .map(
          (row) =>
            `<tr><td valign="top" style="padding:10px 16px 10px 0;border-bottom:1px solid ${DUST_GREY};font-family:${BODY_FONT};font-size:14px;line-height:1.4;color:${MUTED};white-space:nowrap;">${escapeHtml(row.label)}</td>` +
            `<td valign="top" style="padding:10px 0;border-bottom:1px solid ${DUST_GREY};font-family:${BODY_FONT};font-size:15px;line-height:1.4;font-weight:bold;color:${BLACK_FOREST};">${escapeHtml(row.value)}</td></tr>`,
        )
        .join("")}</table>`;

    case "callout": {
      const accent = block.tone === "warning" ? OXIDIZED_IRON : SPICY_PAPRIKA;
      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px;"><tr><td bgcolor="${FLORAL_WHITE}" style="padding:14px 16px;background:${FLORAL_WHITE};border-left:4px solid ${accent};font-family:${BODY_FONT};font-size:15px;line-height:1.5;color:${TEXT};">${escapeHtml(block.text)}</td></tr></table>`;
    }

    case "button":
      // Botón «a prueba de Outlook»: el color de fondo va en la celda, no en el enlace.
      return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px;"><tr><td bgcolor="${BLACK_FOREST}" style="border-radius:8px;background:${BLACK_FOREST};"><a href="${escapeHtml(block.url)}" style="display:inline-block;padding:13px 24px;font-family:${BODY_FONT};font-size:16px;font-weight:bold;line-height:1.2;color:${FLORAL_WHITE};text-decoration:none;border-radius:8px;">${escapeHtml(block.label)}</a></td></tr></table>`;

    case "link":
      return `<p style="margin:0 0 12px;font-family:${BODY_FONT};font-size:14px;line-height:1.5;color:${MUTED};"><a href="${escapeHtml(block.url)}" style="color:${OXIDIZED_IRON};text-decoration:underline;">${escapeHtml(block.label)}</a></p>`;
  }
}

export function renderHtml(subject: string, content: EmailContent): string {
  const footerSite = content.siteUrl
    ? ` Podés entrar cuando quieras a <a href="${escapeHtml(content.siteUrl)}" style="color:${OXIDIZED_IRON};text-decoration:underline;">${escapeHtml(new URL(content.siteUrl).host)}</a>.`
    : "";

  return `<!doctype html>
<html lang="es-AR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background:${FLORAL_WHITE};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${FLORAL_WHITE};font-size:1px;line-height:1px;">${escapeHtml(content.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${FLORAL_WHITE}" style="background:${FLORAL_WHITE};">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;">
<tr><td bgcolor="${BLACK_FOREST}" style="padding:20px 28px;background:${BLACK_FOREST};border-radius:12px 12px 0 0;font-family:${HEADING_FONT};font-size:24px;font-weight:bold;line-height:1;color:${FLORAL_WHITE};">Estudi<span style="color:${SPICY_PAPRIKA};">App</span></td></tr>
<tr><td bgcolor="#ffffff" style="padding:28px;background:#ffffff;border:1px solid ${DUST_GREY};border-top:0;border-radius:0 0 12px 12px;">
<h1 style="margin:0 0 18px;font-family:${HEADING_FONT};font-size:24px;line-height:1.25;color:${BLACK_FOREST};">${escapeHtml(content.title)}</h1>
<p style="margin:0 0 16px;font-family:${BODY_FONT};font-size:16px;line-height:1.55;color:${TEXT};">${escapeHtml(content.greeting)}</p>
${content.blocks.map(renderBlockHtml).join("\n")}
</td></tr>
<tr><td style="padding:16px 28px;font-family:${BODY_FONT};font-size:12px;line-height:1.5;color:${MUTED};">${escapeHtml(content.footer ?? DEFAULT_FOOTER)}${footerSite}</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

export function renderText(content: EmailContent): string {
  const parts: string[] = [content.title, content.greeting];
  for (const block of content.blocks) {
    switch (block.kind) {
      case "paragraph":
        parts.push(block.text);
        break;
      case "facts":
        parts.push(block.rows.map((row) => `${row.label}: ${row.value}`).join("\n"));
        break;
      case "callout":
        parts.push(`${block.tone === "warning" ? "Importante: " : ""}${block.text}`);
        break;
      case "button":
      case "link":
        parts.push(`${block.label}: ${block.url}`);
        break;
    }
  }
  parts.push(
    `${content.footer ?? DEFAULT_FOOTER}${content.siteUrl ? `\n${content.siteUrl}` : ""}`,
  );
  return `${parts.join("\n\n")}\n`;
}
