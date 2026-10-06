"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "@/lib/auth/actions";
import { homeFor, type UserRole, type Viewer } from "@/lib/auth/roles";
import { Avatar, Icon, Logo } from "./ui";

type NavItem = [label: string, href: string, icon: string];

const NAV: Record<UserRole, NavItem[]> = {
  alumno: [
    ["Mi espacio", "/alumno", "home"],
    ["Próximas clases", "/alumno/proximas-clases", "calendar"],
    ["Historial", "/alumno/historial", "clock"],
    ["Buscar profesores", "/docentes", "search"],
    ["Mi perfil", "/alumno/perfil", "user"],
  ],
  docente: [
    ["Mi espacio", "/docente", "home"],
    ["Mi disponibilidad", "/docente/disponibilidad", "calendar"],
    ["Perfil profesional", "/docente/perfil", "user"],
  ],
  administrador: [
    ["Solicitudes", "/admin/docentes/pendientes", "users"],
    ["Docentes", "/admin/docentes/activos", "graduation"],
    ["Contenido", "/admin/contenido", "image"],
    ["Métricas", "/admin/metricas", "chart"],
  ],
};

const ROLE_COPY: Record<UserRole, { area: string; label: string }> = {
  alumno: { area: "Espacio de aprendizaje", label: "Estudiante" },
  docente: { area: "Espacio docente", label: "Docente" },
  administrador: { area: "Administración", label: "Equipo de curaduría" },
};

function SignOutIcon() {
  return (
    <form action={signOut}>
      <button type="submit" aria-label="Cerrar sesión" title="Cerrar sesión">
        <Icon name="logout" size={17} />
      </button>
    </form>
  );
}

function PublicHeader({ viewer }: { viewer: Viewer }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  // El menú móvil se cierra al navegar (se ajusta durante el render, sin efecto).
  const [menuPath, setMenuPath] = useState(pathname);
  if (menuPath !== pathname) {
    setMenuPath(pathname);
    setOpen(false);
  }
  return (
    <header className="public-header">
      <div className="header-inner">
        <Logo />
        <nav
          className={`public-nav ${open ? "nav-open" : ""}`}
          aria-label="Navegación principal"
        >
          <Link
            className={pathname.startsWith("/docentes") ? "active" : ""}
            href="/docentes"
          >
            Encontrá tu profe
          </Link>
          <Link
            className={pathname === "/como-funciona" ? "active" : ""}
            href="/como-funciona"
          >
            Cómo funciona
          </Link>
          {viewer?.role !== "docente" && viewer?.role !== "administrador" && (
            <Link href="/registro/docente">
              Quiero enseñar
              <Icon name="arrow-up-right" size={14} />
            </Link>
          )}
        </nav>
        <div className="header-actions">
          {viewer ? (
            <>
              <span className="login-link">Hola, {viewer.name.split(" ")[0]}</span>
              <Link
                href={homeFor(viewer.role)}
                className="button button-small button-forest"
              >
                Mi espacio <Icon name="arrow-up-right" size={17} />
              </Link>
            </>
          ) : (
            <>
              <Link href="/login" className="login-link">
                Ingresar
              </Link>
              <Link
                href="/registro/alumno"
                className="button button-small button-forest"
              >
                Empezar <Icon name="arrow-up-right" size={17} />
              </Link>
            </>
          )}
          <button
            type="button"
            className="icon-button menu-toggle"
            aria-label={open ? "Cerrar menú" : "Abrir menú"}
            aria-expanded={open}
            onClick={() => setOpen(!open)}
          >
            <Icon name={open ? "x" : "menu"} />
          </button>
        </div>
      </div>
    </header>
  );
}

function Footer({ viewer }: { viewer: Viewer }) {
  return (
    <footer className="site-footer">
      <div className="footer-top">
        <div>
          <Logo />
          <p>
            El conocimiento vale más
            <br />
            cuando se comparte.
          </p>
        </div>
        <div>
          <span className="footer-label">APRENDER</span>
          <Link href="/docentes">Encontrá tu profesor</Link>
          <Link href="/como-funciona">Cómo funciona</Link>
          {!viewer && <Link href="/registro/alumno">Crear una cuenta</Link>}
        </div>
        <div>
          <span className="footer-label">COMPARTIR</span>
          <Link href="/registro/docente">Quiero enseñar</Link>
          <Link href="/como-funciona?rol=docente">Ser parte de EstudiApp</Link>
          <Link href={viewer ? homeFor(viewer.role) : "/login"}>Mi espacio</Link>
        </div>
        <div className="footer-note">
          <span className="footer-asterisk">✳</span>
          <p>
            Hay conocimientos que se estudian.
            <br />Y otros que solo los años pueden enseñar.
          </p>
        </div>
      </div>
      <div className="footer-bottom">
        <span>© 2026 EstudiApp. Aprender también es avanzar.</span>
        <div>
          <Link href="/terminos">Términos</Link>
          <Link href="/privacidad">Privacidad</Link>
          <Link href="/cancelacion">Cancelaciones</Link>
        </div>
      </div>
    </footer>
  );
}

