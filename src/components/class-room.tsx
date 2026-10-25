"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ClassRating } from "@/components/class-rating";
import { Avatar, ButtonLink, Icon } from "@/components/ui";
import { longDate, timeAR, timeRange } from "@/lib/format";
import type { RoomAccess } from "@/lib/video/room-access";

type Visible = Exclude<RoomAccess, { state: "not_found" }>;

/**
 * Sala de la clase con Daily.co (Daily Prebuilt dentro de un iframe). La sala es privada: el token personal que
 * generó el servidor viaja en la dirección del iframe y solo vale en el horario de la clase. Los controles de
 * cámara, micrófono, pantalla compartida y chat son los de Daily. No se graba.
 */
export function ClassRoom({ access }: { access: Visible }) {
  const { view } = access;
  const home = view.role === "alumno" ? "/alumno" : "/docente";

  return (
    <div className="stu-classroom">
      <div className="stu-room-header">
        <div>
          <span className="stu-eyebrow">TU AULA, DONDE ESTÉS</span>
          <h1>Clase individual</h1>
          <span>
            con {view.otherName} · {longDate(view.startsAt)} · {timeRange(view.startsAt, view.endsAt)}
          </span>
        </div>
        <ButtonLink href={home} variant="ghost" className="stu-room-leave">
          <Icon name="arrow-left" size={16} /> Salir de la sala
        </ButtonLink>
      </div>
      {access.state === "open" ? (
        <>
          <ClassOverBar endsAt={view.endsAt} role={view.role} />
          <iframe
            className="stu-room-frame"
            title={`Videollamada con ${view.otherName}`}
            src={`${access.roomUrl}?t=${encodeURIComponent(access.token)}`}
            allow="camera; microphone; fullscreen; display-capture; autoplay; speaker-selection"
          />
        </>
      ) : (
        <RoomNotice access={access} home={home} />
      )}
    </div>
  );
}

function RoomNotice({ access, home }: { access: Exclude<Visible, { state: "open" }>; home: string }) {
  const router = useRouter();
  const { view } = access;
  const opensAt = access.state === "not_yet" ? access.opensAt : null;
  const [remaining, setRemaining] = useState<number | null>(null);

  // Cuando llega la hora de apertura, se vuelve a pedir la página: el servidor recién ahí genera el token.
  useEffect(() => {
    if (!opensAt) return;
    const target = new Date(opensAt).getTime();
    const tick = () => {
      const left = target - Date.now();
      setRemaining(Math.max(0, left));
      if (left <= 0) router.refresh();
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [opensAt, router]);

  const person = <Avatar name={view.otherName} src={view.otherPhoto ?? undefined} size={64} />;

  if (access.state === "not_yet")
    return (
      <div className="stu-room-ended" role="status">
        {person}
        <h2>La sala se abre a las {timeAR(access.opensAt)}.</h2>
        <p>
          Podés entrar desde 10 minutos antes de la clase.
          {remaining !== null && remaining < 60 * 60_000 && <> Faltan {formatCountdown(remaining)}.</>} La página se
          actualiza sola.
        </p>
        <div>
          <ButtonLink href={home}>Volver a mi espacio</ButtonLink>
        </div>
      </div>
    );

  if (access.state === "ended")
    return (
      <div className="stu-room-ended">
        <span className="stu-room-ended-symbol" aria-hidden="true">
          ✳
        </span>
        <h2>
          Una duda menos.
          <br />
          Un paso más.
        </h2>
        <p>
          La clase con {view.otherName} ya terminó. La sala está cerrada.
          {access.awaitingAttendance &&
            (view.role === "alumno"
              ? " Estamos confirmando la asistencia: si tu docente no se conectó, te devolvemos el 100 % y te avisamos por email."
              : " Estamos confirmando la asistencia a la sala: la clase cuenta como dada si estuviste al menos 10 minutos.")}
        </p>
        <div>
          <ButtonLink href={home}>Volver a mi espacio</ButtonLink>
          {access.rating && (
            <ClassRating
              bookingId={view.bookingId}
              tutorName={view.otherName}
              tutorPhoto={view.otherPhoto}
              score={access.rating.score}
              canRate={access.rating.canRate}
              variant="room"
            />
          )}
        </div>
      </div>
    );

  return (
    <div className="stu-room-ended" role="alert">
      {person}
      <h2>No pudimos abrir la sala.</h2>
      <p>
        {access.state === "unavailable"
          ? "La videollamada todavía no está disponible. Escribinos y lo resolvemos."
          : "Hubo un problema al conectar con la videollamada. Probá de nuevo en unos segundos."}
      </p>
      <div>
        {access.state === "error" && (
          <button type="button" className="stu-button" onClick={() => router.refresh()}>
            Reintentar
          </button>
        )}
        <ButtonLink href={home} variant="secondary">
          Volver a mi espacio
        </ButtonLink>
      </div>
    </div>
  );
}

/**
 * Aviso que aparece sobre la videollamada cuando termina el horario de la clase. La sala sigue abierta unos
 * minutos más; al tocar el botón se sale de la llamada y se pasa a la pantalla de cierre (con la calificación,
 * para el alumno).
 */
function ClassOverBar({ endsAt, role }: { endsAt: string; role: "alumno" | "docente" }) {
  const router = useRouter();
  const [over, setOver] = useState(false);

  useEffect(() => {
    // Si ya terminó, el temporizador corre enseguida. setTimeout acepta hasta unos 24 días: la sala abre como
    // mucho 10 minutos antes de la clase.
    const left = Math.max(0, new Date(endsAt).getTime() - Date.now());
    const timer = setTimeout(() => setOver(true), left);
    return () => clearTimeout(timer);
  }, [endsAt]);

  if (!over) return null;
  return (
    <div className="stu-room-over" role="status">
      <span>
        <Icon name="clock" size={16} /> Terminó el horario de la clase. La sala se cierra en unos minutos.
      </span>
      <button type="button" className="stu-button" onClick={() => router.refresh()}>
        {role === "alumno" ? "Terminar y calificar" : "Terminar la clase"}
      </button>
    </div>
  );
}

function formatCountdown(ms: number) {
  const total = Math.ceil(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return minutes > 0 ? `${minutes} min ${String(seconds).padStart(2, "0")} s` : `${seconds} s`;
}
