"use client";

import { createContext, useContext, useEffect, useRef, type ReactNode } from "react";

/**
 * Cloudflare Turnstile en los formularios de acceso (login, registro, recuperación). La clave pública
 * (`TURNSTILE_SITE_KEY`) la lee el servidor en el layout y llega por contexto; sin ella no se muestra nada y el
 * servidor tampoco exige el token (ver `src/lib/security/turnstile.ts`).
 *
 * El widget agrega al formulario el campo oculto `cf-turnstile-response`. Un token sirve una sola vez: después de
 * cada envío (`resetKey` cambia) se pide uno nuevo.
 */
type TurnstileApi = {
  render(container: HTMLElement, options: Record<string, unknown>): string;
  reset(widgetId: string): void;
  remove(widgetId: string): void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SCRIPT_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
let scriptPromise: Promise<TurnstileApi> | null = null;

function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  scriptPromise ??= new Promise<TurnstileApi>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SCRIPT_URL;
    script.async = true;
    script.defer = true;
    script.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error("turnstile")));
    script.onerror = () => {
      scriptPromise = null;
      reject(new Error("turnstile"));
    };
    document.head.appendChild(script);
  });
  return scriptPromise;
}

const SiteKeyContext = createContext<string | null>(null);

export function TurnstileProvider({ siteKey, children }: { siteKey: string | null; children: ReactNode }) {
  return <SiteKeyContext.Provider value={siteKey}>{children}</SiteKeyContext.Provider>;
}

export function TurnstileWidget({ action, resetKey }: { action: "login" | "registro" | "recuperar"; resetKey?: unknown }) {
  const siteKey = useContext(SiteKeyContext);
  const container = useRef<HTMLDivElement>(null);
  const widget = useRef<string | null>(null);

  useEffect(() => {
    if (!siteKey || !container.current) return;
    let cancelled = false;
    loadTurnstile()
      .then((api) => {
        if (cancelled || !container.current) return;
        widget.current = api.render(container.current, {
          sitekey: siteKey,
          action,
          language: "es",
          appearance: "interaction-only",
        });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      if (widget.current) window.turnstile?.remove(widget.current);
      widget.current = null;
    };
  }, [siteKey, action]);

  useEffect(() => {
    if (widget.current) window.turnstile?.reset(widget.current);
  }, [resetKey]);

  if (!siteKey) return null;
  return <div ref={container} className="pub-turnstile" />;
}
