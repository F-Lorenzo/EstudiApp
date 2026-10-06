import Link from "next/link";
import {
  Avatar,
  Badge,
  ButtonLink,
  EmptyState,
  Icon,
  PageHeading,
} from "@/components/ui";
import type { ClassItem } from "@/lib/bookings/queries";
import { dayParts, isToday, timeRange } from "@/lib/format";

function formatDay(iso: string) {
  const { weekday, day, monthLong } = dayParts(iso);
  return { weekday: weekday.toUpperCase(), day, month: monthLong.toUpperCase() };
}

/** Fila de una clase próxima. */
export function UpcomingRow({ item }: { item: ClassItem }) {
  const { day, month } = dayParts(item.startsAt);
  const today = isToday(item.startsAt);
  return (
    <article className="stu-class-row">
      <div className="stu-class-date">
        <strong>{day}</strong>
        <span>{month}</span>
      </div>
      <div className="stu-class-person">
        <Avatar
          name={item.tutorName}
          src={item.tutorPhoto ?? undefined}
          size={42}
        />
        <div>
          <h3>Clase individual</h3>
          <p>{item.tutorName}</p>
        </div>
      </div>
      <div className="stu-class-time">
        <strong>{timeRange(item.startsAt, item.endsAt)}</strong>
        <span>Online</span>
      </div>
      <Badge tone={today ? "orange" : "green"}>
        {today ? "Hoy" : "Confirmada"}
      </Badge>
      <Link href={`/alumno/sala/${item.id}`} className="stu-text-link">
        Entrar a la sala
        <Icon name="arrow-right" size={16} />
      </Link>
    </article>
  );
}

/** Fila de una clase del historial. */
export function HistoryRow({ item }: { item: ClassItem }) {
  const { day, month } = dayParts(item.startsAt);
  return (
    <article className="stu-class-row stu-history-row">
      <div className="stu-history-check">
        <Icon name="check" size={22} />
      </div>
      <div className="stu-class-person">
        <div>
          <h3>Clase individual</h3>
          <p>
            {item.tutorName} · {day} {month}
          </p>
        </div>
      </div>
      <Badge tone="muted">Completada</Badge>
      {item.score != null ? (
        <span className="stu-review-score">
          <Icon name="star" size={16} />
          {item.score.toFixed(1)}
        </span>
      ) : (
        <span />
      )}
      <Link href={`/docentes/${item.tutorId}`} className="stu-text-link">
        Reservar otra clase <Icon name="arrow-right" size={16} />
      </Link>
    </article>
  );
}

export function ClassListError() {
  return (
    <EmptyState
      title="No pudimos cargar tus clases."
      description="Hubo un problema de nuestro lado. Actualizá la página en un momento."
    />
  );
}

export function NoUpcoming() {
  return (
    <EmptyState
      title="Todavía no tenés clases reservadas"
      description="Cuando reserves una clase, vas a encontrarla acá con su día y horario."
    >
      <ButtonLink href="/docentes" variant="secondary">
        Explorar profesores <Icon name="arrow-right" size={17} />
      </ButtonLink>
    </EmptyState>
  );
}

export function NoHistory() {
  return (
    <EmptyState
      title="Todavía no completaste ninguna clase"
      description="Las clases que tomes van a quedar registradas acá."
    />
  );
}

export function StudentDashboard({
  firstName,
  upcoming,
  completed,
  loadFailed,
}: {
  firstName: string;
  upcoming: ClassItem[];
  completed: ClassItem[];
  loadFailed: boolean;
}) {
  const next = upcoming[0];
  const stamp = next ? formatDay(next.startsAt) : null;

  return (
    <div className="stu-page">
      <PageHeading
        eyebrow="MI ESPACIO DE APRENDIZAJE"
        title={`Hola, ${firstName}. Seguimos avanzando.`}
        description="Cada pregunta que resolvés te acerca un poco más."
      >
        <ButtonLink href="/docentes" variant="secondary">
          Buscar una clase <Icon name="arrow-right" size={17} />
        </ButtonLink>
      </PageHeading>
      <div className="stu-dashboard-top">
        {next && stamp ? (
          <section className="stu-next-class">
            <div className="stu-next-top">
              <span className="stu-eyebrow">TU PRÓXIMA CLASE</span>
              {isToday(next.startsAt) && (
                <span className="stu-live-label">
                  <i /> Es hoy
                </span>
              )}
            </div>
            <div className="stu-next-body">
              <div>
                <h2>
                  Clase individual
                  <span>Un poco más cerca del «ahora sí».</span>
                </h2>
                <div className="stu-next-person">
                  <Avatar
                    name={next.tutorName}
                    src={next.tutorPhoto ?? undefined}
                    size={40}
                  />
                  <span>
                    con <strong>{next.tutorName}</strong>
                  </span>
                </div>
              </div>
              <div className="stu-date-stamp">
                <span>{stamp.weekday}</span>
                <strong>{stamp.day}</strong>
                <span>{stamp.month}</span>
              </div>
            </div>
            <div className="stu-next-bottom">
              <span>
                <Icon name="clock" size={18} />{" "}
                {timeRange(next.startsAt, next.endsAt)} <b>·</b> Online
              </span>
              <ButtonLink href={`/alumno/sala/${next.id}`}>
                Entrar a la sala <Icon name="arrow-right" size={18} />
              </ButtonLink>
            </div>
          </section>
        ) : (
          <section className="stu-next-class">
            <div className="stu-next-top">
              <span className="stu-eyebrow">TU PRÓXIMA CLASE</span>
            </div>
            <div className="stu-next-body">
              <div>
                <h2>
                  Todavía no tenés una clase reservada
                  <span>Encontrá a tu profe y elegí un horario.</span>
                </h2>
              </div>
            </div>
            <div className="stu-next-bottom">
              <span />
              <ButtonLink href="/docentes">
                Encontrar a mi profe <Icon name="arrow-right" size={18} />
              </ButtonLink>
            </div>
          </section>
        )}
        <aside className="stu-study-note">
          <span className="stu-note-symbol" aria-hidden="true">
            ✳
          </span>
          <span className="stu-eyebrow">ANTES DE ENTRAR</span>
          <h3>
            Traé tus dudas.
            <br />
            Las ordenamos juntos.
          </h3>
          <p>
            Tené a mano tus apuntes, una hoja y esos ejercicios que todavía no
            salen.
          </p>
          <div>
            <Icon name="book" size={18} />
            <span>Tu espacio. Tu ritmo.</span>
          </div>
        </aside>
      </div>
      <section className="stu-class-list">
        <div className="stu-section-title">
          <h2>Próximas clases</h2>
          <Link href="/alumno/proximas-clases" className="stu-text-link">
            Ver todas <Icon name="arrow-right" size={16} />
          </Link>
        </div>
        {loadFailed ? (
          <ClassListError />
        ) : upcoming.length ? (
          upcoming.slice(0, 3).map((item) => (
            <UpcomingRow key={item.id} item={item} />
          ))
        ) : (
          <NoUpcoming />
        )}
      </section>
      {!loadFailed && completed.length > 0 && (
        <section className="stu-class-list">
          <div className="stu-section-title">
            <h2>Tu historial</h2>
            <Link href="/alumno/historial" className="stu-text-link">
              Ver todo <Icon name="arrow-right" size={16} />
            </Link>
          </div>
          {completed.slice(0, 2).map((item) => (
            <HistoryRow key={item.id} item={item} />
          ))}
        </section>
      )}
    </div>
  );
}
