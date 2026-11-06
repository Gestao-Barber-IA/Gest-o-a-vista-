// Gestão Barber IA — avisos de pagamento do Asaas (webhook).
// Configure no Asaas: Integrações → Webhooks → URL desta função, com o
// "Token de autenticação" igual ao segredo ASAAS_WEBHOOK_TOKEN do Supabase.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const ok = (body: unknown = { ok: true }) => new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });

// Data + 1 mês (mesmo dia; ajusta para o último dia quando o mês é mais curto).
function plusMonth(d: string) {
  const [y, m, day] = d.split("-").map(Number);
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const t = new Date(Date.UTC(y, m, Math.min(day, last)));
  return t.toISOString().slice(0, 10);
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Use POST.", { status: 405 });
  const expected = Deno.env.get("ASAAS_WEBHOOK_TOKEN");
  if (!expected || req.headers.get("asaas-access-token") !== expected) return new Response("Token inválido.", { status: 401 });

  const ev = await req.json().catch(() => null);
  if (!ev || !ev.event) return ok({ ignorado: "sem evento" });

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const pay = ev.payment || {};
  const subId = pay.subscription || ev.subscription?.id || null;
  const cusId = pay.customer || ev.subscription?.customer || null;

  let q = db.from("companies").select("id, sub_status, paid_until, asaas_subscription_id");
  if (subId) q = q.eq("asaas_subscription_id", subId);
  else if (cusId) q = q.eq("asaas_customer_id", cusId);
  else return ok({ ignorado: "sem assinatura" });
  const { data: co } = await q.maybeSingle();
  if (!co) return ok({ ignorado: "barbearia não encontrada" });
  if (co.sub_status === "courtesy") return ok({ ignorado: "cortesia" });

  const patch: Record<string, unknown> = {};
  switch (ev.event) {
    case "PAYMENT_CONFIRMED":
    case "PAYMENT_RECEIVED": {
      const due = String(pay.dueDate || pay.paymentDate || new Date().toISOString()).slice(0, 10);
      const until = plusMonth(due);
      patch.sub_status = "active";
      patch.paid_until = co.paid_until && co.paid_until > until ? co.paid_until : until;
      patch.invoice_url = null;
      break;
    }
    case "PAYMENT_CREATED":
    case "PAYMENT_UPDATED":
      if (pay.invoiceUrl && pay.status !== "RECEIVED" && pay.status !== "CONFIRMED") patch.invoice_url = pay.invoiceUrl;
      break;
    case "PAYMENT_OVERDUE":
      patch.sub_status = "overdue";
      if (pay.invoiceUrl) patch.invoice_url = pay.invoiceUrl;
      break;
    case "PAYMENT_REFUNDED":
    case "PAYMENT_CHARGEBACK_REQUESTED":
    case "PAYMENT_CHARGEBACK_DISPUTE":
      patch.sub_status = "blocked";
      break;
    case "SUBSCRIPTION_DELETED":
    case "SUBSCRIPTION_INACTIVATED":
      if (co.asaas_subscription_id === subId) {
        patch.sub_status = co.paid_until ? "canceled" : "blocked";
        patch.asaas_subscription_id = null;
      }
      break;
    default:
      return ok({ ignorado: ev.event });
  }
  if (Object.keys(patch).length) await db.from("companies").update(patch).eq("id", co.id);
  return ok();
});
