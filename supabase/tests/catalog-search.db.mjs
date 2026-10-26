// Migración 0025: búsqueda del catálogo en la base. Se prueba que ignore tildes y mayúsculas, que combine palabras,
// que no interprete comodines, los filtros, los dos órdenes, la paginación (estable, sin repetidos ni huecos) y sus
// límites, «con horarios disponibles» = reservable, y que nadie vea más que los docentes aprobados.
import { makeDb, as, ids, report } from "./harness.mjs";
import { seed, linkPayoutAccount } from "./seed.mjs";

const r = [];
const db = await makeDb();
await seed(db);
const q = (sql, params) => db.query(sql, params);

// --- Docentes del catálogo -----------------------------------------------------------------------------------------
// El seed ya tiene uno aprobado (Matemática, 10.000, cuenta de cobro y un horario libre en 3 días) y uno pendiente.
let n = 0;
async function docente(nombre, { materias, tarifa, rating = 0, cobra = true, horario = null }) {
  n++;
  const id = `d2500000-0000-0000-0000-${String(n).padStart(12, "0")}`;
  await db.exec(`insert into auth.users (id, email, raw_user_meta_data) values ('${id}', 'c${n}@ejemplo.test', '{"full_name":"${nombre}","role":"docente"}')`);
  await db.exec(`update public.tutor_profiles set verification_status = 'aprobado', bio = 'Bio ${n}', tarifa_por_clase = ${tarifa}, rating_promedio = ${rating} where id = '${id}'`);
  await q(`insert into public.tutor_subjects (tutor_id, subject_id) select $1, id from public.subjects where name = any($2)`, [id, materias]);
  if (cobra) await linkPayoutAccount(db, id, `mp-c${n}`);
  if (horario) {
    await db.exec(`insert into public.availability_slots (tutor_id, starts_at, ends_at, is_booked)
      values ('${id}', now() + interval '${horario}', now() + interval '${horario}' + interval '1 hour', false)`);
  }
  return id;
}

const jose = await docente("José Núñez", { materias: ["Física", "Química"], tarifa: 8000, rating: 4.5, horario: "2 days" });
const marina = await docente("Marina Álvarez", { materias: ["Matemática", "Física"], tarifa: 15000, rating: 4.9, cobra: false, horario: "2 days" });
const ana = await docente("Ana Pérez", { materias: ["Inglés"], tarifa: 12000, rating: 4.9, horario: "30 minutes" });
const lucia = await docente("Lucía Gómez", { materias: ["Biología"], tarifa: 20000 });

// 45 de relleno: con 50 en total, una página de 48 no alcanza para todos.
for (let i = 1; i <= 45; i++) await docente(`Profe ${String(i).padStart(2, "0")}`, { materias: ["Lengua y Literatura"], tarifa: 9000, rating: 3 });
const TOTAL = 50;

async function buscar(args = {}, who = "anon") {
  const cols = ["p_q", "p_materias", "p_precio_min", "p_precio_max", "p_disponibilidad", "p_orden", "p_limit", "p_offset"];
  const given = cols.filter((c) => c in args);
  const sql = `select public.search_tutor_catalog(${given.map((c, i) => `${c} => $${i + 1}`).join(", ")}) as j`;
  return as(db, who, async () => (await q(sql, given.map((c) => args[c]))).rows[0].j);
}
/** Todas las páginas de una búsqueda, juntas (de a 48). */
async function buscarTodo(args = {}, who = "anon") {
  const first = await buscar({ ...args, p_limit: 48, p_offset: 0 }, who);
  const rows = [...first.rows];
  while (rows.length < first.total) rows.push(...(await buscar({ ...args, p_limit: 48, p_offset: rows.length }, who)).rows);
  return { total: first.total, rows };
}
const nombres = (res) => res.rows.map((x) => x.full_name).sort();
const idsDe = (res) => res.rows.map((x) => x.id);

