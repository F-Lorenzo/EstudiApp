"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { gsap } from "gsap";
import { ButtonLink, Icon, TeacherCard } from "./ui";
import { Mascot } from "./mascot";
import type { Teacher } from "@/lib/tutors/view";

const topicLinks = [
  {
    name: "Matemática",
    detail: "Conectá las ideas",
    drawing: "ƒ(x)",
    rotation: "-6deg",
  },
  {
    name: "Física",
    detail: "Entendé cómo funciona",
    drawing: "↗",
    rotation: "7deg",
  },
  {
    name: "Química",
    detail: "Encontrá la reacción",
    drawing: "H₂O",
    rotation: "-4deg",
  },
  {
    name: "Programación",
    detail: "Construí tu solución",
    drawing: "{ }",
    rotation: "5deg",
  },
];
const faqs = [
  [
    "¿Cómo elijo al profesor indicado?",
    "Podés buscar por materia, conocer la formación y experiencia de cada profesor, leer reseñas y consultar sus horarios. Elegí a quien mejor se adapte a lo que querés aprender y a tu disponibilidad.",
  ],
  [
    "¿Las clases son individuales y online?",
    "Sí. El recorrido está pensado para clases online, uno a uno. Tenés un espacio para preguntar, practicar y trabajar a tu ritmo con el acompañamiento de tu profesor.",
  ],
  [
    "¿Qué significa trayectoria verificada?",
    "Cada docente completa su perfil con su formación y experiencia, y el equipo de EstudiApp lo revisa antes de que aparezca en el catálogo. Después, las opiniones de sus estudiantes suman a su reputación.",
  ],
  [
    "Soy docente. ¿Cómo puedo ser parte?",
    "Creá una cuenta como docente y completá tu perfil profesional con tu formación, tus materias y tu tarifa. El equipo revisa la solicitud y, una vez aprobada, tu perfil queda visible en el catálogo.",
  ],
];

