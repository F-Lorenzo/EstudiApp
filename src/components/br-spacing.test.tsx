import fs from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AuthFrame } from "./auth-ui";

// En pantallas angostas el CSS oculta algunos <br /> de los titulares (`display: none`). Si entre las
// palabras no hay un espacio explícito, quedan pegadas: «sabés.Todo lo quepodés abrir» (error visto
// en un iPhone). Estas pruebas aseguran que cada salto oculto tenga su espacio.

describe("titulares con saltos de línea ocultos en móvil", () => {
  it.each(["teacher", "learner"] as const)("el titular de acceso (%s) no pega palabras", (role) => {
    const html = renderToStaticMarkup(
      <AuthFrame role={role}>
        <div />
      </AuthFrame>,
    );
    const titulo = /<h2>([\s\S]*?)<\/h2>/.exec(html)?.[1] ?? "";
    expect(titulo).toContain("<br/>");
    // Un carácter que no es espacio pegado a un <br/> significa que, sin el salto, se unen dos palabras.
    expect(titulo).not.toMatch(/[^\s>]<br\s*\/?>/);
    expect(titulo.replace(/<br\s*\/?>/g, "").replace(/<[^>]+>/g, "")).not.toMatch(/\.[A-ZÁÉÍÓÚ]|[a-záéíóú][A-ZÁÉÍÓÚ]/);
  });

  // Titulares que usa el resto del sitio: el texto antes del <br /> termina en {" "}.
  const root = path.resolve(__dirname);
  const CASOS: [archivo: string, texto: string][] = [
    ["home.tsx", "Detrás de cada explicación hay años de recorrido."],
    ["home.tsx", "Antes del"],
    ["admin-content.tsx", "Claro. Cercano."],
    ["how-it-works.tsx", "También tenemos"],
  ];

  it.each(CASOS)("%s: «%s» lleva un espacio antes del salto", (archivo, texto) => {
    const codigo = fs.readFileSync(path.join(root, archivo), "utf8").replace(/\r\n/g, "\n");
    const despues = codigo.slice(codigo.indexOf(texto) + texto.length);
    expect(despues.startsWith('{" "}\n')).toBe(true);
    expect(despues.replace(/^\{" "\}\n\s*/, "").startsWith("<br />")).toBe(true);
  });
});
