// Gestão Barber IA — totem de autoatendimento (tablet na recepção). Pública (sem login): o tablet manda
// { empresa, token, acao, dados }. O token é o código do link gerado no app (Integração › Totem); aqui só existe o hash.
// A AppBarber só aceita o IP fixo do servidor: o pedido entra na fila (totem_pedidos), o servidor pega pela função
// sync-servidor, responde, e esta função devolve a resposta ao tablet (espera até ~22 s).
// Ações: info (aqui mesmo) · buscar { fone } · chegou { fone, codigos } · servicos · horarios { data, servico }
//        · agendar { fone, nome, servicos, profissional, data, hora }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "content-type, apikey, authorization, x-client-info", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const dorme = (ms: number) => new Promise((r) => setTimeout(r, ms));
const so = (t: unknown) => String(t ?? "").replace(/\D/g, "");
async function sha256(t: string) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
}
function igual(a: string, b: string) {
  if (!a || a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
const hojeSP = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
const somaDias = (iso: string, n: number) => { const d = new Date(iso + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

// Só deixa passar dados no formato esperado (nada de texto livre além do nome).
function limpar(acao: string, d: any, dias: number) {
  d = d && typeof d === "object" ? d : {};
  const fone = so(d.fone).replace(/^55(?=\d{10,11}$)/, "");
  const foneOk = fone.length >= 10 && fone.length <= 11;
  const hoje = hojeSP(), ate = somaDias(hoje, Math.max(1, dias) - 1);
  const dataOk = (x: unknown) => typeof x === "string" && /^\d{4}-\d{2}-\d{2}$/.test(x) && x >= hoje && x <= ate;
  const int = (x: unknown) => Number.isInteger(Number(x)) && Number(x) > 0 && Number(x) < 1e9;
  switch (acao) {
    case "buscar": return foneOk ? { fone } : null;
    case "chegou": return foneOk && Array.isArray(d.codigos) && d.codigos.length >= 1 && d.codigos.length <= 6 && d.codigos.every(int) ? { fone, codigos: d.codigos.map(Number) } : null;
    case "servicos": return {};
    case "horarios": return dataOk(d.data) && int(d.servico) ? { data: d.data, servico: Number(d.servico) } : null;
    case "agendar": {
      const nome = String(d.nome || "").replace(/[^\p{L}\p{M}' .-]/gu, "").replace(/\s+/g, " ").trim().slice(0, 60);
      if (!foneOk || !dataOk(d.data) || !/^\d{2}:\d{2}$/.test(String(d.hora)) || !int(d.profissional) || !Array.isArray(d.servicos) || !d.servicos.length || d.servicos.length > 6 || !d.servicos.every(int)) return null;
      // Ofertas aceitas no final (upsell): só o texto, para a observação do agendamento.
      const adicionais = (Array.isArray(d.adicionais) ? d.adicionais : []).slice(0, 4).map((x: unknown) => String(x ?? "").replace(/[<>]/g, "").slice(0, 90)).filter(Boolean);
      return { fone, nome, data: d.data, hora: d.hora, profissional: Number(d.profissional), servicos: d.servicos.map(Number), adicionais };
    }
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ erro: "Use POST." }, 405);
  let b: any; try { b = await req.json(); } catch { return json({ erro: "Pedido inválido." }, 400); }
  const empresa = String(b?.empresa || ""), token = String(b?.token || ""), acao = String(b?.acao || "");
  if (!/^[0-9a-f-]{36}$/i.test(empresa) || token.length < 20 || token.length > 100) return json({ erro: "Link do totem inválido." }, 401);

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const { data: i } = await db.from("integrations").select("company_id, tt_on, tt_token_hash, tt_days, tt_seen_at, est_code, api_key").eq("company_id", empresa).maybeSingle();
  if (!i || !i.tt_token_hash || !igual(await sha256(token), i.tt_token_hash)) return json({ erro: "Link do totem inválido. Gere um novo no app (Integração › Totem)." }, 401);
  const { data: co } = await db.from("companies").select("name, logo, settings, sub_status, paid_until").eq("id", empresa).maybeSingle();
  const paidUntil = co?.paid_until ? new Date(co.paid_until + "T23:59:59Z").getTime() + 86400000 : 0;
  const ativo = !!(i.tt_on && i.est_code && i.api_key && co && ["active", "courtesy", "canceled"].includes(co.sub_status) && paidUntil >= Date.now());
  const online = !!(i.tt_seen_at && Date.now() - new Date(i.tt_seen_at).getTime() < 90000);
  const dias = Math.max(1, Math.min(30, Number(i.tt_days) || 7));

  if (acao === "info") {
    const o = co?.settings?.ocup || {};
    return json({ ok: true, nome: co?.name || "", logo: co?.logo || "", marca: co?.settings?.brand || "barber", ativo, online, dias, hoje: hojeSP(),
      abertura: typeof o.open === "string" ? o.open : "09:00", fechamento: typeof o.close === "string" ? o.close : "20:00", fechados: Array.isArray(o.closed) ? o.closed.map(Number) : [] });
  }
  if (!ativo) return json({ erro: "O totem está desligado. Fale com a recepção, por favor." }, 403);
  if (!online) return json({ erro: "O totem está sem conexão com a agenda agora. Fale com a recepção, por favor." }, 503);
  const dados = limpar(acao, b.dados, dias);
  if (!dados) return json({ erro: "Pedido inválido." }, 400);

  // Limite: no máximo 40 pedidos por minuto por barbearia (protege os créditos da AppBarber).
  const { count } = await db.from("totem_pedidos").select("id", { count: "exact", head: true }).eq("company_id", empresa).gte("criado_em", new Date(Date.now() - 60000).toISOString());
  if ((count || 0) >= 40) return json({ erro: "Muitos pedidos seguidos. Aguarde um minuto, por favor." }, 429);

  const { data: p, error } = await db.from("totem_pedidos").insert({ company_id: empresa, acao, dados }).select("id").single();
  if (error || !p) return json({ erro: "Não consegui registrar o pedido. Tente de novo." }, 500);
  const fim = Date.now() + 22000;
  while (Date.now() < fim) {
    await dorme(400);
    const { data: r } = await db.from("totem_pedidos").select("status, resposta").eq("id", p.id).maybeSingle();
    if (r && (r.status === "feito" || r.status === "erro")) {
      await db.from("totem_pedidos").delete().eq("id", p.id); // apaga na hora: tinha o celular do cliente
      return r.status === "feito" ? json({ ok: true, ...(r.resposta || {}) }) : json({ erro: (r.resposta && r.resposta.erro) || "Não consegui concluir. Fale com a recepção, por favor." }, 422);
    }
  }
  await db.from("totem_pedidos").update({ status: "expirado" }).eq("id", p.id).eq("status", "novo");
  return json({ erro: "A agenda está demorando para responder. Tente de novo ou fale com a recepção." }, 504);
});
