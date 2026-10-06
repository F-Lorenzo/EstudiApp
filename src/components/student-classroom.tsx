"use client";

import { useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { Avatar, ButtonLink, Icon, SampleBanner } from "@/components/ui";

/** Sala de clase de muestra: simula controles, chat y calificación. No abre cámara ni micrófono. */
export function Classroom({
  teacherName,
  teacherPhoto,
  studentName,
}: {
  teacherName: string;
  teacherPhoto: string | null;
  studentName: string;
}) {
  const firstName = studentName.split(" ")[0];
  const [mic, setMic] = useState(true);
  const [camera, setCamera] = useState(true);
  const [board, setBoard] = useState(true);
  const [chat, setChat] = useState(false);
  const [ended, setEnded] = useState(false);
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [rated, setRated] = useState(false);
  const [chatMessage, setChatMessage] = useState("");
  const [messages, setMessages] = useState([
    {
      author: "Profe",
      text: `¡Hola, ${firstName}! Hoy vamos a ir paso a paso. ¿Tenés tus apuntes a mano?`,
    },
  ]);
  const dialog = useRef<HTMLDialogElement>(null);

  function finish() {
    setEnded(true);
    dialog.current?.showModal();
  }
  function sendChat(event: FormEvent) {
    event.preventDefault();
    if (!chatMessage.trim()) return;
    setMessages((previous) => [
      ...previous,
      { author: "Vos", text: chatMessage.trim() },
    ]);
    setChatMessage("");
  }

  return (
    <div className="stu-classroom">
      <div className="stu-room-header">
        <div>
          <span className="stu-eyebrow">TU AULA, DONDE ESTÉS</span>
          <h1>Clase individual</h1>
          <span>con {teacherName}</span>
        </div>
        <div className="stu-room-demo">
          <i /> Sala de muestra<span>Sin conexión de audio o video real</span>
        </div>
      </div>
      <SampleBanner>
        La sala de clase todavía no está conectada: los controles, el chat y la
        calificación son una simulación. No se usa tu cámara ni tu micrófono.
      </SampleBanner>
      {ended ? (
        <div className="stu-room-ended">
          <span className="stu-room-ended-symbol">✳</span>
          <h2>
            Una duda menos.
            <br />
            Un paso más.
          </h2>
          <p>La clase de muestra finalizó. Gracias por compartir este espacio.</p>
          <div>
            <ButtonLink href="/alumno">Volver a mis clases</ButtonLink>
            {!rated && (
              <button
                type="button"
                className="stu-button stu-button-outline"
                onClick={() => dialog.current?.showModal()}
              >
                Calificar la clase
              </button>
            )}
          </div>
        </div>
      ) : (
        <>
          <div className={`stu-room-content ${chat ? "stu-with-chat" : ""}`}>
            <div className="stu-stage">
              {board ? (
                <div className="stu-whiteboard">
                  <div className="stu-board-label">
                    <span>01 / VAMOS PASO A PASO</span>
                    <span>Apuntes de clase</span>
                  </div>
                  <h2>
                    Entender el camino,
                    <br />
                    no solo el resultado.
                  </h2>
                  <div className="stu-equation">
                    ∫ x² dx <span>=</span>{" "}
                    <span className="stu-fraction">
                      <b>x³</b>
                      <b>3</b>
                    </span>{" "}
                    + C
                  </div>
                  <div className="stu-board-annotation">
                    <span>↳</span> Integramos, sumamos una potencia
                    <br />y dividimos por el nuevo exponente.
                  </div>
                  <div className="stu-board-footer">
                    <span>Probemos juntos con el siguiente ejercicio.</span>
                    <span aria-hidden="true">✳</span>
                  </div>
                </div>
              ) : (
                <div className="stu-teacher-video">
                  <Avatar
                    name={teacherName}
                    src={teacherPhoto ?? undefined}
                    size={160}
                  />
                  <h2>{teacherName}</h2>
                  <p>Vista de cámara de muestra</p>
                </div>
              )}
              <div className="stu-participant-label">
                <Icon name="mic" size={14} /> {teacherName} <span>Docente</span>
              </div>
              <div className="stu-self-video">
                <Avatar name={studentName} size={48} />
                <span>
                  {camera
                    ? "Tu cámara · Vista de muestra"
                    : "Cámara desactivada"}
                </span>
                <small>
                  {mic ? "Micrófono activado" : "Micrófono silenciado"}
                </small>
              </div>
            </div>
            {chat && (
              <aside className="stu-chat">
                <div className="stu-chat-heading">
                  <h2>Conversación</h2>
                  <button
                    type="button"
                    className="stu-icon-button"
                    aria-label="Cerrar conversación"
                    onClick={() => setChat(false)}
                  >
                    <Icon name="x" size={18} />
                  </button>
                </div>
                <p>Los mensajes de esta sala son de muestra.</p>
                <div className="stu-messages" aria-live="polite">
                  {messages.map((message, index) => (
                    <div
                      className={
                        message.author === "Vos" ? "stu-own-message" : ""
                      }
                      key={index}
                    >
                      <strong>{message.author}</strong>
                      <p>{message.text}</p>
                    </div>
                  ))}
                </div>
                <form onSubmit={sendChat}>
                  <label className="stu-visually-hidden" htmlFor="stu-message">
                    Escribí un mensaje
                  </label>
                  <input
                    id="stu-message"
                    value={chatMessage}
                    maxLength={500}
                    onChange={(event) => setChatMessage(event.target.value)}
                    placeholder="Escribí un mensaje…"
                  />
                  <button
                    aria-label="Enviar mensaje"
                    disabled={!chatMessage.trim()}
                  >
                    <Icon name="arrow-right" size={18} />
                  </button>
                </form>
              </aside>
            )}
          </div>
          <div className="stu-room-controls">
            <span className="stu-room-time">
              <Icon name="clock" size={17} /> 00:00{" "}
              <small>Clase de muestra</small>
            </span>
            <div className="stu-controls-main">
              <button
                type="button"
                className={!mic ? "is-off" : ""}
                onClick={() => setMic(!mic)}
                aria-pressed={mic}
                aria-label={mic ? "Silenciar micrófono" : "Activar micrófono"}
              >
                <Icon name={mic ? "mic" : "mic-off"} size={21} />
                <span>{mic ? "Micrófono" : "Silenciado"}</span>
              </button>
              <button
                type="button"
                className={!camera ? "is-off" : ""}
                onClick={() => setCamera(!camera)}
                aria-pressed={camera}
                aria-label={camera ? "Desactivar cámara" : "Activar cámara"}
              >
                <Icon name={camera ? "video" : "camera-off"} size={21} />
                <span>{camera ? "Cámara" : "Sin cámara"}</span>
              </button>
              <button
                type="button"
                onClick={() => setBoard(!board)}
                aria-pressed={board}
              >
                <Icon name="screen" size={21} />
                <span>{board ? "Ver docente" : "Ver pizarra"}</span>
              </button>
              <button
                type="button"
                onClick={() => setChat(!chat)}
                aria-pressed={chat}
              >
                <Icon name="message" size={21} />
                <span>Chat</span>
              </button>
              <button type="button" className="stu-end-call" onClick={finish}>
                <Icon name="x" size={21} />
                <span>Finalizar</span>
              </button>
            </div>
            <span className="stu-room-secure">
              <Icon name="shield" size={16} /> Espacio individual
            </span>
          </div>
        </>
      )}
      <dialog
        ref={dialog}
        className="stu-rating-modal"
        aria-labelledby="stu-rating-title"
      >
        <button
          type="button"
          className="stu-modal-close stu-icon-button"
          aria-label="Cerrar calificación"
          onClick={() => dialog.current?.close()}
        >
          <Icon name="x" size={20} />
        </button>
        {rated ? (
          <div className="stu-rating-thanks">
            <div className="stu-result-mark">
              <Icon name="check" size={32} />
            </div>
            <h2 id="stu-rating-title">Tu experiencia cuenta.</h2>
            <p>
              Es una vista de muestra: tu valoración no se guardó. Gracias por
              ayudar a que aprender sea cada vez mejor.
            </p>
            <ButtonLink href="/alumno">
              Volver a mis clases <Icon name="arrow-right" size={17} />
            </ButtonLink>
          </div>
        ) : (
          <>
            <Avatar
              name={teacherName}
              src={teacherPhoto ?? undefined}
              size={64}
            />
            <span className="stu-eyebrow">UN MOMENTO ANTES DE IRTE</span>
            <h2 id="stu-rating-title">¿Cómo estuvo tu clase?</h2>
            <p>Contanos cómo fue aprender con {teacherName.split(" ")[0]}.</p>
            <div
              className="stu-rating-stars"
              role="group"
              aria-label="Calificación de la clase"
            >
              {[1, 2, 3, 4, 5].map((value) => (
                <button
                  type="button"
                  autoFocus={value === 1}
                  key={value}
                  aria-label={`${value} ${value === 1 ? "estrella" : "estrellas"}`}
                  aria-pressed={rating === value}
                  className={value <= rating ? "is-selected" : ""}
                  onClick={() => setRating(value)}
                >
                  <Icon name="star" size={35} />
                </button>
              ))}
            </div>
            <span className="stu-rating-description" aria-live="polite">
              {
                [
                  "Elegí una puntuación",
                  "Necesita mejorar",
                  "Podría haber sido mejor",
                  "Una buena experiencia",
                  "Muy buena clase",
                  "¡Una gran experiencia!",
                ][rating]
              }
            </span>
            <label className="stu-field">
              <span>
                Tu comentario <small>Opcional</small>
              </span>
              <textarea
                rows={3}
                maxLength={500}
                placeholder="¿Qué te ayudó a entender mejor?"
                value={comment}
                onChange={(event) => setComment(event.target.value)}
              />
            </label>
            <button
              type="button"
              className="stu-button stu-wide-button"
              disabled={!rating}
              onClick={() => setRated(true)}
            >
              Enviar valoración <Icon name="arrow-right" size={18} />
            </button>
            <Link href="/alumno" className="stu-rating-skip">
              Ahora no, volver a mis clases
            </Link>
          </>
        )}
      </dialog>
    </div>
  );
}
