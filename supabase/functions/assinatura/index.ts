// Gestão Barber IA — assinatura no Asaas (chamada pelo app, só pelo gestor).
// Ações: "assinar" (cria cliente + assinatura), "trocar" (muda de plano),
//        "cancelar" (cancela no fim do período pago), "fatura" (link da cobrança em aberto).
// Segredos (Supabase → Edge Functions → Secrets): ASAAS_API_KEY e ASAAS_ENV ("sandbox" ou "production").
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, x-client-info, apikey",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const ENV = (Deno.env.get("ASAAS_ENV") || "sandbox").toLowerCase();
const BASE = Deno.env.get("ASAAS_BASE_URL") || (ENV === "production" ? "https://api.asaas.com/v3" : "https://api-sandbox.asaas.com/v3");

async function asaas(path: string, method = "GET", body?: unknown) {
  const key = Deno.env.get("ASAAS_API_KEY");
  if (!key) throw new Error("O pagamento ainda não foi configurado. Avise o suporte do Gestão Barber IA.");
  const r = await fetch(BASE + path, {
    method,
    headers: { "Content-Type": "application/json", "User-Agent": "gestao-barber-ia", access_token: key },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = data?.errors?.map((e: { description: string }) => e.description).join(" ") || `Erro ${r.status} no Asaas.`;
    throw new Error(msg);
  }
  return data;
}

const today = () => new Date().toISOString().slice(0, 10);
const onlyDigits = (s: string) => String(s || "").replace(/\D/g, "");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ erro: "Use POST." }, 405);
  try {
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
    const jwt = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: u } = await db.auth.getUser(jwt);
    if (!u?.user) return json({ erro: "Entre no app novamente." }, 401);
    const { data: prof } = await db.from("profiles").select("company_id, role, status, name, email, phone").eq("id", u.user.id).maybeSingle();
    if (!prof || prof.role !== "gestor" || prof.status !== "ativo") return json({ erro: "Somente o gestor pode cuidar da assinatura." }, 403);
    const { data: co } = await db.from("companies").select("*").eq("id", prof.company_id).single();

    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "");

    if (action === "fatura") {
      if (!co.asaas_subscription_id) return json({ invoiceUrl: co.invoice_url || null });
      const p = await asaas(`/subscriptions/${co.asaas_subscription_id}/payments?status=PENDING&limit=1`);
      const o = await asaas(`/subscriptions/${co.asaas_subscription_id}/payments?status=OVERDUE&limit=1`);
      const pay = o.data?.[0] || p.data?.[0];
      const url = pay?.invoiceUrl || co.invoice_url || null;
      if (url !== co.invoice_url) await db.from("companies").update({ invoice_url: url }).eq("id", co.id);
      return json({ invoiceUrl: url });
    }

    if (action === "cancelar") {
      if (!co.asaas_subscription_id) return json({ erro: "Não há assinatura para cancelar." }, 400);
      await asaas(`/subscriptions/${co.asaas_subscription_id}`, "DELETE");
      // Continua usando até o fim do período já pago.
      await db.from("companies").update({ sub_status: co.paid_until ? "canceled" : "blocked", asaas_subscription_id: null, invoice_url: null }).eq("id", co.id);
      return json({ ok: true, paidUntil: co.paid_until });
    }

    // assinar / trocar: confere o plano e o limite de barbeiros
    const { data: plan } = await db.from("plans").select("*").eq("id", String(body.plan_id || "")).eq("active", true).maybeSingle();
    if (!plan) return json({ erro: "Escolha um plano válido." }, 400);
    const { count } = await db.from("barbers").select("id", { count: "exact", head: true }).eq("company_id", co.id).eq("active", true);
    if (plan.max_barbers !== null && (count || 0) > plan.max_barbers) {
      return json({ erro: `Você tem ${count} barbeiros ativos e o plano ${plan.name} permite até ${plan.max_barbers}. Desative barbeiros ou escolha um plano maior.` }, 400);
    }
    const value = plan.price_cents / 100;

    if (action === "trocar") {
      if (!co.asaas_subscription_id) return json({ erro: "Assine um plano primeiro." }, 400);
      await asaas(`/subscriptions/${co.asaas_subscription_id}`, "PUT", { value, description: `Gestão Barber IA - plano ${plan.name}`, updatePendingPayments: true });
      await db.from("companies").update({ plan_id: plan.id }).eq("id", co.id);
      return json({ ok: true });
    }

    if (action !== "assinar") return json({ erro: "Ação desconhecida." }, 400);
    const doc = onlyDigits(body.cpf_cnpj);
    if (doc.length !== 11 && doc.length !== 14) return json({ erro: "Digite um CPF (11 números) ou CNPJ (14 números) válido." }, 400);
    if (co.asaas_subscription_id && ["active", "pending", "overdue"].includes(co.sub_status)) {
      return json({ erro: "Esta barbearia já tem uma assinatura. Use Trocar de plano." }, 400);
    }

    let customer = co.asaas_customer_id;
    if (!customer) {
      const c = await asaas("/customers", "POST", {
        name: String(body.name || co.name).slice(0, 100), cpfCnpj: doc, email: co.email || prof.email,
        mobilePhone: onlyDigits(body.phone || co.phone || prof.phone) || undefined, externalReference: co.id,
        notificationDisabled: false,
      });
      customer = c.id;
    } else {
      await asaas(`/customers/${customer}`, "PUT", { cpfCnpj: doc, name: String(body.name || co.name).slice(0, 100) });
    }

    // 1ª cobrança: no teste grátis, vence no último dia do teste; se ainda há período pago
    // (assinou de novo depois de cancelar), vence no fim dele; senão, vence hoje.
    const trialEnd = new Date(co.trial_ends_at).toISOString().slice(0, 10);
    const stillPaid = !!co.paid_until && co.paid_until >= today();
    const due = co.sub_status === "trial" && trialEnd > today() ? trialEnd : stillPaid ? co.paid_until : today();
    const sub = await asaas("/subscriptions", "POST", {
      customer, billingType: "UNDEFINED", value, nextDueDate: due, cycle: "MONTHLY",
      description: `Gestão Barber IA - plano ${plan.name}`, externalReference: co.id,
    });
    const pays = await asaas(`/subscriptions/${sub.id}/payments?limit=1`);
    const invoiceUrl = pays.data?.[0]?.invoiceUrl || null;
    await db.from("companies").update({
      asaas_customer_id: customer, asaas_subscription_id: sub.id, plan_id: plan.id, cpf_cnpj: doc,
      sub_status: stillPaid ? "active" : "pending",
      invoice_url: invoiceUrl,
    }).eq("id", co.id);
    return json({ ok: true, invoiceUrl, dueDate: due });
  } catch (e) {
    return json({ erro: (e as Error).message || "Não foi possível falar com o Asaas." }, 502);
  }
});
