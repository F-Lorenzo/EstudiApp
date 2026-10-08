"use client";

import { useState } from "react";
import { ButtonLink, Icon } from "@/components/ui";

type Role = "learner" | "teacher";

const learnerSteps = [
  {
    title: "Encontrá a tu profe.",
    text: "Buscá por materia, conocé su trayectoria y leé opiniones. Elegí a quien mejor conecte con lo que necesitás.",
    label: "PRIMERA CONEXIÓN",
    icon: "search",
    note: "Álgebra, Física, Contabilidad…",
  },
  {
    title: "Hacé lugar para aprender.",
    text: "Elegí un horario disponible y revisá los detalles de tu clase antes de confirmar la reserva.",
    label: "UN MOMENTO PARA VOS",
    icon: "calendar",
    note: "Tu agenda también cuenta.",
  },
  {
    title: "Preguntá. Practicá. Avanzá.",
    text: "Conectate desde tu espacio a una clase individual. Compartí tus dudas, trabajá a tu ritmo y contanos cómo te fue.",
    label: "AHORA SÍ, A ENTENDER",
    icon: "book",
    note: "Ese «ah, ahora sí» está más cerca.",
  },
];

const teacherSteps = [
  {
    title: "Tu experiencia tiene lugar.",
    text: "Creá tu cuenta y contanos sobre tu formación, materias y manera de enseñar. Completá tu presentación profesional.",
    label: "MOSTRÁ TU RECORRIDO",
    icon: "graduation",
    note: "Lo que sabés puede abrir caminos.",
  },
  {
    title: "Organizá tu propuesta.",
    text: "Una vez revisado el perfil, elegí tus horarios y tarifa. Tu agenda reúne la disponibilidad y las clases reservadas.",
    label: "ENSEÑÁ A TU MANERA",
    icon: "calendar",
    note: "Tu tiempo, bien organizado.",
  },
  {
    title: "Acompañá un nuevo paso.",
    text: "Conocé las necesidades de cada estudiante y prepará una clase enfocada en ellas. Encontrá todo en tu espacio docente.",
    label: "HACÉ LA DIFERENCIA",
    icon: "book",
    note: "El conocimiento crece cuando se comparte.",
  },
];

const learnerFaq = [
  [
    "¿Las clases son individuales?",
    "Sí. La experiencia está diseñada para clases online de una persona con un docente, con tiempo para tus dudas y tus objetivos.",
  ],
  [
    "¿Cómo elijo a mi docente?",
    "Podés comparar materias, formación, experiencia, opiniones, precios y disponibilidad. Entrá al perfil para conocer su propuesta antes de reservar.",
  ],
  [
    "¿Qué necesito para una clase?",
    "Una conexión a internet, cámara y micrófono. Te recomendamos tener a mano tu programa, apuntes y los ejercicios que quieras trabajar.",
  ],
  [
    "¿Ya puedo reservar y pagar una clase?",
    "Todavía no. Ya podés crear tu cuenta, explorar el catálogo y conocer los perfiles. La reserva con pago y la sala de clase están en construcción.",
  ],
];

const teacherFaq = [
  [
    "¿Qué necesito para crear mi perfil?",
    "Tu información de contacto, una presentación, tu formación y experiencia, las materias que enseñás y tu tarifa por clase.",
  ],
  [
    "¿Cómo funciona la revisión?",
    "El equipo de EstudiApp revisa cada solicitud. Mientras está en revisión tu perfil no aparece en el catálogo; cuando se aprueba, queda visible. Si hace falta un ajuste, te lo indicamos en tu espacio.",
  ],
  [
    "¿Puedo definir mis horarios?",
    "La gestión de disponibilidad está en construcción. Vas a poder agregar y editar tus bloques horarios y ver las clases reservadas desde tu espacio docente.",
  ],
];

export function HowItWorks({ initialRole = "learner" }: { initialRole?: Role }) {
  const [role, setRole] = useState<Role>(initialRole);
  const steps = role === "learner" ? learnerSteps : teacherSteps;
  const faq = role === "learner" ? learnerFaq : teacherFaq;

  return (
    <div className="pub-how">
      <section className="pub-how-intro pub-container">
        <p className="pub-eyebrow">
          <span /> MENOS VUELTAS, MÁS APRENDIZAJE
        </p>
        <h1>
          De «no me sale»
          <br />a <span className="pub-underlined">«ahora entiendo».</span>
        </h1>
        <div className="pub-how-intro-bottom">
          <p>
            Conectar con la persona indicada
            <br />
            puede cambiar tu manera de aprender.
          </p>
          <div
            className="pub-role-tabs"
            role="tablist"
            aria-label="Cómo funciona según tu rol"
          >
            <button
              id="how-learner"
              role="tab"
              aria-selected={role === "learner"}
              aria-controls="how-steps"
              onClick={() => setRole("learner")}
            >
              Quiero aprender
            </button>
            <button
              id="how-teacher"
              role="tab"
              aria-selected={role === "teacher"}
              aria-controls="how-steps"
              onClick={() => setRole("teacher")}
            >
              Quiero enseñar
            </button>
          </div>
        </div>
      </section>
      <section
        className="pub-steps pub-container"
        id="how-steps"
        role="tabpanel"
        aria-labelledby={role === "learner" ? "how-learner" : "how-teacher"}
      >
        {steps.map((step, index) => (
          <article className="pub-step" key={`${role}-${index}`}>
            <span className="pub-step-number">
              0{index + 1}
              <span aria-hidden="true">.</span>
            </span>
            <div className="pub-step-content">
              <p className="pub-eyebrow">{step.label}</p>
              <h2>{step.title}</h2>
              <p>{step.text}</p>
            </div>
            <div className={`pub-step-sketch pub-sketch-${index}`}>
              <Icon name={step.icon} size={48} />
              <span>{step.note}</span>
            </div>
          </article>
        ))}
      </section>
      <section className="pub-how-cta pub-container">
        <div>
          <span className="pub-note-star" aria-hidden="true">
            ✳
          </span>
          <h2>
            {role === "learner"
              ? "Tu próximo paso empieza con una buena pregunta."
              : "Hay alguien esperando aprender eso que sabés."}
          </h2>
        </div>
        <ButtonLink
          href={role === "learner" ? "/docentes" : "/registro/docente"}
        >
          {role === "learner"
            ? "Encontrar a mi profe"
            : "Crear mi perfil docente"}
          <Icon name="arrow-right" size={18} />
        </ButtonLink>
      </section>
      <section className="pub-faq pub-container">
        <div>
          <p className="pub-eyebrow">POR SI TE QUEDÓ UNA DUDA</p>
          <h2>
            También tenemos{" "}
            <br />
            algunas respuestas.
          </h2>
        </div>
        <div>
          {faq.map(([question, answer]) => (
            <details key={question}>
              <summary>
                {question}
                <Icon name="plus" size={19} />
              </summary>
              <p>{answer}</p>
            </details>
          ))}
        </div>
      </section>
    </div>
  );
}
