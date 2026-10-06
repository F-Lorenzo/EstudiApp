"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { initials, money } from "@/lib/format";
import type { Teacher } from "@/lib/tutors/view";

const iconPaths: Record<string, string[]> = {
  "arrow-right": ["M4 12h15", "m13 5 7 7-7 7"],
  "arrow-left": ["M20 12H5", "m11 5-7 7 7 7"],
  "arrow-up-right": ["M5 19 19 5", "M5 5h14v14"],
  search: ["m16 16 5 5", "M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z"],
  check: ["m5 12 4 4L19 6"],
  star: [
    "m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3l-5.6 2.9 1.1-6.2L3 9.6l6.2-.9Z",
  ],
  clock: ["M12 7v5l3 2", "M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z"],
  calendar: [
    "M7 2v4M17 2v4M3 10h18",
    "M5 4h14a2 2 0 0 1 2 2v14H3V6a2 2 0 0 1 2-2Z M7 14h2m4 0h2m-8 4h2",
  ],
  book: [
    "M12 6v15",
    "M12 6C9 3 5 3 2 4v15c4-1 7-1 10 2 3-3 6-3 10-2V4c-3-1-7-1-10 2Z",
  ],
  shield: ["m8 12 3 3 5-6", "M12 2 3 6v6c0 5 6 9 9 10 3-1 9-5 9-10V6Z"],
  graduation: ["m2 9 10-5 10 5-10 5Z", "M6 11v6q6 5 12 0v-6m4-2v7"],
  eye: [
    "M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7Z",
    "M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z",
  ],
  "eye-off": ["m3 3 18 18M9 5q8-2 13 7l-3 4M5 7l-3 5q6 10 15 5", "m10 10 4 4"],
  plus: ["M12 4v16", "M4 12h16"],
  minus: ["M4 12h16"],
  x: ["m6 6 12 12", "M18 6 6 18"],
  filter: ["M4 6h16M4 12h16M4 18h16", "M8 3v6m8 0v6M9 15v6"],
  video: ["M15 9 22 5v14l-7-4", "M2 5h13v14H2Z"],
  camera: ["M8 4h8l2 3h4v14H2V7h4Z", "M16 13a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z"],
  "camera-off": ["m2 2 20 20M15 9l7-4v14l-7-4", "M9 5h6v10M15 19H2V5h3"],
  mic: [
    "M8 6a4 4 0 0 1 8 0v6a4 4 0 0 1-8 0Z",
    "M4 10v2a8 8 0 0 0 16 0v-2M12 20v3m-4 0h8",
  ],
  "mic-off": [
    "m2 2 20 20M8 8v4a4 4 0 0 0 7 3M8 4a4 4 0 0 1 8 2v5",
    "M4 10v2a8 8 0 0 0 14 5M12 20v3m-4 0h8",
  ],
  "chevron-left": ["m15 5-7 7 7 7"],
  "chevron-right": ["m9 5 7 7-7 7"],
  "chevron-down": ["m5 9 7 7 7-7"],
  screen: ["M2 3h20v14H2Z", "M8 22h8m-4-5v5"],
  volume: ["m3 9 5 0 5-5v16l-5-5H3Z", "M17 8q5 4 0 8m3-11q7 7 0 14"],
  message: ["M21 3H3v15h5l4 4 4-4h5Z", "M7 8h10M7 12h7"],
  upload: ["M12 16V2m-5 5 5-5 5 5", "M3 14v7h18v-7"],
  menu: ["M4 6h16M4 12h16M4 18h16"],
  heart: [
    "M20.8 4.6a5.5 5.5 0 0 0-7.8 0l-1 1-1-1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z",
  ],
  home: ["m2 10 10-8 10 8", "M5 9v13h5v-8h4v8h5V9"],
  user: ["M16 6a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z", "M3 22v-3a9 9 0 0 1 18 0v3"],
  users: [
    "M15 6a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z M2 22v-3a9 9 0 0 1 18 0v3",
    "M19 3q6 4 0 8m1 4q4 2 3 7",
  ],
  chart: ["M3 3v18h18", "M7 15v2m5-8v8m5-12v12"],
  image: ["M2 3h20v18H2Z", "m2 17 6-7 7 7 3-4 4 4 M17 7h.01"],
  logout: ["M9 4H3v16h6", "M8 12h14m-5-5 5 5-5 5"],
  bell: ["M5 8a7 7 0 0 1 14 0v8l2 3H3l2-3Z", "M9 22h6"],
  sparkles: [
    "m12 2 2.7 7.3L22 12l-7.3 2.7L12 22l-2.7-7.3L2 12l7.3-2.7Z",
    "M20 2v4m-2-2h4",
  ],
  wallet: ["M3 5h18v15H3Z", "M16 10h6v5h-6Zm-12-5V2h14v3"],
  info: ["M12 11v6m0-10h.01", "M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z"],
};

