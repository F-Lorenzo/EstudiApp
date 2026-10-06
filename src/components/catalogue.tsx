"use client";

import { useState, useTransition, type FormEvent } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Avatar, ButtonLink, EmptyState, Icon } from "@/components/ui";
import { money } from "@/lib/format";
import {
  catalogQueryString,
  PRICE_CEILING,
  PRICE_FLOOR,
  type CatalogUiFilters,
} from "@/lib/tutors/filters";
import type { Teacher } from "@/lib/tutors/view";

export function Catalogue({
  teachers,
  subjects,
  filters,
  loadFailed,
}: {
  teachers: Teacher[];
  subjects: string[];
  filters: CatalogUiFilters;
  /** La consulta a la base falló: se muestra un aviso en lugar de resultados. */
  loadFailed: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const [filtersOpen, setFiltersOpen] = useState(false);

  // Los filtros viven en la URL (la fuente de verdad es el servidor). Este
  // estado local solo permite escribir y arrastrar el precio sin esperar la
  // respuesta; se reajusta cuando la URL cambia desde afuera.
  const urlKey = catalogQueryString(filters);
  const [syncedKey, setSyncedKey] = useState(urlKey);
  const [draft, setDraft] = useState(filters);
  if (syncedKey !== urlKey) {
    setSyncedKey(urlKey);
    setDraft(filters);
  }

  const price = draft.precioMax ?? PRICE_CEILING;
  const filterCount =
    draft.materias.length +
    Number(draft.precioMax != null) +
    Number(draft.disponibilidad);
  const hasAnyFilter = filterCount > 0 || filters.q !== "";

  function apply(next: CatalogUiFilters) {
    setDraft(next);
    startTransition(() => {
      router.replace(`${pathname}${catalogQueryString(next)}`, {
        scroll: false,
      });
    });
  }
  function submitSearch(event: FormEvent) {
    event.preventDefault();
    apply({ ...draft, q: draft.q.trim() });
  }
  function reset() {
    apply({
      q: "",
      materias: [],
      precioMax: null,
      disponibilidad: false,
      orden: draft.orden,
    });
  }
  function toggleSubject(subject: string) {
    apply({
      ...draft,
      materias: draft.materias.includes(subject)
        ? draft.materias.filter((item) => item !== subject)
        : [...draft.materias, subject],
    });
  }
  function commitPrice(value: number) {
    apply({ ...draft, precioMax: value >= PRICE_CEILING ? null : value });
  }

  return (
    <div className="pub-catalogue">
      <section className="pub-catalogue-intro pub-container">
        <div>
          <p className="pub-eyebrow">
            <span /> UN BUEN PROFE HACE LA DIFERENCIA
          </p>
          <h1>
            El próximo <span className="pub-underlined">«entendí»</span>
            <br />
            empieza acá.
          </h1>
          <p>
            Encontrá a alguien que sepa de tu materia.
            <br className="pub-desktop-break" /> Y que sepa cómo acompañarte.
          </p>
        </div>
        <div className="pub-catalogue-note" aria-hidden="true">
          <span className="pub-note-star">✳</span>
          <span>
            Tu materia.
            <br />
            Tu ritmo.
            <br />
            <strong>Tu próximo paso.</strong>
          </span>
          <svg viewBox="0 0 100 65">
            <path
              d="M8 10c15 37 56 47 76 21M66 28l20 1-5 20"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
      </section>

      <section className="pub-catalogue-body pub-container">
        <button
          className="pub-filter-toggle pub-outline-button"
          type="button"
          onClick={() => setFiltersOpen(!filtersOpen)}
          aria-expanded={filtersOpen}
          aria-controls="catalogue-filters"
        >
          <Icon name="filter" size={18} /> Filtrar docentes{" "}
          {filterCount > 0 && <span>{filterCount}</span>}
          <Icon name={filtersOpen ? "minus" : "plus"} size={18} />
        </button>
        <aside
          id="catalogue-filters"
          className={`pub-filters ${filtersOpen ? "pub-filters-open" : ""}`}
        >
          <div className="pub-filter-title">
            <h2>Encontrá tu profe</h2>
            {hasAnyFilter && (
              <button type="button" onClick={reset} className="pub-text-button">
                Limpiar
              </button>
            )}
          </div>
          <fieldset>
            <legend>Materia</legend>
            {subjects.map((subject) => (
              <label className="pub-check" key={subject}>
                <input
                  type="checkbox"
                  checked={draft.materias.includes(subject)}
                  onChange={() => toggleSubject(subject)}
                />
                <span>{subject}</span>
              </label>
            ))}
            {!subjects.length && (
              <p className="pub-filter-empty">Todavía no hay materias.</p>
            )}
          </fieldset>
          <fieldset>
            <legend>Precio por clase</legend>
            <div className="pub-price-range">
              <span>Hasta</span>
              <strong>{money(price)}</strong>
            </div>
            <input
              aria-label="Precio máximo por clase"
              className="pub-range"
              type="range"
              min={PRICE_FLOOR}
              max={PRICE_CEILING}
              step="500"
              value={price}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  precioMax: Number(event.target.value),
                })
              }
              onPointerUp={(event) =>
                commitPrice(Number(event.currentTarget.value))
              }
              onKeyUp={(event) =>
                commitPrice(Number(event.currentTarget.value))
              }
            />
            <div className="pub-range-labels">
              <span>{money(PRICE_FLOOR)}</span>
              <span>{money(PRICE_CEILING)}</span>
            </div>
          </fieldset>
          <fieldset>
            <legend>Disponibilidad</legend>
            <label className="pub-check">
              <input
                type="checkbox"
                checked={draft.disponibilidad}
                onChange={(event) =>
                  apply({ ...draft, disponibilidad: event.target.checked })
                }
              />
              <span>Con horarios disponibles</span>
            </label>
          </fieldset>
          <div className="pub-filter-help">
            <Icon name="shield" size={23} />
            <p>
              <strong>Conocé antes de elegir.</strong> En cada perfil podés ver
              formación, experiencia y opiniones.
            </p>
          </div>
        </aside>

        <div className="pub-results" aria-busy={pending}>
          <form className="pub-search" role="search" onSubmit={submitSearch}>
            <Icon name="search" size={21} />
            <input
              type="search"
              enterKeyHint="search"
              aria-label="Buscar materia o docente"
              placeholder="Probá con Álgebra, Física o el nombre de un profe (Enter para buscar)"
              value={draft.q}
              onChange={(event) =>
                setDraft({ ...draft, q: event.target.value })
              }
            />
            {draft.q && (
              <button
                type="button"
                onClick={() => apply({ ...draft, q: "" })}
                aria-label="Borrar búsqueda"
              >
                <Icon name="x" size={17} />
              </button>
            )}
          </form>
          <div className="pub-results-top">
            <p aria-live="polite">
              <strong>{loadFailed ? 0 : teachers.length}</strong>{" "}
              {teachers.length === 1 ? "docente para vos" : "docentes para vos"}
            </p>
            <label>
              Ordenar por{" "}
              <select
                aria-label="Ordenar docentes"
                value={draft.orden}
                onChange={(event) =>
                  apply({
                    ...draft,
                    orden: event.target.value === "precio" ? "precio" : "calificacion",
                  })
                }
              >
                <option value="calificacion">Mejor calificación</option>
                <option value="precio">Menor precio</option>
              </select>
            </label>
          </div>
          {filterCount > 0 && (
            <div className="pub-active-filters">
              {filters.materias.map((subject) => (
                <button
                  type="button"
                  key={subject}
                  onClick={() => toggleSubject(subject)}
                >
                  {subject}
                  <Icon name="x" size={13} />
                </button>
              ))}
              {filters.precioMax != null && (
                <button
                  type="button"
                  onClick={() => apply({ ...draft, precioMax: null })}
                >
                  Hasta {money(filters.precioMax)}
                  <Icon name="x" size={13} />
                </button>
              )}
              {filters.disponibilidad && (
                <button
                  type="button"
                  onClick={() => apply({ ...draft, disponibilidad: false })}
                >
                  Con horarios
                  <Icon name="x" size={13} />
                </button>
              )}
            </div>
          )}
          <div className="pub-teacher-list">
            {teachers.map((teacher) => (
              <TeacherRow teacher={teacher} key={teacher.id} />
            ))}
            {loadFailed ? (
              <div className="pub-empty">
                <EmptyState
                  title="No pudimos cargar los docentes."
                  description="Hubo un problema de nuestro lado. Probá de nuevo en un momento."
                >
                  <ButtonLink href="/docentes" variant="secondary">
                    Reintentar <Icon name="arrow-right" size={17} />
                  </ButtonLink>
                </EmptyState>
              </div>
            ) : (
              !teachers.length && (
                <div className="pub-empty">
                  {hasAnyFilter ? (
                    <EmptyState
                      title="Todavía no encontramos esa combinación."
                      description="Probá con otra materia o ampliá el precio para descubrir más docentes."
                    >
                      <button
                        type="button"
                        className="pub-primary-button"
                        onClick={reset}
                      >
                        Restablecer filtros <Icon name="arrow-right" size={17} />
                      </button>
                    </EmptyState>
                  ) : (
                    <EmptyState
                      title="Estamos sumando a los primeros docentes."
                      description="Todavía no hay perfiles verificados publicados. Volvé pronto."
                    />
                  )}
                </div>
              )
            )}
          </div>
        </div>
      </section>
      <section className="pub-bottom-note pub-container">
        <span className="pub-note-star" aria-hidden="true">
          ✳
        </span>
        <div>
          <h2>Un tema difícil. Una buena compañía.</h2>
          <p>
            No hace falta tener todas las respuestas para dar el primer paso.
          </p>
        </div>
        <ButtonLink href="/como-funciona" variant="secondary">
          Así funciona <Icon name="arrow-right" size={17} />
        </ButtonLink>
      </section>
    </div>
  );
}

