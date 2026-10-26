import { EmailStatus } from "@/components/admin-emails";
import { emailKindLabel, getEmailOutboxSummary, getEmailSetup } from "@/lib/admin/email-status";
import { relativeFromNow } from "@/lib/format";
import { runtimeEnv } from "@/lib/runtime-env";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Emails" };

export default async function EmailsPage() {
  const supabase = await createClient();
  // La bandeja sale de `email_outbox_summary` (migración 0023), que exige administración.
  const { summary } = await getEmailOutboxSummary(supabase);
  const setup = getEmailSetup(runtimeEnv());

  const outbox = summary && {
    sent: summary.last_7_days.enviado,
    pending: summary.last_7_days.pendiente,
    failed: summary.last_7_days.fallido,
    skipped: summary.last_7_days.omitido,
    waiting: summary.waiting,
    oldestWaiting: summary.oldest_waiting_at ? relativeFromNow(summary.oldest_waiting_at) : null,
    lastSent: summary.last_sent_at ? relativeFromNow(summary.last_sent_at) : null,
    problems: summary.problems.map((problem, index) => ({
      key: `${problem.at}-${index}`,
      kind: emailKindLabel(problem.kind),
      status: problem.status,
      error: problem.error ?? "—",
      when: relativeFromNow(problem.at),
    })),
  };

  return <EmailStatus setup={setup} outbox={outbox} />;
}
