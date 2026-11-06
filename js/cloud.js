/* Gestão Barber IA — ligação com o Supabase (login, e-mail e dados na nuvem).
   Sem js/config.js preenchido, o app continua no modo de demonstração local. */
(function () {
  'use strict';
  const CFG = window.GB_CONFIG || {};
  const GB = window.GB;
  const enabled = !!(CFG.supabaseUrl && CFG.supabaseAnonKey && window.supabase && window.supabase.createClient);
  const Cloud = { enabled, user: null, profile: null, companyId: null, recovery: false, last: null, onRemote: null, onError: null, onAuth: null };
  GB.Cloud = Cloud;
  if (!enabled) return;

  const c = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'implicit' },
  });
  Cloud.client = c;
  Cloud.base = () => location.origin + location.pathname;
  Cloud.apiUrl = CFG.supabaseUrl.replace(/\/$/, '') + '/functions/v1/lancamentos';

  // ---------- mensagens de erro em português ----------
  Cloud.message = function (err, ctx) {
    const m = String((err && (err.message || err.error_description || err)) || '');
    if (/Invalid login credentials/i.test(m)) return 'E-mail ou senha incorretos.';
    if (/Email not confirmed/i.test(m)) return 'Confirme seu e-mail antes de entrar. Procure a mensagem do Gestão Barber IA na caixa de entrada (e no spam).';
    if (/already registered|already been registered/i.test(m)) return 'Este e-mail já tem conta. Use Entrar ou "Esqueci minha senha".';
    if (/Password should be at least/i.test(m)) return 'A senha precisa ter pelo menos 6 caracteres.';
    if (/Database error saving new user/i.test(m)) return ctx === 'invite' ? 'Este convite é inválido ou já foi usado. Peça um novo ao gestor.' : 'Não foi possível criar a conta. Tente de novo.';
    if (/only request this after|rate limit|too many/i.test(m)) return 'Muitas tentativas seguidas. Aguarde um minuto e tente de novo.';
    if (/provider is not enabled|Unsupported provider/i.test(m)) return 'Este tipo de login ainda não foi ativado. O gestor pode ativá-lo no painel do Supabase. Por enquanto, entre com e-mail e senha.';
    if (/expired|invalid.*token|otp/i.test(m)) return 'O link expirou ou já foi usado. Peça um novo.';
    if (/Failed to fetch|NetworkError|network/i.test(m)) return 'Sem conexão com a internet. Confira a rede e tente de novo.';
    if (/Limite do plano/i.test(m)) return m.replace(/^.*?(Limite do plano)/, '$1');
    if (/só podem ser alterados pelo pagamento|disponível nos planos pagos|Acesso restrito/i.test(m)) return m;
    if (/row-level security|permission denied/i.test(m)) return 'Você não tem permissão para fazer isso. Se a assinatura venceu, atualize a página.';
    return m || 'Algo deu errado. Tente de novo.';
  };

  // ---------- login e conta ----------
  Cloud.init = () => new Promise(resolve => {
    let ready = false;
    c.auth.onAuthStateChange((event, session) => {
      Cloud.user = session ? session.user : null;
      if (event === 'PASSWORD_RECOVERY') Cloud.recovery = true;
      if (!ready && event === 'INITIAL_SESSION') { ready = true; resolve(); return; }
      if (ready && Cloud.onAuth) Cloud.onAuth(event, session);
    });
    setTimeout(() => { if (!ready) { ready = true; resolve(); } }, 6000);
  });
  Cloud.signIn = (email, password) => c.auth.signInWithPassword({ email, password });
  Cloud.signUp = (email, password, data) => c.auth.signUp({ email, password, options: { data, emailRedirectTo: Cloud.base() } });
  Cloud.reset = email => c.auth.resetPasswordForEmail(email, { redirectTo: Cloud.base() + '?redefinir=1' });
  Cloud.updatePassword = password => c.auth.updateUser({ password });
  Cloud.updateEmail = email => c.auth.updateUser({ email }, { emailRedirectTo: Cloud.base() });
  // Confere se o login social está ativo no Supabase antes de sair do app.
  Cloud.oauth = async provider => {
    try {
      const r = await fetch(CFG.supabaseUrl.replace(/\/$/, '') + '/auth/v1/settings', { headers: { apikey: CFG.supabaseAnonKey } });
      const st = await r.json();
      if (st.external && st.external[provider] === false) return { error: { message: 'provider is not enabled' } };
    } catch (e) { /* segue e deixa o Supabase responder */ }
    return c.auth.signInWithOAuth({ provider, options: { redirectTo: Cloud.base() } });
  };
  Cloud.signOut = async () => { Cloud.unsubscribe(); Cloud.last = null; Cloud.profile = null; await c.auth.signOut(); Cloud.user = null; };
  Cloud.getInvite = async code => { const { data, error } = await c.rpc('get_invite', { p_code: code }); if (error) throw error; return data; };
  // Assinatura no Asaas (função "assinatura" no Supabase).
  Cloud.billingAction = async (action, payload = {}) => {
    const { data, error } = await c.functions.invoke('assinatura', { body: { action, ...payload } });
    if (error) {
      let msg = error.message;
      try { const b = await error.context.json(); if (b && b.erro) msg = b.erro; } catch (e) { /* usa a mensagem padrão */ }
      if (/Failed to send a request|Function not found|404/i.test(msg)) msg = 'O pagamento ainda não está disponível. Avise o suporte do Gestão Barber IA.';
      throw new Error(msg);
    }
    if (data && data.erro) throw new Error(data.erro);
    return data;
  };
  // Painel do dono do SaaS.
  Cloud.admin = {
    list: async () => { const { data, error } = await c.rpc('admin_companies'); if (error) throw error; return data || []; },
    update: async (id, patch) => { const { error } = await c.rpc('admin_update_company', { p_id: id, p_patch: patch }); if (error) throw error; },
    plans: async () => { const { data, error } = await c.from('plans').select('*').order('sort'); if (error) throw error; return data; },
    savePlan: async (id, patch) => { const { error } = await c.from('plans').update(patch).eq('id', id); if (error) throw error; },
  };
  // Provas do checklist (fotos) no armazenamento do Supabase, pasta da barbearia.
  const PROOFS = 'provas';
  const urlCache = {};
  Cloud.uploadProof = async (path, dataUrl) => {
    const blob = await (await fetch(dataUrl)).blob();
    const { error } = await c.storage.from(PROOFS).upload(path, blob, { contentType: 'image/jpeg', upsert: false });
    if (error) throw error;
    return path;
  };
  Cloud.proofUrl = async path => {
    const hit = urlCache[path];
    if (hit && hit.exp > Date.now()) return hit.url;
    const { data, error } = await c.storage.from(PROOFS).createSignedUrl(path, 3600);
    if (error) throw error;
    urlCache[path] = { url: data.signedUrl, exp: Date.now() + 3500 * 1000 };
    return data.signedUrl;
  };
  Cloud.removeProof = async path => { try { await c.storage.from(PROOFS).remove([path]); } catch (e) { /* segue */ } };
  Cloud.rotateKey = async () => { const { data, error } = await c.rpc('rotate_api_key'); if (error) throw error; return data; };

  // ---------- conversão entre o app e as tabelas ----------
  const ENTRY_KEYS = GB.FIELDS.map(f => f.key);
  const MONTH_KEYS = GB.MONTH_FIELDS.filter(f => !f.calc).map(f => f.key);
  const pick = (o, keys) => { const r = {}; for (const k of keys) if (o[k] !== null && o[k] !== undefined && o[k] !== '') r[k] = Number(o[k]); return r; };

  const TABLES = {
    barbers: { key: b => b.id, row: (b, cid) => ({ id: b.id, company_id: cid, name: b.name, photo: b.photo || null, active: b.active !== false, role: b.role || 'Barbeiro', instagram: b.instagram || '' }), list: s => s.barbers, pk: r => ({ id: r.id }) },
    invites: { key: i => i.code, row: (i, cid) => ({ code: i.code, company_id: cid, barber_id: i.barberId, used: !!i.used }), list: s => s.invites, pk: r => ({ code: r.code }) },
    entries: { key: e => e.id, row: (e, cid) => ({ id: e.id, company_id: cid, barber_id: e.barberId, date: e.date, data: pick(e, ENTRY_KEYS), source: e.source || 'manual' }), list: s => s.entries, pk: r => ({ id: r.id }) },
    pop: { key: r => r.barberId + '|' + r.day, row: (r, cid) => ({ id: r.barberId + '|' + r.day, company_id: cid, barber_id: r.barberId, day: r.day, data: { ev: r.ev || {}, notes: r.notes || {}, msg: r.msg || {}, res: r.res || null, by: r.by || null, at: r.at || null } }), list: s => s.pop || [], pk: r => ({ id: r.id }) },
    monthly: { key: m => m.barberId + '|' + m.month, row: (m, cid) => ({ company_id: cid, barber_id: m.barberId, month: m.month, data: { ...pick(m, MONTH_KEYS), ...(m._adj && Object.keys(m._adj).length ? { _adj: m._adj } : {}) } }), list: s => s.monthly || [], pk: r => ({ barber_id: r.barber_id, month: r.month }) },
  };
  const TNAME = { pop: 'pop_records' };
  const tbl = t => TNAME[t] || t;
  const ORDER_UP = ['barbers', 'invites', 'entries', 'monthly', 'pop'];
  const ORDER_DEL = ['pop', 'monthly', 'entries', 'invites', 'barbers'];

  function snapshot(s, cid) {
    const out = { tables: {}, company: '', users: {} };
    for (const t of ORDER_UP) {
      const map = {};
      for (const item of TABLES[t].list(s)) { const r = TABLES[t].row(item, cid); map[TABLES[t].key(item)] = { json: JSON.stringify(r), row: r }; }
      out.tables[t] = map;
    }
    const co = s.company;
    out.company = JSON.stringify({ name: co.name, cnpj: co.cnpj || '', phone: co.phone || '', email: co.email || '', logo: co.logo || null, settings: { weights: s.weights, goals: s.goals, hidden: s.hidden, org: s.org || null, pop: s.popCfg || null } });
    for (const u of s.users) out.users[u.id] = JSON.stringify({ name: u.name, phone: u.phone || '', status: u.status });
    return out;
  }
  const sameSnap = (a, b) => {
    if (!a || !b || a.company !== b.company) return false;
    if (JSON.stringify(a.users) !== JSON.stringify(b.users)) return false;
    for (const t of ORDER_UP) {
      const x = a.tables[t], y = b.tables[t], kx = Object.keys(x), ky = Object.keys(y);
      if (kx.length !== ky.length) return false;
      for (const k of kx) if (!y[k] || y[k].json !== x[k].json) return false;
    }
    return true;
  };

  async function fetchAll(table, cid) {
    const out = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await c.from(table).select('*').eq('company_id', cid).range(from, from + 999);
      if (error) throw error;
      out.push(...data);
      if (data.length < 1000) return out;
    }
  }

  // Carrega a barbearia inteira do usuário logado.
  Cloud.load = async function () {
    if (!Cloud.user) return { status: 'sem-login' };
    const { data: prof, error } = await c.from('profiles').select('*').eq('id', Cloud.user.id).maybeSingle();
    if (error) throw error;
    if (!prof) return { status: 'sem-perfil' };
    Cloud.profile = prof; Cloud.companyId = prof.company_id;
    if (prof.status !== 'ativo') return { status: prof.status };
    const cid = prof.company_id, gestor = prof.role === 'gestor';
    const q = (p) => p.then(r => { if (r.error) throw r.error; return r.data; });
    // Situação da assinatura: bloqueada mostra só a tela de pagamento.
    const [billing, plans] = await Promise.all([
      q(c.rpc('company_access')),
      q(c.from('plans').select('*').eq('active', true).order('sort')),
    ]);
    Cloud.billing = billing; Cloud.plans = plans;
    if (billing && billing.access === 'blocked') {
      const co = await q(c.from('companies').select('name, email, phone, logo').eq('id', cid).single());
      Cloud.last = null;
      return { status: 'bloqueado', billing, plans, company: co, role: prof.role };
    }
    const [co, profs, barbers, entries, monthly, invites, key, pop] = await Promise.all([
      q(c.from('companies').select('*').eq('id', cid).single()),
      q(c.from('profiles').select('*').eq('company_id', cid)),
      q(c.from('barbers').select('*').eq('company_id', cid).order('created_at')),
      fetchAll('entries', cid),
      fetchAll('monthly', cid),
      gestor ? q(c.from('invites').select('*').eq('company_id', cid)) : Promise.resolve([]),
      gestor ? q(c.from('api_keys').select('key').eq('company_id', cid).maybeSingle()) : Promise.resolve(null),
      fetchAll('pop_records', cid).catch(() => []),
    ]);
    const st = co.settings || {};
    const state = {
      version: 2, demo: false, cloud: true,
      company: { name: co.name, cnpj: co.cnpj, phone: co.phone, email: co.email, logo: co.logo },
      users: profs.map(p => ({ id: p.id, name: p.name, email: p.email, phone: p.phone, role: p.role, status: p.status, barberId: p.barber_id })),
      barbers: barbers.map(b => ({ id: b.id, name: b.name, photo: b.photo, active: b.active, role: b.role, instagram: b.instagram })),
      entries: entries.map(e => ({ id: e.id, barberId: e.barber_id, date: e.date, source: e.source, ...e.data })),
      monthly: monthly.map(m => ({ barberId: m.barber_id, month: m.month, ...m.data })),
      invites: invites.map(i => ({ code: i.code, barberId: i.barber_id, used: i.used, createdAt: String(i.created_at).slice(0, 10) })),
      weights: st.weights || Object.fromEntries(GB.INDICATORS.map(i => [i.key, i.weight])),
      goals: st.goals || { team: { ...GB.DEFAULT_GOALS }, byBarber: {} },
      hidden: Array.isArray(st.hidden) ? st.hidden : ['fid'],
      org: st.org || null,
      popCfg: st.pop || null,
      pop: pop.map(r => ({ barberId: r.barber_id, day: r.day, ...(r.data || {}) })),
      apiKey: key ? key.key : '',
      billing, plans,
    };
    Cloud.last = snapshot(state, cid);
    return { status: 'ativo', state };
  };

  // ---------- salvar: envia só o que mudou ----------
  let timer = null, running = false, again = null;
  Cloud.save = function (state) {
    if (!Cloud.companyId || !Cloud.last) return;
    clearTimeout(timer);
    timer = setTimeout(() => run(state), 500);
  };
  Cloud.busy = () => running || !!timer;

  async function run(state) {
    timer = null;
    if (running) { again = state; return; }
    running = true;
    const cid = Cloud.companyId, cur = snapshot(state, cid), last = Cloud.last;
    const gestor = Cloud.profile && Cloud.profile.role === 'gestor';
    try {
      for (const t of ORDER_UP) {
        const now = cur.tables[t], was = last.tables[t];
        const added = [], changed = [];
        for (const k of Object.keys(now)) { if (!was[k]) added.push(now[k].row); else if (was[k].json !== now[k].json) changed.push(now[k].row); }
        if (added.length) { const { error } = await c.from(tbl(t)).upsert(added); if (error) throw error; }
        for (const r of changed) {
          let qb = c.from(tbl(t)).update(r);
          for (const [col, v] of Object.entries(TABLES[t].pk(r))) qb = qb.eq(col, v);
          const { error } = await qb; if (error) throw error;
        }
      }
      if (gestor) {
        for (const t of ORDER_DEL) {
          const now = cur.tables[t], was = last.tables[t];
          const gone = Object.keys(was).filter(k => !now[k]).map(k => was[k].row);
          for (const r of gone) {
            let qb = c.from(tbl(t)).delete();
            for (const [col, v] of Object.entries(TABLES[t].pk(r))) qb = qb.eq(col, v);
            const { error } = await qb; if (error) throw error;
          }
        }
        if (cur.company !== last.company) {
          const { error } = await c.from('companies').update(JSON.parse(cur.company)).eq('id', cid);
          if (error) throw error;
        }
      }
      for (const id of Object.keys(cur.users)) {
        if (cur.users[id] === last.users[id]) continue;
        const u = JSON.parse(cur.users[id]), old = last.users[id] ? JSON.parse(last.users[id]) : {};
        const patch = {};
        if (u.name !== old.name) patch.name = u.name;
        if (u.phone !== old.phone) patch.phone = u.phone;
        if (u.status !== old.status) patch.status = u.status;
        if (Object.keys(patch).length) { const { error } = await c.from('profiles').update(patch).eq('id', id); if (error) throw error; }
      }
      Cloud.last = cur;
      Cloud.error = null;
    } catch (err) {
      Cloud.error = Cloud.message(err);
      if (Cloud.onError) Cloud.onError(Cloud.error);
    } finally {
      running = false;
      if (again) { const s = again; again = null; run(s); }
    }
  }

  // ---------- tempo real: outro aparelho mudou algo ----------
  let channel = null, rtTimer = null;
  Cloud.subscribe = function () {
    Cloud.unsubscribe();
    const cid = Cloud.companyId;
    channel = c.channel('company-' + cid);
    for (const t of ['entries', 'monthly', 'barbers', 'profiles', 'pop_records']) channel.on('postgres_changes', { event: '*', schema: 'public', table: t, filter: 'company_id=eq.' + cid }, remote);
    channel.on('postgres_changes', { event: '*', schema: 'public', table: 'companies', filter: 'id=eq.' + cid }, remote);
    channel.subscribe();
  };
  Cloud.unsubscribe = () => { if (channel) { c.removeChannel(channel); channel = null; } };
  function remote() {
    clearTimeout(rtTimer);
    rtTimer = setTimeout(async () => {
      if (Cloud.busy()) { remote(); return; }
      const before = Cloud.last, beforeBilling = JSON.stringify(Cloud.billing);
      try {
        const r = await Cloud.load();
        if (r.status !== 'ativo') { if (Cloud.onAuth) Cloud.onAuth('PROFILE_CHANGED'); return; }
        if (sameSnap(before, Cloud.last) && beforeBilling === JSON.stringify(Cloud.billing)) return; // eco do que este aparelho salvou
        if (Cloud.onRemote) Cloud.onRemote(r.state);
      } catch (e) { /* tenta de novo na próxima mudança */ }
    }, 700);
  }
})();
