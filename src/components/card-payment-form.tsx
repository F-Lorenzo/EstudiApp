"use client";

import { useEffect, useId, useRef, useState } from "react";

/**
 * Formulario de tarjeta de Mercado Pago (Card Payment Brick, Checkout API). Lo dibuja el SDK de Mercado Pago
 * dentro de la página: el número de la tarjeta nunca pasa por EstudiApp, solo el token que devuelve el SDK.
 *
 * La tarjeta se tokeniza con la clave pública del DOCENTE (modelo marketplace): el pago se crea después con su
 * token de acceso, y Mercado Pago exige que los dos sean de la misma cuenta.
 */

const SDK_URL = "https://sdk.mercadopago.com/js/v2";

type BrickController = { unmount: () => void };
type MercadoPagoInstance = {
  bricks: () => {
    create: (brick: "cardPayment", containerId: string, settings: Record<string, unknown>) => Promise<BrickController>;
  };
};
type MercadoPagoConstructor = new (publicKey: string, options: { locale: string }) => MercadoPagoInstance;

declare global {
  interface Window {
    MercadoPago?: MercadoPagoConstructor;
  }
}

let sdkPromise: Promise<MercadoPagoConstructor> | null = null;

/** Carga el SDK una sola vez por página. Si falla, el próximo intento vuelve a probar. */
function loadSdk(): Promise<MercadoPagoConstructor> {
  if (window.MercadoPago) return Promise.resolve(window.MercadoPago);
  sdkPromise ??= new Promise<MercadoPagoConstructor>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SDK_URL;
    script.async = true;
    script.onload = () => (window.MercadoPago ? resolve(window.MercadoPago) : reject(new Error("sdk")));
    script.onerror = () => reject(new Error("sdk"));
    document.head.appendChild(script);
  }).catch((error: unknown) => {
    sdkPromise = null;
    throw error;
  });
  return sdkPromise;
}

export function CardPaymentForm({
  publicKey,
  amount,
  payerEmail,
  onSubmit,
}: {
  publicKey: string;
  amount: number;
  payerEmail: string | null;
  /** Recibe lo que arma el formulario (token, medio, cuotas, pagador). Devuelve `true` si el pago se procesó. */
  onSubmit: (formData: unknown) => Promise<boolean>;
}) {
  const containerId = `mp-card-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  // El formulario se crea una vez: si la función cambia entre renders no hay que volver a dibujarlo.
  const submitRef = useRef(onSubmit);
  useEffect(() => {
    submitRef.current = onSubmit;
  }, [onSubmit]);

  useEffect(() => {
    let controller: BrickController | null = null;
    let cancelled = false;

    loadSdk()
      .then((MercadoPago) => {
        if (cancelled) return null;
        const mp = new MercadoPago(publicKey, { locale: "es-AR" });
        return mp.bricks().create("cardPayment", containerId, {
          initialization: { amount, ...(payerEmail ? { payer: { email: payerEmail } } : {}) },
          customization: {
            paymentMethods: { maxInstallments: 1 },
            visual: {
              style: {
                customVariables: {
                  baseColor: "#023618",
                  formBackgroundColor: "#FFFCF2",
                  errorColor: "#B02E0C",
                  fontSizeMedium: "16px",
                },
              },
            },
          },
          callbacks: {
            onReady: () => {
              if (!cancelled) setState("ready");
            },
            // El SDK espera una promesa: se resuelve si el pago se procesó y se rechaza para que la persona
            // pueda corregir y volver a intentar.
            onSubmit: async (formData: unknown) => {
              if (!(await submitRef.current(formData))) throw new Error("rechazado");
            },
            onError: () => {
              // Errores de validación del formulario los muestra el propio SDK; solo nos importa si no cargó.
            },
          },
        });
      })
      .then((created) => {
        if (!created) return;
        if (cancelled) created.unmount();
        else controller = created;
      })
      .catch(() => {
        if (!cancelled) setState("error");
      });

    return () => {
      cancelled = true;
      controller?.unmount();
    };
  }, [publicKey, amount, payerEmail, containerId]);

  return (
    <div className="stu-card-payment">
      {state === "loading" && (
        <p className="stu-payment-caption" role="status">
          Cargando el formulario seguro de Mercado Pago…
        </p>
      )}
      {state === "error" && (
        <p className="stu-field-error" role="alert">
          No pudimos cargar el formulario de pago. Revisá tu conexión y volvé a intentar.
        </p>
      )}
      <div id={containerId} />
    </div>
  );
}
