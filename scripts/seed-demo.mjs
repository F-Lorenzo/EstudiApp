// Datos de MOCK para hacer una demo funcional de EstudiApp.
// Todo lo que crea este script está marcado con el prefijo de email
// "demo@estudiapp.test" para poder identificarlo y borrarlo fácil.
//
// Uso:
//   node scripts/seed-demo.mjs            -> crea los datos de demo
//   node scripts/seed-demo.mjs --cleanup  -> borra todo lo que creó
//
// Requiere en el entorno (no en .env.local, para no commitear la
// service role key por accidente):
//   NEXT_PUBLIC_SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//   SEED_DEMO_CONFIRM   el host del proyecto (por ejemplo abcd1234.supabase.co). Es una
//                       confirmación explícita: este script crea cuentas con datos falsos y
//                       NUNCA debe correr contra producción.
//
// Opcional:
//   SEED_DEMO_PASSWORD  contraseña de las cuentas de demo. Si no se define, se genera una
//                       aleatoria en cada ejecución y se muestra solo en la consola.
//
// Para BORRAR el modo demo completo: alcanza con correr el --cleanup
// de arriba y después borrar este archivo. No toca ninguna migración
// ni tabla, solo filas.

import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error(
    "Faltan NEXT_PUBLIC_SUPABASE_URL y/o SUPABASE_SERVICE_ROLE_KEY en el entorno.",
  );
  process.exit(1);
}

const SUPABASE_HOST = new URL(SUPABASE_URL).host;
if (process.env.SEED_DEMO_CONFIRM !== SUPABASE_HOST) {
  console.error(
    `Este script crea (o borra) cuentas de demo en ${SUPABASE_HOST}.\n` +
      "Si es un proyecto de DESARROLLO, confirmalo repitiendo su host:\n" +
      `  SEED_DEMO_CONFIRM=${SUPABASE_HOST}`,
  );
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// Las cuentas de demo son públicas por definición (el repo lo es): la contraseña no puede estar
// escrita acá. Se genera en cada ejecución, o se toma del entorno.
const DEMO_PASSWORD =
  process.env.SEED_DEMO_PASSWORD || randomBytes(15).toString("base64url");

// --- Definición de los datos de mock -------------------------------------

const DOCENTES = [
  {
    email: "maria.gonzalez.demo@estudiapp.test",
    fullName: "María González",
    bio: "Profesora de Matemática y Física con 8 años de experiencia en secundario y preparación de exámenes de ingreso.",
    nivelAcademico: "Profesora en Matemática (UBA)",
    tarifaPorClase: 2500,
    contactoVerificacion: "+54 9 11 5555-0001",
    materias: ["Matemática", "Física"],
    verificationStatus: "aprobado",
  },
  {
    email: "juan.perez.demo@estudiapp.test",
    fullName: "Juan Pérez",
    bio: "Desarrollador de software y docente de programación e inglés técnico.",
    nivelAcademico: "Ingeniero en Sistemas (UTN)",
    tarifaPorClase: 3000,
    contactoVerificacion: "+54 9 11 5555-0002",
    materias: ["Programación", "Inglés"],
    verificationStatus: "aprobado",
  },
  {
    email: "lucia.fernandez.demo@estudiapp.test",
    fullName: "Lucía Fernández",
    bio: "Profesora de Lengua e Historia, especializada en comprensión de textos.",
    nivelAcademico: "Profesora en Letras (UNLP)",
    tarifaPorClase: 2000,
    contactoVerificacion: "+54 9 11 5555-0003",
    materias: ["Lengua y Literatura", "Historia"],
    verificationStatus: "aprobado",
  },
  {
    email: "pedro.diaz.demo@estudiapp.test",
    fullName: "Pedro Díaz",
    bio: "Estudiante avanzado de Contabilidad, doy clases de apoyo a estudiantes de nivel secundario.",
    nivelAcademico: "Estudiante avanzado de Contador Público (UBA)",
    tarifaPorClase: 1800,
    contactoVerificacion: "+54 9 11 5555-0004",
    materias: ["Contabilidad"],
    verificationStatus: "pendiente", // para poder demostrar el flujo de aprobación
  },
];

const ALUMNOS = [
  { email: "sofia.martinez.demo@estudiapp.test", fullName: "Sofía Martínez" },
  { email: "tomas.rodriguez.demo@estudiapp.test", fullName: "Tomás Rodríguez" },
];

const ADMIN = { email: "admin.demo@estudiapp.test", fullName: "Admin Demo" };

const DEMO_EMAILS = [
  ...DOCENTES.map((d) => d.email),
  ...ALUMNOS.map((a) => a.email),
  ADMIN.email,
];

// --- Helpers ---------------------------------------------------------------

async function findUserIdByEmail(email) {
  const { data, error } = await supabase.auth.admin.listUsers({
    page: 1,
    perPage: 200,
  });
  if (error) throw error;
  return data.users.find((u) => u.email === email)?.id ?? null;
}

async function createDemoUser(email, fullName, role) {
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password: DEMO_PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: fullName, role },
  });
  if (error) throw error;
  return data.user.id;
}

