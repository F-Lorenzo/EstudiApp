import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { TokenCryptoError, decryptToken, encryptToken, parseEncryptionKey, tokenAad } from "./token-crypto";

const key = randomBytes(32);
const aad = tokenAad("d1000000-0000-0000-0000-000000000001", "access");

describe("clave de cifrado", () => {
  it("se lee de base64 y tiene que ser de 32 bytes", () => {
    expect(parseEncryptionKey(key.toString("base64"))).toEqual(key);
  });

  it("rechaza una clave ausente, corta o larga", () => {
    expect(() => parseEncryptionKey(undefined)).toThrow(TokenCryptoError);
    expect(() => parseEncryptionKey("")).toThrow(/Falta/);
    expect(() => parseEncryptionKey(randomBytes(16).toString("base64"))).toThrow(/32 bytes/);
    expect(() => parseEncryptionKey(randomBytes(33).toString("base64"))).toThrow(/32 bytes/);
  });
});

describe("cifrado de tokens", () => {
  it("se descifra a lo mismo que se cifró", () => {
    const token = "APP_USR-1234567890-abcdef-1111111111";
    expect(decryptToken(encryptToken(token, key, aad), key, aad)).toBe(token);
  });

  it("no deja el token a la vista", () => {
    const token = "APP_USR-secreto";
    expect(encryptToken(token, key, aad)).not.toContain("APP_USR");
  });

  it("cifrar dos veces lo mismo da textos distintos (IV nuevo)", () => {
    expect(encryptToken("x", key, aad)).not.toBe(encryptToken("x", key, aad));
  });

  it("guarda la versión para poder cambiar de algoritmo", () => {
    expect(encryptToken("x", key, aad)).toMatch(/^v1\.[\w-]+\.[\w-]+\.[\w-]+$/);
  });

  it("no se descifra con otra clave", () => {
    expect(() => decryptToken(encryptToken("x", key, aad), randomBytes(32), aad)).toThrow(TokenCryptoError);
  });

  it("no se descifra en la fila de otro docente ni como otro tipo de token", () => {
    const stored = encryptToken("x", key, aad);
    expect(() => decryptToken(stored, key, tokenAad("d2000000-0000-0000-0000-000000000002", "access"))).toThrow(TokenCryptoError);
    expect(() => decryptToken(stored, key, tokenAad("d1000000-0000-0000-0000-000000000001", "refresh"))).toThrow(TokenCryptoError);
  });

  it("detecta un texto alterado", () => {
    const [version, iv, tag, ciphertext] = encryptToken("token-largo-de-prueba", key, aad).split(".");
    const tampered = (ciphertext[0] === "A" ? "B" : "A") + ciphertext.slice(1);
    expect(() => decryptToken([version, iv, tag, tampered].join("."), key, aad)).toThrow(TokenCryptoError);
  });

  it("rechaza formatos desconocidos sin filtrar detalles", () => {
    for (const stored of ["", "texto-plano", "v2.a.b.c", "v1.a.b", "v1.a.b.c.d"]) {
      expect(() => decryptToken(stored, key, aad), stored).toThrow(TokenCryptoError);
    }
    try {
      decryptToken(encryptToken("x", key, aad), randomBytes(32), aad);
    } catch (error) {
      expect(String(error)).not.toMatch(/bad decrypt|auth|tag/i);
    }
  });
});