export function Icon({
  name,
  size = 20,
  className = "",
}: {
  name: string;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`icon ${className}`}
      aria-hidden="true"
    >
      {(iconPaths[name] || iconPaths.sparkles).map((d, i) => (
        <path key={i} d={d} className={i % 2 ? "icon-accent" : undefined} />
      ))}
    </svg>
  );
}

export function Badge({
  children,
  tone = "green",
}: {
  children: ReactNode;
  tone?: "green" | "orange" | "muted";
}) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function ButtonLink({
  href,
  children,
  variant = "primary",
  className = "",
}: {
  href: string;
  children: ReactNode;
  variant?: "primary" | "secondary" | "ghost";
  className?: string;
}) {
  return (
    <Link href={href} className={`button button-${variant} ${className}`}>
      {children}
    </Link>
  );
}

export function PageHeading({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow?: string;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header className="page-heading">
      <div>
        {eyebrow && (
          <p className="eyebrow">
            <span />
            {eyebrow}
          </p>
        )}
        <h1>{title}</h1>
        {description && <p className="page-description">{description}</p>}
      </div>
      {children && <div className="page-heading-actions">{children}</div>}
    </header>
  );
}

export function Avatar({
  name,
  src,
  size = 48,
}: {
  name: string;
  src?: string;
  size?: number;
}) {
  const [failed, setFailed] = useState(false);
  return (
    <span
      className="avatar"
      style={{ width: size, height: size, fontSize: size * 0.31 }}
    >
      {src && !failed ? (
        <img
          src={src}
          alt={name}
          width={size}
          height={size}
          loading="lazy"
          onError={() => setFailed(true)}
        />
      ) : (
        <span aria-label={name}>{initials(name)}</span>
      )}
    </span>
  );
}

export function TeacherCard({
  teacher,
  compact = false,
}: {
  teacher: Teacher;
  compact?: boolean;
}) {
  return (
    <article
      className={`teacher-card ${compact ? "teacher-card-compact" : ""}`}
    >
      <div className="teacher-image">
        {teacher.photo ? (
          <img src={teacher.photo} alt={teacher.name} loading="lazy" />
        ) : (
          <span className="teacher-image-fallback" aria-hidden="true">
            {initials(teacher.name)}
          </span>
        )}
        <Badge>{teacher.subject}</Badge>
      </div>
      <div className="teacher-card-body">
        <div className="teacher-meta">
          <span>
            <Icon name="shield" size={15} /> Trayectoria verificada
          </span>
          <span>
            <Icon name="star" size={14} />{" "}
            {teacher.rating > 0 ? teacher.rating.toFixed(1) : "Nuevo"}
          </span>
        </div>
        <h3>
          <Link href={`/docentes/${teacher.id}`}>{teacher.name}</Link>
        </h3>
        <p>{teacher.title ?? teacher.subjects.join(" · ")}</p>
        {teacher.experience != null && (
          <span className="teacher-experience">
            {teacher.experience} años compartiendo conocimiento
          </span>
        )}
        <div className="teacher-card-bottom">
          <span>
            <strong>{money(teacher.price)}</strong>
            <small> / clase</small>
          </span>
          <Link
            href={`/docentes/${teacher.id}`}
            className="circle-link"
            aria-label={`Conocer a ${teacher.name}`}
          >
            <Icon name="arrow-up-right" size={22} />
          </Link>
        </div>
      </div>
    </article>
  );
}

export function EmptyState({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <span className="empty-state-icon">
        <Icon name="book" size={36} />
      </span>
      <h3>{title}</h3>
      <p>{description}</p>
      {children}
    </div>
  );
}

/** Aviso para las pantallas que todavía no están conectadas a datos reales. */
export function SampleBanner({
  title = "Vista de muestra.",
  children,
}: {
  title?: string;
  children: ReactNode;
}) {
  return (
    <div className="sample-banner" role="note">
      <Icon name="info" size={18} />
      <p>
        <strong>{title}</strong> {children}
      </p>
    </div>
  );
}

export function Logo({ light = false }: { light?: boolean }) {
  return (
    <Link
      className={`brand-logo ${light ? "brand-logo-light" : ""}`}
      href="/"
      aria-label="EstudiApp — Inicio"
    >
      <img
        src="/brand/logo-official.png"
        alt="EstudiApp. Aprender también es avanzar."
        width="167"
        height="54"
      />
    </Link>
  );
}
