/* Gestão Barber IA — telas e interação. */
(function () {
  'use strict';
  const { DB, INDICATORS, FIELDS, PERIOD_NAMES, periodRange, computeRanking, importEntries, upsertEntry, gapTo, emptyState, monthRange, addMonths, monthFromIntegration, levelOf, isNum, passHash, uid, iso, fromIso, hash, icon, logo } = window.GB;

  const Cloud = window.GB.Cloud || { enabled: false };
  const blankState = () => ({ version: 2, demo: false, cloud: true, company: { name: '', cnpj: '', phone: '', email: '', logo: null }, users: [], barbers: [], entries: [], monthly: [], invites: [],
    weights: Object.fromEntries(window.GB.INDICATORS.map(i => [i.key, i.weight])), goals: { team: { ...window.GB.DEFAULT_GOALS }, byBarber: {} }, hidden: ['fid'], apiKey: '' });
  let state = Cloud.enabled ? blankState() : DB.load();
  const ui = {
    period: DB.pref.get('period', 'mes'),
    offset: 0,
    authMode: 'entrar',
    perfBarber: null,
    invite: null,
    confirm: null,
    tvIndex: 0,
    tvTimer: null,
    lastReset: null,
  };
  if (!PERIOD_NAMES[ui.period]) ui.period = 'mes';
  document.documentElement.style.setProperty('--base-size', DB.pref.get('size', '16') + 'px');

  const root = document.getElementById('app');
  const $ = (s, r = document) => r.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let rkCache = {};
  const save = () => { if (Cloud.enabled) Cloud.save(state); else DB.save(state); rkCache = {}; };

  // ---------- formatação ----------
  const nf0 = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });
  const nf1 = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const nf2 = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const money0 = v => 'R$ ' + nf0.format(v);
  const money2 = v => 'R$ ' + nf2.format(v);
  function fmt(ind, v) {
    if (v === null || v === undefined) return '—';
    switch (ind.fmt) {
      case 'money': return money0(v);
      case 'money2': return money2(v);
      case 'pct': return nf1.format(v) + '%';
      default: return nf0.format(v);
    }
  }
  const score = v => nf1.format(v);
  const ord = n => n + 'º';
  const dateBR = s => { const d = fromIso(s); return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }); };

  // ---------- sessão ----------
  function currentUser() {
    if (Cloud.enabled) return Cloud.user ? state.users.find(u => u.id === Cloud.user.id && u.status === 'ativo') || null : null;
    const id = DB.session.get();
    return state.users.find(u => u.id === id && u.status === 'ativo') || null;
  }
  const isGestor = u => !!u && u.role === 'gestor';
  const barberById = id => state.barbers.find(b => b.id === id);
  const range = (offset = ui.offset) => periodRange(ui.period, offset);

  // ---------- pedaços de interface ----------
  function avatar(b, size = 44) {
    const name = b?.name || '?';
    const ini = name.split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0]).join('').toUpperCase();
    const inner = b?.photo ? `<img src="${esc(b.photo)}" alt="">` : esc(ini);
    return `<span class="avatar" style="--s:${size}px" aria-hidden="true">${inner}</span>`;
  }
  function companyAvatar(size = 40) {
    return avatar({ name: state.company.name, photo: state.company.logo }, size);
  }
  // Versão grande (abertura e login): só o selo, que já traz o nome.
  // Versão compacta (menu, TV): selo pequeno + nome ao lado.
  const brand = (cls = '') => cls.includes('brand--lg')
    ? `<span class="brand ${cls}">${logo()}</span>`
    : `<span class="brand ${cls}">${logo()}
      <span class="brand-text"><span class="brand-name">Gestão Barber <span class="brand-ia-word">IA</span></span>
      <span class="brand-sub">Sistema de gestão</span></span>
    </span>`;

  function toast(msg) {
    document.querySelectorAll('.toast').forEach(t => t.remove());
    const t = document.createElement('div');
    t.className = 'toast'; t.setAttribute('role', 'status'); t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2800);
  }

  function readImage(file, max = 256) {
    return new Promise((resolve, reject) => {
      if (!file || !file.type.startsWith('image/')) { reject(new Error('Escolha um arquivo de imagem.')); return; }
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Não foi possível ler a imagem.'));
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error('Imagem inválida.'));
        img.onload = () => {
          const s = Math.min(1, max / Math.max(img.width, img.height));
          const c = document.createElement('canvas');
          c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          resolve(c.toDataURL('image/jpeg', 0.85));
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  async function copyText(text, fallbackEl) {
    try { await navigator.clipboard.writeText(text); toast('Link copiado.'); }
    catch (e) {
      if (fallbackEl) {
        const r = document.createRange(); r.selectNodeContents(fallbackEl);
        const s = getSelection(); s.removeAllRanges(); s.addRange(r);
      }
      toast('Selecionei o texto. Use Copiar do seu aparelho.');
    }
  }

  // ---------- abertura ----------
  const PHRASES = [
    ['Cada cliente na cadeira é uma chance de ser lembrado.', 'Capriche no detalhe que ninguém pediu.'],
    ['Consistência vence talento que não aparece.', 'Repita hoje o que deu certo ontem.'],
    ['O corte termina na cadeira. A experiência, não.', 'Ofereça algo a mais no próximo atendimento.'],
    ['Meta batida começa no primeiro cliente do dia.', 'Abra a agenda com energia.'],
    ['Quem mede, melhora.', 'Confira seus números antes de começar.'],
    ['Pequenos ajustes trazem grandes resultados.', 'Escolha um ponto para melhorar hoje.'],
    ['Cliente bem atendido volta e traz outro.', 'Apresente o plano mensal para quem vem sempre.'],
    ['Disciplina é fazer bem feito mesmo sem ninguém olhando.', 'Siga o checklist do começo ao fim.'],
    ['Seu próximo nível está no hábito de hoje.', 'Treine uma técnica nova nesta semana.'],
    ['Time forte se faz com cada um dando o seu melhor.', 'Ajude um colega no próximo intervalo.'],
    ['Atenção ao cliente é o melhor marketing.', 'Chame pelo nome quem você atende.'],
    ['O ranking muda todo dia. Sua dedicação também pode.', 'Comece pelo que está ao seu alcance.'],
  ];
  function splash(next) {
    const [q, sub] = PHRASES[Math.floor(Math.random() * PHRASES.length)];
    root.innerHTML = `
      <div class="splash" role="status" aria-live="polite">
        <div class="splash-inner">
          ${brand('brand--lg')}
          <p class="splash-quote">${esc(q)}</p>
          <p class="splash-sub">${esc(sub)}</p>
          <div class="splash-bar" aria-hidden="true"><span></span></div>
        </div>
      </div>`;
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    setTimeout(next, reduce ? 600 : 1900);
  }

  // ---------- login, cadastro e convite ----------
  // Campo de senha com botão de mostrar/ocultar.
  function passField(id, name, label, opts = {}) {
    return `<div class="field"><label for="${id}" class="pw-label">${label}</label>
      <div class="input-wrap"><input class="input" id="${id}" name="${name}" type="password" ${opts.required === false ? '' : 'required'} ${opts.min ? `minlength="${opts.min}"` : ''} autocomplete="${opts.auto || 'new-password'}" ${opts.ph ? `placeholder="${opts.ph}"` : ''}>
      <button type="button" data-action="togglePass" data-target="${id}" aria-label="Mostrar senha" aria-pressed="false">${icon('eye')}</button></div>
      ${opts.hint ? `<small>${opts.hint}</small>` : ''}</div>`;
  }

  function authShell(inner) {
    return `<div class="auth"><div class="auth-card">${brand('brand--lg')}${inner}
      <p class="auth-foot">Cada atendimento conta.</p></div></div>`;
  }
  function tabs(active) {
    return `<div class="tabs" role="tablist">
      <button type="button" role="tab" aria-selected="${active === 'entrar'}" data-action="authMode" data-mode="entrar">Entrar</button>
      <button type="button" role="tab" aria-selected="${active === 'criar'}" data-action="authMode" data-mode="criar">Criar cadastro</button>
    </div>`;
  }

  function renderAuth(mode, code) {
    let inner = '';
    if (mode === 'convite' && Cloud.enabled && (!ui.inviteInfo || ui.inviteInfo.code !== code)) {
      root.innerHTML = authShell(`<div class="empty" style="padding:10px 0">${icon('clock')}<h2>Abrindo convite…</h2></div>`);
      Cloud.getInvite(code).then(info => { ui.inviteInfo = { code, info }; renderAuth('convite', code); })
        .catch(() => { ui.inviteInfo = { code, info: null }; renderAuth('convite', code); });
      return;
    }
    if (mode === 'convite') {
      const inv = Cloud.enabled ? (ui.inviteInfo.info ? { code } : null) : state.invites.find(i => i.code === code && !i.used);
      const b = Cloud.enabled ? (ui.inviteInfo.info ? { name: ui.inviteInfo.info.barber } : null) : inv && barberById(inv.barberId);
      const coName = Cloud.enabled ? (ui.inviteInfo.info ? ui.inviteInfo.info.company : '') : state.company.name;
      if (!inv || !b) {
        inner = `<div class="empty" style="padding:10px 0">${icon('link')}<h2>Convite inválido</h2>
          <p>Este link já foi usado ou foi cancelado. Peça um novo convite ao gestor da barbearia.</p>
          <a class="btn" href="#inicio" data-action="authMode" data-mode="entrar">Ir para o login</a></div>`;
      } else {
        inner = `
          <p class="auth-lead"><b style="color:var(--fg)">${esc(coName)}</b> convidou você para a equipe. Faça seu cadastro e aguarde o gestor aprovar sua entrada.</p>
          <form class="form" data-form="invite" data-code="${esc(code)}" novalidate>
            <label class="field"><span>Nome *</span><input class="input" id="inv-name" name="name" required value="${esc(b.name)}" autocomplete="name"></label>
            <label class="field"><span>E-mail *</span><input class="input" id="inv-email" name="email" type="email" required autocomplete="email" placeholder="voce@email.com"></label>
            <label class="field"><span>WhatsApp</span><input class="input" id="inv-phone" name="phone" type="tel" autocomplete="tel" placeholder="(00) 00000-0000"></label>
            ${passField('inv-pass', 'pass', 'Senha *', { min: 6, hint: 'Mínimo de 6 caracteres.' })}
            ${passField('inv-pass2', 'pass2', 'Confirmar senha *', { min: 6 })}
            <p class="form-msg" data-msg></p>
            <button class="btn btn-primary btn-block" type="submit">${icon('check')} Enviar cadastro</button>
          </form>`;
      }
    } else if (mode === 'pendente') {
      inner = `<div class="empty" style="padding:10px 0">${icon('clock')}<h2>Cadastro enviado</h2>
        <p>Agora é só aguardar. Assim que o gestor aprovar, você entra com seu e-mail e senha.</p>
        <button class="btn" data-action="authMode" data-mode="entrar">Voltar para o login</button></div>`;
    } else if (mode === 'confirmar') {
      inner = `<div class="empty" style="padding:10px 0">${icon('mail')}<h2>Confirme seu e-mail</h2>
        <p>Enviamos uma mensagem para <b style="color:var(--fg)">${esc(ui.authEmail || 'o seu e-mail')}</b>. Abra o link para ativar a conta${ui.authInvite ? '. Depois, é só aguardar o gestor aprovar sua entrada' : ''}.</p>
        <p class="section-note">Não chegou? Confira a pasta de spam ou lixo eletrônico.</p>
        <button class="btn" data-action="authMode" data-mode="entrar">Ir para o login</button></div>`;
    } else if (mode === 'bloqueado') {
      root.innerHTML = authShell(blockedScreen());
      clearInterval(ui.blockPoll);
      ui.blockPoll = setInterval(() => { if (!document.hidden && ui.authMode === 'bloqueado') ACTIONS.recheckAccess(null, null, true); }, 30000);
      return;
    } else if (mode === 'recusado' || mode === 'semPerfil') {
      inner = `<div class="empty" style="padding:10px 0">${icon('lock')}<h2>${mode === 'recusado' ? 'Acesso não aprovado' : 'Conta sem barbearia'}</h2>
        <p>${mode === 'recusado' ? 'O gestor não aprovou este cadastro. Fale com a barbearia para receber um novo convite.' : 'Este login não está ligado a nenhuma barbearia. Peça um convite ao gestor ou crie a conta da sua barbearia.'}</p>
        <button class="btn" data-action="logout">Sair</button></div>`;
    } else if (mode === 'novaSenha') {
      inner = `
        <p class="auth-lead">Crie sua nova senha.</p>
        <form class="form" data-form="newPass" novalidate>
          ${passField('np-pass', 'pass', 'Nova senha *', { min: 6, hint: 'Mínimo de 6 caracteres.' })}
          ${passField('np-pass2', 'pass2', 'Confirmar nova senha *', { min: 6 })}
          <p class="form-msg" data-msg></p>
          <button class="btn btn-primary btn-block" type="submit">${icon('check')} Salvar nova senha</button>
        </form>`;
    } else if (mode === 'recuperar') {
      inner = `
        <p class="auth-lead">${Cloud.enabled ? 'Digite o e-mail da sua conta. Vamos enviar um link para você criar uma senha nova.' : 'Informe seu e-mail. O gestor da barbearia pode gerar uma senha nova para você em <b>Barbeiros</b>.'}</p>
        <form class="form" data-form="recover" novalidate>
          <label class="field"><span>E-mail *</span><input class="input" id="rec-email" name="email" type="email" required autocomplete="email"></label>
          <p class="form-msg" data-msg></p>
          <button class="btn btn-primary btn-block" type="submit">${icon('mail')} ${Cloud.enabled ? 'Enviar link por e-mail' : 'Pedir nova senha'}</button>
        </form>
        <div class="auth-links"><button class="link-btn" data-action="authMode" data-mode="entrar">Voltar para o login</button></div>`;
    } else if (mode === 'criar') {
      inner = `${tabs('criar')}
        <p class="auth-lead">Crie a conta da sua barbearia. Você será o gestor e vai convidar os barbeiros depois.</p>
        <form class="form" data-form="signup" novalidate>
          <label class="field"><span>Nome da barbearia *</span><input class="input" id="su-company" name="company" required></label>
          <label class="field"><span>Seu nome *</span><input class="input" id="su-name" name="name" required autocomplete="name"></label>
          <label class="field"><span>E-mail *</span><input class="input" id="su-email" name="email" type="email" required autocomplete="email" placeholder="voce@barbearia.com"></label>
          ${passField('su-pass', 'pass', 'Senha *', { min: 6, hint: 'Mínimo de 6 caracteres.' })}
          ${passField('su-pass2', 'pass2', 'Confirmar senha *', { min: 6 })}
          ${Cloud.enabled ? `<label class="field"><span>WhatsApp</span><input class="input" id="su-phone" name="phone" type="tel" autocomplete="tel" placeholder="(00) 00000-0000"></label>
          <div class="trial-note">
            <p><b>7 dias grátis para testar, sem cartão.</b></p>
            <p>${icon('edit')}<span>No teste, você lança os resultados manualmente.</span></p>
            <p>${icon('plug')}<span>Ao assinar um plano, os resultados passam a ser preenchidos automaticamente pela integração (API) com o seu sistema.</span></p>
          </div>
          <label class="check"><input type="checkbox" id="su-terms" name="terms"><span><b>Li e aceito os <a href="termos.html" target="_blank" rel="noopener">Termos de uso</a> e a <a href="privacidade.html" target="_blank" rel="noopener">Política de privacidade</a></b></span></label>` : ''}
          ${state.demo ? '<p class="section-note">Neste aparelho, criar uma conta nova substitui os dados de demonstração. Dá para restaurá-los depois em Configurações.</p>' : ''}
          <p class="form-msg" data-msg></p>
          <button class="btn btn-primary btn-block" type="submit">${icon('check')} Criar conta</button>
        </form>
        <p class="section-note" style="text-align:center">Barbeiro? Sua entrada é pelo link de convite que o gestor envia.</p>`;
    } else {
      inner = `${tabs('entrar')}
        <p class="auth-lead">Entre com sua conta.</p>
        ${ui.authMsg ? `<p class="form-msg ${ui.authMsg.ok ? 'ok' : ''}" role="status">${esc(ui.authMsg.text)}</p>` : ''}
        <form class="form" data-form="login" novalidate>
          <label class="field"><span>E-mail *</span><input class="input" id="li-email" name="email" type="email" required autocomplete="email" placeholder="voce@barbearia.com"></label>
          <div class="field"><label for="li-pass" style="font-weight:600;font-size:.95rem">Senha *</label>
            <div class="input-wrap"><input class="input" id="li-pass" name="pass" type="password" required autocomplete="current-password" placeholder="••••••••">
            <button type="button" data-action="togglePass" data-target="li-pass" aria-label="Mostrar senha" aria-pressed="false">${icon('eye')}</button></div></div>
          <label class="check"><input type="checkbox" id="li-remember" name="remember" checked><span><b>Lembrar-me neste aparelho</b><small>Você continua conectado até sair.</small></span></label>
          <p class="form-msg" data-msg></p>
          <button class="btn btn-primary btn-block" type="submit">${icon('login')} Entrar</button>
        </form>
        <div class="divider">ou</div>
        <div class="stack">
          <button class="btn btn-dark btn-block" data-action="social" data-name="Google">Continuar com Google</button>
          <button class="btn btn-dark btn-block" data-action="social" data-name="Apple">Continuar com Apple</button>
          <button class="btn btn-dark btn-block" data-action="social" data-name="Microsoft">Continuar com Microsoft</button>
        </div>
        <div class="auth-links">
          <button class="link-btn" data-action="authMode" data-mode="criar">Ainda não tenho conta. Criar agora</button>
          <button class="link-btn" data-action="authMode" data-mode="recuperar">Esqueci minha senha</button>
        </div>
        ${state.demo ? `<div class="demo-box"><span><strong>Demonstração.</strong> Os números são de exemplo. Entre como:</span>
          <div class="row"><button class="btn btn-sm" data-action="demoFill" data-email="gestor@demo.com">Gestor</button>
          <button class="btn btn-sm" data-action="demoFill" data-email="barbeiro@demo.com">Barbeiro</button>
          <span class="muted" style="align-self:center">senha: demo123</span></div></div>` : ''}`;
    }
    root.innerHTML = authShell(inner);
    ui.authMsg = null;
  }

  // ---------- Instalar na tela de início (PWA) ----------
  const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isMobile = () => isIOS() || /android|mobile/i.test(navigator.userAgent);
  let installEvt = null;
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; });
  window.addEventListener('appinstalled', () => { installEvt = null; DB.pref.set('installed', '1'); closeInstall(); toast('Pronto! O Gestão Barber IA está na tela de início.'); });
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }
  function canOfferInstall() { return !isStandalone() && DB.pref.get('installed', '0') !== '1'; }
  // Mostra o convite depois do login, no celular, no máximo uma vez por sessão e não antes de 7 dias se a pessoa disse "Agora não".
  function maybeOfferInstall() {
    if (!canOfferInstall() || !isMobile() || document.getElementById('install-sheet')) return;
    let shown = false; try { shown = sessionStorage.getItem('gbia.installShown') === '1'; } catch (e) { /* opcional */ }
    if (shown || Date.now() < Number(DB.pref.get('installSnooze', '0'))) return;
    try { sessionStorage.setItem('gbia.installShown', '1'); } catch (e) { /* opcional */ }
    setTimeout(() => { if (currentUser() && !ui.fx && location.hash !== '#apresentacao') openInstall(); }, 1200);
  }
  function installSteps() {
    if (isIOS()) {
      return `<ol class="inst-steps">
        <li><span class="inst-n">1</span><span>Toque em <b>Compartilhar</b> ${icon('share')} na barra do navegador.</span></li>
        <li><span class="inst-n">2</span><span>Role e toque em <b>Adicionar à Tela de Início</b> ${icon('plus')}.</span></li>
        <li><span class="inst-n">3</span><span>Toque em <b>Adicionar</b>, no canto de cima.</span></li></ol>`;
    }
    return `<ol class="inst-steps">
      <li><span class="inst-n">1</span><span>Toque no menu <b>⋮</b> do navegador, no canto de cima.</span></li>
      <li><span class="inst-n">2</span><span>Toque em <b>Instalar app</b> ou <b>Adicionar à tela inicial</b>.</span></li>
      <li><span class="inst-n">3</span><span>Confirme em <b>Instalar</b>.</span></li></ol>`;
  }
  function openInstall() {
    closeInstall();
    const el = document.createElement('div');
    el.id = 'install-sheet'; el.className = 'inst-wrap';
    el.innerHTML = `<div class="inst-scrim" data-inst="later"></div>
      <section class="inst-sheet" role="dialog" aria-modal="true" aria-labelledby="inst-t">
        <div class="inst-head">${logo('inst-logo')}<div><h2 id="inst-t">Gestão Barber IA na sua tela de início</h2>
          <p>Abra o app com um toque, em tela cheia, como qualquer aplicativo.</p></div></div>
        ${installEvt ? `<button class="btn btn-primary btn-block" data-inst="go">${icon('plus')} Adicionar à tela de início</button>` : installSteps()}
        ${isIOS() ? '<p class="inst-tip">Se não encontrar a opção, abra este endereço no Safari e repita os passos.</p>' : ''}
        <button class="btn btn-block" data-inst="later">Agora não</button>
      </section>`;
    el.addEventListener('click', async e => {
      const b = e.target.closest('[data-inst]'); if (!b) return;
      if (b.dataset.inst === 'later') { DB.pref.set('installSnooze', String(Date.now() + 7 * 86400000)); closeInstall(); return; }
      if (b.dataset.inst === 'go' && installEvt) {
        const evt = installEvt; installEvt = null;
        evt.prompt();
        const r = await evt.userChoice.catch(() => ({ outcome: 'dismissed' }));
        if (r.outcome === 'accepted') { DB.pref.set('installed', '1'); closeInstall(); }
        else { DB.pref.set('installSnooze', String(Date.now() + 7 * 86400000)); closeInstall(); }
      }
    });
    document.body.appendChild(el);
    el.querySelector('.inst-sheet button').focus();
  }
  function closeInstall() { const el = document.getElementById('install-sheet'); if (el) el.remove(); }

  // ---------- menu ----------
  const NAV = [
    { items: [
      { r: 'inicio', t: 'Início', i: 'grid' },
      { r: 'time', t: 'Time e ranking', i: 'trophy' },
      { r: 'lancamentos', t: 'Lançamentos', i: 'wallet', g: 1 },
      { r: 'gestao-visual', t: 'Gestão Visual', i: 'signal' },
      { r: 'fechamento', t: 'Fechamento do mês', i: 'clipboard', g: 1 },
    ] },
    { group: 'GP · Gestão de pessoas', items: [
      { r: 'performance', t: 'Minha performance', i: 'chart' },
      { r: 'barbeiros', t: 'Barbeiros', i: 'users', g: 1 },
      { r: 'tarefas', t: 'Tarefas', i: 'clipboard', soon: 1 },
      { r: 'metas', t: 'Metas', i: 'target', soon: 1 },
      { r: 'premios', t: 'Prêmios e metas', i: 'gift', soon: 1 },
      { r: 'sonhos', t: 'Sonhos', i: 'rocket', soon: 1 },
      { r: 'checklist', t: 'Checklist POP', i: 'checksq', soon: 1 },
    ] },
    { group: 'Gestor', g: 1, items: [
      { r: 'empresa', t: 'Minha empresa', i: 'building' },
      { r: 'integracao', t: 'Integração & API', i: 'plug' },
      { r: 'apresentacao', t: 'Modo apresentação', i: 'monitor' },
      { r: 'configuracoes', t: 'Configurações', i: 'gear' },
      { r: 'assinatura', t: 'Assinatura', i: 'card', cloud: 1 },
      { r: 'admin', t: 'Painel do SaaS', i: 'gauge', admin: 1 },
      { r: 'organograma', t: 'Organograma', i: 'org', soon: 1 },
      { r: 'cockpit', t: 'Cockpit do gestor', i: 'gauge', soon: 1 },
    ] },
    { group: 'Conta', items: [
      { r: 'cadastro', t: 'Meu cadastro', i: 'idcard' },
      { r: 'ajuda', t: 'Central de ajuda', i: 'help' },
    ] },
  ];
  const SOON_TEXT = {
    tarefas: 'Tarefas do dia para cada barbeiro, com prazo e confirmação.',
    metas: 'Metas individuais e da equipe, com acompanhamento em tempo real.',
    premios: 'Prêmios ligados às metas, para motivar o time.',
    sonhos: 'Cada barbeiro registra um sonho e acompanha quanto falta para realizá-lo.',
    checklist: 'Checklist do procedimento padrão (POP), que alimenta o indicador Checklist POP.',
    organograma: 'Estrutura da equipe e responsabilidades.',
    cockpit: 'Visão rápida do gestor com os principais números do negócio.',
  };

  function drawer(user, route) {
    const g = isGestor(user);
    const groups = NAV.filter(gr => !gr.g || g).map(gr => {
      const items = gr.items.filter(it => (!it.g || g) && (!it.cloud || billing()) && (!it.admin || (billing() && billing().admin))).map(it => `
        <a class="nav-item" href="#${it.r}" ${it.r === route ? 'aria-current="page"' : ''}>${icon(it.i)}<span>${esc(it.t)}</span>${it.soon ? '<span class="nav-soon">em breve</span>' : ''}</a>`).join('');
      return (gr.group ? `<div class="nav-group">${esc(gr.group)}</div>` : '') + items;
    }).join('');
    const periods = Object.entries(PERIOD_NAMES).map(([k, v]) =>
      `<button type="button" aria-pressed="${ui.period === k}" data-action="period" data-period="${k}">${v}</button>`).join('');
    return `
      <div class="scrim" hidden data-action="closeDrawer"></div>
      <nav class="drawer" aria-label="Menu principal">
        ${brand()}
        ${groups}
        <div class="period-box"><div class="nav-group">Período</div>${periods}</div>
        <div class="nav-sep"></div>
        ${canOfferInstall() ? `<button class="nav-item" data-action="installApp">${icon('download')}<span>Adicionar à tela de início</span></button>` : ''}
        <button class="nav-item" data-action="logout">${icon('logout')}<span>Sair</span></button>
      </nav>`;
  }

  function popover(user) {
    const c = state.company;
    const b = user.barberId ? barberById(user.barberId) : null;
    const who = isGestor(user) ? { name: c.name, photo: c.logo } : (b || { name: user.name });
    return `
      <div class="popover" hidden role="dialog" aria-label="Perfil">
        <div class="popover-head">${avatar(who, 64)}<div><b>${esc(isGestor(user) ? c.name : user.name)}</b><span>${esc(user.email)}</span></div></div>
        <label class="btn btn-dark btn-block" style="cursor:pointer">${icon('camera')} Atualizar foto
          <input type="file" accept="image/*" hidden data-change="${isGestor(user) ? 'companyLogo' : 'myPhoto'}"></label>
        <ul class="info-list">
          ${c.cnpj ? `<li>${icon('card')}<span>CNPJ: <b>${esc(c.cnpj)}</b></span></li>` : ''}
          ${c.phone ? `<li>${icon('phone')}<b>${esc(c.phone)}</b></li>` : ''}
          <li>${icon('building')}<b>${esc(c.name)}</b></li>
          ${c.email ? `<li>${icon('mail')}<b>${esc(c.email)}</b></li>` : ''}
        </ul>
        <button class="btn btn-danger btn-block" data-action="logout">${icon('logout')} Sair</button>
      </div>`;
  }

  // ---------- componentes do ranking ----------
  function periodNav() {
    const r = range();
    return `<div class="period-nav">
      <button class="icon-btn" data-action="shift" data-dir="-1" aria-label="Período anterior">${icon('left')}</button>
      <b>${esc(PERIOD_NAMES[ui.period])}: ${esc(r.label)}</b>
      <button class="icon-btn" data-action="shift" data-dir="1" aria-label="Próximo período" ${ui.offset >= 0 ? 'disabled style="opacity:.3"' : ''}>${icon('right')}</button>
    </div>`;
  }

  function titleChip(R, id) {
    if (R.title.barberId !== id) return '';
    return R.title.type === 'mvp' ? `<span class="chip chip-mvp">${icon('diamond')} MVP</span>` : `<span class="chip chip-destaque">${icon('bolt')} Destaque</span>`;
  }

  // Coroa do 1º lugar: azul com diamante (MVP), dourada (Destaque) ou prata.
  function crownSvg(tier) {
    const id = 'cg-' + tier;
    const gem = tier === 'tier-mvp'
      ? `<polygon points="49,-4 60,-18 71,-4 60,10" fill="url(#${id})" stroke="#e8f6ff" stroke-width="1.5"/><path d="M49 -4h22M55 -4l5 14 5-14" stroke="#e8f6ff" stroke-width="1" fill="none"/>`
      : `<circle cx="60" cy="-2" r="6" fill="url(#${id})" stroke="#fff" stroke-width="1.2"/>`;
    return `<svg viewBox="0 -22 120 100" aria-hidden="true">
      <defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff"/><stop offset=".45" style="stop-color:var(--tc)"/><stop offset="1" style="stop-color:var(--tc2)"/></linearGradient></defs>
      <path d="M12 62 6 18l26 22L60 6l28 34 26-22-6 44z" fill="url(#${id})" stroke="#fff" stroke-opacity=".7" stroke-width="1.6" stroke-linejoin="round"/>
      <rect x="10" y="62" width="100" height="12" rx="3" fill="url(#${id})" stroke="#fff" stroke-opacity=".7" stroke-width="1.4"/>
      <circle cx="6" cy="16" r="4" fill="#fff"/><circle cx="114" cy="16" r="4" fill="#fff"/>
      <circle cx="35" cy="68" r="2.6" fill="#0b1630"/><circle cx="60" cy="68" r="3.2" fill="#0b1630"/><circle cx="85" cy="68" r="2.6" fill="#0b1630"/>
      ${gem}
      <g class="twinkle"><path d="M60 -22v10M55 -17h10" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/></g>
    </svg>`;
  }

  function pdPhoto(b) {
    const ini = (b.name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0]).join('').toUpperCase();
    return `<div class="pd-photo"><span>${b.photo ? `<img src="${esc(b.photo)}" alt="">` : esc(ini)}</span></div>`;
  }

  const barsSvg = `<svg viewBox="0 0 24 20" aria-hidden="true"><rect x="1" y="12" width="5" height="8" rx="1" fill="var(--tc)"/><rect x="9.5" y="7" width="5" height="13" rx="1" fill="var(--tc)"/><rect x="18" y="1" width="5" height="19" rx="1" fill="var(--tc)" opacity=".75"/></svg>`;

  function podium(R) {
    const rows = R.rows;
    if (!rows.length) return emptyBarbers();
    const sparks = Array.from({ length: 12 }, (_, i) =>
      `<span style="left:${8 + ((i * 37) % 84)}%;--dl:${((i * 0.73) % 4).toFixed(2)}s;--dur:${(3.2 + (i % 4) * 0.6).toFixed(1)}s"></span>`).join('');
    const card = (row, place) => {
      const delay = { 1: '0.15s', 2: '0s', 3: '0.3s' }[place];
      if (!row) return `<div class="pd pd-${place} tier-silver pd-empty" style="--in:${delay}"><div class="pd-float"><div class="pd-card"><div class="pd-frame"><div class="pd-inner"><span class="muted">Vago</span></div></div>
        <div class="pd-badge"><span>${ord(place)}<small>LUGAR</small></span></div></div></div><div class="pd-base"></div></div>`;
      const b = row.barber;
      const t = place === 1 && R.title.barberId === b.id ? R.title.type : null;
      const tier = place === 2 ? 'tier-silver' : place === 3 ? 'tier-bronze' : t === 'mvp' ? 'tier-mvp' : t === 'destaque' ? 'tier-gold' : 'tier-plat';
      const leadsTxt = `${row.leads.length} / ${R.N}`;
      const middle = t
        ? `<div class="pd-title"><span>${icon(t === 'mvp' ? 'diamond' : 'crown')}<span><b>${t === 'mvp' ? 'MVP' : 'DESTAQUE'}</b><i class="num">${leadsTxt}</i></span></span></div>`
        : '';
      return `<div class="pd pd-${place} ${tier}" data-id="${esc(b.id)}" data-pos="${place}" style="--in:${delay};--fd:${place === 1 ? '0s' : place === 2 ? '-2s' : '-4s'}">
        <div class="pd-beam"></div>
        ${place === 1 ? `<div class="pd-sparks">${sparks}</div>` : ''}
        <div class="pd-float">
          <div class="pd-card">
            ${place === 1 ? `<div class="pd-crown">${crownSvg(tier)}</div>` : ''}
            <div class="pd-frame"><div class="pd-inner">
              ${pdPhoto(b)}
              <div class="pd-name">${esc(b.name)}</div>
              <hr class="pd-line">
              ${place === 1 ? middle : ''}
              <div class="pd-pts">${score(row.overall)}<small>pts</small></div>
              <div class="pd-money"><span class="pd-coin">$</span>${money0(row.sums.fat)}</div>
              ${t ? '' : `<div class="pd-leads" title="1º lugar em ${row.leads.length} de ${R.N} indicadores">${barsSvg}<span>${leadsTxt}</span></div>`}
            </div></div>
            <div class="pd-badge"><span>${ord(place)}<small>LUGAR</small></span></div>
            <a class="pd-link" href="#perfil-${esc(b.id)}" aria-label="Ver perfil de ${esc(b.name)}, ${ord(place)} lugar"></a>
          </div>
        </div>
        <div class="pd-base"><i></i><i></i></div>
      </div>`;
    };
    return `<div class="podium-x"><div class="pd-row">${card(rows[1], 2)}${card(rows[0], 1)}${card(rows[2], 3)}</div></div>`;
  }

  function podiumLegend(R) {
    return `<div class="pd-legend">
      <div class="lg-mvp">${icon('diamond')}<span><b>MVP</b>Lidera ${R.mvpNeed} ou mais indicadores.<em>Contorno azul (diamante).</em></span></div>
      <div class="lg-gold">${icon('crown')}<span><b>Destaque</b>Lidera no mínimo ${R.half} indicadores.<em>Contorno dourado.</em></span></div>
      <div class="lg-pts">${icon('trophy')}<span><b>Classificação por pontos</b>Sem título no período: contorno prata e bronze.</span></div>
    </div>`;
  }

  function pageGestaoVisual() {
    const R = computeRanking(state, range());
    liveDetect(R);
    return `${periodNav()}
      <section class="section"><h2 class="section-title">Pódio e ranking ao vivo</h2>${podium(R)}${R.rows.length ? podiumLegend(R) : ''}</section>
      <section class="section"><h2 class="section-title">Ranking em tempo real</h2>${rankingList(R)}</section>`;
  }

  function prevPositions() {
    const P = computeRanking(state, range(ui.offset - 1));
    const hasData = P.active.length > 0;
    return hasData ? Object.fromEntries(P.rows.map(r => [r.barber.id, r.pos])) : {};
  }

  function rankingList(R, limit) {
    if (!R.rows.length) return '';
    const prev = prevPositions();
    const n = R.rows.length;
    const rows = (limit ? R.rows.slice(0, limit) : R.rows).map(r => {
      const p = prev[r.barber.id];
      const diff = p ? p - r.pos : 0;
      const trend = diff === 0
        ? `<span class="rank-trend" title="Mesma posição do período anterior">${icon('dash')}</span>`
        : `<span class="rank-trend ${diff > 0 ? 'up' : 'down'}" title="${diff > 0 ? 'Subiu' : 'Caiu'} ${Math.abs(diff)} posição(ões) em relação ao período anterior">${icon(diff > 0 ? 'up' : 'down')}<b class="num">${Math.abs(diff)}</b></span>`;
      const t = R.title.barberId === r.barber.id ? R.title.type : null;
      const sub = t === 'mvp'
        ? `<small class="rank-sub sub-mvp">${icon('diamond')} MVP · ${r.leads.length}/${R.N}</small>`
        : t === 'destaque'
          ? `<small class="rank-sub sub-gold">${icon('crown')} Destaque · ${r.leads.length}/${R.N}</small>`
          : `<small class="rank-sub">${r.leads.length}/${R.N} ${liveRecent(R, r.barber.id) ? 'ind.' : 'indicadores'}</small>`;
      const zone = r.pos <= 3 ? 'top' : (n >= 5 && r.pos > n - 2 ? 'low' : '');
      const nowD = liveRecent(R, r.barber.id);
      const nowChip = nowD ? `<span class="rk-now ${nowD > 0 ? 'up' : 'down'}" title="Mudança nos últimos 15 minutos">${nowD > 0 ? '↑' : '↓'}${Math.abs(nowD)} agora</span>` : '';
      return `<li><a class="rank-row ${zone}" data-id="${esc(r.barber.id)}" data-pos="${r.pos}" href="#perfil-${esc(r.barber.id)}">
        <span class="rank-pos num">${ord(r.pos)}</span>
        ${avatar(r.barber, 46)}
        <span class="rank-who"><b><span class="rank-name">${esc(r.barber.name)}</span><span class="rank-money num">${money0(r.sums.fat)}</span></b>${sub.replace('</small>', nowChip + '</small>')}</span>
        <span class="rank-score num">${score(r.overall)}</span>
        ${trend}
      </a></li>`;
    }).join('');
    return `<ol class="rank-list">${rows}</ol>`;
  }

  function highlights(R) {
    if (!R.active.length) return `<div class="card muted">Ainda não há lançamentos neste período.</div>`;
    return `<div class="highlights">${R.active.map(ind => {
      const leaders = ind.leaders.map(barberById).filter(Boolean);
      if (!leaders.length) return '';
      const row = R.rows.find(r => r.barber.id === leaders[0].id);
      return `<div class="card card-glow hl">
        <div class="hl-head">${icon('trophy')}<span>Melhor em ${esc(ind.label)} · ${ind.weight} pts</span></div>
        <div class="hl-who"><span class="avatar-stack">${leaders.slice(0, 3).map(b => avatar(b, 44)).join('')}</span><span>${leaders.map(b => esc(b.name)).join(' + ')}</span></div>
        <div class="hl-val num">${fmt(ind, row.values[ind.key])}</div>
        ${leaders.length > 1 ? '<span><span class="chip chip-tie">Empate na liderança</span></span>' : ''}
      </div>`;
    }).join('')}</div>`;
  }

  function titleCard(R) {
    const rule = `Destaque: 1º lugar em no mínimo ${R.half} de ${R.Nrule} indicadores. MVP: em ${R.mvpNeed} ou mais.`;
    if (!R.title.type) {
      return `<div class="card title-card is-none">
        <div class="eyebrow">${icon('trophy')} Título do período</div>
        <h3>Ninguém conquistou título ainda</h3>
        <p class="muted">${R.N >= 2 ? esc(rule) : 'São necessários pelo menos 2 indicadores com dados.'}</p></div>`;
    }
    const row = R.rows.find(r => r.barber.id === R.title.barberId);
    const names = row.leads.map(k => INDICATORS.find(i => i.key === k).label).join(' · ');
    const mvp = R.title.type === 'mvp';
    return `<div class="card title-card ${mvp ? 'is-mvp' : ''}">
      <div class="eyebrow">${icon(mvp ? 'diamond' : 'bolt')} ${mvp ? 'MVP do período' : 'Destaque do período'}</div>
      <h3>${esc(row.barber.name)}</h3>
      <p><b>${row.leads.length} de ${R.N} indicadores em 1º lugar</b></p>
      <p class="muted">${esc(names)}</p>
      <p class="muted" style="font-size:.88rem;margin-top:6px">${esc(rule)}${mvp ? '' : ' Mais um 1º lugar e vira MVP.'}</p>
    </div>`;
  }

  function inactiveNote(R) {
    const none = R.inactive.filter(i => i.reason === 'sem dados');
    if (!none.length) return '';
    return `<p class="section-note">Indicadores ainda sem dados (não aparecem e não pontuam): ${none.map(i => esc(i.label)).join(', ')}.</p>`;
  }

  function classification(R) {
    if (!R.rows.length || !R.active.length) return '';
    const head = R.active.map(i => `<th>${esc(i.label)} <small>(${i.weight} pts)</small></th>`).join('');
    const body = R.rows.map(r => `<tr>
      <td class="num"><b>${ord(r.pos)}</b></td>
      <td><span class="td-who">${avatar(r.barber, 36)}<span>${esc(r.barber.name)}</span></span></td>
      ${R.active.map(i => `<td class="${r.ranks[i.key] === 1 && i.leaders.includes(r.barber.id) ? 'lead-cell' : ''}">${ord(r.ranks[i.key])} <small>(${score(r.scores[i.key])} pts)</small></td>`).join('')}
      <td class="td-score">${score(r.overall)}</td></tr>`).join('');
    return `<section class="section card">
      <h2 class="section-title">Classificação geral</h2>
      <p class="section-note">Posição em cada indicador e nota proporcional (1º = 100, último = 0). A pontuação geral é a média ponderada das notas pelos pesos.</p>
      <div class="table-wrap"><table><thead><tr><th>Rank</th><th>Barbeiro</th>${head}<th>Pontuação</th></tr></thead><tbody>${body}</tbody></table></div>
    </section>`;
  }

  function emptyBarbers() {
    const u = currentUser();
    return `<div class="card empty">${icon('users')}<h2>Nenhum barbeiro cadastrado</h2>
      <p>${isGestor(u) ? 'Cadastre a equipe e envie os convites para começar o ranking.' : 'O gestor ainda não cadastrou a equipe.'}</p>
      ${isGestor(u) ? `<a class="btn btn-primary" href="#barbeiros">${icon('plus')} Cadastrar barbeiros</a>` : ''}</div>`;
  }

  // ---------- páginas ----------
  function pageInicio(user) {
    const R = computeRanking(state, range());
    liveDetect(R);
    const shortcuts = isGestor(user)
      ? [['lancamentos', 'Lançar resultados', 'bolt'], ['time', 'Time e ranking', 'trophy'], ['barbeiros', 'Barbeiros', 'users'], ['apresentacao', 'Tela da loja', 'crown']]
      : [['performance', 'Minha performance', 'award'], ['time', 'Time e ranking', 'trophy'], ['ajuda', 'Como pontuo', 'help'], ['apresentacao', 'Tela da loja', 'crown']];
    return `
      ${periodNav()}
      <div class="shortcuts">${shortcuts.map(([r, t, i]) => `<a class="shortcut" href="#${r}">${icon(i)}<span>${t}</span></a>`).join('')}</div>
      <div class="home-cols">
        <section class="section"><h2 class="section-title">Pódio do período</h2>${podium(R)}${R.rows.length ? podiumLegend(R) : ''}
          <p class="section-note">${R.N ? `Pontuação geral = média ponderada dos ${R.N} indicadores com dados.` : 'Ainda não há resultados lançados neste período.'} Destaque lidera no mínimo ${R.half} indicadores; MVP lidera ${R.mvpNeed} ou mais.</p></section>
        <section class="section"><h2 class="section-title">Ranking em tempo real</h2>${rankingList(R)}</section>
      </div>
      <section class="section"><h2 class="section-title">Destaques por indicador</h2>${highlights(R)}${titleCard(R)}${inactiveNote(R)}</section>
      ${classification(R)}`;
  }

  // ---------- Time e ranking (por mês) ----------
  const curYm = () => iso(new Date()).slice(0, 7);
  const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
  const ymLabel = ym => cap(monthRange(ym).label);
  const ymShort = ym => { const l = monthRange(ym).label; return cap(l.slice(0, 3)) + '/' + ym.slice(2, 4); };
  const monthR = ym => rkCache[ym] || (rkCache[ym] = computeRanking(state, monthRange(ym)));
  const ROLES = ['Barbeiro', 'Barbeiro líder', 'Aprendiz', 'Recepcionista', 'Gerente'];
  const RADAR_COLORS = ['#d6b46a', '#5b9dff', '#ff5fa8', '#52d37e'];
  const fmtGoal = (ind, v) => fmt(ind, v);

  function firstYm() {
    let min = curYm();
    for (const e of state.entries) if (e.date.slice(0, 7) < min) min = e.date.slice(0, 7);
    for (const m of state.monthly || []) if (m.month < min) min = m.month;
    return min;
  }
  function monthsUntil(ym) {
    const out = []; let k = firstYm();
    while (k <= ym && out.length < 60) { out.push(k); k = addMonths(k, 1); }
    return out;
  }
  const hasData = row => row && Object.keys(row.sums.n).length > 0;

  // Carreira = média das pontuações mensais em que o barbeiro teve dados.
  function career(barberId, ym) {
    const months = [];
    let sum = 0, n = 0;
    for (const k of monthsUntil(ym)) {
      const R = monthR(k);
      const row = R.rows.find(r => r.barber.id === barberId);
      if (!hasData(row) || !R.active.length) continue;
      sum += row.overall; n++;
      months.push({ ym: k, score: row.overall, career: sum / n });
    }
    const cur = months.length ? months[months.length - 1] : null;
    const value = n ? sum / n : 0;
    const prev = cur && cur.ym === ym ? (months.length > 1 ? months[months.length - 2].career : null) : null;
    return { months, value, delta: prev === null ? null : value - prev };
  }
  function careerByInd(barberId, ym) {
    const acc = {};
    for (const k of monthsUntil(ym)) {
      const R = monthR(k);
      const row = R.rows.find(r => r.barber.id === barberId);
      if (!hasData(row)) continue;
      for (const ind of R.active) { (acc[ind.key] = acc[ind.key] || []).push(row.scores[ind.key]); }
    }
    return Object.fromEntries(Object.entries(acc).map(([k, v]) => [k, v.reduce((a, b) => a + b, 0) / v.length]));
  }

  // ---------- gráficos em SVG ----------
  function lineSvg({ labels, series, yMax, yFmt = v => nf0.format(v), height = 210 }) {
    const W = 360, H = height, L = 46, Rt = 14, T = 14, B = 30;
    const max = yMax || Math.max(1, ...series.flatMap(s => s.values.filter(v => v != null))) * 1.15;
    const nice = (() => { const p = Math.pow(10, Math.floor(Math.log10(max))); return Math.ceil(max / p) * p; })();
    const x = i => labels.length < 2 ? (L + W - Rt) / 2 : L + (i * (W - L - Rt)) / (labels.length - 1);
    const y = v => T + (1 - v / nice) * (H - T - B);
    const ticks = [0, 0.25, 0.5, 0.75, 1].map(t => t * nice);
    const grid = ticks.map(t => `<line x1="${L}" x2="${W - Rt}" y1="${y(t)}" y2="${y(t)}" class="ch-grid"/><text x="${L - 6}" y="${y(t) + 4}" class="ch-y">${esc(yFmt(t))}</text>`).join('');
    const step = Math.ceil(labels.length / 5);
    const xl = labels.map((l, i) => (i % step === 0 || i === labels.length - 1) ? `<text x="${x(i)}" y="${H - 8}" class="ch-x">${esc(l)}</text>` : '').join('');
    const paths = series.map(s => {
      const pts = s.values.map((v, i) => v == null ? null : [x(i), y(v)]).filter(Boolean);
      if (!pts.length) return '';
      const d = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
      const area = s.fill ? `<path d="${d} L${pts[pts.length - 1][0]} ${y(0)} L${pts[0][0]} ${y(0)} Z" fill="${s.color}" opacity=".14"/>` : '';
      const dots = pts.map((p, i) => `<circle cx="${p[0]}" cy="${p[1]}" r="${i === pts.length - 1 ? 5 : 3.5}" fill="${s.color}" ${s.dashed ? 'opacity=".6"' : ''}><title>${esc(labels[s.values.findIndex((v, k) => k >= i && v != null)] || '')}: ${esc(yFmt(s.values.filter(v => v != null)[i]))}</title></circle>`).join('');
      return `${area}<path d="${d}" fill="none" stroke="${s.color}" stroke-width="${s.dashed ? 2 : 3}" ${s.dashed ? 'stroke-dasharray="5 5" opacity=".7"' : ''} stroke-linejoin="round" stroke-linecap="round"/>${dots}`;
    }).join('');
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img">${grid}${xl}${paths}</svg>`;
  }

  function radarSvg(axes, series) {
    const W = 400, H = 360, cx = W / 2, cy = H / 2 + 4, Rr = 118, n = axes.length;
    if (n < 3) return '<p class="muted">São necessários pelo menos 3 indicadores com dados para o radar.</p>';
    const pt = (i, v) => { const a = -Math.PI / 2 + (i * 2 * Math.PI) / n; return [cx + Math.cos(a) * Rr * v / 100, cy + Math.sin(a) * Rr * v / 100]; };
    const rings = [20, 40, 60, 80, 100].map(v => `<polygon points="${axes.map((_, i) => pt(i, v).join(',')).join(' ')}" class="rd-ring"/>`).join('');
    const spokes = axes.map((_, i) => { const [x2, y2] = pt(i, 100); return `<line x1="${cx}" y1="${cy}" x2="${x2}" y2="${y2}" class="rd-ring"/>`; }).join('');
    const labels = axes.map((a, i) => {
      const [x2, y2] = pt(i, 122);
      const anchor = Math.abs(x2 - cx) < 8 ? 'middle' : x2 > cx ? 'start' : 'end';
      const words = a.label.split(' ');
      const lines = words.length > 2 ? [words.slice(0, 2).join(' '), words.slice(2).join(' ')] : words.length === 2 && a.label.length > 12 ? words : [a.label];
      return `<text x="${x2}" y="${y2 - (lines.length - 1) * 7 + 4}" text-anchor="${anchor}" class="rd-label">${lines.map((l, k) => `<tspan x="${x2}" dy="${k ? 14 : 0}">${esc(l)}</tspan>`).join('')}</text>`;
    }).join('');
    const polys = series.map(s => {
      const pts = axes.map((a, i) => pt(i, Math.max(0, Math.min(100, s.values[a.key] ?? 0))));
      const dots = s.dashed ? '' : pts.map((p, i) => `<circle cx="${p[0]}" cy="${p[1]}" r="3.5" fill="${s.color}"><title>${esc(s.name)} · ${esc(axes[i].label)}: ${score(s.values[axes[i].key] ?? 0)}</title></circle>`).join('');
      return `<polygon points="${pts.map(p => p.join(',')).join(' ')}" fill="${s.color}" fill-opacity="${s.dashed ? 0 : 0.18}" stroke="${s.color}" stroke-width="${s.dashed ? 1.6 : 2.4}" ${s.dashed ? 'stroke-dasharray="5 4" stroke-opacity=".75"' : ''} stroke-linejoin="round"/>${dots}`;
    }).join('');
    return `<svg class="chart radar" viewBox="0 0 ${W} ${H}" role="img">${rings}${spokes}${polys}${labels}</svg>`;
  }

  // ---------- blocos da tela Time ----------
  function monthOptions(sel) {
    const opts = []; let k = curYm();
    const min = addMonths(curYm(), -11) < firstYm() ? addMonths(curYm(), -11) : firstYm();
    while (k >= min && opts.length < 24) { opts.push(k); k = addMonths(k, -1); }
    return opts.map(o => `<option value="${o}" ${o === sel ? 'selected' : ''}>${ymLabel(o).replace(' de ', '/')}</option>`).join('');
  }
  function monthPicker(ym, user) {
    return `<div class="card tm-month">
      <label class="field"><span class="tm-eyebrow">Mês dos dados</span>
        <select class="input" id="tm-month" data-change="teamMonth">${monthOptions(ym)}</select></label>
      ${isGestor(user) ? `<span class="chip chip-ok tm-saved" id="tm-saved">${icon('check')} Salvo automaticamente</span>` : ''}
    </div>`;
  }

  function classCards(R, ym) {
    if (!R.rows.length) return emptyBarbers();
    return `<div class="cc-list">${R.rows.map(r => {
      const c = career(r.barber.id, ym);
      const lv = levelOf(c.value);
      const d = c.delta;
      const delta = d === null ? '<span class="muted">primeiro mês</span>' : `<span class="cc-delta ${d >= 0 ? 'up' : 'down'}">${d >= 0 ? '▲ +' : '▼ '}${nf1.format(d)} pts no mês</span>`;
      return `<article class="cc cc-p${r.pos <= 3 ? r.pos : 'n'} ${ui.teamBarber === r.barber.id ? 'is-sel' : ''}" data-action="teamPick" data-id="${esc(r.barber.id)}" tabindex="0" role="button" aria-label="Ver métricas de ${esc(r.barber.name)}">
        <span class="cc-pos num">${r.pos}</span>
        ${avatar(r.barber, 60)}
        <div class="cc-body">
          <b class="cc-name">${esc(r.barber.name)} ${titleChip(R, r.barber.id)}</b>
          <span class="muted num">${r.leads.length} de ${R.N} em 1º · ${money0(r.sums.fat)}</span>
          <div class="cc-meta"><span class="lv ${lv.cls}">${lv.name}</span>${delta}<span class="muted num">carreira ${nf1.format(c.value)}</span></div>
          <div class="cc-chips">${R.active.map(i => `<span class="rk-chip ${i.leaders.includes(r.barber.id) ? 'lead' : ''}">${esc(i.label)}: <b class="num">${ord(r.ranks[i.key])}</b></span>`).join('')}</div>
        </div>
        <span class="cc-score num">${score(r.overall)}</span>
      </article>`;
    }).join('')}</div>`;
  }

  function teamTop(ym) {
    const R = monthR(ym);
    return `<section class="section"><h2 class="section-title">Destaques por indicador</h2>${highlights(R)}${titleCard(R)}${inactiveNote(R)}</section>
      <section class="section"><h2 class="section-title">Classificação geral</h2>
        <p class="section-note">Toque num barbeiro para ver as métricas, a carreira e as metas dele.</p>${classCards(R, ym)}</section>`;
  }

  function editorFields(b, ym) {
    const rec = (state.monthly || []).find(m => m.barberId === b.id && m.month === ym) || {};
    const integ = monthFromIntegration(state, b.id, ym);
    const R = monthR(ym);
    const row = R.rows.find(r => r.barber.id === b.id);
    const hidden = state.hidden || [];
    return GB.MONTH_FIELDS.filter(f => !hidden.includes(GB.FIELD_IND[f.key] || f.key)).map(f => {
      if (f.calc) {
        const t = row && row.sums.cli > 0 ? row.sums.fat / row.sums.cli : null;
        return `<div class="field"><span class="tm-flabel">${esc(f.label)}<span class="lock">${icon('chart')} Calculado</span></span>
          <input class="input num" id="m-${f.key}" value="${t == null ? '' : nf2.format(t)}" readonly tabindex="-1" placeholder="Faturamento ÷ clientes"></div>`;
      }
      const locked = f.daily && isNum(integ[f.key]) && !isNum(rec[f.key]);
      if (locked) {
        const v = integ[f.key];
        const shown = f.key.endsWith('Pct') ? nf2.format(v) : (f.step === '0.01' ? nf2.format(v) : nf0.format(v));
        return `<div class="field"><span class="tm-flabel">${esc(f.label)}<span class="lock">${icon('lock')} Vindo da integração</span></span>
          <input class="input num" id="m-${f.key}" value="${shown}" readonly tabindex="-1"></div>`;
      }
      return `<label class="field"><span class="tm-flabel">${esc(f.label)}</span>
        <input class="input input-edit num" id="m-${f.key}" name="${f.key}" type="number" inputmode="decimal" min="0" ${f.max ? `max="${f.max}"` : ''} step="${f.step}" value="${isNum(rec[f.key]) ? rec[f.key] : ''}" placeholder="—" data-auto="month" data-id="${esc(b.id)}"></label>`;
    }).join('');
  }

  function teamEditor(ym) {
    const list = state.barbers.filter(b => b.active !== false);
    if (!list.length) return emptyBarbers();
    const sel = barberById(ui.teamBarber) && barberById(ui.teamBarber).active !== false ? barberById(ui.teamBarber) : list[0];
    ui.teamBarber = sel.id;
    const R = monthR(ym);
    const row = R.rows.find(r => r.barber.id === sel.id);
    const goals = state.goals?.byBarber?.[sel.id] || {};
    return `<div class="tm-carousel" role="list">${list.map(b => {
      const r = R.rows.find(x => x.barber.id === b.id);
      return `<button class="tm-car ${b.id === sel.id ? 'on' : ''}" role="listitem" data-action="teamPick" data-id="${esc(b.id)}">${avatar(b, 64)}<b>${esc(b.name)}</b><span class="muted num" data-pts="${esc(b.id)}">${r ? score(r.overall) : '—'} pts</span></button>`;
    }).join('')}</div>
    <section class="section card tm-edit">
      <h2 class="section-title">Editar métricas de ${esc(sel.name)} · ${esc(ymLabel(ym).replace(' de ', '/'))}</h2>
      <div class="tm-photo">${avatar(sel, 96)}<label class="btn btn-sm" style="cursor:pointer">${icon('camera')} Trocar foto<input type="file" accept="image/*" hidden data-change="barberPhoto" data-id="${esc(sel.id)}"></label></div>
      <div class="tm-fixed"><small>Nome (fixo)</small><b>${esc(sel.name)}</b></div>
      <div class="grid-2">
        <label class="field"><span class="tm-flabel">Instagram</span><input class="input input-edit" id="m-instagram" name="instagram" value="${esc(sel.instagram || '')}" placeholder="@usuario" data-auto="barber" data-id="${esc(sel.id)}"></label>
        <label class="field"><span class="tm-flabel">Cargo na empresa</span><select class="input input-edit" id="m-role" name="role" data-auto="barber" data-id="${esc(sel.id)}">${ROLES.map(r => `<option ${r === (sel.role || 'Barbeiro') ? 'selected' : ''}>${r}</option>`).join('')}</select></label>
      </div>
      <div class="grid-2" id="tm-fields">${editorFields(sel, ym)}</div>
      <details class="tm-goals"><summary>Metas individuais de ${esc(sel.name.split(' ')[0])} <span class="muted">(em branco = meta da equipe)</span></summary>
        <div class="grid-2">${GB.visibleInds(state).map(i => `<label class="field"><span class="tm-flabel">${esc(i.label)}</span><input class="input input-edit num" id="g-${i.key}" name="${i.key}" type="number" min="0" step="any" value="${isNum(goals[i.key]) ? goals[i.key] : ''}" placeholder="Equipe: ${esc(fmtGoal(i, GB.goalFor(state, '', i.key)))}" data-auto="goal" data-id="${esc(sel.id)}"></label>`).join('')}</div>
      </details>
      <p class="section-note" id="tm-pos">${row ? `Posição atual: ${ord(row.pos)} · pontuação ${score(row.overall)} / 100.` : ''} Tudo é salvo automaticamente no mês selecionado.</p>
    </section>`;
  }

  function strengths(row, prevRow, R, barberId) {
    // No mês em andamento, metas de soma ficam proporcionais aos dias já passados.
    const ym = ui.teamMonth || curYm();
    const today = new Date();
    const frac = ym === curYm() ? today.getDate() / new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate() : 1;
    const SUMS = ['fat', 'check', 'serv', 'cli', 'planos', 'prod'];
    const items = R.active.map(ind => {
      const v = row.values[ind.key];
      const goal = GB.goalFor(state, barberId, ind.key) * (SUMS.includes(ind.key) ? frac : 1);
      const pct = goal > 0 && v != null ? (v / goal) * 100 : 0;
      const dv = prevRow && prevRow.scores[ind.key] != null ? row.scores[ind.key] - prevRow.scores[ind.key] : null;
      return { ind, v, goal, pct, dv };
    }).sort((a, b) => b.pct - a.pct);
    const half = Math.ceil(items.length / 2);
    const strong = items.slice(0, Math.min(3, half));
    const weak = items.slice(Math.max(half, items.length - 3)).reverse();
    const card = (it, kind) => {
      const tone = it.pct >= 100 ? 'ok' : it.pct >= 70 ? 'mid' : 'bad';
      const msg = kind === 'strong'
        ? (it.pct >= 100 ? 'Meta batida. Mantenha o ritmo.' : it.pct >= 70 ? 'Perto da meta. Continue avançando.' : 'Está entre os seus melhores números, mas ainda abaixo da meta.')
        : (it.pct < 33 ? 'Prioridade: menos de 1/3 da meta.' : it.pct < 70 ? 'Atenção: abaixo de 70% da meta.' : 'Quase lá. Um empurrão fecha a meta.');
      return `<div class="st-item">
        <div class="st-top"><b>${esc(it.ind.label)}</b><span class="num">${nf0.format(it.pct)}% da meta</span></div>
        <div class="st-bar st-${tone}"><i style="width:${Math.min(100, Math.max(2, it.pct))}%"></i></div>
        <p class="st-msg">${msg} <span class="num">${fmt(it.ind, it.v)} de ${fmt(it.ind, it.goal)}.</span>${it.dv === null ? '' : ` Variação do mês: <b class="num ${it.dv >= 0 ? 'delta-up' : 'delta-down'}">${it.dv >= 0 ? '+' : ''}${nf1.format(it.dv)} pts</b>.`}</p>
      </div>`;
    };
    const note = frac < 1 ? `<p class="section-note">Mês em andamento: metas de faturamento, serviços, clientes, Checklist POP, planos e produtos estão proporcionais aos ${today.getDate()} dias já passados.</p>` : '';
    return `<section class="section card"><h2 class="section-title st-good">Onde é forte</h2>${note}<div class="stack">${strong.map(i => card(i, 'strong')).join('')}</div></section>
      ${weak.length ? `<section class="section card"><h2 class="section-title st-badt">Onde precisa melhorar</h2><div class="stack">${weak.map(i => card(i, 'weak')).join('')}</div></section>` : ''}`;
  }

  function teamInsights(barberId, ym) {
    const b = barberById(barberId);
    if (!b) return '';
    const R = monthR(ym);
    const row = R.rows.find(r => r.barber.id === b.id);
    if (!row) return `<div class="card muted">${esc(b.name)} está inativo e não aparece no ranking.</div>`;
    const prevRow = monthR(addMonths(ym, -1)).rows.find(r => r.barber.id === b.id);
    const last6 = Array.from({ length: 6 }, (_, i) => addMonths(ym, i - 5));
    const fatVals = last6.map(k => { const r = monthR(k).rows.find(x => x.barber.id === b.id); return hasData(r) ? r.sums.fat : null; });
    const c = career(b.id, ym);
    const lv = levelOf(c.value);
    const cm = c.months.slice(-6);
    return `
      <section class="section card"><h2 class="section-title">Faturamento de ${esc(b.name.split(' ')[0])} · últimos 6 meses</h2>
        ${lineSvg({ labels: last6.map(ymShort), series: [{ values: fatVals, color: '#d6b46a', fill: true }], yFmt: v => v >= 1000 ? 'R$' + nf0.format(v / 1000) + 'k' : 'R$' + nf0.format(v) })}</section>
      <section class="section card">
        <div class="lv-head">
          <span class="lv-badge ${lv.cls}">${icon(lv.name === 'Diamante' ? 'diamond' : lv.name === 'Ouro' ? 'crown' : 'award')}</span>
          <div><small class="tm-eyebrow">Nível atual</small><b class="lv-name">${lv.name}</b></div>
          <div class="lv-career"><small class="tm-eyebrow">Média da carreira</small><b class="num">${nf1.format(c.value)} pts</b>
            ${c.delta === null ? '' : `<span class="num ${c.delta >= 0 ? 'delta-up' : 'delta-down'}">${c.delta >= 0 ? '+' : ''}${nf1.format(c.delta)} pts neste mês</span>`}</div>
        </div>
        <p class="lv-need">${lv.next ? `Faltam <b class="num">${nf1.format(lv.need)} pts</b> de média para chegar ao nível ${lv.next}.` : 'Nível máximo alcançado.'}</p>
        <p class="section-note">Níveis pela média de carreira: ${GB.LEVELS.map(l => `${l.name} ${l.min ? 'a partir de ' + l.min : 'abaixo de 70'}`).join(' · ')}.</p>
        ${cm.length ? lineSvg({ labels: cm.map(m => ymShort(m.ym)), series: [{ values: cm.map(m => m.score), color: '#5b9dff', dashed: true }, { values: cm.map(m => m.career), color: '#d6b46a' }], yMax: 100, yFmt: v => nf0.format(v) }) : ''}
        <div class="ch-legend"><span><i style="background:#d6b46a"></i>Média da carreira</span><span><i class="dash" style="border-color:#5b9dff"></i>Pontuação do mês</span></div>
      </section>
      ${strengths(row, prevRow, R, b.id)}`;
  }

  function teamRadars(ym) {
    const R = monthR(ym);
    if (!R.rows.length) return '';
    let sel = (ui.radarSel || []).filter(id => R.rows.some(r => r.barber.id === id));
    if (!sel.length) sel = R.rows.slice(0, 2).map(r => r.barber.id);
    ui.radarSel = sel;
    const color = id => RADAR_COLORS[sel.indexOf(id) % RADAR_COLORS.length];
    const chips = R.rows.map(r => {
      const on = sel.includes(r.barber.id);
      return `<button class="rd-chip ${on ? 'on' : ''}" style="${on ? `--c:${color(r.barber.id)}` : ''}" data-action="radarToggle" data-id="${esc(r.barber.id)}" aria-pressed="${on}">${avatar(r.barber, 30)}${esc(r.barber.name)}</button>`;
    }).join('');
    const monthSeries = sel.map(id => { const r = R.rows.find(x => x.barber.id === id); return { name: r.barber.name, color: color(id), values: r.scores }; });
    const prevYm = addMonths(ym, -1);
    const careerSeries = sel.flatMap(id => {
      const name = barberById(id).name;
      return [{ name: name + ' (antes)', color: color(id), dashed: true, values: careerByInd(id, prevYm) }, { name, color: color(id), values: careerByInd(id, ym) }];
    });
    const legend = sel.map(id => `<span><i style="background:${color(id)}"></i>${esc(barberById(id).name)}</span>`).join('');
    return `<section class="section card">
      <h2 class="section-title">Radares de competência</h2>
      <p class="section-note">Escolha até 4 barbeiros para comparar. Escala de 0 a 100, a mesma do ranking: 100 é o líder do indicador.</p>
      <div class="rd-chips">${chips}</div>
      <div class="rd-grid">
        <div class="rd-box"><h3>Radar do mês · ${esc(ymLabel(ym).replace(' de ', '/'))}</h3>${radarSvg(R.active, monthSeries)}<div class="ch-legend">${legend}</div></div>
        <div class="rd-box"><h3>Radar de carreira · acumulado até ${esc(ymLabel(ym).replace(' de ', '/'))}</h3>${radarSvg(R.active, careerSeries)}<div class="ch-legend">${legend}<span><i class="dash" style="border-color:var(--muted)"></i>Carreira até o mês anterior</span></div></div>
      </div>
      <p class="section-note">Carreira: média das notas de todos os meses em cada indicador.</p>
    </section>`;
  }

  function pageTime(user) {
    const ym = ui.teamMonth || curYm();
    if (!isGestor(user) && user.barberId) ui.teamBarber = user.barberId;
    if (!barberById(ui.teamBarber)) ui.teamBarber = monthR(ym).rows[0]?.barber.id;
    return `${monthPicker(ym, user)}
      <div id="tm-top" class="tm-block">${teamTop(ym)}</div>
      ${isGestor(user) ? `<div id="tm-editor" class="tm-block">${teamEditor(ym)}</div>` : ''}
      <div id="tm-insights" class="tm-block">${ui.teamBarber ? teamInsights(ui.teamBarber, ym) : ''}</div>
      <div id="tm-radar" class="tm-block">${teamRadars(ym)}</div>`;
  }

  function pageLancamentos(user) {
    const ym = ui.teamMonth || curYm();
    return `${monthPicker(ym, user)}
      <p class="section-note">Lance os totais do mês de cada barbeiro. Campos com cadeado vêm da integração e não podem ser editados aqui.</p>
      <div id="tm-editor" class="tm-block">${teamEditor(ym)}</div>
      <a class="btn" href="#integracao">${icon('plug')} Integração com outro sistema</a>`;
  }

  // Atualiza as partes da tela sem perder o campo que está sendo digitado.
  function refreshTeam() {
    const ym = ui.teamMonth || curYm();
    const top = $('#tm-top'); if (top) top.innerHTML = teamTop(ym);
    const ins = $('#tm-insights'); if (ins && ui.teamBarber) ins.innerHTML = teamInsights(ui.teamBarber, ym);
    const rd = $('#tm-radar'); if (rd) rd.innerHTML = teamRadars(ym);
    const R = monthR(ym);
    document.querySelectorAll('[data-pts]').forEach(el => { const r = R.rows.find(x => x.barber.id === el.dataset.pts); el.textContent = (r ? score(r.overall) : '—') + ' pts'; });
    const row = R.rows.find(r => r.barber.id === ui.teamBarber);
    const pos = $('#tm-pos'); if (pos && row) pos.textContent = `Posição atual: ${ord(row.pos)} · pontuação ${score(row.overall)} / 100. Tudo é salvo automaticamente no mês selecionado.`;
    const tk = $('#m-ticket'); if (tk && row) tk.value = row.sums.cli > 0 ? nf2.format(row.sums.fat / row.sums.cli) : '';
  }

  let autoTimer = null;
  function autoSave(el) {
    const chip = $('#tm-saved');
    if (chip) { chip.className = 'chip chip-warn tm-saved'; chip.innerHTML = `${icon('clock')} Salvando…`; }
    clearTimeout(autoTimer);
    autoTimer = setTimeout(() => {
      const ym = ui.teamMonth || curYm();
      const id = el.dataset.id, kind = el.dataset.auto, key = el.name;
      const raw = el.value.trim();
      let ok = true;
      if (kind === 'barber') {
        const b = barberById(id); if (b) b[key] = raw;
      } else {
        const v = raw === '' ? null : Number(raw.replace(',', '.'));
        if (v !== null && (Number.isNaN(v) || v < 0 || (el.max && v > Number(el.max)))) ok = false;
        else if (kind === 'month') {
          state.monthly = state.monthly || [];
          let rec = state.monthly.find(m => m.barberId === id && m.month === ym);
          if (!rec) { rec = { barberId: id, month: ym }; state.monthly.push(rec); }
          rec[key] = v;
        } else if (kind === 'goal') {
          state.goals = state.goals || { team: {}, byBarber: {} };
          const g = (state.goals.byBarber[id] = state.goals.byBarber[id] || {});
          if (v === null) delete g[key]; else g[key] = v;
        }
      }
      el.classList.toggle('input-bad', !ok);
      if (chip) {
        chip.className = ok ? 'chip chip-ok tm-saved' : 'chip chip-bad tm-saved';
        chip.innerHTML = ok ? `${icon('check')} Salvo automaticamente` : `${icon('x')} Valor inválido em "${esc(el.closest('.field')?.querySelector('.tm-flabel')?.firstChild?.textContent || key)}"`;
      }
      if (!ok) return;
      save();
      refreshTeam();
    }, 450);
  }

  function perfFor(barberId, user) {
    const b = barberById(barberId);
    if (!b) return `<div class="card empty">${icon('users')}<h2>Barbeiro não encontrado</h2><p>Ele pode ter sido removido da equipe.</p></div>`;
    const R = computeRanking(state, range());
    // Compara com o mesmo número de dias do período anterior, para não punir o período em andamento.
    const cur = range(), prevR = range(ui.offset - 1);
    if (ui.offset === 0) {
      const days = Math.round((fromIso(iso(new Date())) - fromIso(cur.start)) / 86400000);
      const s = fromIso(prevR.start);
      const lim = iso(new Date(s.getFullYear(), s.getMonth(), s.getDate() + days));
      if (lim < prevR.end) prevR.end = lim;
    }
    const P = computeRanking(state, prevR);
    const row = R.rows.find(r => r.barber.id === b.id);
    const prow = P.rows.find(r => r.barber.id === b.id);
    const picker = isGestor(user) ? `<label class="field"><span>Barbeiro</span><select class="input" id="perf-barber" data-change="perfBarber">
      ${state.barbers.map(x => `<option value="${esc(x.id)}" ${x.id === b.id ? 'selected' : ''}>${esc(x.name)}${x.active === false ? ' (inativo)' : ''}</option>`).join('')}</select></label>` : '';
    if (!row) return `${picker}<div class="card muted">Este barbeiro está inativo e não aparece no ranking.</div>`;

    let goal = '';
    if (R.N >= 2) {
      if (R.title.barberId === b.id && R.title.type === 'mvp') goal = `É o MVP do período. Mantenha a liderança em ${R.mvpNeed} indicadores.`;
      else if (R.title.barberId === b.id) goal = `É o Destaque do período. Falta 1 indicador em 1º lugar para virar MVP.`;
      else {
        const miss = Math.max(0, R.half - row.leads.length);
        goal = miss > 0 ? `Faltam ${miss} indicador(es) em 1º lugar para disputar o título de Destaque.` : `Já lidera ${row.leads.length} indicadores. Para levar o título, precisa superar quem lidera mais.`;
      }
    }

    const cards = GB.visibleInds(state).map(ind => {
      const act = R.active.find(a => a.key === ind.key);
      if (!act) return `<div class="card ind" style="opacity:.55"><div class="ind-top"><span>${esc(ind.label)}</span><span class="chip chip-soft">sem dados</span></div><div class="ind-val">—</div></div>`;
      const v = row.values[ind.key];
      const pv = prow ? prow.values[ind.key] : null;
      let delta = '';
      if (v !== null && pv !== null && pv !== undefined && pv > 0) {
        const d = ((v - pv) / pv) * 100;
        delta = `<span class="${d >= 0 ? 'delta-up' : 'delta-down'}">${d >= 0 ? '+' : ''}${nf1.format(d)}% vs. período anterior</span>`;
      }
      const lead = act.leaders.includes(b.id);
      return `<div class="card ind ${lead ? 'card-glow' : ''}">
        <div class="ind-top"><span>${esc(ind.label)}</span>${lead ? '<span class="chip chip-destaque">1º lugar</span>' : `<span class="chip chip-soft">${act.weight} pts</span>`}</div>
        <div class="ind-val num">${fmt(ind, v)}</div>
        <div class="bar" title="Nota ${score(row.scores[ind.key])}"><i style="width:${Math.max(2, row.scores[ind.key])}%"></i></div>
        <div class="ind-foot"><span class="num">${ord(row.ranks[ind.key])} de ${R.rows.length} · nota ${score(row.scores[ind.key])}</span>${delta}</div>
      </div>`;
    }).join('');

    return `${picker}${periodNav()}
      <div class="card">
        <div class="perf-head">${avatar(b, 72)}<div><h2>${esc(b.name)} ${titleChip(R, b.id)}</h2><p class="muted" style="margin:2px 0 0">${esc(goal)}</p></div></div>
        <div class="perf-stats">
          <div class="stat"><span>Posição</span><b class="num">${ord(row.pos)} de ${R.rows.length}</b></div>
          <div class="stat"><span>Pontuação</span><b class="num">${score(row.overall)}</b></div>
          <div class="stat"><span>1º lugares</span><b class="num">${row.leads.length} de ${R.N}</b></div>
          <div class="stat"><span>Faturamento</span><b class="num">${money0(row.sums.fat)}</b></div>
        </div>
      </div>
      <section class="section"><h2 class="section-title">Indicadores</h2><div class="ind-grid">${cards}</div></section>`;
  }

  function pagePerformance(user) {
    if (isGestor(user)) {
      const id = ui.perfBarber && barberById(ui.perfBarber) ? ui.perfBarber : state.barbers[0]?.id;
      return id ? perfFor(id, user) : emptyBarbers();
    }
    return user.barberId ? perfFor(user.barberId, user) : `<div class="card muted">Seu cadastro ainda não está ligado a um barbeiro. Fale com o gestor.</div>`;
  }

  function inviteLink(code) { return location.href.split('#')[0] + '#convite-' + code; }

  function pageBarbeiros() {
    const pending = state.users.filter(u => u.role === 'barbeiro' && u.status === 'pendente');
    const pendingHtml = pending.length ? `<section class="section"><h2 class="section-title">Aguardando aprovação</h2><ul class="list">
      ${pending.map(u => { const b = barberById(u.barberId); return `<li class="list-row">${avatar(b || u, 44)}
        <div class="grow"><b>${esc(u.name)}</b><span class="muted">${esc(u.email)}${u.phone ? ' · ' + esc(u.phone) : ''}</span></div>
        <div class="btn-row"><button class="btn btn-sm btn-primary" data-action="approve" data-id="${esc(u.id)}">${icon('check')} Aprovar</button>
        <button class="btn btn-sm btn-danger" data-action="reject" data-id="${esc(u.id)}">Recusar</button></div></li>`; }).join('')}
      </ul></section>` : '';

    const rows = state.barbers.map(b => {
      const u = state.users.find(x => x.barberId === b.id && x.status !== 'recusado');
      const inv = state.invites.find(i => i.barberId === b.id && !i.used);
      let status;
      if (u && u.status === 'ativo') status = '<span class="chip chip-ok">com acesso</span>';
      else if (u && u.status === 'pendente') status = '<span class="chip chip-warn">aguardando aprovação</span>';
      else if (inv) status = '<span class="chip chip-soft">convite enviado</span>';
      else status = '<span class="chip chip-soft">sem acesso</span>';
      const showInvite = ui.invite === b.id && inv;
      const link = inv ? inviteLink(inv.code) : '';
      const msg = `Olá, ${b.name}! Você foi convidado para a equipe da ${state.company.name} no Gestão Barber IA. Faça seu cadastro por este link: ${link}`;
      return `<li class="list-row" style="${b.active === false ? 'opacity:.6' : ''}">
        ${avatar(b, 48)}
        <div class="grow"><b>${esc(b.name)}</b>${status} ${b.active === false ? '<span class="chip chip-soft">inativo</span>' : ''}${u ? `<div class="muted" style="font-size:.88rem">${esc(u.email)}</div>` : ''}</div>
        <div class="btn-row">
          ${!u ? `<button class="btn btn-sm btn-primary" data-action="invite" data-id="${esc(b.id)}">${icon('link')} ${inv ? 'Ver convite' : 'Convidar'}</button>` : ''}
          ${u && u.status === 'ativo' ? `<button class="btn btn-sm" data-action="resetPass" data-id="${esc(u.id)}">${icon('lock')} ${Cloud.enabled ? 'Enviar redefinição de senha' : 'Nova senha'}</button>` : ''}
          <label class="btn btn-sm" style="cursor:pointer">${icon('camera')} Foto<input type="file" accept="image/*" hidden data-change="barberPhoto" data-id="${esc(b.id)}"></label>
          <button class="btn btn-sm" data-action="toggleBarber" data-id="${esc(b.id)}">${b.active === false ? 'Reativar' : 'Desativar'}</button>
        </div>
        ${showInvite ? `<div class="invite-box">
          <span class="muted">Envie este link para ${esc(b.name)}. Ele faz o cadastro e você aprova aqui.</span>
          <div class="invite-link" id="inv-${esc(b.id)}">${esc(link)}</div>
          <div class="btn-row">
            <button class="btn btn-sm" data-action="copyInvite" data-id="${esc(b.id)}">${icon('copy')} Copiar link</button>
            <a class="btn btn-sm" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(msg)}">${icon('chat')} WhatsApp</a>
            <a class="btn btn-sm" href="mailto:?subject=${encodeURIComponent('Convite: ' + state.company.name)}&body=${encodeURIComponent(msg)}">${icon('mail')} E-mail</a>
            <button class="btn btn-sm btn-danger" data-action="cancelInvite" data-id="${esc(b.id)}">Cancelar convite</button>
          </div></div>` : ''}
      </li>`;
    }).join('');

    return `${pendingHtml}
      <section class="section card">
        <h2 class="section-title">Adicionar barbeiro</h2>
        ${billing() && billing().max_barbers ? `<p class="section-note">Seu plano: <b class="num">${activeBarbers()} de ${billing().max_barbers}</b> barbeiros ativos. <a href="#assinatura">Trocar de plano</a></p>` : ''}
        <form class="form" data-form="addBarber" novalidate>
          <div class="grid-2"><label class="field"><span>Nome *</span><input class="input" id="nb-name" name="name" required></label>
          <label class="field"><span>Foto</span><input class="input" id="nb-photo" name="photo" type="file" accept="image/*"></label></div>
          <p class="form-msg" data-msg></p>
          <div><button class="btn btn-primary" type="submit">${icon('plus')} Adicionar</button></div>
        </form>
      </section>
      ${ui.lastReset ? `<div class="card card-glow"><b>Senha provisória de ${esc(ui.lastReset.name)}:</b> <span class="invite-link" style="display:inline-block">${esc(ui.lastReset.pass)}</span><p class="section-note">Passe essa senha para o barbeiro. Ele pode trocá-la em Meu cadastro.</p></div>` : ''}
      <section class="section"><h2 class="section-title">Equipe (${state.barbers.length})</h2>
        ${state.barbers.length ? `<ul class="list">${rows}</ul>` : '<div class="card muted">Ninguém cadastrado ainda.</div>'}</section>`;
  }

  function pageConfig() {
    const w = state.weights;
    const hidden = state.hidden || [];
    const total = INDICATORS.filter(i => !hidden.includes(i.key)).reduce((a, i) => a + Number(w[i.key] ?? i.weight), 0);
    return `
      <section class="section card">
        <h2 class="section-title">Indicadores e pesos</h2>
        <p class="section-note">O peso define quanto cada indicador vale na pontuação geral. Desmarque "Ativo" para ocultar um indicador do app inteiro; os dados dele ficam guardados para quando você reativar. Soma dos ativos: <b class="num">${total} pts</b>.</p>
        <form class="form" data-form="weights" novalidate>
          <div class="grid-2">${INDICATORS.map(i => { const off = hidden.includes(i.key); return `<div class="field ind-cfg ${off ? 'is-off' : ''}"><label for="w-${i.key}">${esc(i.label)}${off ? ' <span class="chip chip-soft">oculto</span>' : ''}</label>
            <div class="ind-row"><input class="input num" id="w-${i.key}" name="${i.key}" type="number" min="0" max="100" step="1" value="${w[i.key] ?? i.weight}">
            <label class="ind-on"><input type="checkbox" id="on-${i.key}" name="on-${i.key}" ${off ? '' : 'checked'}> Ativo</label></div></div>`; }).join('')}</div>
          <p class="form-msg" data-msg></p>
          <div class="btn-row"><button class="btn btn-primary" type="submit">${icon('check')} Salvar indicadores</button>
          <button class="btn" type="button" data-action="defaultWeights">Voltar aos pesos padrão</button></div>
        </form>
      </section>
      <section class="section card">
        <h2 class="section-title">Metas mensais da equipe</h2>
        <p class="section-note">Valem para todos os barbeiros. Para ajustar a meta de alguém, abra o barbeiro em Time e ranking, em "Metas individuais". Percentuais em %, valores em R$.</p>
        <form class="form" data-form="goals" novalidate>
          <div class="grid-2">${GB.visibleInds(state).map(i => `<label class="field"><span>${esc(i.label)}</span><input class="input num" id="gt-${i.key}" name="${i.key}" type="number" min="0" step="any" value="${GB.goalFor(state, '', i.key)}"></label>`).join('')}</div>
          <p class="form-msg" data-msg></p>
          <div class="btn-row"><button class="btn btn-primary" type="submit">${icon('check')} Salvar metas</button>
          <button class="btn" type="button" data-action="defaultGoals">Voltar às metas padrão</button></div>
        </form>
      </section>
      <section class="section card">
        <h2 class="section-title">${Cloud.enabled ? 'Dados da barbearia' : 'Dados deste aparelho'}</h2>
        <p class="section-note">${Cloud.enabled ? `Os dados ficam salvos na nuvem e valem em todos os aparelhos. ${Cloud.error ? `<b style="color:var(--danger)">Última tentativa de salvar falhou: ${esc(Cloud.error)}</b>` : 'Tudo sincronizado.'}` : 'Nesta versão os dados ficam salvos neste navegador. Quando o app for ligado a um servidor, eles passam a valer em todos os aparelhos.'}</p>
        <div class="btn-row">
          ${Cloud.enabled ? '' : `<button class="btn ${ui.confirm === 'demo' ? 'btn-danger' : ''}" data-action="resetDemo">${ui.confirm === 'demo' ? 'Confirmar: apagar e restaurar demonstração' : 'Restaurar dados de demonstração'}</button>`}
          <button class="btn btn-danger" data-action="clearData">${ui.confirm === 'clear' ? 'Confirmar: apagar equipe e lançamentos' : 'Apagar equipe e lançamentos'}</button>
        </div>
      </section>`;
  }

  function pageIntegracao() {
    if (billing() && !billing().api) {
      return `<section class="section card empty">${icon('plug')}<h2>Integração com o seu sistema</h2>
        <p>Nos planos pagos, a agenda ou o caixa que você já usa envia os resultados direto para o Gestão Barber IA, sem digitar nada. No teste grátis, os resultados são lançados à mão em Lançamentos.</p>
        <div class="btn-row" style="justify-content:center"><a class="btn btn-primary" href="#assinatura">${icon('card')} Ver planos</a><a class="btn" href="#lancamentos">Lançar à mão</a></div></section>`;
    }
    const ex = JSON.stringify([
      { data: iso(new Date()), barbeiro: state.barbers[0]?.name || 'Nome do barbeiro', faturamento: 420.5, servicos: 9, clientes: 8, checklist_pop: 1, horas_disponiveis: 8, horas_ocupadas: 6.5, planos_mensais: 1, clientes_retorno: 5, venda_produtos: 60 },
    ], null, 2);
    return `
      <section class="section card">
        <h2 class="section-title">Como funciona</h2>
        <p class="section-note">Outro sistema (agenda, caixa, ERP) envia os resultados de cada barbeiro por dia. Os números entram no ranking na hora, junto com os lançados à mão.</p>
        <div class="field"><span>Chave da API</span><div class="invite-link" id="api-key">${esc(state.apiKey)}</div></div>
        <div class="btn-row"><button class="btn btn-sm" data-action="copyKey">${icon('copy')} Copiar chave</button>
        <button class="btn btn-sm ${ui.confirm === 'key' ? 'btn-danger' : ''}" data-action="newKey">${ui.confirm === 'key' ? 'Confirmar: a chave antiga para de funcionar' : 'Gerar nova chave'}</button></div>
        <pre class="code">POST ${esc(Cloud.enabled ? Cloud.apiUrl : '/api/v1/lancamentos')}
Authorization: Bearer ${esc(state.apiKey)}
Content-Type: application/json</pre>
        <p class="section-note">Campos aceitos: <code>data</code> (AAAA-MM-DD), <code>barbeiro</code> (nome) ou <code>barbeiro_id</code>, ${FIELDS.map(f => `<code>${f.api}</code>`).join(', ')}. Campos ausentes ficam em branco. Enviar a mesma data e barbeiro de novo substitui os números.</p>
        <p class="section-note">${Cloud.enabled ? 'O endereço acima funciona depois que a função <code>lancamentos</code> for publicada no Supabase (veja o guia em <code>supabase/LEIAME.md</code>). Abaixo dá para importar os dados colando o JSON.' : '<b>Atenção:</b> o endereço acima passa a receber dados quando o app for publicado com servidor. Até lá, teste o formato colando os dados abaixo.'}</p>
      </section>
      <section class="section card">
        <h2 class="section-title">Testar importação</h2>
        <form class="form" data-form="import" novalidate>
          <label class="field"><span>Dados em JSON</span><textarea class="input" id="imp-json" name="json" spellcheck="false">${esc(ex)}</textarea></label>
          <p class="form-msg" data-msg></p>
          <div><button class="btn btn-primary" type="submit">${icon('upload')} Importar lançamentos</button></div>
        </form>
      </section>`;
  }

  function pageEmpresa() {
    const c = state.company;
    return `<section class="section card">
      <h2 class="section-title">Dados da barbearia</h2>
      <div class="perf-head">${companyAvatar(72)}<label class="btn btn-sm" style="cursor:pointer">${icon('camera')} Trocar logo<input type="file" accept="image/*" hidden data-change="companyLogo"></label></div>
      <form class="form" data-form="company" novalidate>
        <label class="field"><span>Nome *</span><input class="input" id="co-name" name="name" required value="${esc(c.name)}"></label>
        <div class="grid-2">
          <label class="field"><span>CNPJ</span><input class="input" id="co-cnpj" name="cnpj" value="${esc(c.cnpj)}" placeholder="00.000.000/0000-00"></label>
          <label class="field"><span>Telefone</span><input class="input" id="co-phone" name="phone" type="tel" value="${esc(c.phone)}"></label>
        </div>
        <label class="field"><span>E-mail</span><input class="input" id="co-email" name="email" type="email" value="${esc(c.email)}"></label>
        <p class="form-msg" data-msg></p>
        <div><button class="btn btn-primary" type="submit">${icon('check')} Salvar</button></div>
      </form></section>`;
  }

  function pageCadastro(user) {
    const b = user.barberId ? barberById(user.barberId) : null;
    return `<section class="section card">
      <h2 class="section-title">Meu cadastro</h2>
      ${b ? `<div class="perf-head">${avatar(b, 72)}<label class="btn btn-sm" style="cursor:pointer">${icon('camera')} Trocar foto<input type="file" accept="image/*" hidden data-change="myPhoto"></label></div>` : ''}
      <form class="form" data-form="profile" novalidate>
        <label class="field"><span>Nome *</span><input class="input" id="pr-name" name="name" required value="${esc(user.name)}"></label>
        <label class="field"><span>E-mail *</span><input class="input" id="pr-email" name="email" type="email" required value="${esc(user.email)}"></label>
        ${passField('pr-pass', 'pass', 'Nova senha', { required: false, min: 6, hint: 'Deixe em branco para manter a atual.' })}
        ${passField('pr-pass2', 'pass2', 'Confirmar nova senha', { required: false, min: 6 })}
        <p class="form-msg" data-msg></p>
        <div><button class="btn btn-primary" type="submit">${icon('check')} Salvar</button></div>
      </form></section>`;
  }

  function pageAjuda() {
    const R = computeRanking(state, range());
    const w = state.weights;
    return `<section class="section card prose">
      <h2 class="section-title">Como a pontuação funciona</h2>
      <h3>1. Indicadores e pesos</h3>
      <p>Cada indicador vale um peso. Só entram no cálculo os indicadores que têm dados no período.</p>
      <ul>${GB.visibleInds(state).map(i => `<li>${esc(i.label)}: <b>${w[i.key] ?? i.weight} pts</b></li>`).join('')}</ul>
      <h3>2. Nota de cada indicador</h3>
      <p>Quem está em 1º recebe 100 e o último recebe 0. Os outros ficam no meio, proporcional ao resultado.</p>
      <h3>3. Pontuação geral</h3>
      <p>É a média das notas, ponderada pelos pesos.</p>
      <h3>4. Destaque e MVP</h3>
      <p>Neste período a regra considera <b>${R.Nrule}</b> indicadores${R.N >= 2 ? ' com dados' : ' ativos (ainda sem dados suficientes)'}.</p>
      <ul>
        <li><b>Destaque do período:</b> 1º lugar em no mínimo metade dos indicadores (${R.half}).</li>
        <li><b>MVP:</b> 1º lugar em um a mais que a metade (${R.mvpNeed} ou mais).</li>
        <li>O Destaque vira MVP quando conquista mais um 1º lugar. Nunca há Destaque e MVP ao mesmo tempo.</li>
        <li>Empate no 1º lugar conta para todos os empatados. Se duas pessoas chegarem ao critério, leva quem lidera mais indicadores e, depois, quem tem a maior pontuação geral.</li>
        <li>Quando a metade não é número inteiro, arredonda para cima.</li>
      </ul>
      <h3>5. Ordem do ranking</h3>
      <p>Quem tem o título fica em 1º. Os demais seguem pela pontuação geral.</p>
    </section>`;
  }

  // ---------- Fechamento do mês (apresentação para a equipe) ----------
  function pageFechamento() {
    const ym = ui.fxMonth || addMonths(curYm(), new Date().getDate() <= 10 ? -1 : 0);
    ui.fxMonth = ym;
    const R = monthR(ym);
    const top = R.rows.slice(0, 3);
    const total = R.rows.reduce((a, r) => a + r.sums.fat, 0);
    const t = R.title.type ? R.rows.find(r => r.barber.id === R.title.barberId) : null;
    return `<section class="card fc-head">
        <div class="fc-brand">${logo('fc-logo')}<div><h2>Fechamento do mês</h2><p>Cada atendimento conta.</p></div></div>
        <div class="fc-controls">
          <label class="field"><span>Mês do fechamento</span><select class="input" id="fc-month" data-change="fxMonth">${monthOptions(ym)}</select></label>
          <button class="btn btn-primary fc-start" data-action="fxStart" ${R.rows.length && R.active.length ? '' : 'disabled'}>${icon('monitor')} Iniciar fechamento</button>
        </div>
        ${R.rows.length && R.active.length ? '' : '<p class="section-note">Este mês ainda não tem resultados lançados.</p>'}
      </section>
      ${R.rows.length && R.active.length ? `<section class="section card">
        <h2 class="section-title">Resumo de ${esc(ymLabel(ym).replace(' de ', '/'))}</h2>
        <div class="perf-stats">
          <div class="stat"><span>Faturamento da equipe</span><b class="num">${money0(total)}</b></div>
          <div class="stat"><span>Barbeiros</span><b class="num">${R.rows.length}</b></div>
          <div class="stat"><span>Indicadores</span><b class="num">${R.N}</b></div>
          <div class="stat"><span>Título</span><b>${t ? (R.title.type === 'mvp' ? 'MVP' : 'Destaque') + ' · ' + esc(first(t.barber.name)) : 'Nenhum'}</b></div>
        </div>
        <ol class="fc-top">${top.map(r => `<li>${avatar(r.barber, 40)}<span><b>${ord(r.pos)} ${esc(r.barber.name)}</b><small class="muted num">${score(r.overall)} pts · ${r.leads.length}/${R.N} lideradas</small></span></li>`).join('')}</ol>
        <p class="section-note">A apresentação mostra cada barbeiro do último ao 4º colocado, depois revela o pódio com suspense. Use em tela cheia na TV da loja.</p>
      </section>` : ''}`;
  }

  function fxPhoto(b) {
    const ini = (b.name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0]).join('').toUpperCase();
    return `<div class="fx-photo"><span>${b.photo ? `<img src="${esc(b.photo)}" alt="">` : esc(ini)}</span></div>`;
  }
  function fxSlides(ym) {
    const R = monthR(ym);
    const rows = R.rows, s = [{ k: 'intro' }];
    for (let i = rows.length - 1; i >= 3; i--) s.push({ k: 'card', row: rows[i] });
    s.push({ k: 'podium' });
    for (const p of [3, 2, 1]) if (rows[p - 1]) s.push({ k: 'card', row: rows[p - 1], place: p });
    s.push({ k: 'final' });
    return { R, s };
  }
  const fxDots = n => Array.from({ length: n }, (_, i) => `<i class="fx-dot" style="left:${(i * 37.7) % 100}%;top:${(i * 61.3) % 100}%;--d:${(i % 7) * 0.9}s;--s:${2 + (i % 4)}px"></i>`).join('');
  const fxConfetti = n => Array.from({ length: n }, (_, i) => `<i class="fx-cf" style="left:${(i * 47.3) % 100}%;--d:${((i * 0.37) % 2.6).toFixed(2)}s;--r:${(i * 53) % 360}deg;--c:${['#d6b46a', '#6cc8ff', '#ffffff', '#f4a95c', '#9b8cff'][i % 5]};--x:${((i % 9) - 4) * 14}px"></i>`).join('');

  function fxTier(R, row, place) {
    if (place === 3) return { cls: 'fx-bronze', label: 'Bronze' };
    if (place === 2) return { cls: 'fx-silver', label: 'Prata' };
    if (place === 1) {
      if (R.title.barberId === row.barber.id && R.title.type === 'mvp') return { cls: 'fx-mvp', label: 'MVP' };
      if (R.title.barberId === row.barber.id) return { cls: 'fx-gold', label: 'Destaque' };
      return { cls: 'fx-gold', label: 'Ouro' };
    }
    return { cls: 'fx-plain', label: ord(row.pos) };
  }

  function fxSlideHtml(R, sl, ym) {
    const n = R.rows.length, month = esc(ymLabel(ym).replace(' de ', '/'));
    if (sl.k === 'intro') return `<div class="fx-slide fx-intro">
        <div class="fx-emblem"><span class="fx-orbit"></span><span class="fx-orbit o2"></span>${logo('fx-logo')}</div>
        <p class="fx-kicker">${esc(state.company.name)}</p>
        <h1 class="fx-title">Fechamento</h1>
        <p class="fx-month">${month}</p>
        <p class="fx-tag">Cada atendimento conta.</p>
        <p class="fx-count"><b data-count="${n}">0</b> barbeiros</p>
        <p class="fx-hint">Toque, deslize ou use as setas</p></div>`;
    if (sl.k === 'podium') {
      const t1 = fxTier(R, R.rows[0], 1);
      return `<div class="fx-slide fx-pintro">
        <h1 class="fx-title gold">É hora do pódio</h1>
        <p class="fx-month">Os três melhores de ${month}</p>
        <div class="fx-chips"><span class="c-bronze">Bronze</span><span class="c-silver">Prata</span><span class="${t1.cls === 'fx-mvp' ? 'c-mvp' : 'c-gold'}">${t1.label}</span></div>
        <div class="fx-spot"></div><div class="fx-spot s2"></div><div class="fx-spot s3"></div></div>`;
    }
    if (sl.k === 'final') {
      const top = R.rows.slice(0, 3);
      return `<div class="fx-slide fx-final">
        <h1 class="fx-title gold">Parabéns ao pódio</h1>
        <div class="fx-fgrid">${top.map((r, i) => { const t = fxTier(R, r, i + 1); return `<div class="fx-fcard ${t.cls}" style="--d:${0.4 + i * 0.25}s">
          ${fxPhoto(r.barber)}<b class="num">${ord(i + 1)}</b><span>${esc(r.barber.name)}</span><strong class="num">${t.label === 'MVP' || t.label === 'Destaque' ? `${r.leads.length}/${R.N}` : score(r.overall)}</strong><small>${t.label}</small></div>`; }).join('')}</div>
        <p class="fx-tag gold">Cada atendimento conta.</p>
        <p class="fx-thanks">Obrigado a cada um que fez este mês acontecer.</p>
        <p class="fx-kicker">${esc(state.company.name)} · Gestão Barber IA</p>
        <div class="fx-confetti">${fxConfetti(70)}</div></div>`;
    }
    const r = sl.row, place = sl.place, tier = fxTier(R, r, place);
    const titled = place === 1 && R.title.barberId === r.barber.id;
    const crown = place === 1 ? `<div class="fx-crown">${crownSvg(tier.cls === 'fx-mvp' ? 'tier-mvp' : 'tier-gold')}</div>` : place ? `<div class="fx-gem">${icon('diamond')}</div>` : '';
    const leads = `<div class="fx-leads ${titled ? 'big' : ''}"><b class="num"><span data-count="${r.leads.length}">0</span><i>/</i>${R.N}</b><small>Categorias lideradas</small><div class="fx-bar"><i style="--w:${R.N ? (r.leads.length / R.N) * 100 : 0}%"></i></div></div>`;
    const scoreBlock = `<div class="fx-score ${titled ? 'small' : ''}"><small>Pontuação</small><b class="num" data-count="${r.overall.toFixed(1)}" data-dec="1">0</b></div>`;
    return `<div class="fx-slide fx-cardwrap ${place ? 'is-suspense' : ''}" data-place="${place || ''}">
      <article class="fx-card ${tier.cls}">
        <div class="fx-card-in">
          ${crown}
          ${fxPhoto(r.barber)}
          <span class="fx-badge">${tier.label}</span>
          <h2 class="fx-name">${esc(r.barber.name)}</h2>
          <p class="fx-role">${esc(r.barber.role || 'Barbeiro')}</p>
          <span class="fx-pos num">${place ? `${ord(place)} lugar` : `${ord(r.pos)} de ${n}`}</span>
          ${titled ? leads + scoreBlock : scoreBlock + leads}
          <div class="fx-inds">${R.active.map((ind, k) => `<div class="fx-ind ${ind.leaders.includes(r.barber.id) ? 'lead' : ''}" style="--d:${0.5 + k * 0.09}s">
            <small>${esc(ind.label)}</small><b class="num">${fmt(ind, r.values[ind.key])}${ind.key === 'check' ? ' pts' : ''}</b><span class="num">${ord(r.ranks[ind.key])} de ${n}</span><div class="fx-bar"><i style="--w:${Math.max(3, r.scores[ind.key])}%"></i></div></div>`).join('')}</div>
        </div>
        ${place ? `<div class="fx-suspense"><p>E o pódio é de…</p><span class="fx-drum"><i></i><i></i><i></i></span></div>` : ''}
        ${place === 1 ? `<div class="fx-confetti">${fxConfetti(80)}</div>` : ''}
      </article></div>`;
  }

  function fxCount(scope) {
    scope.querySelectorAll('[data-count]').forEach(el => {
      const target = Number(el.dataset.count), dec = Number(el.dataset.dec || 0);
      const f = dec ? nf1 : nf0;
      if (matchMedia('(prefers-reduced-motion: reduce)').matches) { el.textContent = f.format(target); return; }
      const t0 = performance.now(), dur = 1500;
      const step = now => {
        const p = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - p, 3);
        el.textContent = f.format(target * e);
        if (p < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
  }

  function fxRender() {
    const fx = ui.fx; if (!fx) return;
    let ov = document.getElementById('fx');
    if (!ov) {
      ov = document.createElement('div');
      ov.id = 'fx'; ov.className = 'fx'; ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-label', 'Apresentação do fechamento do mês');
      ov.innerHTML = `<div class="fx-bg">${fxDots(34)}</div><div class="fx-stage" aria-live="polite"></div><nav class="fx-ctrl"></nav>`;
      document.body.appendChild(ov);
      fxBind(ov);
    }
    const { R, s } = fxSlides(fx.ym);
    fx.total = s.length;
    fx.i = Math.max(0, Math.min(fx.i, s.length - 1));
    const sl = s[fx.i];
    const stage = ov.querySelector('.fx-stage');
    stage.innerHTML = fxSlideHtml(R, sl, fx.ym);
    ov.dataset.kind = sl.k + (sl.place ? '-' + sl.place : '');
    ov.querySelector('.fx-ctrl').innerHTML = `
      <button class="fx-btn" data-fx="prev" aria-label="Anterior" ${fx.i === 0 ? 'disabled' : ''}>${icon('left')}</button>
      <span class="fx-pages">${s.map((_, k) => `<i class="${k === fx.i ? 'on' : k < fx.i ? 'done' : ''}"></i>`).join('')}</span>
      <button class="fx-btn" data-fx="next" aria-label="Próximo" ${fx.i === s.length - 1 ? 'disabled' : ''}>${icon('right')}</button>
      <button class="fx-btn sm" data-fx="full" aria-label="Tela cheia">${icon('expand')}</button>
      <button class="fx-btn sm" data-fx="close" aria-label="Fechar apresentação">${icon('x')}</button>`;
    clearTimeout(fx.timer);
    const slide = stage.firstElementChild;
    if (slide.classList.contains('is-suspense')) {
      Sound.play('rufar');
      fx.timer = setTimeout(() => fxReveal(slide, sl.place), 2800);
    } else {
      fxCount(slide);
      if (sl.k === 'podium') Sound.play('sino');
      if (sl.k === 'final') Sound.play('aplausos');
    }
  }
  function fxReveal(slide, place) {
    if (!slide || !slide.classList.contains('is-suspense')) return;
    slide.classList.remove('is-suspense'); slide.classList.add('is-revealed');
    Sound.play(place === 1 ? 'fanfarra' : 'moeda');
    if (place === 1) setTimeout(() => Sound.play('aplausos'), 900);
    fxCount(slide);
  }
  function fxGo(d) {
    const fx = ui.fx; if (!fx) return;
    const slide = document.querySelector('#fx .fx-slide');
    if (d > 0 && slide && slide.classList.contains('is-suspense')) { clearTimeout(fx.timer); fxReveal(slide, Number(slide.dataset.place)); return; }
    const ni = fx.i + d;
    if (ni < 0 || ni >= fx.total) return;
    fx.i = ni; fx.dir = d; fxRender();
  }
  function fxClose() {
    const ov = document.getElementById('fx');
    if (ui.fx) clearTimeout(ui.fx.timer);
    ui.fx = null;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    if (ov) { ov.classList.add('fx-out'); setTimeout(() => ov.remove(), 350); }
  }
  function fxBind(ov) {
    ov.addEventListener('click', e => {
      const b = e.target.closest('[data-fx]');
      if (b) {
        e.stopPropagation();
        const a = b.dataset.fx;
        if (a === 'prev') fxGo(-1); else if (a === 'next') fxGo(1); else if (a === 'close') fxClose();
        else if (a === 'full') { const d = document.documentElement; if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); else if (d.requestFullscreen) d.requestFullscreen().catch(() => toast('Este aparelho não permite tela cheia.')); else toast('Este aparelho não permite tela cheia.'); }
        return;
      }
      if (e.target.closest('.fx-card-in') && e.target.closest('.fx-inds')) return; // deixa rolar os indicadores
      if (ui.fx?.moved) return;
      fxGo(e.clientX < window.innerWidth * 0.3 ? -1 : 1);
    });
    let x0 = null, y0 = null;
    ov.addEventListener('touchstart', e => { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; if (ui.fx) ui.fx.moved = false; }, { passive: true });
    ov.addEventListener('touchend', e => {
      if (x0 === null) return;
      const dx = e.changedTouches[0].clientX - x0, dy = e.changedTouches[0].clientY - y0;
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) { if (ui.fx) ui.fx.moved = true; fxGo(dx < 0 ? 1 : -1); setTimeout(() => { if (ui.fx) ui.fx.moved = false; }, 350); }
      else if (Math.abs(dy) > 10 && ui.fx) { ui.fx.moved = true; setTimeout(() => { if (ui.fx) ui.fx.moved = false; }, 350); }
      x0 = null;
    }, { passive: true });
  }
  document.addEventListener('keydown', e => {
    if (!ui.fx) return;
    if (['ArrowRight', 'PageDown', ' ', 'Enter'].includes(e.key)) { e.preventDefault(); fxGo(1); }
    else if (['ArrowLeft', 'PageUp'].includes(e.key)) { e.preventDefault(); fxGo(-1); }
    else if (e.key === 'Escape') fxClose();
  });

  // ---------- Assinatura (SaaS) ----------
  const STATUS_TXT = { trial: 'Teste grátis', pending: 'Aguardando pagamento', active: 'Ativa', overdue: 'Pagamento atrasado', canceled: 'Cancelada', courtesy: 'Cortesia', blocked: 'Bloqueada' };
  const priceTxt = p => 'R$ ' + nf2.format(p.price_cents / 100);
  const fmtDate = d => d ? new Date(String(d).length <= 10 ? d + 'T12:00:00' : d).toLocaleDateString('pt-BR') : '—';
  const daysLeft = d => Math.max(0, Math.ceil((new Date(d).getTime() - Date.now()) / 86400000));
  const billing = () => (Cloud.enabled && state.billing) || null;
  const activeBarbers = () => state.barbers.filter(b => b.active !== false).length;
  const planById = id => (state.plans || Cloud.plans || []).find(p => p.id === id);

  function trialBanner(user) {
    const b = billing();
    if (!b || !isGestor(user) || location.hash === '#assinatura') return '';
    if (b.access === 'trial') {
      const d = daysLeft(b.trial_ends_at);
      const txt = b.status === 'pending' ? `Assinatura feita. A 1ª cobrança vence em ${fmtDate(b.trial_ends_at)}.` : `Teste grátis: ${d === 0 ? 'termina hoje' : `faltam ${d} dia${d > 1 ? 's' : ''}`}.`;
      return `<div class="sub-banner ${d <= 2 ? 'warn' : ''}">${icon('clock')}<span>${txt}</span><a class="btn btn-sm btn-primary" href="#assinatura">${b.status === 'pending' ? 'Ver assinatura' : 'Assinar agora'}</a></div>`;
    }
    if (b.access === 'paid' && b.status === 'canceled') {
      return `<div class="sub-banner warn">${icon('clock')}<span>Assinatura cancelada. O acesso vai até ${fmtDate(b.paid_until)}.</span><a class="btn btn-sm btn-primary" href="#assinatura">Reativar</a></div>`;
    }
    return '';
  }

  function plansGrid(plans, current, mode) {
    const n = activeBarbers();
    return `<div class="plan-grid">${plans.map(p => {
      const fits = p.max_barbers === null || n <= p.max_barbers;
      const isCur = p.id === current;
      return `<label class="plan ${isCur ? 'is-cur' : ''} ${fits ? '' : 'is-off'}">
        <input type="radio" name="plan_id" value="${esc(p.id)}" ${isCur || (!current && p.sort === 2 && fits) ? 'checked' : ''} ${fits ? '' : 'disabled'}>
        <span class="plan-name">${esc(p.name)}${isCur ? ' <span class="chip chip-ok">atual</span>' : ''}</span>
        <span class="plan-price"><b class="num">${priceTxt(p)}</b>/mês</span>
        <span class="plan-lim">${p.max_barbers === null ? 'Barbeiros ilimitados' : `Até ${p.max_barbers} barbeiros`}</span>
        <ul class="plan-feat"><li>Ranking, pódio e tela da loja</li><li>Fechamento do mês animado</li><li>${p.api ? 'Integração por API com seu sistema' : 'Lançamento manual'}</li></ul>
        ${fits ? '' : `<small class="plan-why">Você tem ${n} barbeiros ativos.</small>`}
      </label>`;
    }).join('')}</div>`;
  }

  function subscribeForm(b, plans, compact) {
    return `<form class="form" data-form="subscribe" novalidate>
      ${plansGrid(plans, null, 'new')}
      <div class="grid-2">
        <label class="field"><span>CPF ou CNPJ de quem paga *</span><input class="input" id="sb-doc" name="cpf_cnpj" inputmode="numeric" autocomplete="off" value="${esc(b.cpf_cnpj || '')}" placeholder="Somente números"></label>
        <label class="field"><span>Nome ou razão social *</span><input class="input" id="sb-name" name="name" value="${esc(state.company.name || '')}"></label>
      </div>
      <label class="field"><span>WhatsApp para avisos de cobrança</span><input class="input" id="sb-phone" name="phone" type="tel" value="${esc(state.company.phone || '')}" placeholder="(00) 00000-0000"></label>
      <p class="section-note">Pagamento mensal por PIX, boleto ou cartão. ${b.access === 'trial' && b.status === 'trial' ? `A 1ª cobrança vence em ${fmtDate(b.trial_ends_at)}, no fim do teste grátis.` : 'A 1ª cobrança vence hoje.'} Você pode trocar de plano ou cancelar quando quiser.</p>
      <p class="form-msg" data-msg></p>
      <button class="btn btn-primary btn-block" type="submit">${icon('check')} Assinar</button>
    </form>`;
  }

  function pageAssinatura() {
    const b = billing();
    if (!b) return `<div class="card muted">A assinatura aparece quando o app está ligado à nuvem.</div>`;
    const plans = state.plans || [];
    const cur = planById(b.plan_id);
    const statusChip = `<span class="chip ${b.access === 'blocked' ? 'chip-bad' : b.access === 'trial' || b.status === 'canceled' ? 'chip-warn' : 'chip-ok'}">${STATUS_TXT[b.status] || b.status}</span>`;
    let summary = '';
    if (b.status === 'courtesy') summary = `Acesso cortesia${b.paid_until ? ` até ${fmtDate(b.paid_until)}` : ''}.`;
    else if (b.access === 'trial' && b.status === 'trial') summary = `Teste grátis até ${fmtDate(b.trial_ends_at)} (${daysLeft(b.trial_ends_at)} dia(s)). No teste, os resultados são lançados à mão; a integração por API faz parte dos planos pagos.`;
    else if (b.status === 'pending') summary = `Plano ${esc(cur ? cur.name : '')} escolhido. A 1ª cobrança vence em ${fmtDate(b.access === 'trial' ? b.trial_ends_at : new Date())}.`;
    else if (b.status === 'active') summary = `Plano ${esc(cur ? cur.name : '')}, pago até ${fmtDate(b.paid_until)}. A próxima cobrança chega por e-mail${state.company.phone ? ' e WhatsApp' : ''}.`;
    else if (b.status === 'canceled') summary = `Assinatura cancelada. O acesso continua até ${fmtDate(b.paid_until)}.`;
    const usage = cur && cur.max_barbers !== null ? `<p class="section-note">Barbeiros ativos: <b class="num">${activeBarbers()} de ${cur.max_barbers}</b>.</p>` : '';
    const canNew = !b.has_subscription || ['canceled', 'blocked', 'trial'].includes(b.status) && !b.has_subscription;
    return `
      <section class="section card">
        <div class="sub-head"><h2 class="section-title">Sua assinatura</h2>${statusChip}</div>
        <p>${summary}</p>${usage}
        ${b.invoice_url && b.status !== 'active' && b.status !== 'courtesy' ? `<a class="btn btn-primary" href="${esc(b.invoice_url)}" target="_blank" rel="noopener">${icon('wallet')} Pagar fatura</a>` : ''}
        ${b.has_subscription ? `<button class="btn btn-sm" data-action="subInvoice">${icon('wallet')} Ver fatura em aberto</button>` : ''}
      </section>
      ${b.status === 'courtesy' ? '' : canNew ? `<section class="section card"><h2 class="section-title">Escolha seu plano</h2>${subscribeForm(b, plans)}</section>` : `
      <section class="section card">
        <h2 class="section-title">Trocar de plano</h2>
        <form class="form" data-form="changePlan" novalidate>${plansGrid(plans, b.plan_id, 'change')}
          <p class="section-note">O novo valor vale a partir da próxima cobrança.</p>
          <p class="form-msg" data-msg></p>
          <button class="btn btn-primary" type="submit">${icon('check')} Trocar plano</button>
        </form>
      </section>
      <section class="section card">
        <h2 class="section-title">Cancelar assinatura</h2>
        <p class="section-note">As próximas cobranças param. ${b.paid_until ? `O acesso continua até ${fmtDate(b.paid_until)}; depois o app fica bloqueado.` : 'O app fica bloqueado.'} Seus dados continuam guardados se você voltar.</p>
        <button class="btn ${ui.confirm === 'cancelSub' ? 'btn-danger' : ''}" data-action="subCancel">${ui.confirm === 'cancelSub' ? 'Confirmar cancelamento' : 'Cancelar assinatura'}</button>
      </section>`}
      <p class="section-note"><a href="termos.html" target="_blank" rel="noopener">Termos de uso</a> · <a href="privacidade.html" target="_blank" rel="noopener">Política de privacidade</a></p>`;
  }

  // Tela de bloqueio (assinatura vencida ou teste encerrado).
  function blockedScreen() {
    const info = ui.blockInfo || {};
    const b = info.billing || {};
    if (info.role !== 'gestor') {
      return `<div class="empty" style="padding:10px 0">${icon('lock')}<h2>Acesso suspenso</h2>
        <p>O acesso de ${esc(info.company?.name || 'sua barbearia')} ao Gestão Barber IA está suspenso. Fale com o gestor da barbearia.</p>
        <button class="btn" data-action="logout">Sair</button></div>`;
    }
    const title = b.status === 'trial' || b.status === 'pending' && !b.paid_until ? 'Seu teste grátis terminou' : b.status === 'overdue' ? 'Pagamento em atraso' : 'Assinatura inativa';
    const why = b.status === 'overdue' ? 'A última cobrança não foi paga. Pague a fatura para liberar o app na hora.' : b.status === 'pending' ? 'Falta pagar a 1ª cobrança para liberar o app.' : 'Escolha um plano para continuar usando. Seus dados estão guardados.';
    state.company = { ...state.company, ...(info.company || {}) };
    state.plans = info.plans || [];
    const canNew = !b.has_subscription || ['trial', 'canceled', 'blocked'].includes(b.status) && !b.has_subscription;
    return `<div class="block-pay">
      <div class="empty" style="padding:0">${icon('lock')}<h2>${title}</h2><p>${why}</p></div>
      ${b.invoice_url ? `<a class="btn btn-primary btn-block" href="${esc(b.invoice_url)}" target="_blank" rel="noopener">${icon('wallet')} Pagar fatura</a>` : ''}
      ${canNew ? subscribeForm({ ...b, access: 'blocked' }, info.plans || []) : ''}
      <div class="btn-row" style="justify-content:center"><button class="btn btn-sm" data-action="recheckAccess">${icon('check')} Já paguei, atualizar</button>
      <button class="btn btn-sm" data-action="logout">Sair</button></div>
      <p class="section-note" style="text-align:center">Depois do pagamento, o app libera sozinho em alguns minutos. PIX e cartão liberam mais rápido que boleto.</p>
    </div>`;
  }

  // ---------- Painel do dono do SaaS ----------
  function pageAdmin() {
    const b = billing();
    if (!b || !b.admin) return `<div class="card muted">Área restrita.</div>`;
    if (!ui.adminData) {
      ui.adminData = 'loading';
      Promise.all([Cloud.admin.list(), Cloud.admin.plans()]).then(([list, plans]) => { ui.adminData = { list, plans }; render(); })
        .catch(e => { ui.adminData = { error: Cloud.message(e) }; render(); });
    }
    if (ui.adminData === 'loading') return `<div class="card muted">Carregando barbearias…</div>`;
    if (ui.adminData.error) return `<div class="card">${esc(ui.adminData.error)} <button class="btn btn-sm" data-action="adminReload">Tentar de novo</button></div>`;
    const { list, plans } = ui.adminData;
    const pmap = Object.fromEntries(plans.map(p => [p.id, p]));
    const paying = list.filter(c => c.status !== 'courtesy' && c.access === 'paid' && ['active', 'canceled'].includes(c.sub_status));
    const mrr = paying.filter(c => c.sub_status === 'active').reduce((a, c) => a + (pmap[c.plan_id]?.price_cents || 0), 0) / 100;
    const f = ui.adminFilter || 'todas';
    const groups = { todas: () => true, teste: c => c.access === 'trial', pagantes: c => c.access === 'paid' && c.sub_status !== 'courtesy', bloqueadas: c => c.access === 'blocked', cortesia: c => c.sub_status === 'courtesy' };
    const rows = list.filter(groups[f]);
    const kpi = (l, v) => `<div class="stat"><span>${l}</span><b class="num">${v}</b></div>`;
    return `
      <section class="section card">
        <h2 class="section-title">Resumo do SaaS</h2>
        <div class="perf-stats">
          ${kpi('Barbearias', list.length)}${kpi('Em teste', list.filter(groups.teste).length)}${kpi('Pagantes', paying.length)}
          ${kpi('Bloqueadas', list.filter(groups.bloqueadas).length)}${kpi('Receita mensal', 'R$ ' + nf2.format(mrr))}
        </div>
      </section>
      <section class="section">
        <div class="btn-row">${Object.keys(groups).map(k => `<button class="btn btn-sm ${k === f ? 'btn-primary' : ''}" data-action="adminFilter" data-f="${k}">${k[0].toUpperCase() + k.slice(1)}</button>`).join('')}
          <button class="btn btn-sm" data-action="adminReload">${icon('check')} Atualizar</button></div>
        <ul class="list">${rows.map(c => `<li class="list-row adm-row">
          <div class="grow"><b>${esc(c.name)}</b><span class="muted">${esc(c.owner || '')} · ${esc(c.email || '')}${c.phone ? ' · ' + esc(c.phone) : ''}</span>
            <div class="adm-meta"><span class="chip ${c.access === 'blocked' ? 'chip-bad' : c.access === 'trial' ? 'chip-warn' : 'chip-ok'}">${STATUS_TXT[c.sub_status] || c.sub_status}</span>
            <span class="muted">${c.plan_id ? esc(pmap[c.plan_id]?.name || c.plan_id) : 'sem plano'} · ${c.barbers} barbeiros · ${c.users} acessos</span>
            <span class="muted">${c.access === 'trial' ? 'teste até ' + fmtDate(c.trial_ends_at) : c.paid_until ? 'pago até ' + fmtDate(c.paid_until) : ''} · cadastro ${fmtDate(c.created_at)}${c.last_activity ? ' · último lançamento ' + fmtDate(c.last_activity) : ''}</span></div></div>
          <div class="btn-row">
            <button class="btn btn-sm" data-action="adminTrial" data-id="${esc(c.id)}">+7 dias de teste</button>
            <button class="btn btn-sm" data-action="adminCourtesy" data-id="${esc(c.id)}">Cortesia 30 dias</button>
            ${c.access === 'blocked' ? '' : `<button class="btn btn-sm btn-danger" data-action="adminBlock" data-id="${esc(c.id)}">${ui.confirm === 'blk' + c.id ? 'Confirmar bloqueio' : 'Bloquear'}</button>`}
          </div></li>`).join('') || '<li class="card muted">Nenhuma barbearia neste filtro.</li>'}</ul>
      </section>
      <section class="section card">
        <h2 class="section-title">Planos e preços</h2>
        <p class="section-note">Novos preços valem para novas assinaturas. Assinaturas já feitas mantêm o valor até a barbearia trocar de plano.</p>
        <form class="form" data-form="adminPlans" novalidate>
          ${plans.map(p => `<div class="grid-2 adm-plan">
            <label class="field"><span>${esc(p.name)}: preço mensal (R$)</span><input class="input num" name="price_${esc(p.id)}" id="pp-${esc(p.id)}" type="number" min="0" step="0.01" value="${(p.price_cents / 100).toFixed(2)}"></label>
            <label class="field"><span>Máximo de barbeiros (vazio = ilimitado)</span><input class="input num" name="max_${esc(p.id)}" id="pm-${esc(p.id)}" type="number" min="1" step="1" value="${p.max_barbers ?? ''}"></label>
          </div>`).join('')}
          <p class="form-msg" data-msg></p>
          <button class="btn btn-primary" type="submit">${icon('check')} Salvar planos</button>
        </form>
      </section>`;
  }

  function pageSoon(route) {
    const item = NAV.flatMap(g => g.items).find(i => i.r === route);
    return `<div class="card empty">${icon(item?.i || 'clock')}<h2>${esc(item?.t || 'Em breve')}</h2>
      <p>${esc(SOON_TEXT[route] || '')}</p><span class="chip chip-soft">Chega numa próxima etapa</span>
      <a class="btn" href="#inicio">Voltar ao início</a></div>`;
  }

  const PAGES = {
    inicio: { t: 'Início', r: pageInicio },
    'gestao-visual': { t: 'Gestão Visual', r: pageGestaoVisual },
    fechamento: { t: 'Fechamento do mês', r: pageFechamento, g: 1 },
    time: { t: 'Time e ranking', r: pageTime },
    performance: { t: 'Minha performance', r: pagePerformance },
    lancamentos: { t: 'Lançamentos', r: pageLancamentos, g: 1 },
    barbeiros: { t: 'Barbeiros', r: pageBarbeiros, g: 1 },
    configuracoes: { t: 'Configurações', r: pageConfig, g: 1 },
    assinatura: { t: 'Assinatura', r: pageAssinatura, g: 1 },
    admin: { t: 'Painel do SaaS', r: pageAdmin, g: 1 },
    integracao: { t: 'Integração & API', r: pageIntegracao, g: 1 },
    empresa: { t: 'Minha empresa', r: pageEmpresa, g: 1 },
    cadastro: { t: 'Meu cadastro', r: pageCadastro },
    ajuda: { t: 'Central de ajuda', r: pageAjuda },
  };

  // ---------- ranking ao vivo: ultrapassagens ----------
  const LIVE_MS = 15 * 60 * 1000; // "agora" vale por 15 minutos
  const readJSON = (k, d) => { try { return JSON.parse(DB.pref.get(k, '') || 'null') || d; } catch (e) { return d; } };
  const rangeKey = r => r.start + '_' + r.end;

  // Compara com a última posição vista neste aparelho e registra quem subiu e quem desceu.
  function liveDetect(R) {
    const key = rangeKey(R.range);
    const store = readJSON('live', {});
    const recent = readJSON('liveRecent', {});
    const now = Date.now();
    const rec = recent[key] || {};
    for (const id of Object.keys(rec)) if (now - rec[id].at > LIVE_MS) delete rec[id];
    const pos = Object.fromEntries(R.rows.map(r => [r.barber.id, r.pos]));
    const prev = store[key];
    const events = [];
    let anim = null;
    if (prev && R.active.length) {
      const old = prev.pos;
      const changed = R.rows.filter(r => old[r.barber.id] && old[r.barber.id] !== r.pos);
      for (const r of changed) {
        const id = r.barber.id, d = old[id] - r.pos;
        rec[id] = { diff: (rec[id]?.diff || 0) + d, at: now };
        if (rec[id].diff === 0) delete rec[id];
      }
      for (const r of changed.filter(r => old[r.barber.id] > r.pos).sort((a, b) => a.pos - b.pos)) {
        const passed = R.rows.filter(o => old[o.barber.id] && old[o.barber.id] < old[r.barber.id] && o.pos > r.pos).map(o => o.barber);
        if (passed.length) events.push({ up: r.barber, down: passed, pos: r.pos, leader: r.pos === 1 });
      }
      if (changed.length) anim = { old, leaderChanged: prev.leader && prev.leader !== R.rows[0]?.barber.id };
    }
    store[key] = { pos, leader: R.rows[0]?.barber.id, at: now };
    const keys = Object.keys(store).sort((a, b) => store[b].at - store[a].at).slice(0, 8);
    DB.pref.set('live', JSON.stringify(Object.fromEntries(keys.map(k => [k, store[k]]))));
    recent[key] = rec;
    DB.pref.set('liveRecent', JSON.stringify(Object.fromEntries(Object.entries(recent).filter(([k]) => keys.includes(k)))));
    if (anim) ui.liveAnim = anim;
    if (events.length) ui.liveQueue = (ui.liveQueue || []).concat(events);
    return events;
  }
  function liveRecent(R, id) {
    const r = (readJSON('liveRecent', {})[rangeKey(R.range)] || {})[id];
    return r && Date.now() - r.at < LIVE_MS ? r.diff : 0;
  }

  // Depois de desenhar: linhas deslizam da posição antiga e cartões do pódio trocam de lugar.
  function applyLive() {
    const a = ui.liveAnim;
    ui.liveAnim = null;
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (a) {
      document.querySelectorAll('.rank-list').forEach(list => {
        const rows = [...list.querySelectorAll('.rank-row[data-id]')];
        if (rows.length < 2) return;
        const step = rows[1].getBoundingClientRect().top - rows[0].getBoundingClientRect().top;
        rows.forEach(el => {
          const was = a.old[el.dataset.id], now = Number(el.dataset.pos);
          if (!was || was === now) return;
          el.classList.add(was > now ? 'rk-up' : 'rk-down');
          if (!reduce && el.animate) el.animate([{ transform: `translateY(${(was - now) * step}px)` }, { transform: 'none' }], { duration: 1100, easing: 'cubic-bezier(.2,.8,.2,1)' });
          setTimeout(() => el.classList.remove('rk-up', 'rk-down'), 6000);
        });
      });
      document.querySelectorAll('.pd[data-id]').forEach(el => {
        const was = a.old[el.dataset.id], now = Number(el.dataset.pos);
        if (was && was !== now) el.classList.add(was > now ? 'pd-swap-up' : 'pd-swap-down');
        if (now === 1 && a.leaderChanged) el.classList.add('pd-new-leader');
      });
    }
    runLiveQueue();
  }

  function runLiveQueue() {
    if (ui.liveBusy || !(ui.liveQueue || []).length) return;
    const ev = ui.liveQueue.shift();
    ui.liveBusy = true;
    const tv = location.hash === '#apresentacao';
    const others = ev.down.map(b => first(b.name));
    const txt = `${first(ev.up.name)} passou ${others.length > 1 ? others.slice(0, -1).join(', ') + ' e ' + others[others.length - 1] : others[0]}`;
    const el = document.createElement('div');
    el.className = 'ov-banner' + (tv ? ' ov-tv' : '') + (ev.leader ? ' ov-leader' : '');
    el.setAttribute('role', 'status');
    el.innerHTML = `<div class="ov-faces"><span class="ov-up">${avatar(ev.up, tv ? 72 : 48)}<i>${icon('up')}</i></span>
        <span class="ov-arrow">${icon('right')}</span>
        <span class="ov-down">${avatar(ev.down[0], tv ? 60 : 40)}<i>${icon('down')}</i></span></div>
      <div class="ov-text"><small>${ev.leader ? 'Novo líder do ranking' : 'Ultrapassagem'}</small><b>${esc(txt)}</b>
        <span>e subiu para o ${ord(ev.pos)} lugar${ev.down.length === 1 ? `. ${esc(first(ev.down[0].name))} caiu para o ${ord(ev.pos + 1)}.` : '.'}</span></div>`;
    document.body.appendChild(el);
    if (tv) Sound.play(ev.leader ? 'fanfarra' : undefined);
    const hide = () => { el.classList.add('ov-out'); setTimeout(() => { el.remove(); ui.liveBusy = false; runLiveQueue(); }, 450); };
    el.addEventListener('click', hide);
    setTimeout(hide, tv ? 7000 : 5000);
  }

  // ---------- sons (gerados no navegador, sem arquivos) ----------
  const Sound = {
    ctx: null,
    get on() { return DB.pref.get('sound', '1') === '1'; },
    set on(v) { DB.pref.set('sound', v ? '1' : '0'); },
    get kind() { return DB.pref.get('soundKind', 'sino'); },
    set kind(v) { DB.pref.set('soundKind', v); },
    KINDS: { sino: 'Sino', moeda: 'Moeda', fanfarra: 'Fanfarra', aplausos: 'Aplausos' },
    ensure() {
      try {
        if (!this.ctx) { const C = window.AudioContext || window.webkitAudioContext; if (!C) return null; this.ctx = new C(); }
        if (this.ctx.state === 'suspended') this.ctx.resume();
        return this.ctx;
      } catch (e) { return null; }
    },
    tone(c, f, t, dur, type, g) {
      const o = c.createOscillator(), a = c.createGain();
      o.type = type; o.frequency.setValueAtTime(f, t);
      a.gain.setValueAtTime(0.0001, t); a.gain.exponentialRampToValueAtTime(g, t + 0.02); a.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(a).connect(c.destination); o.start(t); o.stop(t + dur + 0.05);
    },
    play(kind = this.kind, force = false) {
      if (!this.on && !force) return;
      const c = this.ensure(); if (!c) return;
      const t = c.currentTime + 0.02;
      if (kind === 'moeda') { this.tone(c, 988, t, 0.1, 'square', 0.08); this.tone(c, 1319, t + 0.09, 0.45, 'square', 0.08); }
      else if (kind === 'fanfarra') { [523, 659, 784, 1047].forEach((f, i) => this.tone(c, f, t + i * 0.13, i === 3 ? 0.9 : 0.3, 'triangle', 0.22)); }
      else if (kind === 'aplausos') {
        const len = c.sampleRate * 1.6, buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0);
        for (let i = 0; i < len; i++) { const clap = (i % 2200) < 500 && Math.random() < 0.6; d[i] = (Math.random() * 2 - 1) * (clap ? 0.9 : 0.15) * (1 - i / len); }
        const src = c.createBufferSource(), fl = c.createBiquadFilter(), g = c.createGain();
        fl.type = 'bandpass'; fl.frequency.value = 1800; g.gain.value = 0.5; src.buffer = buf; src.connect(fl).connect(g).connect(c.destination); src.start(t);
      } else if (kind === 'rufar') {
        // rufar de tambor: batidas cada vez mais rápidas por ~2,6 s
        let tt = t;
        for (let k = 0; k < 40; k++) {
          const len = Math.floor(c.sampleRate * 0.05), buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0);
          for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
          const src = c.createBufferSource(), fl = c.createBiquadFilter(), g = c.createGain();
          fl.type = 'bandpass'; fl.frequency.value = 260; fl.Q.value = 0.8; g.gain.value = 0.25 + (k / 40) * 0.5;
          src.buffer = buf; src.connect(fl).connect(g).connect(c.destination); src.start(tt);
          tt += Math.max(0.035, 0.11 - k * 0.0022);
        }
      } else { this.tone(c, 880, t, 1.4, 'sine', 0.25); this.tone(c, 1760, t, 0.8, 'sine', 0.07); this.tone(c, 1318, t + 0.12, 1.1, 'sine', 0.1); }
    },
  };

  // ---------- tela da loja (modo apresentação) ----------
  const TV_SECONDS = 30;
  const ALERT_LINES = {
    leader: [['Quem lidera dita o ritmo da casa.', 'Hoje é dia de aumentar a vantagem.'], ['Defender o topo dá mais trabalho que chegar nele.', 'Qual detalhe vai fazer o próximo cliente voltar?']],
    chase: [['O pódio está a um bom dia de distância.', 'Qual cliente você vai encantar agora?'], ['Falta pouco. Pouco mesmo.', 'Um atendimento caprichado muda essa conta.']],
    middle: [['Sair do meio é decisão, não sorte.', 'Qual horário vazio você vai preencher hoje?'], ['Quem está acima não vai esperar.', 'Ofereça o plano mensal para quem vem sempre.']],
    low: [['A virada começa no próximo atendimento.', 'Quem você pode chamar agora para lotar a agenda?'], ['Daqui para frente, só dá para subir.', 'Escolha um número e foque nele hoje.']],
  };
  function pickLine(zone, id) {
    const list = ALERT_LINES[zone];
    const day = new Date().getDate();
    return list[(hash(id + day).charCodeAt(0) + day) % list.length];
  }
  function gapText(g) {
    switch (g.kind) {
      case 'fat': return `faturar mais ${money0(g.delta)}`;
      case 'ocup': return `ocupar mais ${nf1.format(g.delta)} pontos percentuais da agenda`;
      case 'check': return `somar mais ${g.delta} ponto(s) no Checklist POP`;
      case 'planos': return `vender mais ${g.delta} plano(s) mensal(is)`;
      case 'serv': return `fazer mais ${g.delta} serviço(s)`;
      default: return '';
    }
  }
  const first = name => esc(name.split(/\s+/)[0]);
  function bestGaps(list) {
    if (!list.length) return [];
    const fat = list.find(g => g.kind === 'fat');
    const other = list.filter(g => g.kind !== 'fat')[0];
    return [fat, other].filter(Boolean).slice(0, 2);
  }

  function tvRanking(R) {
    return `<div class="tv-split">
      <section class="tv-panel"><h2 class="section-title">Pódio do período</h2><div class="tv-stage">${podium(R)}</div></section>
      <section class="tv-panel"><div class="tv-panel-head"><h2 class="section-title">Ranking em tempo real</h2><span class="tv-count">${R.rows.length} posições</span></div>${rankingList(R)}</section>
    </div>`;
  }

  function tvGuardians(R) {
    const cards = R.active.map(ind => {
      const leaders = ind.leaders.map(barberById).filter(Boolean);
      if (!leaders.length) return '';
      const row = R.rows.find(r => r.barber.id === leaders[0].id);
      const names = leaders.length > 1 ? leaders.map(b => first(b.name)).join(' + ') : esc(leaders[0].name);
      return `<div class="gd ${leaders.length > 1 ? 'gd-tie' : ''}">
        <span class="gd-label">${esc(ind.label)}</span>
        <div class="gd-photos"><span class="gd-crown">${crownSvg('tier-gold')}</span>${leaders.slice(0, 3).map(b => `<span class="gd-photo">${pdPhoto(b).replace('pd-photo', 'gd-ring')}</span>`).join('')}</div>
        <b class="gd-name">${names}</b>
        <span class="gd-val num">${fmt(ind, row.values[ind.key])}${ind.key === 'check' ? ' pts' : ''}</span>
        ${leaders.length > 1 ? '<span class="chip chip-destaque">Empate na liderança</span>' : ''}
      </div>`;
    }).join('');
    return `<p class="tv-eyebrow gold">${icon('crown')} Líderes do período</p>
      <h2 class="tv-h">Quem está puxando cada resultado</h2>
      ${cards ? `<div class="gd-grid">${cards}</div>` : '<div class="card muted">Ainda não há lançamentos neste período.</div>'}`;
  }

  function tvAlerts(R) {
    const n = R.rows.length;
    const cards = R.rows.map((r, i) => {
      const zone = r.pos === 1 ? 'leader' : r.pos <= 3 ? 'chase' : (r.pos > Math.ceil(n / 2) + 1 ? 'low' : 'middle');
      const [line, sub] = pickLine(zone, r.barber.id);
      let gap;
      if (r.pos === 1) {
        const second = R.rows[1];
        if (!second) gap = 'Sem concorrência no período.';
        else {
          const d = r.overall - second.overall;
          const t = R.title.barberId === r.barber.id ? (R.title.type === 'mvp' ? 'MVP' : 'Destaque') : null;
          if (d >= 0) {
            const g = bestGaps(gapTo(R, second, r))[0];
            gap = `Vantagem de ${score(d)} pts sobre ${first(second.barber.name)}.${g ? ` ${first(second.barber.name)} precisa ${gapText(g)} para passar.` : ''}`;
          } else {
            gap = `Está em 1º pelo título de ${t}. Na pontuação, ${first(second.barber.name)} está ${score(-d)} pts à frente: mantenha a liderança nos indicadores.`;
          }
        }
      } else {
        const above = R.rows[i - 1];
        if (above.pos === 1 && R.title.barberId === above.barber.id) {
          const need = Math.max(1, R.half - r.leads.length);
          gap = `${first(above.barber.name)} está em 1º pelo título. Para disputar, fique em 1º em mais ${need} indicador(es).`;
        } else {
          const gs = bestGaps(gapTo(R, r, above));
          gap = gs.length ? `Para passar ${first(above.barber.name)}: ${gs.map(gapText).join(' ou ')}.` : `Faltam ${score(above.overall - r.overall)} pts para passar ${first(above.barber.name)}.`;
        }
      }
      return `<div class="al al-${zone}">
        <div class="al-av">${avatar(r.barber, 58)}<span class="al-pos num">${ord(r.pos)}</span></div>
        <div class="al-body"><b class="al-name">${esc(r.barber.name)}</b>
          <p class="al-line">${esc(line)}</p><p class="al-sub">${esc(sub)}</p>
          <p class="al-gap">${gap}</p></div>
      </div>`;
    }).join('');
    return `<p class="tv-eyebrow red">${icon('bolt')} Alerta do ranking</p>
      <h2 class="tv-h">Quanto falta para subir de posição</h2>
      ${cards ? `<div class="al-grid">${cards}</div>` : '<div class="card muted">Sem barbeiros no ranking.</div>'}`;
  }

  function renderTV() {
    if (!Cloud.enabled) state = DB.load();
    const R = computeRanking(state, range());
    liveDetect(R);
    const slides = [tvRanking, tvGuardians, tvAlerts];
    const i = ((ui.tvIndex % slides.length) + slides.length) % slides.length;
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    root.innerHTML = `<div class="tv">
      <div class="tv-progress" aria-hidden="true"><i style="animation-duration:${TV_SECONDS}s${reduce ? ';animation:none;width:100%' : ''}"></i></div>
      <header class="tv-head">
        ${logo('tv-logo')}
        <div class="tv-title"><b>${esc(state.company.name)}</b><span>Tela da loja · ${esc(PERIOD_NAMES[ui.period])}: ${esc(range().label)}</span></div>
        <div class="tv-controls">
          <button class="btn btn-sm" data-action="tvSound" aria-pressed="${Sound.on}">${icon('sound')} ${Sound.on ? 'Sons ativos' : 'Sons desligados'}</button>
          <select class="input tv-select" id="tv-sound" data-change="tvSoundKind" aria-label="Escolher e testar som">
            ${Object.entries(Sound.KINDS).map(([k, v]) => `<option value="${k}" ${Sound.kind === k ? 'selected' : ''}>Som: ${v}</option>`).join('')}
          </select>
          <button class="icon-btn tv-ib" data-action="tvFull" aria-label="Tela cheia">${icon('expand')}</button>
          <button class="icon-btn tv-ib" data-action="exitTV" aria-label="Sair da tela da loja">${icon('x')}</button>
        </div>
      </header>
      <div class="tv-body">${slides[i](R)}</div>
      <nav class="tv-dots" aria-label="Telas">${slides.map((_, k) => `<button class="${k === i ? 'on' : ''}" data-action="tvGo" data-i="${k}" aria-label="Tela ${k + 1}"></button>`).join('')}</nav>
    </div>`;
    applyLive();
    clearTimeout(ui.tvTimer);
    ui.tvTimer = setTimeout(() => { ui.tvIndex = i + 1; if (location.hash === '#apresentacao') { renderTV(); window.scrollTo(0, 0); } }, TV_SECONDS * 1000);
  }

  async function keepAwake() {
    try { if (navigator.wakeLock && !ui.wake) { ui.wake = await navigator.wakeLock.request('screen'); ui.wake.addEventListener('release', () => { ui.wake = null; }); } } catch (e) { /* opcional */ }
  }

  // ---------- render principal ----------
  function render() {
    clearTimeout(ui.tvTimer);
    rkCache = {};
    const h = decodeURIComponent(location.hash.slice(1));
    if (h.startsWith('convite-')) { renderAuth('convite', h.slice(8)); return; }
    const user = currentUser();
    if (!user) { renderAuth(ui.authMode); return; }

    let route = h || 'inicio';
    if (route === 'apresentacao') { renderTV(); return; }
    let page, title;
    if (route.startsWith('perfil-')) {
      const id = route.slice(7);
      page = { r: () => perfFor(id, user) }; title = 'Perfil';
    } else if (PAGES[route]) {
      page = PAGES[route]; title = page.t;
    } else if (SOON_TEXT[route]) {
      page = { r: () => pageSoon(route) }; title = NAV.flatMap(g => g.items).find(i => i.r === route).t;
    } else { route = 'inicio'; page = PAGES.inicio; title = page.t; }
    if (page.g && !isGestor(user)) { route = 'inicio'; page = PAGES.inicio; title = page.t; }

    const pending = isGestor(user) ? state.users.filter(u => u.status === 'pendente').length : 0;
    const who = isGestor(user) ? { name: state.company.name, photo: state.company.logo } : (barberById(user.barberId) || { name: user.name });
    root.innerHTML = `
      <header class="topbar">
        <button class="icon-btn" data-action="openDrawer" aria-label="Abrir menu">${icon('menu')}</button>
        <div class="topbar-title"><h1>${esc(title)}</h1><p>Período: ${esc(PERIOD_NAMES[ui.period])} · ${esc(range().label)}</p></div>
        <a class="icon-btn" href="#apresentacao" aria-label="Modo apresentação" title="Modo apresentação">${icon('monitor')}</a>
        <button class="icon-btn" data-action="fontSize" aria-label="Tamanho da letra" title="Tamanho da letra">${icon('type')}</button>
        ${isGestor(user) ? `<a class="icon-btn" href="#barbeiros" aria-label="Aprovações pendentes: ${pending}">${icon('bell')}${pending ? `<span class="badge-dot">${pending}</span>` : ''}</a>` : ''}
        <button class="avatar-btn" data-action="togglePopover" aria-label="Perfil e conta">${avatar(who, 40)}</button>
      </header>
      ${trialBanner(user)}
      <main class="main" id="main">${page.r(user)}</main>
      <button class="fab" data-action="openDrawer" aria-label="Abrir menu">${icon('menu')}</button>
      ${drawer(user, route)}
      ${popover(user)}`;
    applyLive();
    maybeOfferInstall();
  }

  // ---------- ações ----------
  function setMsg(form, text, ok) {
    const m = form.querySelector('[data-msg]');
    if (m) { m.textContent = text; m.classList.toggle('ok', !!ok); }
  }
  const val = (form, name) => (form.elements[name]?.value ?? '').trim();
  const validEmail = e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

  const ACTIONS = {
    authMode(el, ev) { ev.preventDefault(); ui.authMode = el.dataset.mode; if (location.hash.startsWith('#convite-')) location.hash = ''; renderAuth(ui.authMode); },
    togglePass(el) {
      const i = document.getElementById(el.dataset.target || 'li-pass'); if (!i) return;
      const show = i.type === 'password';
      i.type = show ? 'text' : 'password';
      el.innerHTML = icon(show ? 'eyeOff' : 'eye');
      el.setAttribute('aria-pressed', String(show));
      el.setAttribute('aria-label', show ? 'Ocultar senha' : 'Mostrar senha');
    },
    async social(el) {
      if (!Cloud.enabled) { toast(`Entrar com ${el.dataset.name} será ligado junto com o servidor.`); return; }
      const provider = { Google: 'google', Apple: 'apple', Microsoft: 'azure' }[el.dataset.name];
      const { error } = await Cloud.oauth(provider);
      if (error) toast(Cloud.message(error));
    },
    demoFill(el) { $('#li-email').value = el.dataset.email; $('#li-pass').value = 'demo123'; $('#li-pass').focus(); },
    openDrawer() { $('.drawer').classList.add('open'); $('.scrim').hidden = false; },
    closeDrawer() { $('.drawer').classList.remove('open'); $('.scrim').hidden = true; },
    togglePopover() { const p = $('.popover'); p.hidden = !p.hidden; },
    async logout() {
      if (Cloud.enabled) { await Cloud.signOut(); state = blankState(); rkCache = {}; }
      else DB.session.clear();
      ui.authMode = 'entrar'; location.hash = ''; render();
    },
    period(el) { ui.period = el.dataset.period; ui.offset = 0; DB.pref.set('period', ui.period); render(); },
    shift(el) { ui.offset = Math.min(0, ui.offset + Number(el.dataset.dir)); ui.confirm = null; render(); },
    fontSize() {
      const sizes = ['16', '18', '20'];
      const next = sizes[(sizes.indexOf(DB.pref.get('size', '16')) + 1) % sizes.length];
      DB.pref.set('size', next);
      document.documentElement.style.setProperty('--base-size', next + 'px');
    },
    tvSound() { Sound.on = !Sound.on; if (Sound.on) Sound.play(undefined, true); renderTV(); },
    tvFull() { const d = document.documentElement; if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); else if (d.requestFullscreen) d.requestFullscreen().catch(() => toast('Este aparelho não permite tela cheia.')); else toast('Este aparelho não permite tela cheia.'); },
    tvGo(el) { ui.tvIndex = Number(el.dataset.i); renderTV(); },
    exitTV() { if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); location.hash = 'inicio'; },
    approve(el) { const u = state.users.find(x => x.id === el.dataset.id); if (u) { u.status = 'ativo'; save(); toast(`${u.name} agora tem acesso.`); render(); } },
    reject(el) { const u = state.users.find(x => x.id === el.dataset.id); if (u) { u.status = 'recusado'; save(); toast('Cadastro recusado.'); render(); } },
    invite(el) {
      const id = el.dataset.id;
      if (!state.invites.find(i => i.barberId === id && !i.used)) {
        state.invites.push({ code: hash(id + Date.now() + Math.random()).slice(0, 10), barberId: id, createdAt: iso(new Date()), used: false });
        save();
      }
      ui.invite = ui.invite === id ? null : id; render();
    },
    copyInvite(el) { const inv = state.invites.find(i => i.barberId === el.dataset.id && !i.used); if (inv) copyText(inviteLink(inv.code), $('#inv-' + CSS.escape(el.dataset.id))); },
    cancelInvite(el) { state.invites = state.invites.filter(i => !(i.barberId === el.dataset.id && !i.used)); ui.invite = null; save(); render(); },
    toggleBarber(el) {
      const b = barberById(el.dataset.id); if (!b) return;
      const lim = billing() && billing().max_barbers;
      if (b.active === false && lim && activeBarbers() >= lim) { toast(`Seu plano permite até ${lim} barbeiros ativos. Troque de plano em Assinatura.`); return; }
      b.active = b.active === false; save(); render();
    },
    async resetPass(el) {
      const u = state.users.find(x => x.id === el.dataset.id); if (!u) return;
      if (Cloud.enabled) {
        const { error } = await Cloud.reset(u.email);
        toast(error ? Cloud.message(error) : `Enviamos para ${u.email} um link para criar uma senha nova.`);
        return;
      }
      const pass = hash(u.id + Date.now()).slice(0, 8);
      u.pass = passHash(u.email, pass); save();
      ui.lastReset = { name: u.name, pass }; render();
    },
    installApp() { ACTIONS.closeDrawer(); openInstall(); },
    async recheckAccess(el, ev, silent) {
      const ok = await loadCloud();
      if (ok) { toast('Pagamento confirmado. Bem-vindo de volta!'); if (location.hash === '#inicio') render(); else location.hash = 'inicio'; return; }
      if (!silent) { toast('Ainda não recebemos a confirmação do pagamento. PIX e cartão levam alguns minutos; boleto até 3 dias úteis.'); render(); }
    },
    async subInvoice() {
      try {
        const r = await Cloud.billingAction('fatura');
        if (r.invoiceUrl) { state.billing.invoice_url = r.invoiceUrl; toast('Fatura encontrada.'); render(); }
        else toast('Não há fatura em aberto.');
      } catch (e) { toast(e.message); }
    },
    async subCancel() {
      if (ui.confirm !== 'cancelSub') { ui.confirm = 'cancelSub'; render(); return; }
      ui.confirm = null;
      try { await Cloud.billingAction('cancelar'); toast('Assinatura cancelada.'); await loadCloud(); render(); }
      catch (e) { toast(e.message); render(); }
    },
    adminFilter(el) { ui.adminFilter = el.dataset.f; render(); },
    adminReload() { ui.adminData = null; render(); },
    async adminTrial(el) {
      const c = ui.adminData.list.find(x => x.id === el.dataset.id);
      const base = Math.max(Date.now(), new Date(c.trial_ends_at).getTime());
      await adminDo(c.id, { sub_status: c.access === 'paid' ? c.sub_status : 'trial', trial_ends_at: new Date(base + 7 * 86400000).toISOString() }, '7 dias de teste a mais.');
    },
    async adminCourtesy(el) {
      const d = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
      await adminDo(el.dataset.id, { sub_status: 'courtesy', paid_until: d }, 'Cortesia de 30 dias aplicada.');
    },
    async adminBlock(el) {
      if (ui.confirm !== 'blk' + el.dataset.id) { ui.confirm = 'blk' + el.dataset.id; render(); return; }
      ui.confirm = null;
      await adminDo(el.dataset.id, { sub_status: 'blocked' }, 'Barbearia bloqueada.');
    },
    fxStart() {
      ui.fx = { ym: ui.fxMonth || curYm(), i: 0 };
      Sound.ensure(); keepAwake();
      const d = document.documentElement;
      if (d.requestFullscreen) d.requestFullscreen().catch(() => {});
      fxRender();
    },
    teamPick(el) {
      ui.teamBarber = el.dataset.id;
      const u = currentUser();
      if (!isGestor(u)) { refreshTeam(); $('#tm-insights')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
      const ed = $('#tm-editor');
      if (ed) { ed.innerHTML = teamEditor(ui.teamMonth || curYm()); refreshTeam(); ed.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
      else render();
    },
    radarToggle(el) {
      const id = el.dataset.id; let sel = ui.radarSel || [];
      if (sel.includes(id)) { if (sel.length > 1) sel = sel.filter(x => x !== id); }
      else { sel = [...sel, id]; if (sel.length > 4) sel = sel.slice(1); }
      ui.radarSel = sel; const rd = $('#tm-radar'); if (rd) rd.innerHTML = teamRadars(ui.teamMonth || curYm());
    },
    defaultGoals() { state.goals = { ...(state.goals || {}), team: { ...GB.DEFAULT_GOALS } }; save(); toast('Metas padrão restauradas.'); render(); },
    defaultWeights() { state.weights = Object.fromEntries(INDICATORS.map(i => [i.key, i.weight])); save(); toast('Pesos padrão restaurados.'); render(); },
    resetDemo() {
      if (ui.confirm !== 'demo') { ui.confirm = 'demo'; render(); return; }
      state = DB.reset(); ui.confirm = null; DB.session.set(state.users[0].id, true); toast('Dados de demonstração restaurados. Você entrou como Gestor Demo.'); location.hash = 'inicio'; render();
    },
    clearData() {
      if (ui.confirm !== 'clear') { ui.confirm = 'clear'; render(); return; }
      const me = currentUser();
      state.barbers = []; state.entries = []; state.monthly = []; state.invites = []; state.demo = false;
      if (!Cloud.enabled) state.users = state.users.filter(u => u.id === me.id);
      ui.confirm = null; save(); toast('Equipe e lançamentos apagados.'); render();
    },
    copyKey() { copyText(state.apiKey, $('#api-key')); },
    newKey() {
      if (ui.confirm !== 'key') { ui.confirm = 'key'; render(); return; }
      if (Cloud.enabled) {
        Cloud.rotateKey().then(k => { state.apiKey = k; ui.confirm = null; toast('Nova chave gerada.'); render(); }).catch(e => toast(Cloud.message(e)));
        return;
      }
      state.apiKey = 'gbia_' + hash(String(Date.now())) + hash('k' + Math.random()); ui.confirm = null; save(); toast('Nova chave gerada.'); render();
    },
  };

  async function adminDo(id, patch, msg) {
    try { await Cloud.admin.update(id, patch); toast(msg); ui.adminData = null; render(); }
    catch (e) { toast(Cloud.message(e)); }
  }

  const FORMS = {
    async subscribe(f) {
      const plan = f.querySelector('input[name="plan_id"]:checked');
      if (!plan) return setMsg(f, 'Escolha um plano.');
      const doc = val(f, 'cpf_cnpj').replace(/\D/g, '');
      if (doc.length !== 11 && doc.length !== 14) return setMsg(f, 'Digite um CPF (11 números) ou CNPJ (14 números).');
      if (!val(f, 'name')) return setMsg(f, 'Digite o nome ou a razão social de quem paga.');
      setMsg(f, 'Criando sua assinatura…', true);
      try {
        const r = await Cloud.billingAction('assinar', { plan_id: plan.value, cpf_cnpj: doc, name: val(f, 'name'), phone: val(f, 'phone') });
        await loadCloud();
        toast(r.invoiceUrl ? 'Assinatura criada. Use o botão Pagar fatura.' : 'Assinatura criada.');
        render();
      } catch (e) { setMsg(f, e.message); }
    },
    async changePlan(f) {
      const plan = f.querySelector('input[name="plan_id"]:checked');
      if (!plan || plan.value === billing().plan_id) return setMsg(f, 'Escolha um plano diferente do atual.');
      setMsg(f, 'Trocando…', true);
      try { await Cloud.billingAction('trocar', { plan_id: plan.value }); await loadCloud(); toast('Plano trocado.'); render(); }
      catch (e) { setMsg(f, e.message); }
    },
    async adminPlans(f) {
      try {
        for (const p of ui.adminData.plans) {
          const price = Math.round(Number(val(f, 'price_' + p.id)) * 100);
          const maxRaw = val(f, 'max_' + p.id);
          if (!(price >= 0)) return setMsg(f, `Preço do plano ${p.name} inválido.`);
          await Cloud.admin.savePlan(p.id, { price_cents: price, max_barbers: maxRaw === '' ? null : Math.max(1, Math.round(Number(maxRaw))) });
        }
        toast('Planos salvos.'); ui.adminData = null; await loadCloud(); render();
      } catch (e) { setMsg(f, Cloud.message(e)); }
    },
    async login(f) {
      const email = val(f, 'email').toLowerCase(), pass = f.elements.pass.value;
      if (!email || !pass) return setMsg(f, 'Preencha e-mail e senha.');
      if (Cloud.enabled) {
        setMsg(f, 'Entrando…', true);
        const { error } = await Cloud.signIn(email, pass);
        if (error) return setMsg(f, Cloud.message(error));
        DB.pref.set('ephemeral', f.elements.remember.checked ? '0' : '1');
        try { sessionStorage.setItem('gbia.alive', '1'); } catch (e) { /* opcional */ }
        if (await loadCloud()) { if (location.hash === '#inicio') render(); else location.hash = 'inicio'; }
        else render();
        return;
      }
      const u = state.users.find(x => x.email.toLowerCase() === email);
      if (!u || u.pass !== passHash(email, pass)) return setMsg(f, 'E-mail ou senha incorretos.');
      if (u.status === 'pendente') return setMsg(f, 'Seu cadastro está aguardando a aprovação do gestor.');
      if (u.status === 'recusado') return setMsg(f, 'Seu acesso não foi aprovado. Fale com o gestor da barbearia.');
      DB.session.set(u.id, f.elements.remember.checked);
      location.hash = 'inicio'; render();
    },
    async signup(f) {
      const company = val(f, 'company'), name = val(f, 'name'), email = val(f, 'email').toLowerCase(), pass = f.elements.pass.value;
      if (!company || !name) return setMsg(f, 'Preencha o nome da barbearia e o seu nome.');
      if (!validEmail(email)) return setMsg(f, 'Digite um e-mail válido.');
      if (pass.length < 6) return setMsg(f, 'A senha precisa ter pelo menos 6 caracteres.');
      if (pass !== f.elements.pass2.value) return setMsg(f, 'As senhas não são iguais. Digite a mesma senha nos dois campos.');
      if (Cloud.enabled) {
        if (!f.elements.terms.checked) return setMsg(f, 'Para criar a conta, aceite os Termos de uso e a Política de privacidade.');
        setMsg(f, 'Criando conta…', true);
        const { data, error } = await Cloud.signUp(email, pass, { company, name, phone: val(f, 'phone'), terms_accepted_at: new Date().toISOString() });
        if (error) return setMsg(f, Cloud.message(error));
        if (data.session) { if (await loadCloud()) { toast('Conta criada. Agora cadastre sua equipe.'); location.hash = 'barbeiros'; } render(); return; }
        ui.authEmail = email; ui.authInvite = false; ui.authMode = 'confirmar'; renderAuth('confirmar'); return;
      }
      if (!state.demo && state.users.some(u => u.email.toLowerCase() === email)) return setMsg(f, 'Este e-mail já tem conta. Use Entrar.');
      const gestor = { id: uid('u_'), name, email, pass: passHash(email, pass), role: 'gestor', status: 'ativo', barberId: null };
      state = DB.replace(emptyState({ name: company, cnpj: '', phone: '', email, logo: null }, gestor));
      DB.session.set(gestor.id, true);
      toast('Conta criada. Agora cadastre sua equipe.');
      location.hash = 'barbeiros'; render();
    },
    async invite(f) {
      const code = f.dataset.code;
      const name = val(f, 'name'), email = val(f, 'email').toLowerCase(), pass = f.elements.pass.value;
      if (!name) return setMsg(f, 'Digite seu nome.');
      if (!validEmail(email)) return setMsg(f, 'Digite um e-mail válido.');
      if (pass.length < 6) return setMsg(f, 'A senha precisa ter pelo menos 6 caracteres.');
      if (pass !== f.elements.pass2.value) return setMsg(f, 'As senhas não são iguais. Digite a mesma senha nos dois campos.');
      if (Cloud.enabled) {
        setMsg(f, 'Enviando cadastro…', true);
        const { data, error } = await Cloud.signUp(email, pass, { invite_code: code, name, phone: val(f, 'phone') });
        if (error) return setMsg(f, Cloud.message(error, 'invite'));
        history.replaceState(null, '', location.pathname);
        if (data.session) { await loadCloud(); render(); return; }
        ui.authEmail = email; ui.authInvite = true; ui.authMode = 'confirmar'; renderAuth('confirmar'); return;
      }
      const inv = state.invites.find(i => i.code === code && !i.used);
      if (!inv) return setMsg(f, 'Este convite não é mais válido.');
      if (state.users.some(u => u.email.toLowerCase() === email && u.status !== 'recusado')) return setMsg(f, 'Este e-mail já está cadastrado.');
      state.users.push({ id: uid('u_'), name, email, phone: val(f, 'phone'), pass: passHash(email, pass), role: 'barbeiro', status: 'pendente', barberId: inv.barberId });
      inv.used = true; save();
      history.replaceState(null, '', location.pathname + location.search);
      ui.authMode = 'pendente'; renderAuth('pendente');
    },
    async recover(f) {
      const email = val(f, 'email').toLowerCase();
      if (!validEmail(email)) return setMsg(f, 'Digite um e-mail válido.');
      if (Cloud.enabled) {
        setMsg(f, 'Enviando…', true);
        const { error } = await Cloud.reset(email);
        if (error) return setMsg(f, Cloud.message(error));
        return setMsg(f, `Pronto. Se existir uma conta com ${email}, você vai receber um link para criar a senha nova. Confira também o spam.`, true);
      }
      setMsg(f, 'Pedido registrado. Avise o gestor para gerar sua nova senha.', true);
    },
    async newPass(f) {
      const pass = f.elements.pass.value, pass2 = f.elements.pass2.value;
      if (pass.length < 6) return setMsg(f, 'A senha precisa ter pelo menos 6 caracteres.');
      if (pass !== pass2) return setMsg(f, 'As senhas não são iguais. Digite a mesma senha nos dois campos.');
      setMsg(f, 'Salvando…', true);
      const { error } = await Cloud.updatePassword(pass);
      if (error) return setMsg(f, Cloud.message(error));
      Cloud.recovery = false;
      history.replaceState(null, '', location.pathname);
      toast('Senha alterada.');
      if (await loadCloud() && location.hash !== '#inicio') location.hash = 'inicio'; else render();
    },
    async addBarber(f) {
      const name = val(f, 'name');
      if (!name) return setMsg(f, 'Digite o nome do barbeiro.');
      let photo = null;
      const file = f.elements.photo.files[0];
      const lim = billing() && billing().max_barbers;
      if (lim && activeBarbers() >= lim) return setMsg(f, `Seu plano permite até ${lim} barbeiros ativos. Troque de plano em Assinatura para cadastrar mais.`);
      if (file) { try { photo = await readImage(file); } catch (e) { return setMsg(f, e.message); } }
      state.barbers.push({ id: uid('b_'), name, photo, active: true, role: 'Barbeiro', instagram: '' }); save();
      toast(`${name} adicionado. Agora envie o convite.`); render();
    },
    weights(f) {
      const w = {};
      for (const i of INDICATORS) {
        const v = Number(val(f, i.key));
        if (Number.isNaN(v) || v < 0 || v > 100) return setMsg(f, `Peso de "${i.label}" deve ficar entre 0 e 100.`);
        w[i.key] = Math.round(v);
      }
      const hidden = INDICATORS.filter(i => !f.elements['on-' + i.key].checked).map(i => i.key);
      if (INDICATORS.length - hidden.length < 2) return setMsg(f, 'Deixe pelo menos 2 indicadores ativos.');
      state.weights = w; state.hidden = hidden; save(); toast('Indicadores salvos.'); render();
    },
    goals(f) {
      const g = { ...(state.goals?.team || {}) };
      for (const i of GB.visibleInds(state)) {
        const v = Number(val(f, i.key).replace(',', '.'));
        if (Number.isNaN(v) || v < 0) return setMsg(f, `Meta de "${i.label}" precisa ser um número positivo.`);
        g[i.key] = v;
      }
      state.goals = { byBarber: {}, ...(state.goals || {}), team: g }; save(); toast('Metas da equipe salvas.'); render();
    },
    import(f) {
      let data;
      try { data = JSON.parse(f.elements.json.value); } catch (e) { return setMsg(f, 'O texto não é um JSON válido. Confira vírgulas e aspas.'); }
      try {
        const res = importEntries(state, Array.isArray(data) ? data : [data]); save();
        setMsg(f, `${res.ok} lançamento(s) importado(s).${res.errors.length ? ' Problemas: ' + res.errors.join(' ') : ''}`, res.errors.length === 0);
      } catch (e) { setMsg(f, e.message); }
    },
    company(f) {
      const name = val(f, 'name');
      if (!name) return setMsg(f, 'O nome da barbearia é obrigatório.');
      Object.assign(state.company, { name, cnpj: val(f, 'cnpj'), phone: val(f, 'phone'), email: val(f, 'email') });
      save(); toast('Dados da barbearia salvos.'); render();
    },
    async profile(f) {
      const u = currentUser();
      const name = val(f, 'name'), email = val(f, 'email').toLowerCase(), pass = f.elements.pass.value;
      if (!name) return setMsg(f, 'Digite seu nome.');
      if (!validEmail(email)) return setMsg(f, 'Digite um e-mail válido.');
      if (state.users.some(x => x.id !== u.id && x.email.toLowerCase() === email)) return setMsg(f, 'Este e-mail já é usado por outra conta.');
      if (pass && pass.length < 6) return setMsg(f, 'A nova senha precisa ter pelo menos 6 caracteres.');
      if (pass && pass !== f.elements.pass2.value) return setMsg(f, 'As senhas não são iguais. Digite a mesma senha nos dois campos.');
      const emailChanged = email !== u.email.toLowerCase();
      if (Cloud.enabled) {
        u.name = name; save();
        if (pass) { const { error } = await Cloud.updatePassword(pass); if (error) return setMsg(f, Cloud.message(error)); }
        if (emailChanged) { const { error } = await Cloud.updateEmail(email); if (error) return setMsg(f, Cloud.message(error)); }
        toast(emailChanged ? `Enviamos um link de confirmação para ${email}. O e-mail muda depois que você confirmar.` : 'Cadastro atualizado.');
        render(); return;
      }
      if (emailChanged && !pass) return setMsg(f, 'Para trocar o e-mail, digite também uma nova senha.');
      u.name = name; u.email = email;
      if (pass) u.pass = passHash(email, pass);
      save(); toast('Cadastro atualizado.'); render();
    },
  };

  const CHANGES = {
    tvSoundKind(el) { Sound.kind = el.value; Sound.play(el.value, true); },
    perfBarber(el) { ui.perfBarber = el.value; render(); },
    teamMonth(el) { ui.teamMonth = el.value; render(); },
    fxMonth(el) { ui.fxMonth = el.value; render(); },
    async barberPhoto(el) {
      const b = barberById(el.dataset.id);
      try { b.photo = await readImage(el.files[0]); save(); toast('Foto atualizada.'); render(); } catch (e) { toast(e.message); }
    },
    async myPhoto(el) {
      const b = barberById(currentUser()?.barberId);
      if (!b) { toast('Seu cadastro não está ligado a um barbeiro.'); return; }
      try { b.photo = await readImage(el.files[0]); save(); toast('Foto atualizada.'); render(); } catch (e) { toast(e.message); }
    },
    async companyLogo(el) {
      try { state.company.logo = await readImage(el.files[0]); save(); toast('Logo atualizado.'); render(); } catch (e) { toast(e.message); }
    },
  };

  root.addEventListener('click', e => {
    const el = e.target.closest('[data-action]');
    if (el && ACTIONS[el.dataset.action]) { ACTIONS[el.dataset.action](el, e); return; }
    const pop = $('.popover');
    if (pop && !pop.hidden && !e.target.closest('.popover')) pop.hidden = true;
  });
  root.addEventListener('submit', e => {
    const f = e.target.closest('form[data-form]');
    if (!f) return;
    e.preventDefault();
    FORMS[f.dataset.form]?.(f);
  });
  root.addEventListener('input', e => {
    const el = e.target.closest('[data-auto]');
    if (el && el.tagName !== 'SELECT') autoSave(el);
  });
  root.addEventListener('keydown', e => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('article[data-action]')) { e.preventDefault(); ACTIONS[e.target.dataset.action](e.target, e); }
  });
  root.addEventListener('change', e => {
    const au = e.target.closest('select[data-auto]');
    if (au) { autoSave(au); return; }
    const el = e.target.closest('[data-change]');
    if (el && CHANGES[el.dataset.change]) CHANGES[el.dataset.change](el);
  });
  window.addEventListener('hashchange', () => {
    if (ui.fx) fxClose();
    ui.confirm = null; ui.invite = null; ui.lastReset = null;
    render();
    if (location.hash === '#apresentacao') {
      ui.tvSnap = null; ui.tvIndex = 0; keepAwake(); Sound.ensure();
      render();
      if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(() => {});
    }
    window.scrollTo(0, 0);
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && document.getElementById('install-sheet')) { closeInstall(); return; }
    if (e.key === 'Escape') {
      if (location.hash === '#apresentacao') ACTIONS.exitTV();
      const d = $('.drawer'); if (d && d.classList.contains('open')) ACTIONS.closeDrawer();
      const p = $('.popover'); if (p) p.hidden = true;
    }
  });

  // Atualiza a tela da loja quando outra aba deste aparelho lança resultados.
  window.addEventListener('storage', e => {
    if (Cloud.enabled || e.key !== 'gbia.v1') return;
    if (location.hash === '#apresentacao') renderTV();
    else if (['', '#inicio', '#gestao-visual'].includes(location.hash) && currentUser()) { state = DB.load(); rkCache = {}; render(); }
  });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && location.hash === '#apresentacao') keepAwake(); });

  // ---------- nuvem: carregar, ouvir mudanças e iniciar ----------
  async function loadCloud() {
    try {
      const r = await Cloud.load();
      if (r.status === 'ativo') { state = r.state; rkCache = {}; Cloud.subscribe(); ui.authMode = 'entrar'; clearInterval(ui.blockPoll); return true; }
      state = blankState();
      if (r.status === 'bloqueado') ui.blockInfo = r;
      ui.authMode = r.status === 'bloqueado' ? 'bloqueado' : r.status === 'pendente' ? 'pendente' : r.status === 'recusado' ? 'recusado' : r.status === 'sem-perfil' ? 'semPerfil' : 'entrar';
    } catch (e) {
      state = blankState();
      ui.authMsg = { text: 'Não foi possível carregar os dados: ' + Cloud.message(e) };
      ui.authMode = 'entrar';
    }
    return false;
  }
  function isTyping() {
    const a = document.activeElement;
    return a && root.contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName);
  }
  if (Cloud.enabled) {
    Cloud.onError = async msg => {
      toast(/Limite do plano/.test(msg) ? msg : 'Não foi possível salvar na nuvem: ' + msg);
      // Volta para o que está salvo no servidor, para a tela não mostrar algo que não foi gravado.
      await loadCloud();
      if (ui.fx || location.hash === '#apresentacao') return;
      render();
    };
    // Confere a assinatura a cada 10 minutos (o teste ou o mês pode vencer com o app aberto).
    setInterval(async () => {
      if (!Cloud.user || !state.billing || document.hidden) return;
      try {
        const { data } = await Cloud.client.rpc('company_access');
        if (data && data.access !== state.billing.access) { await loadCloud(); render(); }
      } catch (e) { /* tenta de novo depois */ }
    }, 600000);
    Cloud.onRemote = next => {
      const apply = () => {
        state = next; rkCache = {};
        if (ui.fx) return;
        if (location.hash === '#apresentacao') renderTV();
        else if (['#time', '#lancamentos'].includes(location.hash)) refreshTeam();
        else render();
      };
      if (isTyping()) { root.addEventListener('focusout', () => setTimeout(() => { if (!isTyping()) apply(); }, 50), { once: true }); }
      else apply();
    };
    Cloud.onAuth = async (event) => {
      if (event === 'PASSWORD_RECOVERY') { ui.authMode = 'novaSenha'; renderAuth('novaSenha'); return; }
      if (event === 'SIGNED_OUT') { state = blankState(); ui.authMode = 'entrar'; render(); return; }
      if (event === 'PROFILE_CHANGED') { await loadCloud(); render(); }
    };
  }
  async function bootCloud() {
    await Cloud.init();
    const params = new URLSearchParams(location.search);
    const h = location.hash;
    const err = /error_description=([^&]+)/.exec(h);
    if (err) ui.authMsg = { text: Cloud.message(decodeURIComponent(err[1].replace(/\+/g, ' '))) };
    if (/access_token|error_description|type=/.test(h)) history.replaceState(null, '', location.pathname + location.search);
    // "Lembrar-me" desmarcado: encerra a sessão quando o navegador foi fechado.
    let alive = false; try { alive = sessionStorage.getItem('gbia.alive') === '1'; } catch (e) { /* opcional */ }
    if (Cloud.user && DB.pref.get('ephemeral', '0') === '1' && !alive) await Cloud.signOut();
    try { sessionStorage.setItem('gbia.alive', '1'); } catch (e) { /* opcional */ }
    if (Cloud.user && (Cloud.recovery || params.has('redefinir'))) { ui.authMode = 'novaSenha'; return; }
    if (params.has('redefinir')) history.replaceState(null, '', location.pathname + location.hash);
    if (Cloud.user) await loadCloud();
  }
  if (Cloud.enabled) {
    const wait = new Promise(r => setTimeout(r, 1900));
    splash(() => {});
    Promise.all([bootCloud(), wait]).then(() => { if (ui.authMode === 'novaSenha') renderAuth('novaSenha'); else render(); });
  } else {
    splash(render);
  }
})();
