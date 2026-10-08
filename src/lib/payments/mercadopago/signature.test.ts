import { describe, expect, it } from "vitest";
import { computeWebhookSignature, verifyWebhookSignature, webhookManifest } from "./signature";

const SECRET = "clave-de-prueba-no-real";
const TS = "1742505638683";
const REQUEST_ID = "bb56a2f1-6aae-46ac-982e-9dcd3581d08e";

/**
 * Valores calculados APARTE con `openssl dgst -sha256 -hmac` (no con este código), para fijar el
 * algoritmo: texto firmado, HMAC SHA-256 en hexadecimal.
 *
 * Ojo: esto prueba que cumplimos el formato que documenta Mercado Pago, no que Mercado Pago lo
 * cumpla igual. Se confirma de verdad con el primer aviso real de la cuenta de prueba (paso 1.5).
 */
const OPENSSL = {
  completo: "1c45ac89510bbddb637b74369642166bb6878a99ac575a828691e93c22cecd83", // id:123456;request-id:…;ts:…;
  sinId: "db695953362c02a67c9d2fae01751e6a3e7e7d116b6e7a4729f2f1df4fd04ce0", // request-id:req-1;ts:…;
  sinRequestId: "ab5f408ddcc39f16a03702548b4e63cfb18fcfea5d8f327843195de345c5b6e6", // id:abcd12;ts:…;
};

const header = (v1: string, ts = TS) => `ts=${ts},v1=${v1}`;
const valid = { secret: SECRET, signature: header(OPENSSL.completo), requestId: REQUEST_ID, dataId: "123456" };

describe("texto firmado", () => {
  it("arma id, request-id y ts en ese orden", () => {
    expect(webhookManifest({ dataId: "123456", requestId: REQUEST_ID, ts: TS })).toBe(`id:123456;request-id:${REQUEST_ID};ts:${TS};`);
  });

  it("omite las partes que no llegaron", () => {
    expect(webhookManifest({ dataId: null, requestId: "req-1", ts: TS })).toBe(`request-id:req-1;ts:${TS};`);
    expect(webhookManifest({ dataId: "abcd12", requestId: null, ts: TS })).toBe(`id:abcd12;ts:${TS};`);
    expect(webhookManifest({ dataId: null, requestId: null, ts: TS })).toBe(`ts:${TS};`);
  });

  it("pasa a minúsculas un data.id alfanumérico", () => {
    expect(webhookManifest({ dataId: "ABCD12", requestId: null, ts: TS })).toBe(`id:abcd12;ts:${TS};`);
  });
});

describe("firma de los avisos", () => {
  it("coincide con el HMAC SHA-256 calculado por fuera", () => {
    expect(computeWebhookSignature(SECRET, { dataId: "123456", requestId: REQUEST_ID, ts: TS })).toBe(OPENSSL.completo);
    expect(computeWebhookSignature(SECRET, { dataId: null, requestId: "req-1", ts: TS })).toBe(OPENSSL.sinId);
    expect(computeWebhookSignature(SECRET, { dataId: "ABCD12", requestId: null, ts: TS })).toBe(OPENSSL.sinRequestId);
  });

  it("acepta un aviso bien firmado", () => {
    expect(verifyWebhookSignature(valid)).toEqual({ ok: true, ts: TS });
  });

  it("acepta avisos sin data.id o sin request-id si así se firmaron", () => {
    expect(verifyWebhookSignature({ ...valid, signature: header(OPENSSL.sinId), dataId: null, requestId: "req-1" }).ok).toBe(true);
    expect(verifyWebhookSignature({ ...valid, signature: header(OPENSSL.sinRequestId), dataId: "ABCD12", requestId: null }).ok).toBe(true);
  });

  it("tolera espacios y campos de más en la cabecera", () => {
    expect(verifyWebhookSignature({ ...valid, signature: ` ts=${TS} , v1=${OPENSSL.completo} , v0=otra` }).ok).toBe(true);
    expect(verifyWebhookSignature({ ...valid, signature: `v1=${OPENSSL.completo},ts=${TS}` }).ok).toBe(true);
  });

  it("rechaza con otra clave", () => {
    expect(verifyWebhookSignature({ ...valid, secret: "otra-clave" })).toEqual({ ok: false, reason: "mismatch" });
  });

  it("rechaza si cambió el data.id (un aviso reciclado para otro pago)", () => {
    expect(verifyWebhookSignature({ ...valid, dataId: "123457" })).toEqual({ ok: false, reason: "mismatch" });
  });

  it("rechaza si cambió el request-id o el ts", () => {
    expect(verifyWebhookSignature({ ...valid, requestId: "otro" }).ok).toBe(false);
    expect(verifyWebhookSignature({ ...valid, signature: header(OPENSSL.completo, "1742505638684") }).ok).toBe(false);
  });

  it("rechaza si se agregan o se quitan partes del texto firmado", () => {
    expect(verifyWebhookSignature({ ...valid, dataId: null }).ok).toBe(false);
    expect(verifyWebhookSignature({ ...valid, requestId: null }).ok).toBe(false);
  });

  it("rechaza una firma alterada en un solo carácter", () => {
    const flipped = (OPENSSL.completo.startsWith("0") ? "1" : "0") + OPENSSL.completo.slice(1);
    expect(verifyWebhookSignature({ ...valid, signature: header(flipped) })).toEqual({ ok: false, reason: "mismatch" });
  });

  it("sin clave configurada nunca acepta nada", () => {
    expect(verifyWebhookSignature({ ...valid, secret: undefined })).toEqual({ ok: false, reason: "missing_secret" });
    expect(verifyWebhookSignature({ ...valid, secret: "" })).toEqual({ ok: false, reason: "missing_secret" });
  });

  it("rechaza avisos sin cabecera de firma o con una mal formada", () => {
    expect(verifyWebhookSignature({ ...valid, signature: null })).toEqual({ ok: false, reason: "missing_signature" });
    for (const signature of [
      "",
      "basura",
      `v1=${OPENSSL.completo}`, // sin ts
      `ts=${TS}`, // sin v1
      `ts=${TS},v1=`,
      `ts=abc,v1=${OPENSSL.completo}`, // ts que no es número
      `ts=${TS},v1=${OPENSSL.completo.slice(2)}`, // más corta
      `ts=${TS},v1=${OPENSSL.completo}00`, // más larga
      `ts=${TS},v1=${"z".repeat(64)}`, // no hexadecimal
    ]) {
      const result = verifyWebhookSignature({ ...valid, signature });
      expect(result.ok, signature).toBe(false);
    }
  });
});