// --- Texto: sin tildes ni mayúsculas, palabras en cualquier orden ----------------------------------------------------------
for (const texto of ["fisica", "FÍSICA", "  física  "]) {
  const res = await buscar({ p_q: texto, p_limit: 48 });
  r.push([JSON.stringify(nombres(res)) === JSON.stringify(["José Núñez", "Marina Álvarez"]), `«${texto}» encuentra a los docentes de Física y no al pendiente (${nombres(res)})`]);
}
for (const texto of ["nunez", "núñez", "NUÑEZ", "jose"]) {
  const res = await buscar({ p_q: texto });
  r.push([res.total === 1 && res.rows[0]?.id === jose, `«${texto}» encuentra a José Núñez`]);
}
r.push([(await buscar({ p_q: "perez" })).rows[0]?.id === ana, "«perez» encuentra a Ana Pérez"]);
r.push([(await buscar({ p_q: "fisica marina" })).rows.map((x) => x.id).join() === marina, "«fisica marina»: cada palabra en un campo distinto, en cualquier orden"]);
r.push([(await buscar({ p_q: "marina quimica" })).total === 0, "«marina quimica»: todas las palabras tienen que aparecer"]);
r.push([(await buscar({ p_q: "lengua" })).total === 45, "«lengua» encuentra la materia de varias palabras"]);
for (const comodin of ["%", "_", "%a%", "\\", "*"]) {
  r.push([(await buscar({ p_q: comodin })).total === 0, `«${comodin}» no funciona como comodín`]);
}
// Solo cuentan los primeros 100 caracteres: lo que viene después no filtra.
const largo = `ana${" ".repeat(97)}zzzz`;
r.push([(await buscar({ p_q: largo })).rows[0]?.id === ana, "lo que pasa de los 100 caracteres se ignora"]);
r.push([(await buscar({ p_q: "x".repeat(5000) })).total === 0, "un texto enorme no rompe nada"]);
for (const vacio of [null, "", "   "]) {
  r.push([(await buscar({ p_q: vacio })).total === TOTAL, `sin texto (${JSON.stringify(vacio)}) trae a todos los aprobados (${TOTAL})`]);
}

// --- Paginación ------------------------------------------------------------------------------------------------------------
{
  const p1 = await buscar();
  r.push([p1.total === TOTAL && p1.rows.length === 10, `de a 10 por defecto, con el total (${p1.rows.length} de ${p1.total})`]);
  const vistos = [];
  for (const offset of [0, 10, 20, 30, 40]) vistos.push(...idsDe(await buscar({ p_limit: 10, p_offset: offset })));
  const todos = idsDe(await buscarTodo());
  r.push([new Set(vistos).size === TOTAL && JSON.stringify(vistos) === JSON.stringify(todos), "las cinco páginas juntas son el catálogo entero, en el mismo orden, sin repetidos"]);
  const fuera = await buscar({ p_offset: TOTAL });
  r.push([fuera.total === TOTAL && Array.isArray(fuera.rows) && fuera.rows.length === 0, "una página después del final viene vacía pero con el total"]);
  r.push([(await buscar({ p_limit: 1000 })).rows.length === 48, "más de 48 por página no se puede (pide 1000, recibe 48)"]);
  r.push([(await buscar({ p_limit: 0 })).rows.length === 1, "una página de 0 se vuelve de 1"]);
  r.push([JSON.stringify(idsDe(await buscar({ p_offset: -5 }))) === JSON.stringify(idsDe(p1)), "un salto negativo se vuelve 0"]);
  const ultima = await buscar({ p_limit: 48, p_offset: 48 });
  r.push([ultima.rows.length === 2 && ultima.total === TOTAL, "la última página trae lo que queda"]);
}

