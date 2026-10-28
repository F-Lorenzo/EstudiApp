import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AVATAR_NOT_OWN, CREDENTIAL_NOT_OWN, avatarError, credentialError, credentialViewUrl, removeOtherAvatars, removeOtherCredentials } from "./server";
import { avatarPublicUrl } from "./uploads";

const SUPABASE = "https://proyecto.supabase.co";
const ME = "00000000-0000-0000-0000-0000000000d1";
const OTHER = "00000000-0000-0000-0000-0000000000d2";
const A = "3f2b8c1e-9d4a-4b6f-8e2d-1a2b3c4d5e6f";
const B = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";

beforeEach(() => vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", SUPABASE));
afterEach(() => vi.unstubAllEnvs());

function fakeStorage(files: string[], { listError = false, signError = false } = {}) {
  const calls: { op: string; bucket: string; args: unknown }[] = [];
  const client = {
    storage: {
      from: (bucket: string) => ({
        list: async (folder: string) => {
          calls.push({ op: "list", bucket, args: folder });
          return listError ? { data: null, error: new Error("boom") } : { data: files.map((name) => ({ name })), error: null };
        },
        remove: async (names: string[]) => {
          calls.push({ op: "remove", bucket, args: names });
          return { data: [], error: null };
        },
        createSignedUrl: async (name: string, seconds: number) => {
          calls.push({ op: "sign", bucket, args: [name, seconds] });
          return signError ? { data: null, error: new Error("no") } : { data: { signedUrl: `${SUPABASE}/firmado/${name}` }, error: null };
        },
      }),
    },
  } as unknown as SupabaseClient;
  return { client, calls };
}

describe("qué se puede guardar", () => {
  const mine = avatarPublicUrl(SUPABASE, `${ME}/${A}.webp`);
  it("la foto: vacía, la de antes o una propia recién subida", () => {
    expect(avatarError("", "https://viejo.com/yo.jpg", ME)).toBeNull();
    expect(avatarError("https://viejo.com/yo.jpg", "https://viejo.com/yo.jpg", ME)).toBeNull();
    expect(avatarError(mine, null, ME)).toBeNull();
    expect(avatarError("https://otro-sitio.com/rastreador.gif", null, ME)).toBe(AVATAR_NOT_OWN);
    expect(avatarError(avatarPublicUrl(SUPABASE, `${OTHER}/${A}.webp`), null, ME)).toBe(AVATAR_NOT_OWN);
  });

  it("el respaldo: vacío, el de antes o un archivo propio", () => {
    expect(credentialError("", `${ME}/${A}.pdf`, ME)).toBeNull();
    expect(credentialError("https://drive.google.com/x", "https://drive.google.com/x", ME)).toBeNull();
    expect(credentialError(`${ME}/${B}.pdf`, null, ME)).toBeNull();
    expect(credentialError("https://drive.google.com/nuevo", null, ME)).toBe(CREDENTIAL_NOT_OWN);
    expect(credentialError(`${OTHER}/${B}.pdf`, null, ME)).toBe(CREDENTIAL_NOT_OWN);
  });
});

describe("limpieza de archivos viejos", () => {
  it("borra las fotos de la cuenta menos la guardada", async () => {
    const { client, calls } = fakeStorage([`${A}.webp`, `${B}.webp`]);
    await removeOtherAvatars(client, ME, avatarPublicUrl(SUPABASE, `${ME}/${B}.webp`));
    expect(calls).toEqual([
      { op: "list", bucket: "avatars", args: ME },
      { op: "remove", bucket: "avatars", args: [`${ME}/${A}.webp`] },
    ]);
  });

  it("sin foto, o con un enlace de afuera, borra todas", async () => {
    const { client, calls } = fakeStorage([`${A}.webp`]);
    await removeOtherAvatars(client, ME, "https://viejo.com/yo.jpg");
    expect(calls.at(-1)).toEqual({ op: "remove", bucket: "avatars", args: [`${ME}/${A}.webp`] });
  });

  it("nada que borrar, no borra nada; un error no corta el guardado", async () => {
    const same = fakeStorage([`${A}.pdf`]);
    await removeOtherCredentials(same.client, ME, `${ME}/${A}.pdf`);
    expect(same.calls.map((c) => c.op)).toEqual(["list"]);
    const failing = fakeStorage([], { listError: true });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(removeOtherCredentials(failing.client, ME, null)).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledOnce();
    log.mockRestore();
  });
});

describe("credentialViewUrl", () => {
  it("firma los archivos por 10 minutos y deja los enlaces de antes como están", async () => {
    const { client, calls } = fakeStorage([]);
    expect(await credentialViewUrl(client, `${ME}/${A}.pdf`)).toBe(`${SUPABASE}/firmado/${ME}/${A}.pdf`);
    expect(calls[0]).toEqual({ op: "sign", bucket: "credentials", args: [`${ME}/${A}.pdf`, 600] });
    expect(await credentialViewUrl(client, "https://drive.google.com/x")).toBe("https://drive.google.com/x");
    expect(await credentialViewUrl(client, null)).toBeNull();
    expect(await credentialViewUrl(fakeStorage([], { signError: true }).client, `${ME}/${A}.pdf`)).toBeNull();
  });
});