function TeacherRow({ teacher }: { teacher: Teacher }) {
  return (
    <article className="pub-teacher-row">
      <Link
        href={`/docentes/${teacher.id}`}
        className="pub-teacher-photo"
        aria-label={`Ver perfil de ${teacher.name}`}
      >
        <Avatar name={teacher.name} src={teacher.photo ?? undefined} size={112} />
        <span className="pub-verified" title="Perfil verificado por EstudiApp">
          <Icon name="check" size={13} />
        </span>
      </Link>
      <div className="pub-teacher-info">
        <p className="pub-teacher-subject">{teacher.subject}</p>
        <Link href={`/docentes/${teacher.id}`}>
          <h2>{teacher.name}</h2>
        </Link>
        {teacher.title && <p className="pub-teacher-title">{teacher.title}</p>}
        <div className="pub-teacher-rating">
          {teacher.rating > 0 ? (
            <>
              <Icon name="star" size={15} />
              <strong>{teacher.rating.toFixed(1)}</strong>
            </>
          ) : (
            <span>Nuevo en EstudiApp</span>
          )}
          {teacher.experience != null && (
            <>
              <i />
              {teacher.experience} años de experiencia
            </>
          )}
          {teacher.hasAvailability && (
            <>
              <i />
              Con horarios disponibles
            </>
          )}
        </div>
        <p className="pub-teacher-bio">{teacher.bio}</p>
        <div className="pub-subject-pills">
          {teacher.subjects.slice(0, 3).map((subject) => (
            <span key={subject}>{subject}</span>
          ))}
        </div>
      </div>
      <div className="pub-teacher-action">
        <div>
          <strong>{money(teacher.price)}</strong>
          <span>por clase · online</span>
        </div>
        <ButtonLink href={`/docentes/${teacher.id}`} variant="secondary">
          Conocer al profe <Icon name="arrow-right" size={16} />
        </ButtonLink>
      </div>
    </article>
  );
}