/** Cabecera + pie de las páginas públicas y de acceso. */
export function PublicShell({
  viewer,
  children,
}: {
  viewer: Viewer;
  children: ReactNode;
}) {
  return (
    <>
      <a className="skip-link" href="#main">
        Ir al contenido
      </a>
      <PublicHeader viewer={viewer} />
      <main id="main">{children}</main>
      <Footer viewer={viewer} />
    </>
  );
}

/** Barra lateral y cabecera de los espacios de alumno, docente y administración. */
export function AppShell({
  role,
  name,
  pendingCount,
  children,
}: {
  role: UserRole;
  name: string;
  /** Solicitudes docentes por revisar (solo se muestra a administración). */
  pendingCount?: number;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const [navOpen, setNavOpen] = useState(false);
  const [navPath, setNavPath] = useState(pathname);
  if (navPath !== pathname) {
    setNavPath(pathname);
    setNavOpen(false);
  }
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "auto" });
  }, [pathname]);

  // La sala de clase ocupa toda la pantalla, sin barra lateral.
  if (pathname.startsWith("/alumno/sala"))
    return (
      <>
        <a className="skip-link" href="#main">
          Ir al contenido
        </a>
        <main id="main">{children}</main>
      </>
    );

  const copy = ROLE_COPY[role];
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        Ir al contenido
      </a>
      <aside className={`app-sidebar ${navOpen ? "sidebar-open" : ""}`}>
        <Logo />
        <p className="sidebar-label">{copy.area}</p>
        <nav aria-label={copy.area}>
          {NAV[role].map(([label, href, icon]) => {
            const active =
              pathname === href ||
              (href !== "/alumno" &&
                href !== "/docente" &&
                pathname.startsWith(`${href}/`)) ||
              (href.endsWith("/pendientes") &&
                pathname.startsWith("/admin/docentes/") &&
                !pathname.startsWith("/admin/docentes/activos"));
            return (
              <Link
                key={href}
                href={href}
                className={active ? "active" : ""}
                aria-current={active ? "page" : undefined}
              >
                <Icon name={icon} />
                {label}
                {role === "administrador" &&
                  label === "Solicitudes" &&
                  !!pendingCount && (
                    <span className="nav-count">{pendingCount}</span>
                  )}
              </Link>
            );
          })}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-note">
            <Icon name="sparkles" size={24} />
            <p>
              Cada pregunta es
              <br />
              un nuevo comienzo.
            </p>
          </div>
          <Link className="back-home" href="/">
            <Icon name="arrow-left" size={17} />
            Volver al inicio
          </Link>
          <div className="sidebar-profile">
            <Avatar name={name} size={36} />
            <div>
              <strong>{name}</strong>
              <small>{copy.label}</small>
            </div>
            <SignOutIcon />
          </div>
        </div>
      </aside>
      {navOpen && (
        <button
          className="sidebar-scrim"
          onClick={() => setNavOpen(false)}
          aria-label="Cerrar navegación"
        />
      )}
      <div className="app-body">
        <header className="app-topbar">
          <div>
            <button
              className="icon-button menu-toggle"
              onClick={() => setNavOpen(!navOpen)}
              aria-expanded={navOpen}
              aria-label={navOpen ? "Cerrar navegación" : "Abrir navegación"}
            >
              <Icon name={navOpen ? "x" : "menu"} />
            </button>
            <span>Tu próximo paso empieza acá.</span>
          </div>
          <div>
            <Avatar name={name} size={32} />
          </div>
        </header>
        <main className="app-main" id="main">
          {children}
        </main>
        <div className="app-footer">
          EstudiApp <span>Aprender también es avanzar.</span>
        </div>
      </div>
    </div>
  );
}
