"use client";

import { useActionState, useState, useTransition } from "react";
import {
  deleteCommissionTier,
  saveCommissionSettings,
  saveCommissionTier,
} from "@/app/admin/comision/actions";
import { FieldError } from "@/components/field-error";
import { Badge, EmptyState, PageHeading } from "@/components/ui";
import {
  formatRate,
  type CommissionPreviewRow,
  type CommissionSettings,
  type CommissionTier,
} from "@/lib/admin/commission";
import { initialActionState } from "@/lib/validation/form-state";

/** Una tasa (0,125) como la escribe una persona en el formulario («12,5»). */
const asPercentInput = (rate: number) => String(Math.round(rate * 10000) / 100).replace(".", ",");
const asRatingInput = (rating: number) => String(rating).replace(".", ",");

export function CommissionAdmin({
  settings,
  tiers,
  preview,
}: {
  settings: CommissionSettings;
  tiers: CommissionTier[];
  preview: CommissionPreviewRow[];
}) {
  return (
    <div className="mgmt-page">
      <PageHeading
        eyebrow="COMISIÓN POR REPUTACIÓN"
        title="Mejores referencias, menos comisión."
        description="Cuantas más reseñas y mejor calificación tiene un docente, menos comisión paga. Cada reserva guarda la comisión del momento en que se crea: los cambios nunca tocan las clases ya reservadas."
      >
        <Badge tone={settings.enabled ? "green" : "muted"}>{settings.enabled ? "Encendida" : "Apagada"}</Badge>
      </PageHeading>
      <div className="mgmt-commission-layout">
        <SettingsForm settings={settings} />
        <section className="mgmt-panel">
          <div className="mgmt-section-heading">
            <div>
              <h2>Escalones</h2>
              <p>
                Un docente paga la comisión más baja de los escalones que cumple, nunca menos que el piso. Cuentan solo
                las reseñas de clases dadas y pagas, una por alumno.
              </p>
            </div>
          </div>
          <div className="mgmt-tier-list">
            <div className="mgmt-tier-row mgmt-tier-head" aria-hidden="true">
              <span>Reseñas</span>
              <span>Calificación mínima</span>
              <span>Comisión</span>
              <span>Activo</span>
              <span />
            </div>
            <p className="mgmt-tier-base">
              Con menos reseñas de las que pide el primer escalón: la base, {formatRate(settings.baseRate)}.
            </p>
            {tiers.map((tier) => (
              <TierForm key={tier.id} tier={tier} />
            ))}
            <TierForm key="nuevo" tier={null} />
          </div>
        </section>
      </div>
      <section className="mgmt-panel mgmt-commission-preview">
        <div className="mgmt-section-heading">
          <div>
            <h2>Cómo queda cada docente</h2>
            <p>
              {settings.enabled
                ? "La comisión que se le cobra hoy a cada docente aprobado en sus nuevas reservas."
                : "Con la regla apagada, todos pagan la base. Acá ves qué comisión tendría cada uno si la encendieras."}
            </p>
          </div>
        </div>
        {preview.length ? (
          <div className="mgmt-table-wrap">
            <table className="mgmt-table">
              <thead>
                <tr>
                  <th>Docente</th>
                  <th>Reseñas que cuentan</th>
                  <th>Promedio</th>
                  <th>Con la regla encendida</th>
                  <th>Hoy paga</th>
                </tr>
              </thead>
              <tbody>
                {preview.map((row) => (
                  <tr key={row.tutorId}>
                    <td>{row.name}</td>
                    <td>{row.reviews}</td>
                    <td>{row.average === null ? "—" : row.average.toFixed(2).replace(".", ",")}</td>
                    <td>{formatRate(row.rateIfEnabled)}</td>
                    <td>
                      <strong>{formatRate(row.currentRate)}</strong>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="Todavía no hay docentes aprobados" description="Cuando apruebes uno, aparece acá con su comisión." />
        )}
      </section>
    </div>
  );
}

function SettingsForm({ settings }: { settings: CommissionSettings }) {
  const [state, formAction, pending] = useActionState(saveCommissionSettings, initialActionState);
  return (
    <form action={formAction} className="mgmt-panel mgmt-commission-settings">
      <span className="mgmt-small-label">CONFIGURACIÓN</span>
      <label className="mgmt-check">
        <input type="checkbox" name="enabled" defaultChecked={settings.enabled} />
        <span>
          <strong>Aplicar la comisión por reputación</strong>
          <small>Apagada, todos pagan la comisión base.</small>
        </span>
      </label>
      <label className="mgmt-field">
        Comisión base (%)
        <input
          name="base"
          inputMode="decimal"
          required
          defaultValue={state.values?.base ?? asPercentInput(settings.baseRate)}
          aria-invalid={state.fieldErrors?.base ? true : undefined}
        />
        <FieldError messages={state.fieldErrors?.base} />
      </label>
      <label className="mgmt-field">
        Piso (%)
        <input
          name="floor"
          inputMode="decimal"
          required
          defaultValue={state.values?.floor ?? asPercentInput(settings.floorRate)}
          aria-invalid={state.fieldErrors?.floor ? true : undefined}
        />
        <FieldError messages={state.fieldErrors?.floor} />
      </label>
      {state.error && (
        <p className="mgmt-field-error" role="alert">
          {state.error}
        </p>
      )}
      {state.success && (
        <p className="mgmt-field-hint" role="status">
          Guardado. Se aplica a las reservas que se creen desde ahora.
        </p>
      )}
      <button type="submit" className="mgmt-button" disabled={pending}>
        {pending ? "Guardando…" : "Guardar configuración"}
      </button>
    </form>
  );
}

function TierForm({ tier }: { tier: CommissionTier | null }) {
  const [state, formAction, pending] = useActionState(saveCommissionTier.bind(null, tier?.id ?? null), initialActionState);
  const [deleting, startDelete] = useTransition();
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const label = tier ? `escalón de ${tier.minReviews} reseñas` : "escalón nuevo";

  return (
    <form action={formAction} className="mgmt-tier-row" aria-label={tier ? `Escalón de ${tier.minReviews} reseñas` : "Agregar un escalón"}>
      <label className="mgmt-field">
        <span className="mgmt-tier-label">Reseñas (mínimo)</span>
        <input
          name="minReviews"
          inputMode="numeric"
          required
          aria-label={`Reseñas mínimas del ${label}`}
          defaultValue={state.values?.minReviews ?? (tier ? String(tier.minReviews) : "")}
          placeholder="Ej.: 10"
        />
        <FieldError messages={state.fieldErrors?.minReviews} />
      </label>
      <label className="mgmt-field">
        <span className="mgmt-tier-label">Calificación mínima</span>
        <input
          name="minRating"
          inputMode="decimal"
          required
          aria-label={`Calificación mínima del ${label}`}
          defaultValue={state.values?.minRating ?? (tier ? asRatingInput(tier.minRating) : "")}
          placeholder="Ej.: 4,5"
        />
        <FieldError messages={state.fieldErrors?.minRating} />
      </label>
      <label className="mgmt-field">
        <span className="mgmt-tier-label">Comisión (%)</span>
        <input
          name="rate"
          inputMode="decimal"
          required
          aria-label={`Comisión del ${label}`}
          defaultValue={state.values?.rate ?? (tier ? asPercentInput(tier.rate) : "")}
          placeholder="Ej.: 10"
        />
        <FieldError messages={state.fieldErrors?.rate} />
      </label>
      <label className="mgmt-check mgmt-tier-active">
        <input type="checkbox" name="active" defaultChecked={tier ? tier.active : true} aria-label={`Activo: ${label}`} />
        <span className="mgmt-tier-label">Activo</span>
      </label>
      <div className="mgmt-tier-actions">
        <button type="submit" className="mgmt-button mgmt-button-secondary" disabled={pending}>
          {pending ? "Guardando…" : tier ? "Guardar" : "Agregar"}
        </button>
        {tier && (
          <button
            type="button"
            className="mgmt-text-button"
            disabled={deleting}
            onClick={() =>
              startDelete(async () => {
                const result = await deleteCommissionTier(tier.id);
                setDeleteError(result.error ?? null);
              })
            }
          >
            {deleting ? "Borrando…" : "Borrar"}
          </button>
        )}
      </div>
      {(state.error || deleteError) && (
        <p className="mgmt-field-error mgmt-tier-message" role="alert">
          {state.error ?? deleteError}
        </p>
      )}
      {state.success && !tier && (
        <p className="mgmt-field-hint mgmt-tier-message" role="status">
          Escalón agregado.
        </p>
      )}
    </form>
  );
}
