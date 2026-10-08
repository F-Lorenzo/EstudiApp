import { describe, expect, it } from "vitest";
import { postLoginPath, safeInternalPath } from "./redirect";

describe("safeInternalPath", () => {
  it.each(["/alumno", "/docente/perfil?x=1", "/alumno/reservas/abc#top"])(
    "acepta la ruta interna %s",
    (path) => {
      expect(safeInternalPath(path)).toBe(path);
    },
  );

  it.each([
    ["URL absoluta", "https://evil.example"],
    ["protocolo relativo", "//evil.example"],
    ["tabulación entre barras", "/\t/evil.example"],
    ["salto de línea entre barras", "/\n/evil.example"],
    ["barra invertida", "/\\evil.example"],
    ["sin barra inicial", "alumno"],
    ["vacío", ""],
    ["no es texto (null)", null],
    ["no es texto (número)", 42],
  ])("rechaza %s", (_nombre, valor) => {
    expect(safeInternalPath(valor)).toBeNull();
  });
});

describe("postLoginPath", () => {
  it("respeta la ruta pedida si es segura", () => {
    expect(postLoginPath("/alumno/proximas-clases", "alumno")).toBe("/alumno/proximas-clases");
  });

  it("si la ruta es insegura, va al inicio de cada rol", () => {
    expect(postLoginPath("//evil.example", "alumno")).toBe("/alumno");
    expect(postLoginPath("//evil.example", "docente")).toBe("/docente");
    expect(postLoginPath(null, "administrador")).toBe("/admin/docentes/pendientes");
  });
});
