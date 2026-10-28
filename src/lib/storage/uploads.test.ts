import { describe, expect, it } from "vitest";
import {
  avatarPublicUrl,
  centeredSquare,
  isExternalLink,
  isOwnCredentialObject,
  newObjectName,
  ownAvatarObject,
} from "./uploads";

const SUPABASE = "https://proyecto.supabase.co";
const ME = "00000000-0000-0000-0000-0000000000a1";
const OTHER = "00000000-0000-0000-0000-0000000000a2";
const FILE = "3f2b8c1e-9d4a-4b6f-8e2d-1a2b3c4d5e6f";

describe("fotos de perfil", () => {
  it("arma un nombre nuevo, al azar, en la subcarpeta de la cuenta", () => {
    const a = newObjectName(ME, "webp");
    expect(a).toMatch(new RegExp(`^${ME}/[0-9a-f-]{36}\\.webp$`));
    expect(newObjectName(ME, "webp")).not.toBe(a);
  });

  it("reconoce solo las fotos propias subidas a la carpeta", () => {
    const mine = avatarPublicUrl(`${SUPABASE}/`, `${ME}/${FILE}.webp`);
    expect(mine).toBe(`${SUPABASE}/storage/v1/object/public/avatars/${ME}/${FILE}.webp`);
    expect(ownAvatarObject(mine, SUPABASE, ME)).toBe(`${ME}/${FILE}.webp`);
    expect(ownAvatarObject(avatarPublicUrl(SUPABASE, `${OTHER}/${FILE}.webp`), SUPABASE, ME)).toBeNull();
    expect(ownAvatarObject(`https://otro-sitio.com/storage/v1/object/public/avatars/${ME}/${FILE}.webp`, SUPABASE, ME)).toBeNull();
    expect(ownAvatarObject(`${mine}?x=1`, SUPABASE, ME)).toBeNull();
    expect(ownAvatarObject(avatarPublicUrl(SUPABASE, `${ME}/../${OTHER}/${FILE}.webp`), SUPABASE, ME)).toBeNull();
    expect(ownAvatarObject(avatarPublicUrl(SUPABASE, `${ME}/${FILE}.svg`), SUPABASE, ME)).toBeNull();
  });
});

describe("respaldos", () => {
  it("reconoce solo los propios, con un tipo permitido", () => {
    expect(isOwnCredentialObject(`${ME}/${FILE}.pdf`, ME)).toBe(true);
    expect(isOwnCredentialObject(`${OTHER}/${FILE}.pdf`, ME)).toBe(false);
    expect(isOwnCredentialObject(`${ME}/sub/${FILE}.pdf`, ME)).toBe(false);
    expect(isOwnCredentialObject(`${ME}/${FILE}.html`, ME)).toBe(false);
    expect(isOwnCredentialObject(`https://drive.google.com/x`, ME)).toBe(false);
  });

  it("los de antes eran enlaces", () => {
    expect(isExternalLink("https://drive.google.com/x")).toBe(true);
    expect(isExternalLink(`${ME}/${FILE}.pdf`)).toBe(false);
  });
});

describe("centeredSquare", () => {
  it("recorta al centro el lado más corto", () => {
    expect(centeredSquare(1200, 800)).toEqual({ x: 200, y: 0, side: 800 });
    expect(centeredSquare(600, 900)).toEqual({ x: 0, y: 150, side: 600 });
    expect(centeredSquare(400, 400)).toEqual({ x: 0, y: 0, side: 400 });
  });
});