function addHours(date, hours) {
  return new Date(date.getTime() + hours * 60 * 60 * 1000);
}

// --- Cleanup -----------------------------------------------------------

async function cleanup() {
  console.log("Borrando datos de demo...");
  for (const email of DEMO_EMAILS) {
    const id = await findUserIdByEmail(email);
    if (!id) continue;
    // Los ON DELETE CASCADE de profiles/tutor_profiles/bookings/etc.
    // se encargan del resto de las filas relacionadas.
    const { error } = await supabase.auth.admin.deleteUser(id);
    if (error) throw error;
    console.log(`  - borrado ${email}`);
  }
  console.log("Listo.");
}

// --- Seed ----------------------------------------------------------------

async function seed() {
  const { data: subjects, error: subjectsError } = await supabase
    .from("subjects")
    .select("id, name");
  if (subjectsError) throw subjectsError;
  const subjectIdByName = new Map(subjects.map((s) => [s.name, s.id]));

  const tutorIds = {};

  for (const docente of DOCENTES) {
    console.log(`Creando docente ${docente.email}...`);
    const userId = await createDemoUser(docente.email, docente.fullName, "docente");
    tutorIds[docente.email] = userId;

    const { error: tutorError } = await supabase
      .from("tutor_profiles")
      .update({
        bio: docente.bio,
        nivel_academico: docente.nivelAcademico,
        tarifa_por_clase: docente.tarifaPorClase,
        verification_status: docente.verificationStatus,
        rating_promedio: docente.verificationStatus === "aprobado" ? 4.5 : 0,
      })
      .eq("id", userId);
    if (tutorError) throw tutorError;

    // El contacto es un dato privado (migración 0010): va a tutor_private.
    const { error: privateError } = await supabase
      .from("tutor_private")
      .upsert({ id: userId, contacto_verificacion: docente.contactoVerificacion });
    if (privateError) throw privateError;

    const subjectRows = docente.materias
      .map((name) => subjectIdByName.get(name))
      .filter(Boolean)
      .map((subjectId) => ({ tutor_id: userId, subject_id: subjectId }));

    if (subjectRows.length > 0) {
      const { error: subjectsInsertError } = await supabase
        .from("tutor_subjects")
        .insert(subjectRows);
      if (subjectsInsertError) throw subjectsInsertError;
    }
  }

  const studentIds = {};
  for (const alumno of ALUMNOS) {
    console.log(`Creando alumno ${alumno.email}...`);
    studentIds[alumno.email] = await createDemoUser(
      alumno.email,
      alumno.fullName,
      "alumno",
    );
  }

  console.log(`Creando admin ${ADMIN.email}...`);
  const adminId = await createDemoUser(ADMIN.email, ADMIN.fullName, "alumno");
  const { error: adminRoleError } = await supabase
    .from("profiles")
    .update({ role: "administrador" })
    .eq("id", adminId);
  if (adminRoleError) throw adminRoleError;

  // Disponibilidad para los docentes aprobados: un par de franjas
  // futuras libres + una que vamos a usar para una reserva confirmada.
  const mariaId = tutorIds["maria.gonzalez.demo@estudiapp.test"];
  const juanId = tutorIds["juan.perez.demo@estudiapp.test"];
  const luciaId = tutorIds["lucia.fernandez.demo@estudiapp.test"];

  const now = new Date();

  const { data: slots, error: slotsError } = await supabase
    .from("availability_slots")
    .insert([
      { tutor_id: mariaId, starts_at: addHours(now, 24), ends_at: addHours(now, 25) },
      { tutor_id: mariaId, starts_at: addHours(now, 48), ends_at: addHours(now, 49) },
      { tutor_id: juanId, starts_at: addHours(now, 30), ends_at: addHours(now, 31) },
      { tutor_id: luciaId, starts_at: addHours(now, 72), ends_at: addHours(now, 73) },
      // Slot ya pasado, para la reserva "completada" del historial.
      {
        tutor_id: mariaId,
        starts_at: addHours(now, -48),
        ends_at: addHours(now, -47),
        is_booked: true,
      },
      // Slot futuro que vamos a reservar como "confirmada".
      { tutor_id: juanId, starts_at: addHours(now, 50), ends_at: addHours(now, 51), is_booked: true },
    ])
    .select("id, tutor_id, starts_at, ends_at, is_booked");
  if (slotsError) throw slotsError;

  const pastSlot = slots.find((s) => s.tutor_id === mariaId && s.is_booked);
  const upcomingSlot = slots.find((s) => s.tutor_id === juanId && s.is_booked);

  const sofiaId = studentIds["sofia.martinez.demo@estudiapp.test"];
  const tomasId = studentIds["tomas.rodriguez.demo@estudiapp.test"];

  console.log("Creando reservas de ejemplo...");
  const { data: bookings, error: bookingsError } = await supabase
    .from("bookings")
    .insert([
      // Desde la migración 0008 la reserva guarda su propio horario y precio.
      {
        student_id: sofiaId,
        tutor_id: mariaId,
        slot_id: pastSlot.id,
        status: "completada",
        starts_at: pastSlot.starts_at,
        ends_at: pastSlot.ends_at,
        price: 2500,
      },
      {
        student_id: tomasId,
        tutor_id: juanId,
        slot_id: upcomingSlot.id,
        status: "confirmada",
        starts_at: upcomingSlot.starts_at,
        ends_at: upcomingSlot.ends_at,
        price: 3000,
      },
    ])
    .select("id, student_id, tutor_id, status");
  if (bookingsError) throw bookingsError;

  const completedBooking = bookings.find((b) => b.status === "completada");
  const confirmedBooking = bookings.find((b) => b.status === "confirmada");

  console.log("Creando pagos y reseña de ejemplo...");
  // Una reserva confirmada siempre tiene su pago aprobado (así la ven las reglas de cancelación).
  const { error: paymentError } = await supabase.from("payments").insert([
    {
      booking_id: completedBooking.id,
      status: "aprobado",
      amount: 2500,
      commission_amount: 250,
      tutor_amount: 2250,
    },
    {
      booking_id: confirmedBooking.id,
      status: "aprobado",
      amount: 3000,
      commission_amount: 300,
      tutor_amount: 2700,
    },
  ]);
  if (paymentError) throw paymentError;

  const { error: ratingError } = await supabase.from("ratings").insert({
    booking_id: completedBooking.id,
    student_id: completedBooking.student_id,
    tutor_id: completedBooking.tutor_id,
    score: 5,
    comment: "Excelente clase, explica muy claro.",
  });
  if (ratingError) throw ratingError;

  console.log("\nListo. Credenciales de demo (todas usan la misma contraseña):\n");
  console.log(`  Contraseña: ${DEMO_PASSWORD}`);
  console.log("  (generada para esta ejecución: no se guarda en ningún archivo)\n");
  console.log("  Docentes aprobados:");
  for (const d of DOCENTES.filter((d) => d.verificationStatus === "aprobado")) {
    console.log(`    - ${d.email}`);
  }
  console.log("  Docente pendiente de aprobación:");
  console.log(`    - ${DOCENTES.find((d) => d.verificationStatus === "pendiente").email}`);
  console.log("  Alumnos:");
  for (const a of ALUMNOS) console.log(`    - ${a.email}`);
  console.log("  Administrador:");
  console.log(`    - ${ADMIN.email}`);
}

const isCleanup = process.argv.includes("--cleanup");
(isCleanup ? cleanup() : seed()).catch((error) => {
  console.error(error);
  process.exit(1);
});
