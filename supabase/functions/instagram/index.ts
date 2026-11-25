// Gestão Barber IA — webhook do Instagram (Direct). Pública: a Meta chama com ?empresa=<id da empresa>.
// GET: verificação do webhook (hub.verify_token = o token de verificação mostrado no app).
// POST: mensagens novas. Confere a assinatura (X-Hub-Signature-256) com a chave secreta do app da Meta e põe na fila
// (ig_mensagens); o servidor pega pela sync-servidor e a atendente IA responde.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const txt = (t: string, status = 200) => new Response(t, { status, headers: { "Content-Type": "text/plain" } });
async function hmacHex(chave: string, corpo: string) {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(chave), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(corpo));
  return [...new Uint8Array(s)].map((x) => x.toString(16).padStart(2, "0")).join("");
}
function igual(a: string, b: string) {
  if (!a || a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

Deno.serve(async (req) => {
  const url = new URL(req.url), empresa = String(url.searchParams.get("empresa") || "");
  if (!/^[0-9a-f-]{36}$/i.test(empresa)) return txt("empresa inválida", 400);
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const { data: i } = await db.from("integrations").select("ig_on, ig_user_id, ig_app_secret, ig_verify").eq("company_id", empresa).maybeSingle();
  if (!i) return txt("não encontrado", 404);

  if (req.method === "GET") {
    const modo = url.searchParams.get("hub.mode"), tok = String(url.searchParams.get("hub.verify_token") || ""), desafio = url.searchParams.get("hub.challenge") || "";
    if (modo === "subscribe" && i.ig_verify && igual(tok, i.ig_verify)) {
      await db.from("integrations").update({ ig_status: "ok: webhook verificado pela Meta", ig_status_at: new Date().toISOString() }).eq("company_id", empresa);
      return txt(desafio);
    }
    return txt("token de verificação errado", 403);
  }
  if (req.method !== "POST") return txt("use POST", 405);

  const corpo = await req.text();
  const assin = String(req.headers.get("x-hub-signature-256") || "").replace(/^sha256=/, "");
  if (!i.ig_app_secret || !igual(assin, await hmacHex(i.ig_app_secret, corpo))) return txt("assinatura inválida", 401);
  if (!i.ig_on) return txt("ok"); // desligado: a Meta não precisa reenviar
  let b: any; try { b = JSON.parse(corpo); } catch { return txt("ok"); }
  const linhas: any[] = [];
  for (const e of Array.isArray(b?.entry) ? b.entry : []) {
    for (const m of Array.isArray(e?.messaging) ? e.messaging : []) {
      const msg = m && m.message; if (!msg || msg.is_deleted || msg.is_unsupported) continue;
      const eco = !!msg.is_echo, sid = String(eco ? m.recipient?.id : m.sender?.id || "");
      if (!sid || sid === String(i.ig_user_id)) continue;
      const anexo = Array.isArray(msg.attachments) && msg.attachments.length ? `[mandou ${msg.attachments[0].type === "audio" ? "um áudio" : msg.attachments[0].type === "image" ? "uma imagem" : "um anexo"}]` : "";
      const texto = String(msg.text || anexo || "").slice(0, 2000); if (!texto) continue;
      linhas.push({ company_id: empresa, sid: sid.slice(0, 64), tipo: eco ? "eco" : "msg", texto, mid: String(msg.mid || "").slice(0, 200) });
    }
  }
  if (linhas.length) await db.from("ig_mensagens").insert(linhas.slice(0, 50));
  return txt("ok");
});
