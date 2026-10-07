import { Avatar, Icon } from "@/components/ui";
import { dayParts, money, timeRange } from "@/lib/format";

/** Pasos de la reserva: elegir horario, pagar, aprender. */
export function ProgressSteps({ step }: { step: "schedule" | "payment" | "done" }) {
  const order = ["schedule", "payment", "done"] as const;
  const current = order.indexOf(step);
  const labels = ["Elegí tu horario", "Confirmá tu clase", "A aprender"];
  return (
    <ol className="stu-steps" aria-label="Pasos de la reserva">
      {labels.map((label, index) => {
        const done = index < current || step === "done";
        const active = index === current && step !== "done";
        return (
          <li
            key={label}
            className={done ? "stu-step-done" : active ? "stu-step-current" : ""}
            aria-current={active ? "step" : undefined}
          >
            <span>{done ? <Icon name="check" size={14} /> : index + 1}</span>{" "}
            {label}
          </li>
        );
      })}
    </ol>
  );
}

/** Resumen lateral de la reserva (docente, horario, modalidad y precio). */
export function BookingSummary({
  tutorName,
  tutorPhoto,
  subject,
  startsAt,
  endsAt,
  price,
}: {
  tutorName: string;
  tutorPhoto: string | null;
  subject: string | null;
  startsAt?: string;
  endsAt?: string;
  price: number | null;
}) {
  return (
    <aside className="stu-summary">
      <span className="stu-eyebrow">TU PRÓXIMO PASO</span>
      <div className="stu-teacher">
        <Avatar name={tutorName} src={tutorPhoto ?? undefined} size={64} />
        <div>
          <h3>{tutorName}</h3>
          {subject && <span>Docente de {subject}</span>}
        </div>
      </div>
      <h2>Clase individual</h2>
      <dl className="stu-summary-details">
        <div>
          <dt>
            <Icon name="calendar" size={17} /> Fecha
          </dt>
          <dd>
            {startsAt
              ? `${dayParts(startsAt).weekday.slice(0, 3)} ${dayParts(startsAt).day} ${dayParts(startsAt).month}`
              : "Por elegir"}
          </dd>
        </div>
        <div>
          <dt>
            <Icon name="clock" size={17} /> Horario
          </dt>
          <dd>{startsAt && endsAt ? timeRange(startsAt, endsAt) : "Por elegir"}</dd>
        </div>
        <div>
          <dt>
            <Icon name="video" size={17} /> Modalidad
          </dt>
          <dd>Online, individual</dd>
        </div>
      </dl>
      <div className="stu-summary-total">
        <span>Total por la clase</span>
        <strong>{price == null ? "—" : money(price)}</strong>
        <small>Pesos argentinos</small>
      </div>
      <p className="stu-summary-note">
        <Icon name="shield" size={18} /> Una hora para preguntar, practicar y
        entender a tu ritmo.
      </p>
    </aside>
  );
}