/** `featured`: docentes aprobados para la sección de destacados (puede venir vacío). */
export function Home({ featured }: { featured: Teacher[] }) {
  const heroRef = useRef<HTMLElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const router = useRouter();

  useEffect(() => {
    const media = gsap.matchMedia();
    media.add("(prefers-reduced-motion: no-preference)", () => {
      const ctx = gsap.context(() => {
        gsap.from(".hero-reveal", {
          y: 25,
          opacity: 0,
          duration: 0.8,
          stagger: 0.1,
          ease: "power3.out",
          clearProps: "all",
        });
        gsap.from(".hero-art", {
          y: 28,
          rotation: -3,
          opacity: 0,
          duration: 1.05,
          delay: 0.2,
          ease: "power3.out",
          clearProps: "all",
        });
        gsap.from(".hero-annotation", {
          y: 10,
          opacity: 0,
          duration: 0.65,
          delay: 0.8,
          stagger: 0.12,
          ease: "power3.out",
          clearProps: "all",
        });
      }, pageRef);
      return () => ctx.revert();
    });
    return () => media.revert();
  }, []);

  function search(event: FormEvent) {
    event.preventDefault();
    router.push(
      query.trim()
        ? `/docentes?q=${encodeURIComponent(query.trim())}`
        : "/docentes",
    );
  }

  return (
    <div ref={pageRef} className="home-page">
      <section ref={heroRef} className="home-hero" aria-labelledby="hero-title">
        <div className="hero-grain" aria-hidden="true" />
        <div className="hero-layout">
          <div className="hero-copy">
            <p className="eyebrow hero-reveal">
              <span />
              EXPERIENCIA QUE SE COMPARTE
            </p>
            <h1 id="hero-title" className="hero-reveal">
              Hay una forma
              <br />
              de entenderlo.
              <br />
              <span>
                La tuya.
                <svg viewBox="0 0 275 22" fill="none" aria-hidden="true">
                  <path
                    d="M3 13C67 2 190 1 271 9M29 20C91 9 173 8 223 13"
                    stroke="currentColor"
                    strokeWidth="3"
                    strokeLinecap="round"
                  />
                </svg>
              </span>
            </h1>
            <p className="hero-description hero-reveal">
              Aprendé con profesores que tienen mucho
              <br className="desktop-break" /> para enseñarte. A tu ritmo, con
              experiencia real.
            </p>
            <form
              onSubmit={search}
              className="hero-search hero-reveal"
              role="search"
            >
              <Icon name="search" size={21} />
              <label htmlFor="hero-subject" className="sr-only">
                ¿Qué querés aprender?
              </label>
              <input
                id="hero-subject"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="¿Qué querés aprender?"
                autoComplete="off"
              />
              <button type="submit" aria-label="Buscar profesores">
                <Icon name="arrow-up-right" size={26} />
              </button>
            </form>
            <div className="hero-subjects hero-reveal">
              <span>Podés empezar por</span>
              <Link href="/docentes?q=Matemática">Matemática</Link>
              <Link href="/docentes?q=Física">Física</Link>
              <Link href="/docentes?q=Programación">Programación</Link>
            </div>
          </div>
          <div className="hero-visual">
            <svg
              className="hero-orbit"
              viewBox="0 0 620 620"
              fill="none"
              aria-hidden="true"
            >
              <ellipse
                cx="308"
                cy="327"
                rx="285"
                ry="233"
                transform="rotate(-25 308 327)"
                stroke="#b8c59d"
                strokeWidth="1"
                strokeDasharray="3 6"
              />
              <path
                d="M46 193q-11-24-4-51m0 0-14 14m14-14 10 17"
                stroke="#fffcf2"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
              <path
                d="m512 65 6 20m-23-9 19 6m16-8-12 13"
                stroke="#eb5e28"
                strokeWidth="3"
                strokeLinecap="round"
              />
            </svg>
            <div className="hero-art">
              <div className="hero-art-paper" />
              <Mascot stageRef={heroRef} />
            </div>
            <div className="hero-annotation hero-annotation-top">
              <span className="annotation-star">✳</span>
              <span>
                Todo empieza
                <br />
                con una pregunta.
              </span>
            </div>
            <div className="hero-annotation hero-annotation-bottom">
              <span className="annotation-circle">
                <Icon name="graduation" size={22} />
              </span>
              <div>
                Con alguien que sabe.<small>Y sabe cómo acompañarte.</small>
              </div>
            </div>
            <p className="hero-pointer-hint hero-annotation">
              <svg viewBox="0 0 55 30" aria-hidden="true">
                <path
                  d="M2 9q25 23 48-3m0 0-11 1m11-1-2 11"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.2"
                />
              </svg>
              Mové el lápiz. Te está mirando.
            </p>
          </div>
        </div>
        <div className="hero-bottom">
          <span>
            <Icon name="shield" size={17} />
            Profesores con trayectoria
          </span>
          <span>
            <Icon name="video" size={17} />
            Clases online, uno a uno
          </span>
          <span>
            <Icon name="clock" size={17} />
            Un ritmo que es tuyo
          </span>
          <a href="#descubri" aria-label="Descubrí EstudiApp">
            SEGUÍ EXPLORANDO <span>↓</span>
          </a>
        </div>
      </section>

      <section className="home-topics home-section" id="descubri">
        <div className="section-intro">
          <p className="eyebrow">
            <span />
            UN PUNTO DE PARTIDA
          </p>
          <div>
            <h2>¿Qué querés entender hoy?</h2>
            <Link className="text-arrow" href="/docentes">
              Explorar todas las materias{" "}
              <Icon name="arrow-up-right" size={18} />
            </Link>
          </div>
        </div>
        <div className="topic-grid">
          {topicLinks.map((topic, i) => (
            <Link
              href={`/docentes?q=${encodeURIComponent(topic.name)}`}
              className={`topic-link topic-${i}`}
              key={topic.name}
            >
              <span className="topic-number">0{i + 1}</span>
              <span
                className="topic-drawing"
                style={{ transform: `rotate(${topic.rotation})` }}
              >
                {topic.drawing}
              </span>
              <div>
                <h3>{topic.name}</h3>
                <span>{topic.detail}</span>
              </div>
              <Icon name="arrow-up-right" size={22} />
            </Link>
          ))}
        </div>
      </section>

      <section className="home-teachers home-section">
        <div className="section-intro">
          <p className="eyebrow">
            <span />
            LA EXPERIENCIA HACE LA DIFERENCIA
          </p>
          <div>
            <h2>
              Personas que saben.
              <br />
              <span className="heading-muted">Y saben enseñar.</span>
            </h2>
            <div className="section-aside">
              <p>
                Detrás de cada explicación hay años de recorrido.
                <br />
                Conocé a quienes pueden acompañarte.
              </p>
              <Link className="text-arrow" href="/docentes">
                Encontrá tu profe <Icon name="arrow-up-right" size={18} />
              </Link>
            </div>
          </div>
        </div>
        {featured.length > 0 ? (
          <div className="home-teacher-grid">
            {featured.map((teacher) => (
              <TeacherCard key={teacher.id} teacher={teacher} />
            ))}
          </div>
        ) : (
          <p className="home-data-note">
            Estamos sumando a los primeros docentes verificados. Muy pronto vas
            a conocerlos acá.
          </p>
        )}
      </section>

      <section className="home-belief">
        <div className="home-section belief-inner">
          <div className="belief-symbol" aria-hidden="true">
            <svg viewBox="0 0 280 280" fill="none">
              <path
                d="M70 205C82 127 195 167 199 95C202 42 123 53 101 90M193 59l9 39-37-6"
                stroke="#EB5E28"
                strokeWidth="24"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <circle
                cx="141"
                cy="143"
                r="112"
                stroke="#023618"
                strokeWidth="1.5"
                strokeDasharray="2 8"
              />
              <path
                d="m51 41-7-18m25 10 2-18M35 57l-16-8"
                stroke="#B02E0C"
                strokeWidth="3"
                strokeLinecap="round"
              />
            </svg>
            <span>Entender. Conectar. Avanzar.</span>
          </div>
          <div>
            <p className="eyebrow">
              <span />
              APRENDER TAMBIÉN ES AVANZAR
            </p>
            <h2>
              No todos aprendemos
              <br />
              de la misma manera.
              <br />
              <span className="belief-underlined">Y eso está bien.</span>
            </h2>
            <p>
              A veces, lo único que falta es alguien que lo explique de otra
              forma. Con paciencia, con criterio y con la experiencia de haber
              recorrido ese camino.
            </p>
            <Link href="/como-funciona" className="text-arrow">
              Conocé cómo funciona <Icon name="arrow-up-right" size={20} />
            </Link>
          </div>
        </div>
      </section>

      <section className="home-process home-section">
        <div className="section-intro">
          <p className="eyebrow">
            <span />
            MÁS SIMPLE DE LO QUE PENSÁS
          </p>
          <div>
            <h2>
              Tu próxima clase,
              <br />a tres pasos.
            </h2>
            <p className="process-intro">
              Vos traés las preguntas.
              <br />
              Nosotros te acercamos a quien puede ayudarte.
            </p>
          </div>
        </div>
        <div className="process-steps">
          {[
            {
              number: "01",
              icon: "search",
              title: "Encontrá a tu profe",
              body: "Explorá materias, conocé su trayectoria y elegí a la persona indicada para vos.",
            },
            {
              number: "02",
              icon: "calendar",
              title: "Hacé lugar para aprender",
              body: "Elegí el día y horario que te quede cómodo. Tu clase, en tu agenda.",
            },
            {
              number: "03",
              icon: "message",
              title: "Preguntá. Probá. Entendé.",
              body: "Conectate a tu clase individual y empezá a avanzar, una idea a la vez.",
            },
          ].map((step) => (
            <article key={step.number}>
              <div className="process-step-top">
                <span>{step.number}</span>
                <Icon name={step.icon} size={32} />
              </div>
              <h3>{step.title}</h3>
              <p>{step.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="home-teach home-section">
        <div className="teach-panel">
          <div className="teach-copy">
            <p className="eyebrow">
              <span />
              TU EXPERIENCIA TODAVÍA TIENE MUCHO PARA DAR
            </p>
            <h2>
              Lo que sabés puede
              <br />
              cambiar el camino
              <br />
              de alguien más.
            </h2>
            <p>
              Sumate a una comunidad que reconoce tu trayectoria
              <br className="desktop-break" /> y te da un espacio para seguir
              compartiéndola.
            </p>
            <ButtonLink href="/registro/docente">
              Quiero enseñar <Icon name="arrow-up-right" size={20} />
            </ButtonLink>
          </div>
          <div className="teach-art" aria-hidden="true">
            <span className="teach-orbit" />
            <span className="teach-big-star">✳</span>
            <div className="teach-note">
              <span>UNA BUENA EXPLICACIÓN</span>
              <p>
                puede abrir
                <br />
                muchas puertas.
              </p>
              <svg viewBox="0 0 200 30" fill="none">
                <path
                  d="M7 20Q77 4 190 17"
                  stroke="#EB5E28"
                  strokeWidth="4"
                  strokeLinecap="round"
                />
              </svg>
            </div>
            <span className="teach-signature">
              El conocimiento sigue circulando ↗
            </span>
          </div>
        </div>
      </section>

      <section className="home-faq home-section">
        <div>
          <p className="eyebrow">
            <span />
            PREGUNTAR ESTÁ BIEN
          </p>
          <h2>
            Antes del
            <br />
            primer paso.
          </h2>
          <p>
            Algunas respuestas para
            <br />
            que empieces con confianza.
          </p>
          <span className="faq-doodle" aria-hidden="true">
            ¿?
          </span>
        </div>
        <div className="faq-list">
          {faqs.map(([question, answer], i) => (
            <div
              className={`faq-item ${openFaq === i ? "faq-open" : ""}`}
              key={question}
            >
              <h3>
                <button
                  onClick={() => setOpenFaq(openFaq === i ? null : i)}
                  aria-expanded={openFaq === i}
                  aria-controls={`faq-answer-${i}`}
                >
                  <span>{question}</span>
                  <Icon name={openFaq === i ? "minus" : "plus"} size={19} />
                </button>
              </h3>
              <div
                id={`faq-answer-${i}`}
                className="faq-answer"
                hidden={openFaq !== i}
              >
                <p>{answer}</p>
              </div>
            </div>
          ))}
        </div>
      </section>
      <section className="home-signoff">
        <p>El próximo paso es tuyo.</p>
        <Link href="/docentes">
          Vamos a aprender.
          <Icon name="arrow-up-right" />
        </Link>
        <svg aria-hidden="true" viewBox="0 0 100 100">
          <path
            d="M50 5v90M5 50h90M18 18l64 64M18 82l64-64"
            stroke="currentColor"
            strokeWidth="12"
          />
        </svg>
      </section>
    </div>
  );
}
