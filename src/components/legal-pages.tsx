import Link from "next/link";
import { Badge, Icon } from "./ui";

export type LegalKey = "terminos" | "privacidad" | "cancelacion";

const legalDocuments: Record<
  LegalKey,
  {
    title: string;
    description: string;
    sections: { title: string; text: string }[];
  }
> = {
  terminos: {
    title: "Términos y condiciones",
    description: "Las bases para aprender y enseñar en un espacio compartido.",
    sections: [
      {
        title: "Acerca de EstudiApp",
        text: "EstudiApp propone un espacio para conectar estudiantes universitarios con docentes y organizar clases individuales online. Esta pantalla muestra la estructura prevista para los términos del servicio.",
      },
      {
        title: "Cuentas y perfiles",
        text: "El documento definitivo deberá explicar los requisitos de acceso, la responsabilidad sobre los datos del perfil y las condiciones para publicar una propuesta docente.",
      },
      {
        title: "Clases y reservas",
        text: "Las condiciones de duración, horarios, confirmación y prestación de las clases deberán estar disponibles antes de completar cada reserva.",
      },
      {
        title: "Pagos y comprobantes",
        text: "La versión final detallará los medios de pago habilitados, la moneda, los conceptos incluidos en el precio y la emisión de comprobantes. Todavía no se procesan pagos.",
      },
      {
        title: "Convivencia y uso del espacio",
        text: "El aprendizaje necesita un entorno de respeto. Se deberán definir las reglas de convivencia, el uso aceptable de la plataforma y los canales de ayuda ante un inconveniente.",
      },
      {
        title: "Consultas y actualizaciones",
        text: "Los datos del responsable del servicio, los canales de contacto, la fecha de vigencia y el procedimiento de actualización se incorporarán al documento revisado antes de publicar el producto.",
      },
    ],
  },
  privacidad: {
    title: "Política de privacidad",
    description: "Claridad sobre la información que compartís y cómo se cuida.",
    sections: [
      {
        title: "Información personal",
        text: "El texto final deberá identificar los datos necesarios para crear una cuenta, completar perfiles y coordinar clases, junto con las finalidades de cada tratamiento.",
      },
      {
        title: "Uso de la información",
        text: "Se deberán describir los usos de la información para la operación de la plataforma, las comunicaciones del servicio y las preferencias que puede administrar cada persona.",
      },
      {
        title: "Servicios y proveedores",
        text: "La política deberá identificar las categorías de proveedores que intervienen en el servicio, incluidas las herramientas de pagos y videollamadas, y explicar sus responsabilidades.",
      },
      {
        title: "Conservación y seguridad",
        text: "La implementación final establecerá plazos de conservación, medidas de protección y el procedimiento aplicable cuando una cuenta se cierre.",
      },
      {
        title: "Acceso y control de tus datos",
        text: "Se incorporarán los canales y procedimientos para consultar, actualizar o solicitar la eliminación de información personal, según corresponda.",
      },
      {
        title: "Estado de este documento",
        text: "Este texto es preliminar. Se reemplazará por la versión revisada antes del lanzamiento del producto.",
      },
    ],
  },
  cancelacion: {
    title: "Cambios y cancelaciones",
    description: "Una guía clara cuando los planes cambian.",
    sections: [
      {
        title: "Antes de reservar",
        text: "Cada reserva mostrará fecha, hora, duración y precio para que puedas revisar los datos antes de confirmar. Las reglas definitivas de cambio y cancelación deberán presentarse en ese momento.",
      },
      {
        title: "Reprogramar una clase",
        text: "Se deberá definir el plazo para solicitar un cambio, la disponibilidad de ambas personas y el modo de confirmar el nuevo horario.",
      },
      {
        title: "Cancelar una reserva",
        text: "La política final establecerá los plazos, posibles cargos y situaciones que dan lugar a una devolución. Este texto no fija condiciones comerciales definitivas.",
      },
      {
        title: "Cambios del docente",
        text: "El documento deberá explicar cómo se comunica una cancelación del docente y qué alternativas puede elegir el estudiante.",
      },
      {
        title: "Problemas para conectarse",
        text: "Se definirá cómo solicitar asistencia cuando una dificultad técnica impida la clase, qué información es necesaria y cómo se resuelve cada caso.",
      },
      {
        title: "Devoluciones",
        text: "Los medios, plazos y estado de una devolución deberán informarse de manera clara. Todavía no se realizan cobros ni devoluciones.",
      },
    ],
  },
};

export function LegalPage({ page }: { page: LegalKey }) {
  const document = legalDocuments[page];
  return (
    <div className="pub-legal pub-container">
      <header>
        <p className="pub-eyebrow">LAS COSAS CLARAS</p>
        <h1>{document.title}</h1>
        <p>{document.description}</p>
        <div className="pub-legal-meta">
          <Badge tone="orange">Contenido preliminar</Badge>
          <span>Versión preliminar · septiembre de 2026</span>
        </div>
      </header>
      <div className="pub-legal-layout">
        <aside>
          <span>EN ESTE DOCUMENTO</span>
          <nav aria-label="Índice del documento">
            {document.sections.map((section, index) => (
              <a key={section.title} href={`#legal-${index}`}>
                {String(index + 1).padStart(2, "0")}{" "}
                <span>{section.title}</span>
              </a>
            ))}
          </nav>
          <div className="pub-other-legals">
            {(Object.entries(legalDocuments) as [LegalKey, (typeof legalDocuments)[LegalKey]][])
              .filter(([key]) => key !== page)
              .map(([key, item]) => (
                <Link href={`/${key}`} key={key}>
                  {item.title}
                  <Icon name="arrow-right" size={14} />
                </Link>
              ))}
          </div>
        </aside>
        <article>
          <div className="pub-legal-notice">
            <Icon name="book" size={23} />
            <p>
              Este texto es una plantilla de lectura. El contenido definitivo
              requiere validación legal antes del lanzamiento.
            </p>
          </div>
          {document.sections.map((section, index) => (
            <section key={section.title} id={`legal-${index}`}>
              <span className="pub-legal-number">
                {String(index + 1).padStart(2, "0")}
              </span>
              <h2>{section.title}</h2>
              <p>{section.text}</p>
            </section>
          ))}
          <Link className="pub-back-link" href="/">
            Volver al inicio
            <Icon name="arrow-right" size={17} />
          </Link>
        </article>
      </div>
    </div>
  );
}