// --- Orden -----------------------------------------------------------------------------------------------------------------
{
  const res = await buscarTodo();
  const ok = res.rows.every((x, i, a) => i === 0 || Number(a[i - 1].rating_promedio) > Number(x.rating_promedio)
    || (Number(a[i - 1].rating_promedio) === Number(x.rating_promedio) && a[i - 1].id < x.id));
  r.push([ok, "por calificación: la mejor primero y, a igual calificación, por id"]);
  r.push([res.rows[0].id === marina && res.rows[1].id === ana, "las dos de 4,9 encabezan, desempatadas por id"]);
  const precio = await buscarTodo({ p_orden: "precio" });
  const okPrecio = precio.rows.every((x, i, a) => i === 0 || Number(a[i - 1].tarifa_por_clase) <= Number(x.tarifa_por_clase));
  r.push([okPrecio && precio.rows[0].id === jose && precio.rows.at(-1).id === lucia, "por precio: el más barato primero"]);
  r.push([JSON.stringify(idsDe(await buscarTodo({ p_orden: "cualquiera" }))) === JSON.stringify(idsDe(res)), "un orden desconocido es por calificación"]);
}

// --- Filtros ---------------------------------------------------------------------------------------------------------------
r.push([JSON.stringify(idsDe(await buscar({ p_materias: ["Inglés"] }))) === JSON.stringify([ana]), "materia: solo los que la dan"]);
r.push([JSON.stringify(nombres(await buscar({ p_materias: ["Inglés", "Biología"] }))) === JSON.stringify(["Ana Pérez", "Lucía Gómez"]), "varias materias: los que den al menos una"]);
r.push([(await buscar({ p_materias: [] })).total === TOTAL, "una lista de materias vacía no filtra"]);
r.push([(await buscar({ p_precio_max: 9000 })).total === 46, "hasta 9.000: José (8.000) y los 45 de 9.000"]);
r.push([JSON.stringify(nombres(await buscar({ p_precio_min: 15000 }))) === JSON.stringify(["Lucía Gómez", "Marina Álvarez"]), "desde 15.000"]);
r.push([(await buscar({ p_q: "fisica", p_precio_max: 10000 })).rows.map((x) => x.id).join() === jose, "texto y precio a la vez"]);

// --- «Con horarios disponibles» = se puede reservar -------------------------------------------------------------------------
{
  const res = await buscar({ p_disponibilidad: true, p_limit: 48 });
  r.push([JSON.stringify(idsDe(res).sort()) === JSON.stringify([ids.docente, jose].sort()), `con horarios: solo los que se pueden reservar (${nombres(res)})`]);
  const todos = Object.fromEntries((await buscarTodo()).rows.map((x) => [x.id, x.has_availability]));
  r.push([todos[marina] === false, "sin cuenta de cobro vigente no figura con horarios (no se le puede pagar)"]);
  r.push([todos[ana] === false, "un horario que empieza en menos de una hora no cuenta (create_booking no lo deja reservar)"]);
  r.push([todos[lucia] === false && todos[jose] === true && todos[ids.docente] === true, "sin horarios no; con un horario reservable sí"]);
  // Una cuenta de cobro vencida tampoco.
  await linkPayoutAccount(db, jose, "mp-jose", { expiresIn: "-1 day" });
  r.push([(await buscar({ p_q: "jose" })).rows[0]?.has_availability === false, "con la cuenta de cobro vencida deja de figurar con horarios"]);
  await linkPayoutAccount(db, jose, "mp-jose");
}

// --- Quién ve qué ----------------------------------------------------------------------------------------------------------
for (const who of ["anon", "alumno", "docente", "docente2", "admin", "service"]) {
  const res = await buscarTodo({}, who);
  r.push([res.total === TOTAL && !idsDe(res).includes(ids.docente2), `${who}: los mismos ${TOTAL} aprobados, sin el pendiente`]);
}
{
  const res = await buscar({ p_q: "jose" });
  const claves = Object.keys(res.rows[0]).sort().join();
  r.push([claves === "avatar_url,bio,full_name,has_availability,id,rating_promedio,subject_names,tarifa_por_clase", `cada resultado trae solo los datos públicos (${claves})`]);
}
// Un docente dado de baja o rechazado sale del catálogo.
await db.exec(`update public.tutor_profiles set verification_status = 'rechazado', verification_reason = 'Falta el título' where id = '${lucia}'`);
r.push([(await buscar({ p_q: "lucia" })).total === 0 && (await buscar()).total === TOTAL - 1, "un perfil que deja de estar aprobado sale de la búsqueda y del total"]);

report(r);
