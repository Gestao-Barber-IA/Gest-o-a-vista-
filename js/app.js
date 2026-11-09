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
  // ---------- Marca: Gestão Barber IA ou Gestão Salão IA ----------
  // O sistema é o mesmo; a marca da empresa troca logo, cores e as palavras da interface
  // (barbeiro → profissional, barbearia → salão). Nomes de pessoas e da empresa nunca mudam.
  const BRANDS = {
    barber: { key: 'barber', name: 'Gestão Barber IA', word: 'Barber', logo: 'assets/logo.jpg', manifest: 'manifest.webmanifest', icon: 'assets/icon-192.png', apple: 'assets/apple-touch-icon.png', theme: '#0c0c0e',
      tagline: 'Para barbearias', roles: ['Barbeiro', 'Barbeiro líder', 'Aprendiz', 'Recepcionista', 'Gerente'], role: 'Barbeiro' },
    salao: { key: 'salao', name: 'Gestão Salão IA', word: 'Salão', logo: 'assets/logo-salao.jpg', manifest: 'manifest-salao.webmanifest', icon: 'assets/icon-salao-192.png', apple: 'assets/apple-touch-icon-salao.png', theme: '#1a0a10',
      tagline: 'Para salões de beleza e esmalterias', roles: ['Cabeleireira', 'Cabeleireiro', 'Manicure', 'Esteticista', 'Maquiadora', 'Designer de sobrancelhas', 'Recepcionista', 'Gerente'], role: 'Profissional' },
  };
  let MARCA = 'barber';
  const MK = '⁣'; // marca invisível em volta do que veio do usuário (não é traduzido)
  const NB = '(?<![\\wÀ-ÿ@.])', NA = '(?![\\wÀ-ÿ@])';
  const WORDS = [
    [/Gestão Barber IA/g, 'Gestão Salão IA'],
    [/@barbearia\.com/g, '@seusalao.com'],
    [new RegExp(NB + '([DdNn])a (sua|minha|nossa) barbearia' + NA, 'g'), (m, l, x) => l + 'o ' + ({ sua: 'seu', minha: 'meu', nossa: 'nosso' })[x] + ' salão'],
    [new RegExp(NB + '([Pp])ela (sua|minha|nossa) barbearia' + NA, 'g'), (m, l, x) => l + 'elo ' + ({ sua: 'seu', minha: 'meu', nossa: 'nosso' })[x] + ' salão'],
    [new RegExp(NB + '([DdNn])a barbearia' + NA, 'g'), (m, l) => l + 'o salão'],
    [new RegExp(NB + '([Pp])ela barbearia' + NA, 'g'), (m, l) => l + 'elo salão'],
    [new RegExp(NB + 'à barbearia' + NA, 'g'), 'ao salão'],
    [new RegExp(NB + '([SsMm])(ua|inha) barbearia' + NA, 'g'), (m, l, x) => l + (x === 'ua' ? 'eu' : 'eu') + ' salão'],
    [new RegExp(NB + '([Nn])ossa barbearia' + NA, 'g'), (m, l) => l + 'osso salão'],
    [new RegExp(NB + '([Ee])sta barbearia' + NA, 'g'), (m, l) => l + 'ste salão'],
    [new RegExp(NB + '([Uu])ma barbearia' + NA, 'g'), (m, l) => l + 'm salão'],
    [new RegExp(NB + '([Aa]) barbearia' + NA, 'g'), (m, l) => (l === 'A' ? 'O' : 'o') + ' salão'],
    [new RegExp(NB + 'barbearias' + NA, 'g'), 'salões'], [new RegExp(NB + 'Barbearias' + NA, 'g'), 'Salões'],
    [new RegExp(NB + 'barbearia' + NA, 'g'), 'salão'], [new RegExp(NB + 'Barbearia' + NA, 'g'), 'Salão'],
    [new RegExp(NB + 'barbeiros' + NA, 'g'), 'profissionais'], [new RegExp(NB + 'Barbeiros' + NA, 'g'), 'Profissionais'],
    [new RegExp(NB + 'barbeiro' + NA, 'g'), 'profissional'], [new RegExp(NB + 'Barbeiro' + NA, 'g'), 'Profissional'],
  ];
  // Texto do usuário em mensagens simples (toast): protege sem escapar.
  const U = t => (MARCA === 'salao' ? MK + String(t ?? '') + MK : String(t ?? ''));
  const swapWords = t => (/arbe|Barber/.test(t) ? WORDS.reduce((a, [re, to]) => a.replace(re, to), t) : t);
  // Texto: troca as palavras fora das marcas (o que é do usuário fica igual) e tira as marcas.
  const L = t => { if (MARCA !== 'salao') return String(t ?? '').split(MK).join(''); return String(t ?? '').split(MK).map((p, i) => (i % 2 ? p : swapWords(p))).join(''); };
  // HTML: troca nos textos e nos atributos que a pessoa lê (placeholder, aria-label, title, alt).
  function UI(html) {
    let out = '', last = 0, m;
    const re = /<[^>]*>/g;
    while ((m = re.exec(html))) {
      out += L(html.slice(last, m.index));
      out += m[0].replace(/\s(placeholder|aria-label|title|alt)="([^"]*)"/g, (x, a, v) => ` ${a}="${L(v)}"`).split(MK).join('');
      last = re.lastIndex;
    }
    return out + L(html.slice(last));
  }
  const ihDesc = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
  Object.defineProperty(Element.prototype, 'innerHTML', { configurable: true, get() { return ihDesc.get.call(this); }, set(v) { ihDesc.set.call(this, MARCA === 'salao' ? UI(String(v)) : v); } });
  const esc = s => { const t = String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); return MARCA === 'salao' ? MK + t + MK : t; };
  const B = () => BRANDS[MARCA];
  // Modo claro ou escuro: preferência deste aparelho.
  const THEME_KEY = 'gbia.theme';
  const getTheme = () => { try { return localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark'; } catch (e) { return 'dark'; } };
  function applyTheme(t) {
    document.documentElement.dataset.theme = t;
    const m = document.querySelector('meta[name="theme-color"]');
    if (m) m.setAttribute('content', t === 'light' ? (MARCA === 'salao' ? '#fbf4f2' : '#f5f3ee') : B().theme);
  }
  // Aplica a marca na página: cores, logo, título, ícone e app instalável.
  function applyBrand(key) {
    const k = BRANDS[key] ? key : 'barber';
    MARCA = k;
    const b = BRANDS[k], html = document.documentElement;
    if (html.dataset.brand !== k) {
      html.dataset.brand = k;
      window.GB.LOGO_SRC = b.logo;
      document.title = b.name;
      const set = (sel, attr, v) => { const el = document.querySelector(sel); if (el) el.setAttribute(attr, v); };
      set('link[rel="manifest"]', 'href', b.manifest); set('link[rel="icon"]', 'href', b.icon); set('link[rel="apple-touch-icon"]', 'href', b.apple);
      set('meta[name="apple-mobile-web-app-title"]', 'content', b.name); set('meta[name="application-name"]', 'content', b.name);
    }
    applyTheme(getTheme());
  }
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

  // ---------- Ajuda "?": explicação de regras e indicadores (mouse no computador, toque no celular) ----------
  const ocupTipText = () => { const c = GB.ocupCfgOf(state), h = GB.hoursPerDay(c); return `Horas em comandas finalizadas ÷ horas da agenda no período. Hoje, 100% = ${nf1.format(h)} h por dia (${c.open} às ${c.close}, menos ${c.lunch} min de almoço) × ${c.days} dias = ${nf0.format(h * c.days)} h no mês. As ausências do barbeiro (férias, atestado) descontam da capacidade. Atendimentos antes da abertura, depois do fechamento ou no almoço compensam horários vagos; quem passa da capacidade fica acima de 100%. No mês em andamento, a capacidade cresce dia a dia.`; };
  const TIPS = {
    fat: ['Faturamento', 'Soma do valor dos atendimentos do barbeiro no período. Quanto maior, melhor.'],
    check: ['Checklist Agenda Cheia', 'Pontos das ações do checklist (stories, posts, abordagens, convites…). Cada ação só pontua depois que a prova (foto ou print) é aprovada pela gestão. As fotos são apagadas em 7 dias; os pontos continuam.'],
    ocup: ['Taxa de ocupação', ocupTipText],
    ticket: ['Ticket médio', 'Faturamento ÷ clientes atendidos. Mostra quanto cada cliente gasta, em média, com o barbeiro.'],
    serv: ['Serviços realizados', 'Quantidade de serviços feitos no período (corte, barba, sobrancelha…). Um cliente pode fazer mais de um serviço.'],
    cli: ['Clientes atendidos', 'Quantidade de clientes atendidos pelo barbeiro no período.'],
    planos: ['Planos mensais', 'Quantidade de planos mensais (assinaturas) vendidos pelo barbeiro no período.'],
    fid: ['Taxa de fidelização', 'Clientes que voltaram ÷ clientes atendidos no período.'],
    comanda: ['Maior comanda do mês', 'O maior valor de uma única comanda (um atendimento, com serviços e produtos) do profissional no mês. É só um destaque: não entra na pontuação, no MVP nem no Destaque.'],
    prod: ['Venda de produtos', 'Quantidade de produtos (pomadas, shampoos, óleos…) vendidos pelo barbeiro no período.'],
    agend: ['Agendamentos', 'Quantidade de agendamentos do barbeiro no mês. Aparece nos totais da Performance; não entra na pontuação.'],
    aus: ['Dias de ausência', 'Dias em que o barbeiro não trabalhou por férias, atestado ou folga extra. Cada dia desconta um dia da capacidade da taxa de ocupação.'],
    score: ['Como a pontuação funciona', 'Em cada indicador, o 1º do período recebe nota 100, o último 0 e os outros ficam no meio, proporcional ao resultado. A pontuação geral é a média dessas notas, ponderada pelos pesos. Quem tem título (MVP ou Destaque) fica em 1º; os demais seguem pela pontuação.'],
    title: ['MVP e Destaque', 'Destaque: 1º lugar em pelo menos metade dos indicadores com dados (arredonda para cima; com 8, são 4). MVP: um a mais que a metade (5 de 8). Nunca há os dois ao mesmo tempo. Empate no 1º lugar conta para todos os empatados.'],
    live: ['Ranking em tempo real', 'Atualiza assim que entram lançamentos ou dados da integração. As setas mostram quantas posições cada um subiu ou desceu em relação ao período anterior.'],
    leaders: ['Destaques por indicador', 'Quem está em 1º em cada indicador. O número ao lado do nome do indicador é o peso dele na pontuação. Empates aparecem juntos.'],
    career: ['Classificação e níveis', 'A carreira é a média das pontuações de todos os meses com dados. Níveis: Bronze até 69, Prata a partir de 70, Ouro a partir de 85 e Diamante a partir de 95.'],
    weights: ['Pesos', 'O peso define quanto cada indicador vale na pontuação geral. Indicador desativado some do app inteiro e os dados dele ficam guardados para quando for reativado.'],
    goals: ['Metas mensais', 'Referência de cada indicador para a equipe. No mês em andamento, metas de soma (faturamento, serviços, clientes…) ficam proporcionais aos dias já passados. Metas individuais são ajustadas em Lançamentos.'],
    reveal: ['Pódio surpresa', 'Nos últimos dias do mês, os barbeiros não veem colocações, pontuações nem números dos colegas; cada um vê os próprios números. A Tela da loja mostra uma contagem regressiva. O gestor revela o pódio no Fechamento do mês, do 3º ao 1º lugar, e a revelação aparece no celular da equipe.'],
    lanDate: ['Data do lançamento', 'Os campos mostram o total do mês. Ao mudar um total, a diferença é gravada nesta data e já aparece na visão por semana. Diminuir tira do dia escolhido e, se precisar, dos anteriores.'],
    access: ['Quem vê o quê', 'No ranking, todos veem os números de todos. A performance detalhada é só a própria, a não ser que a pessoa tenha acesso a uma área: Gestor vê e lança os resultados da área; Membro só vê.'],
    api: ['Integração por API', 'Outro sistema envia os resultados de cada barbeiro por dia. Os campos vindos da API ficam com cadeado em Lançamentos; só o dono destrava para um ajuste manual.'],
    proof: ['Provas do checklist', 'Cada ação precisa de uma foto ou print como prova. A gestão confere e aprova ou recusa; só ação aprovada pontua. Ninguém confere a própria prova.'],
    compare: ['Comparar profissionais', 'Mostra os números de dois profissionais lado a lado no mês. Verde com ▲ é quem está à frente em cada indicador; vermelho com ▼, quem está atrás; "=" é empate. No meio aparece a diferença. O barbeiro compara os próprios números com o líder de cada indicador; o dono e o gestor de área comparam quem podem ver.'],
    evoCasa: ['Evolução da empresa', 'Compara a soma de toda a equipe com ela mesma em outro período. Verde com ▲ é onde a empresa melhorou; vermelho com ▼, onde caiu. Ticket médio, ocupação e fidelização são calculados sobre os totais da equipe. Com o mês em andamento, compara o mesmo número de dias, a não ser que você marque o mês anterior inteiro.'],
    evo: ['Evolução', 'Compara o profissional com ele mesmo em outro período. Verde com ▲ é onde melhorou; vermelho com ▼, onde caiu. Com o mês em andamento, compara o mesmo número de dias (ex.: 1 a 7 deste mês × 1 a 7 do mês anterior), a não ser que você marque o mês anterior inteiro. Em períodos que não são o mês inteiro, entram os lançamentos por dia.'],
    access_lv: ['Nível de acesso', () => ACCESS_TIP()],
    leads: ['Interessados', 'Cadastros feitos na página de vendas (gest-o-a-vista.vercel.app/oferta) antes do quiz: nome, celular, e-mail e as respostas do quiz. Use a situação para organizar o contato: Novo, Contatado, Virou cliente ou Descartado. Só o dono do SaaS vê esta lista.'],
    pops: ['POPs · Guia do Sucesso', 'POP é o Procedimento Operacional Padrão: o jeito certo de fazer cada processo da barbearia. Cada POP tem o passo a passo em fotos (toque para ampliar) e, se houver, o link do vídeo. Só o dono cadastra e edita; toda a equipe consulta.'],
    extras: ['Acessos extras do líder', 'Liberações opcionais que você dá a um líder: conferir e aprovar o checklist de toda a equipe e/ou lançar à mão os números de toda a equipe só nos indicadores marcados. Os outros campos ficam só para leitura para ele. Campos que vêm da integração continuam travados.'],
    fechamento: ['Fechamento do mês', 'Apresentação para a equipe: mostra do último colocado ao 4º e depois o pódio, do 3º ao 1º. Cada lugar do pódio só aparece quando o gestor toca em Revelar. O resumo esconde o resultado para não estragar a surpresa se a tela estiver na TV.'],
  };
  function leaderExtrasBox(b) {
    const x = extrasOf(b.id), n = (x.review ? 1 : 0) + x.fields.length;
    return `<details class="lx" ${ui.lxOpen === b.id ? 'open' : ''} data-id="${esc(b.id)}">
      <summary>${icon('plus')} Acessos extras do líder ${n ? `<span class="chip chip-ok">${n} liberado${n > 1 ? 's' : ''}</span>` : '<span class="chip chip-soft">nenhum</span>'}${tip('extras')}</summary>
      <label class="check"><input type="checkbox" data-change="leaderExtra" data-id="${esc(b.id)}" data-k="review" ${x.review ? 'checked' : ''}><span><b>Conferir e aprovar o checklist de toda a equipe</b><small>Aprova ou recusa as provas dos colegas (nunca as próprias).</small></span></label>
      <p class="lx-sub">Lançar à mão os números de toda a equipe, só nestes indicadores:</p>
      <div class="lx-grid">${EXTRA_FIELDS().map(f => `<label class="check"><input type="checkbox" data-change="leaderExtra" data-id="${esc(b.id)}" data-k="f:${f.key}" ${x.fields.includes(f.key) ? 'checked' : ''}><span>${esc(f.label)}</span></label>`).join('')}</div>
    </details>`;
  }
  const ACCESS_TIP = () => ACCESS.map(([, l, d]) => `${l}: ${d}`).join(' ');
  const tip = key => TIPS[key] ? `<button type="button" class="tip" data-tip="${key}" aria-label="Explicação: ${esc(TIPS[key][0])}">?</button>` : '';
  const FIELD_TIP = { fat: 'fat', cli: 'cli', serv: 'serv', ticket: 'ticket', ocupPct: 'ocup', fidPct: 'fid', prod: 'prod', check: 'check', planos: 'planos', agend: 'agend', aus: 'aus', comanda: 'comanda' };
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
      <span class="brand-text"><span class="brand-name">Gestão ${B().word} <span class="brand-ia-word">IA</span></span>
      <span class="brand-sub">Sistema de gestão</span></span>
    </span>`;

  function toast(msg, ms = 2800, ic = '') {
    document.querySelectorAll('.toast').forEach(t => t.remove());
    const t = document.createElement('div');
    t.className = 'toast' + (ic ? ' toast-ic' : ''); t.setAttribute('role', 'status');
    if (ic) { t.innerHTML = icon(ic); const sp = document.createElement('span'); sp.textContent = L(msg); t.appendChild(sp); }
    else t.textContent = L(msg);
    document.body.appendChild(t);
    setTimeout(() => t.remove(), ms);
  }

  function readImage(file, max = 256, q = 0.85) {
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
          resolve(c.toDataURL('image/jpeg', q));
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
    const reduce = reduceMotion();
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
    const other = BRANDS[MARCA === 'salao' ? 'barber' : 'salao'];
    return `<div class="auth"><div class="auth-card">${brand('brand--lg')}${inner}
      ${Cloud.enabled ? `<button type="button" class="btn btn-block bc-demo-btn" data-action="startDemo" data-b="${MARCA}">${icon('monitor')} ${esc('Ver demonstração do ' + B().name)}</button>` : ''}
      <button type="button" class="link-btn bc-switch" data-action="pickBrand" data-b="${other.key}">${esc((MARCA === 'salao' ? 'É barbearia?' : 'É salão de beleza ou esmalteria?') + ' Use o ' + other.name)}</button>
      <p class="auth-foot">Cada atendimento conta.</p></div></div>`;
  }
  function tabs(active) {
    return `<div class="tabs" role="tablist">
      <button type="button" role="tab" aria-selected="${active === 'entrar'}" data-action="authMode" data-mode="entrar">Entrar</button>
      <button type="button" role="tab" aria-selected="${active === 'criar'}" data-action="authMode" data-mode="criar">Criar cadastro</button>
    </div>`;
  }

  // ---------- Ultrapassagens no ranking: histórico do mês (mesmo para todos, calculado dos dados) ----------
  // Refaz o ranking do mês dia a dia e registra quem passou quem. Mais recentes primeiro.
  function overtakes(ym) {
    const key = 'ovt' + ym;
    if (rkCache[key]) return rkCache[key];
    const mr = monthRange(ym), today = iso(new Date()), last = today < mr.end ? today : mr.end, ev = [];
    let prev = null;
    for (let d = fromIso(mr.start); iso(d) <= last; d.setDate(d.getDate() + 1)) {
      const day = iso(d);
      if (darkFor({ start: day, end: day })) break; // pódio surpresa: não entrega colocações
      const R = computeRanking({ ...state, entries: state.entries.filter(e => e.date <= day), pop: (state.pop || []).filter(r => r.day.length !== 10 || r.day <= day) }, mr);
      if (!R.active.length) { prev = null; continue; }
      const pos = Object.fromEntries(R.rows.map(r => [r.barber.id, r.pos]));
      if (prev) for (const r of R.rows) {
        const o = prev[r.barber.id];
        if (!o || o <= r.pos) continue;
        const passed = R.rows.filter(x => prev[x.barber.id] && prev[x.barber.id] < o && x.pos > r.pos).map(x => x.barber);
        if (passed.length) ev.push({ key: day + '|' + r.barber.id + '|' + r.pos, day, up: r.barber, pos: r.pos, passed });
      }
      prev = pos;
    }
    return (rkCache[key] = ev.reverse());
  }
  function overtakeFeed() {
    const ym = curYm();
    return [...overtakes(ym), ...overtakes(addMonths(ym, -1))].slice(0, 40);
  }
  const OVT_SEEN = 'ovtSeen';
  function unseenOvertakes() {
    const seen = DB.pref.get(OVT_SEEN, ''), f = overtakeFeed();
    const i = f.findIndex(e => e.key === seen);
    return i === -1 ? (seen ? Math.min(f.length, 9) : Math.min(f.length, 3)) : i;
  }
  const dayLabel = d => { const t = iso(new Date()), y = iso(new Date(Date.now() - 86400000)); return d === t ? 'Hoje' : d === y ? 'Ontem' : d.slice(8, 10) + '/' + d.slice(5, 7); };
  const ovtText = (e, rich) => {
    const nm = x => rich ? `<b>${esc(x.name)}</b>` : U(x.name);
    return `${nm(e.up)} ultrapassou ${e.passed.map(nm).join(' e ')} e assumiu o ${e.pos}º lugar`;
  };
  function notifPanel(user, pending) {
    if (!ui.notifOpen) return '';
    const f = overtakeFeed(), seen = ui.notifSeenBefore || '';
    const cut = f.findIndex(e => e.key === seen);
    return `<div class="notif-panel" role="dialog" aria-label="Notificações">
      <div class="notif-head"><b>Notificações</b><button class="icon-btn" data-action="notifOpen" aria-label="Fechar">${icon('x')}</button></div>
      ${pending ? `<a class="notif-item notif-app" href="#barbeiros">${icon('users')}<span><b>${pending} aprovação${pending > 1 ? 'ões' : ''} pendente${pending > 1 ? 's' : ''}</b><small>Toque para aprovar em Adicionar profissional</small></span></a>` : ''}
      <p class="notif-sub">${icon('trophy')} Ultrapassagens no ranking</p>
      ${f.length ? `<ul class="notif-list">${f.map((e, i) => `<li class="notif-item ${cut === -1 ? (seen ? 'new' : (i < 3 ? 'new' : '')) : (i < cut ? 'new' : '')}">
        ${avatar(e.up, 36)}<span><span>${ovtText(e, true)}</span><small>${dayLabel(e.day)}</small></span></li>`).join('')}</ul>`
        : '<p class="muted notif-empty">Nenhuma ultrapassagem neste mês ainda.</p>'}
    </div>`;
  }
  // Ao entrar: mostra embaixo a última ultrapassagem (uma vez por sessão).
  function maybeOvertakeToast() {
    const e = overtakeFeed()[0];
    if (!e) return;
    let shown = ''; try { shown = sessionStorage.getItem('gbia.ovtToast') || ''; } catch (x) { /* opcional */ }
    if (shown === e.key) return;
    try { sessionStorage.setItem('gbia.ovtToast', e.key); } catch (x) { /* opcional */ }
    setTimeout(() => toast(`${ovtText(e, false)}!`, 6000, 'check'), 900);
  }

  // ---------- Modo apresentação (números e profissionais fictícios) ----------
  const DEMO_ON = !!DB.demo;
  function demoBar(user) {
    if (!DEMO_ON) return '';
    const other = BRANDS[MARCA === 'salao' ? 'barber' : 'salao'];
    const asOwner = isGestor(user);
    return `<div class="demo-bar" role="region" aria-label="Modo apresentação">
      <span class="demo-tag">${icon('monitor')} <b>Modo apresentação</b><small>números e profissionais fictícios</small></span>
      <span class="demo-acts">
        <span class="seg demo-seg" role="group" aria-label="Ver como"><button type="button" class="${asOwner ? 'on' : ''}" data-action="demoAs" data-r="dono">Ver como dono</button><button type="button" class="${asOwner ? '' : 'on'}" data-action="demoAs" data-r="pro">Ver como profissional</button></span>
        <button type="button" class="btn btn-sm" data-action="startDemo" data-b="${other.key}">${esc('Trocar para ' + other.name)}</button>
        <button type="button" class="btn btn-sm" data-action="demoReset">Reiniciar</button>
        <button type="button" class="btn btn-sm btn-primary" data-action="demoExit">${icon('x')} Sair</button>
      </span></div>`;
  }
  function demoLogin(role) {
    const u = role === 'pro' ? state.users.find(x => x.role !== 'gestor' && x.status === 'ativo') : state.users.find(x => x.role === 'gestor');
    if (u) DB.session.set(u.id, false);
  }

  // Tela inicial: a empresa escolhe o sistema do negócio dela antes de entrar ou se cadastrar.
  function brandChooser() {
    const card = b => `<button type="button" class="bc-card bc-${b.key}" data-action="pickBrand" data-b="${b.key}">
      <img src="${b.logo}" alt="" width="512" height="512"><b>${esc(b.name)}</b><span>${esc(b.tagline)}</span><em>${icon('right')} Continuar</em></button>`;
    const demo = b => `<button type="button" class="link-btn bc-demo" data-action="startDemo" data-b="${b.key}">${icon('monitor')} ${esc('Ver demonstração do ' + b.name)}</button>`;
    return `<div class="auth bc"><div class="bc-in">
      <h1>Escolha o sistema do seu negócio</h1>
      <p>Toque na marca para entrar ou criar o cadastro.</p>
      <div class="bc-grid"><div class="bc-col">${card(BRANDS.barber)}${demo(BRANDS.barber)}</div><div class="bc-col">${card(BRANDS.salao)}${demo(BRANDS.salao)}</div></div>
      <p class="auth-foot">Cada atendimento conta.</p></div></div>`;
  }
  function renderAuth(mode, code) {
    document.body.classList.remove('has-nav');
    applyBrand(DB.pref.get('brand', '') || 'barber');
    if (!DB.pref.get('brand', '') && !['convite', 'novaSenha', 'recusado', 'semEmpresa', 'confirmar', 'enviado', 'pendente'].includes(mode)) { root.innerHTML = brandChooser(); return; }
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
    if (DEMO_ON) return;
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
      { r: 'performance', t: 'Minha performance', i: 'chart' },
      { r: 'lancamentos', t: 'Lançamentos', i: 'wallet', g: 1, a: 1 },
    ] },
    { group: 'Apresentações', items: [
      { r: 'apresentacao', t: 'Tela da loja', i: 'monitor' },
      { r: 'fechamento', t: 'Fechamento do mês', i: 'clipboard', g: 1, a: 1 },
      { r: 'temas', t: 'Temas', i: 'palette', g: 1 },
    ] },
    { group: 'GP · Gestão de pessoas', items: [
      { r: 'time', t: 'Performance da equipe', i: 'trophy' },
      { r: 'checklist', t: 'Checklist Agenda Cheia', i: 'checksq' },
      { r: 'pops', t: 'POPs · Guia do Sucesso', i: 'book' },
      { r: 'tarefas', t: 'Tarefas', i: 'clipboard', soon: 1 },
      { r: 'metas', t: 'Metas', i: 'target', soon: 1 },
      { r: 'premios', t: 'Prêmios e metas', i: 'gift', soon: 1 },
      { r: 'sonhos', t: 'Sonhos', i: 'rocket', soon: 1 },
      { r: 'organograma', t: 'Organograma', i: 'org', g: 1 },
    ] },
    { group: 'Gestor', g: 1, items: [
      { r: 'barbeiros', t: 'Adicionar profissional', i: 'users', g: 1 },
      { r: 'configuracoes', t: 'Configurações', i: 'gear' },
      { r: 'assinatura', t: 'Assinatura', i: 'card', cloud: 1 },
      { r: 'admin', t: 'Painel do SaaS', i: 'gauge', admin: 1 },
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
    cockpit: 'Visão rápida do gestor com os principais números do negócio.',
  };

  function drawer(user, route) {
    const g = isGestor(user);
    const groups = NAV.filter(gr => !gr.g || g).map(gr => {
      const am = isAreaMgr(user), hg = hasGrants(user);
      const lf = myExtras().fields.length > 0;
      const items = gr.items.filter(it => (!it.g || g || (it.a && am) || (it.r === 'lancamentos' && lf)) && (!it.cloud || billing()) && (!it.admin || (billing() && billing().admin))).map(it => `
        <a class="nav-item" href="#${it.r}" ${it.r === route ? 'aria-current="page"' : ''}>${icon(it.i)}<span>${esc(it.r === 'performance' && (g || hg) ? (g || accessOf(user.barberId) !== 'profissional' ? 'Performance da empresa' : 'Performance da área') : it.t)}</span>${it.soon ? '<span class="nav-soon">em breve</span>' : ''}</a>`).join('');
      return (gr.group ? `<div class="nav-group">${esc(gr.group)}</div>` : '') + items;
    }).join('');
    const periods = Object.entries(PERIOD_NAMES).map(([k, v]) =>
      `<button type="button" aria-pressed="${ui.period === k}" data-action="period" data-period="${k}">${v}</button>`).join('');
    return `
      <div class="scrim" hidden data-action="closeDrawer"></div>
      <nav class="drawer" aria-label="Menu principal">
        ${brand()}
        ${groups}
        <div class="nav-sep"></div>
        ${!DEMO_ON && isGestor(user) ? `<button class="nav-item" data-action="startDemo" data-b="${MARCA}">${icon('monitor')}<span>Modo apresentação</span></button>` : ''}
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
        <div class="popover-head">${avatar(who, 64)}<div><b>${esc(user.name)}</b><span>${esc(user.email)}</span>${isGestor(user) ? `<span>${esc(c.name)}</span>` : ''}</div></div>
        <label class="btn btn-dark btn-block" style="cursor:pointer">${icon('camera')} ${isGestor(user) ? 'Trocar logo da barbearia' : 'Atualizar foto'}
          <input type="file" accept="image/*" hidden data-change="${isGestor(user) ? 'companyLogo' : 'myPhoto'}"></label>
        <a class="btn btn-block" href="#cadastro">${icon('idcard')} Meu cadastro</a>
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
  // Salão: tiara no lugar da coroa (diamante rosa no MVP).
  function tiaraSvg(tier) {
    const id = 'tg-' + tier, mvp = tier === 'tier-mvp';
    const gem = mvp
      ? `<polygon points="52,-6 60,-20 68,-6 60,8" fill="url(#${id})" stroke="#fff" stroke-width="1.4"/><path d="M52 -6h16M56 -6l4 13 4-13" stroke="#fff" stroke-opacity=".8" stroke-width="1" fill="none"/>`
      : `<path d="M60 -16c6 7 6 13 0 17c-6-4-6-10 0-17z" fill="url(#${id})" stroke="#fff" stroke-width="1.3"/>`;
    return `<svg viewBox="0 -22 120 100" aria-hidden="true">
      <defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff"/><stop offset=".45" style="stop-color:var(--tc)"/><stop offset="1" style="stop-color:var(--tc2)"/></linearGradient></defs>
      <path d="M8 70 C30 48 90 48 112 70 L106 78 C86 62 34 62 14 78 Z" fill="url(#${id})" stroke="#fff" stroke-opacity=".7" stroke-width="1.4" stroke-linejoin="round"/>
      <path d="M20 62 Q24 40 34 34 Q36 46 44 54 M44 54 Q50 26 60 12 Q70 26 76 54 M76 54 Q84 46 86 34 Q96 40 100 62" fill="none" stroke="url(#${id})" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/>
      <circle cx="34" cy="32" r="4.2" fill="#fff"/><circle cx="86" cy="32" r="4.2" fill="#fff"/>
      <circle cx="30" cy="66" r="2.4" fill="#fff" opacity=".85"/><circle cx="45" cy="60" r="2.4" fill="#fff" opacity=".85"/><circle cx="75" cy="60" r="2.4" fill="#fff" opacity=".85"/><circle cx="90" cy="66" r="2.4" fill="#fff" opacity=".85"/>
      <circle cx="60" cy="58" r="3.4" fill="url(#${id})" stroke="#fff" stroke-width="1"/>
      ${gem}
      <g class="twinkle"><path d="M60 -22v8M56 -18h8" stroke="#fff" stroke-width="1.5" stroke-linecap="round"/></g>
    </svg>`;
  }
  function crownSvg(tier) {
    if (MARCA === 'salao') return tiaraSvg(tier);
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

  // ---------- temas do pódio: formato do escudo + tema da temporada ----------
  const PD_LAYOUTS = [
    { k: 'padrao', n: 'Padrão', d: 'O escudo clássico do Gestão Barber IA, com brilho e luzes.' },
    { k: 'escudo', n: 'Escudo', d: 'Flâmula com ponta embaixo, cor cheia e diamantes no 2º e 3º lugar.' },
    { k: 'tech', n: 'Tecnológico', d: 'Visual de painel futurista: cantos cortados, grade e foto hexagonal.' },
    { k: 'minimal', n: 'Minimalista', d: 'Cartões limpos, sem efeitos. Ideal para telas menores.' },
  ];
  // c: cores do 1º, 2º e 3º lugar [cor clara, cor escura]; fx: efeito no fundo; fxc: cores do efeito.
  const SEASONS = [
    { k: 'natal', n: 'Natal', when: '1 a 26 de dezembro', c: [['#ffd66b', '#b07c1c'], ['#5fe08a', '#17803c'], ['#ff5b5b', '#a3122a']], fx: 'snow', fxc: ['#ffffff'] },
    { k: 'anonovo', n: 'Ano Novo', when: '27 de dezembro a 7 de janeiro', c: [['#ffd66b', '#b07c1c'], ['#eef2fa', '#8790a6'], ['#f7c59f', '#a8643a']], fx: 'confetti', fxc: ['#ffd66b', '#ffffff', '#f7c59f'] },
    { k: 'carnaval', n: 'Carnaval', when: 'As duas semanas do Carnaval', c: [['#ffd23f', '#c27a00'], ['#c084ff', '#6a2bd1'], ['#3ee08f', '#0f8a52']], fx: 'confetti', fxc: ['#ffd23f', '#c084ff', '#3ee08f', '#ff5fa2', '#4cc9f0'] },
    { k: 'mulheres', n: 'Mês das Mulheres', when: 'Março', c: [['#d6a4ff', '#7a3fc4'], ['#ff9fd0', '#c2266f'], ['#ffb08f', '#c2553a']], fx: 'petal', fxc: ['#d6a4ff', '#ff9fd0', '#ffffff'] },
    { k: 'junina', n: 'Festa Junina', when: '1º de junho a 31 de julho', c: [['#ffc93c', '#b8650a'], ['#ff6b5b', '#a8231a'], ['#5aa8ff', '#1d55b8']], fx: 'spark', fxc: ['#ffb23f', '#ff7a1f', '#ffd66b'] },
    { k: 'pais', n: 'Dia dos Pais', when: 'Agosto, até o Dia dos Pais', c: [['#ffd66b', '#b07c1c'], ['#7fb2ff', '#23468f'], ['#d9a066', '#7a4a24']], fx: 'star', fxc: ['#ffd66b', '#ffffff'] },
    { k: 'criancas', n: 'Dia das Crianças', when: '5 a 12 de outubro', c: [['#ffd23f', '#c27a00'], ['#4cc9f0', '#1769a8'], ['#ff6b6b', '#b3262f']], fx: 'bubble', fxc: ['#ffd23f', '#4cc9f0', '#ff6b6b', '#7bdc6b'] },
    { k: 'outubrorosa', n: 'Outubro Rosa', when: 'Outubro', c: [['#ff8fc2', '#c2266f'], ['#ffd1e6', '#c4789c'], ['#ff5f97', '#9c1450']], fx: 'petal', fxc: ['#ff8fc2', '#ffd1e6', '#ffffff'] },
    { k: 'halloween', n: 'Halloween', when: '26 a 31 de outubro', c: [['#ff9a2e', '#b04a06'], ['#b47cff', '#4f22a0'], ['#95e85a', '#3c7d14']], fx: 'bat', fxc: ['#c9a0ff', '#ff9a2e'] },
    { k: 'copa', n: 'Copa do Mundo', when: 'Escolha manual nos dias de Copa', c: [['#ffdf3c', '#c99a00'], ['#3ee07a', '#0f8a3c'], ['#5aa0ff', '#1d3fb8']], fx: 'confetti', fxc: ['#ffdf3c', '#3ee07a', '#5aa0ff', '#ffffff'] },
    { k: 'aniversario', n: 'Aniversário', when: 'Semana do aniversário', c: [['#ffd66b', '#b07c1c'], ['#ff8fc7', '#b8327a'], ['#7fd8ff', '#1f78b8']], fx: 'confetti', fxc: ['#ffd66b', '#ff8fc7', '#7fd8ff', '#9be15d', '#ffffff'] },
    { k: 'novembroazul', n: 'Novembro Azul', when: 'Novembro', c: [['#6cc0ff', '#1b58c9'], ['#bcd9ff', '#4a6ea8'], ['#4fd6e0', '#127a85']], fx: 'bubble', fxc: ['#6cc0ff', '#bcd9ff'] },
  ];
  const seasonBy = k => SEASONS.find(s => s.k === k) || null;
  function pdTheme() {
    const t = state.theme || {};
    return { layout: PD_LAYOUTS.some(l => l.k === t.layout) ? t.layout : 'padrao', season: t.season === 'auto' || seasonBy(t.season) ? t.season : 'off', bday: /^\d{4}-\d{2}-\d{2}$/.test(t.bday || '') ? t.bday : '', autoOff: Array.isArray(t.autoOff) ? t.autoOff.filter(k => AUTO_KEYS.includes(k)) : [] };
  }
  // Tema automático pelo calendário.
  function easter(y) {
    const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
    const mo = Math.floor((h + l - 7 * m + 114) / 31), da = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(y, mo - 1, da);
  }
  // Aniversário da empresa: 3 dias antes até 3 dias depois da data.
  function bdayNear(d, bday) {
    if (!bday) return false;
    const [, mm, dd] = bday.split('-').map(Number);
    return [-1, 0, 1].some(k => Math.abs(Math.round((new Date(d.getFullYear() + k, mm - 1, dd) - d) / 864e5)) <= 3);
  }
  // Temas do calendário que valem na data, em ordem de prioridade (o 1º que estiver ligado no automático vence).
  function seasonsOn(dt, bday) {
    const d = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate()), y = d.getFullYear(), m = d.getMonth() + 1, day = d.getDate();
    const out = [];
    if (bdayNear(d, bday)) out.push('aniversario');
    const tue = easter(y); tue.setDate(tue.getDate() - 47);
    const diff = Math.round((d - tue) / 864e5);
    if (diff >= -12 && diff <= 1) out.push('carnaval');
    if (m === 12) out.push(day <= 26 ? 'natal' : 'anonovo');
    if (m === 1 && day <= 7) out.push('anonovo');
    if (m === 3) out.push('mulheres');
    if (m === 6 || m === 7) out.push('junina');
    if (m === 8) { const first = new Date(y, 7, 1).getDay(); if (day <= 1 + ((7 - first) % 7) + 7) out.push('pais'); }
    if (m === 10) { if (day >= 5 && day <= 12) out.push('criancas'); if (day >= 26) out.push('halloween'); out.push('outubrorosa'); }
    if (m === 11) out.push('novembroazul');
    return out;
  }
  const AUTO_KEYS = ['natal', 'anonovo', 'carnaval', 'mulheres', 'junina', 'pais', 'criancas', 'outubrorosa', 'halloween', 'novembroazul', 'aniversario'];
  function seasonOn(dt) {
    const th = pdTheme();
    return seasonsOn(dt, th.bday).find(k => !th.autoOff.includes(k)) || null;
  }
  function activeSeason() {
    const s = pdTheme().season;
    return s === 'off' ? null : seasonBy(s === 'auto' ? seasonOn(new Date()) : s);
  }
  function applyPdTheme() {
    const html = document.documentElement, s = activeSeason();
    html.dataset.pdl = pdTheme().layout;
    if (s) html.dataset.pds = s.k; else delete html.dataset.pds;
  }
  // Cores do tema no escudo (vence as cores de MVP, Destaque, prata e bronze).
  function seasonVars(place) {
    const s = activeSeason();
    if (!s) return '';
    const [a, b] = s.c[place - 1];
    return `;--tc:${a};--tc2:${b};--glow:color-mix(in srgb, ${a} 55%, transparent)`;
  }
  // Efeito de fundo do pódio (neve, confete, pétalas...).
  function seasonFx(s) {
    if (!s) return '';
    const n = s.fx === 'bat' ? 9 : s.fx === 'bubble' ? 14 : 24;
    const parts = Array.from({ length: n }, (_, i) => {
      const left = (i * 41 + 7) % 100, dl = ((i * 0.97) % 7).toFixed(2), dur = (6 + (i % 5) * 1.3).toFixed(1), sz = (0.7 + ((i * 13) % 7) / 10).toFixed(2);
      return `<span style="left:${left}%;--dl:-${dl}s;--dur:${dur}s;--sz:${sz};--c:${s.fxc[i % s.fxc.length]}"></span>`;
    }).join('');
    const flags = s.k === 'junina' ? `<svg class="pd-flags" viewBox="0 0 400 40" preserveAspectRatio="none" aria-hidden="true"><path d="M0 4 Q200 30 400 4" fill="none" stroke="#e9d9b8" stroke-width="1.2"/>${Array.from({ length: 15 }, (_, i) => {
      const x = 12 + i * 26.5, t = x / 400, yy = 4 + 4 * 26 * t * (1 - t);
      return `<path d="M${(x - 8).toFixed(1)} ${yy.toFixed(1)} L${(x + 8).toFixed(1)} ${yy.toFixed(1)} L${(x + 8).toFixed(1)} ${(yy + 16).toFixed(1)} L${x.toFixed(1)} ${(yy + 11).toFixed(1)} L${(x - 8).toFixed(1)} ${(yy + 16).toFixed(1)} Z" fill="${['#ff5b5b', '#ffc93c', '#5aa8ff', '#5fe08a', '#c084ff'][i % 5]}"/>`;
    }).join('')}</svg>` : '';
    return `<div class="pd-fx fx-${s.fx}" aria-hidden="true">${parts}</div>${flags}`;
  }
  // Enfeite do 1º lugar no lugar da coroa.
  function seasonTopper(k) {
    const T = {
      natal: `<path d="M18 62 C20 30 44 6 72 4 C88 3 98 10 100 20 L90 22 C84 18 80 22 82 32 C84 44 92 52 100 62 Z" fill="url(#st-g)"/><path d="M30 40 C40 22 56 12 72 10" stroke="#fff" stroke-opacity=".35" stroke-width="3" fill="none" stroke-linecap="round"/>
        <rect x="10" y="56" width="100" height="20" rx="10" fill="#fff"/><circle cx="99" cy="19" r="10" fill="#fff"/>
        <defs><linearGradient id="st-g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff5b5b"/><stop offset="1" stop-color="#b3101e"/></linearGradient></defs>`,
      anonovo: `<path d="M38 74 L60 4 L82 74 Z" fill="url(#st-g)" stroke="#fff" stroke-opacity=".7" stroke-width="1.4"/><path d="M47 46 L73 46 M42 60 L78 60 M53 28 L67 28" stroke="#1a1a24" stroke-width="4"/>
        <circle cx="60" cy="2" r="7" fill="#fff"/>
        <g stroke="#ffd66b" stroke-width="2" stroke-linecap="round" class="twinkle"><path d="M14 4v-10M14 14v10M4 9h-8M24 9h8M7 2l-5-5M21 16l5 5M21 2l5-5M7 16l-5 5"/></g>
        <g stroke="#fff" stroke-width="1.6" stroke-linecap="round"><path d="M106 22v-8M106 30v8M98 26h-6M114 26h6"/></g>
        <defs><linearGradient id="st-g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffe7a0"/><stop offset=".5" stop-color="#e2a92c"/><stop offset="1" stop-color="#9c6a12"/></linearGradient></defs>`,
      carnaval: `<path d="M94 30 C98 6 108 -8 116 -16 C116 4 110 20 100 32 Z" fill="#3ee08f"/><path d="M86 28 C86 2 92 -12 98 -20 C102 0 98 16 92 30 Z" fill="#ff5fa2"/><path d="M80 30 C76 8 78 -6 82 -14 C90 4 90 18 86 32 Z" fill="#4cc9f0"/>
        <path d="M8 42 C8 26 40 24 60 36 C80 24 112 26 112 42 C112 62 88 68 74 58 C68 54 52 54 46 58 C32 68 8 62 8 42 Z" fill="url(#st-g)" stroke="#ffd23f" stroke-width="2.5"/>
        <ellipse cx="36" cy="44" rx="12" ry="7.5" fill="#0b0b12"/><ellipse cx="84" cy="44" rx="12" ry="7.5" fill="#0b0b12"/>
        <circle cx="60" cy="40" r="3" fill="#ffd23f"/><circle cx="20" cy="36" r="2" fill="#fff"/><circle cx="100" cy="36" r="2" fill="#fff"/>
        <defs><linearGradient id="st-g" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#8a3fe0"/><stop offset=".5" stop-color="#c084ff"/><stop offset="1" stop-color="#8a3fe0"/></linearGradient></defs>`,
      mulheres: `<path d="M60 52 C58 62 60 70 62 78" stroke="#3fae6a" stroke-width="3.5" fill="none" stroke-linecap="round"/><path d="M61 66 C70 58 82 60 86 64 C78 70 68 70 61 66Z M60 70 C50 62 38 64 34 68 C42 74 52 74 60 70Z" fill="#3fae6a"/>
        ${[0, 60, 120, 180, 240, 300].map(a => `<ellipse cx="60" cy="10" rx="13" ry="21" transform="rotate(${a} 60 30)" fill="url(#st-g)" stroke="#fff" stroke-opacity=".5" stroke-width="1"/>`).join('')}
        <circle cx="60" cy="30" r="10" fill="#ffd23f" stroke="#fff" stroke-width="1.5"/>
        <defs><linearGradient id="st-g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f0d4ff"/><stop offset="1" stop-color="#9b55e6"/></linearGradient></defs>`,
      junina: `<ellipse cx="60" cy="66" rx="56" ry="12" fill="#e2b25a" stroke="#9c6a24" stroke-width="2"/><path d="M28 64 C28 30 42 16 60 16 C78 16 92 30 92 64 Z" fill="#efc76f" stroke="#9c6a24" stroke-width="2"/>
        <path d="M29 50 H91 V60 H29 Z" fill="#e0332f"/><rect x="66" y="26" width="13" height="11" fill="#4f8de8" transform="rotate(10 72 31)"/>
        <path d="M40 30 L50 32 M38 40 L48 41 M76 42 L86 40 M50 22 L58 24" stroke="#9c6a24" stroke-width="1.6" stroke-linecap="round"/>
        <path d="M14 70 L24 66 M96 66 L106 70 M30 74 L40 71" stroke="#9c6a24" stroke-width="1.4" stroke-linecap="round"/>`,
      pais: `<path d="M60 40 L16 16 C8 12 4 20 4 40 C4 60 8 68 16 64 Z" fill="url(#st-g)" stroke="#fff" stroke-opacity=".6" stroke-width="1.4"/><path d="M60 40 L104 16 C112 12 116 20 116 40 C116 60 112 68 104 64 Z" fill="url(#st-g)" stroke="#fff" stroke-opacity=".6" stroke-width="1.4"/>
        <rect x="48" y="28" width="24" height="24" rx="6" fill="#ffd66b" stroke="#fff" stroke-width="1.4"/><path d="M22 28 L34 34 M22 52 L34 46 M98 28 L86 34 M98 52 L86 46" stroke="#fff" stroke-opacity=".35" stroke-width="2"/>
        <g class="twinkle"><path d="M60 -12v10M55 -7h10" stroke="#ffd66b" stroke-width="1.8" stroke-linecap="round"/></g>
        <defs><linearGradient id="st-g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4d7fd6"/><stop offset="1" stop-color="#16316e"/></linearGradient></defs>`,
      criancas: `<path d="M60 78 C56 62 40 52 34 40 M60 78 C60 60 60 44 60 30 M60 78 C64 62 80 52 86 40" stroke="#fff" stroke-opacity=".8" stroke-width="1.4" fill="none"/>
        <ellipse cx="32" cy="22" rx="15" ry="18" fill="#ff6b6b"/><ellipse cx="88" cy="22" rx="15" ry="18" fill="#4cc9f0"/><ellipse cx="60" cy="8" rx="16" ry="19" fill="#ffd23f"/>
        <path d="M30 40 l2 4 2-4z M58 27 l2 4 2-4z M86 40 l2 4 2-4z" fill="#fff"/>
        <ellipse cx="27" cy="14" rx="4" ry="6" fill="#fff" opacity=".45"/><ellipse cx="55" cy="0" rx="4" ry="6" fill="#fff" opacity=".45"/><ellipse cx="83" cy="14" rx="4" ry="6" fill="#fff" opacity=".45"/>`,
      outubrorosa: `<path d="M38 78 L64 24 C72 6 70 -14 60 -14 C50 -14 48 6 56 24 L82 78" fill="none" stroke="url(#st-g)" stroke-width="15" stroke-linejoin="round"/>
        <path d="M60 -6 C54 -6 54 6 58 16" stroke="#fff" stroke-opacity=".5" stroke-width="2.5" fill="none" stroke-linecap="round"/>
        <defs><linearGradient id="st-g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffc2dd"/><stop offset="1" stop-color="#e0337e"/></linearGradient></defs>`,
      halloween: `<ellipse cx="60" cy="68" rx="54" ry="10" fill="#2a1840" stroke="#b47cff" stroke-width="2"/><path d="M32 66 L54 0 C58 -12 72 -16 82 -10 C72 -6 66 4 70 16 L88 66 Z" fill="#2a1840" stroke="#b47cff" stroke-width="2" stroke-linejoin="round"/>
        <path d="M37 50 L83 50 L87 62 L33 62 Z" fill="#ff8a1f"/><rect x="52" y="49" width="16" height="14" rx="2" fill="none" stroke="#ffd23f" stroke-width="2.6"/>
        <g class="twinkle"><path d="M98 0v8M94 4h8" stroke="#ffd23f" stroke-width="1.6" stroke-linecap="round"/></g>`,
      copa: `<circle cx="60" cy="38" r="32" fill="url(#st-g)" stroke="#fff" stroke-opacity=".8" stroke-width="1.6"/>
        <polygon points="60,26 71,34 67,47 53,47 49,34" fill="#15171f"/>
        <path d="M60 26 L60 8 M71 34 L88 28 M67 47 L78 62 M53 47 L42 62 M49 34 L32 28" stroke="#15171f" stroke-width="2"/>
        <path d="M54 6 L66 6 L64 10 L56 10 Z M86 22 L91 30 L89 34 L84 27 Z M80 64 L74 69 L70 66 L76 60 Z M40 64 L46 69 L50 66 L44 60 Z M34 22 L29 30 L31 34 L36 27 Z" fill="#15171f"/>
        <path d="M2 74 Q60 56 118 74" stroke="#3ee07a" stroke-width="5" fill="none" stroke-linecap="round"/><path d="M8 78 Q60 62 112 78" stroke="#ffdf3c" stroke-width="3" fill="none" stroke-linecap="round"/>
        <g class="twinkle"><path d="M104 0v10M99 5h10" stroke="#ffdf3c" stroke-width="1.8" stroke-linecap="round"/></g>
        <defs><radialGradient id="st-g" cx=".35" cy=".3" r=".8"><stop offset="0" stop-color="#ffffff"/><stop offset=".7" stop-color="#e8ecf2"/><stop offset="1" stop-color="#9aa3b5"/></radialGradient></defs>`,
      aniversario: `<rect x="22" y="44" width="76" height="32" rx="6" fill="url(#st-g)" stroke="#fff" stroke-opacity=".6" stroke-width="1.4"/>
        <rect x="34" y="22" width="52" height="24" rx="5" fill="#ff8fc7" stroke="#fff" stroke-opacity=".6" stroke-width="1.4"/>
        <path d="M22 50 Q28 58 34 50 Q40 58 46 50 Q52 58 58 50 Q64 58 70 50 Q76 58 82 50 Q88 58 94 50 Q97 54 98 50 L98 46 L22 46 Z" fill="#fff"/>
        <path d="M34 28 Q39 34 44 28 Q49 34 54 28 Q59 34 64 28 Q69 34 74 28 Q79 34 84 28 L86 25 L34 25 Z" fill="#fff"/>
        <circle cx="34" cy="64" r="2.4" fill="#ff8fc7"/><circle cx="52" cy="66" r="2.4" fill="#7fd8ff"/><circle cx="70" cy="64" r="2.4" fill="#9be15d"/><circle cx="86" cy="66" r="2.4" fill="#ff8fc7"/>
        <rect x="45" y="6" width="5" height="16" rx="1.5" fill="#7fd8ff"/><rect x="58" y="4" width="5" height="18" rx="1.5" fill="#ffd66b"/><rect x="71" y="6" width="5" height="16" rx="1.5" fill="#9be15d"/>
        <g class="twinkle"><path d="M47.5 -4 C44 1 45 5 47.5 5 C50 5 51 1 47.5 -4Z M60.5 -6 C57 -1 58 3 60.5 3 C63 3 64 -1 60.5 -6Z M73.5 -4 C70 1 71 5 73.5 5 C76 5 77 1 73.5 -4Z" fill="#ffb23f"/></g>
        <defs><linearGradient id="st-g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffe7a0"/><stop offset="1" stop-color="#c98a2a"/></linearGradient></defs>`,
      novembroazul: `<path d="M60 40 C52 26 34 24 22 36 C16 42 8 42 4 36 C6 54 24 60 38 54 C48 50 56 46 60 44 C64 46 72 50 82 54 C96 60 114 54 116 36 C112 42 104 42 98 36 C86 24 68 26 60 40 Z" fill="url(#st-g)" stroke="#fff" stroke-opacity=".75" stroke-width="1.6"/>
        <path d="M30 40 C40 34 50 36 56 42 M90 40 C80 34 70 36 64 42" stroke="#fff" stroke-opacity=".35" stroke-width="2" fill="none" stroke-linecap="round"/>
        <g class="twinkle"><path d="M60 -2v10M55 3h10" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/></g>
        <defs><linearGradient id="st-g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8fd0ff"/><stop offset="1" stop-color="#1b58c9"/></linearGradient></defs>`,
    };
    return `<svg viewBox="0 -22 120 100" aria-hidden="true">${(T[k] || '').replace(/st-g/g, 'st-' + k)}</svg>`;
  }
  // Diamante do 2º e 3º lugar (formato Escudo).
  const gemSvg = place => `<svg viewBox="0 0 40 32" aria-hidden="true"><defs><linearGradient id="gm-${place}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff"/><stop offset=".5" style="stop-color:var(--tc)"/><stop offset="1" style="stop-color:var(--tc2)"/></linearGradient></defs>
    <path d="M8 2h24l7 9-19 20L1 11z" fill="url(#gm-${place})" stroke="#fff" stroke-opacity=".8" stroke-width="1.2" stroke-linejoin="round"/><path d="M1 11h38M13 2l-3 9 10 20 10-20-3-9M10 11l10-9 10 9" fill="none" stroke="#fff" stroke-opacity=".55" stroke-width="1"/></svg>`;

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
      if (!row) return `<div class="pd pd-${place} tier-silver pd-empty" style="--in:${delay}${seasonVars(place)}"><div class="pd-float"><div class="pd-card"><div class="pd-frame"><div class="pd-inner"><span class="muted">Vago</span></div></div>
        <div class="pd-badge"><span>${ord(place)}<small>LUGAR</small></span></div></div></div><div class="pd-base"></div></div>`;
      const b = row.barber;
      const t = place === 1 && R.title.barberId === b.id ? R.title.type : null;
      const tier = place === 2 ? 'tier-silver' : place === 3 ? 'tier-bronze' : t === 'mvp' ? 'tier-mvp' : t === 'destaque' ? 'tier-gold' : 'tier-plat';
      const leadsTxt = `${row.leads.length} / ${R.N}`;
      const middle = t
        ? `<div class="pd-title"><span>${icon(t === 'mvp' ? 'diamond' : 'crown')}<span><b>${t === 'mvp' ? 'MVP' : 'DESTAQUE'}</b><i class="num">${leadsTxt}</i></span></span></div>`
        : '';
      const sn = activeSeason();
      const tierLbl = place === 2 ? 'Prata' : place === 3 ? 'Bronze' : t === 'mvp' ? 'MVP' : t === 'destaque' ? 'Destaque' : 'Ouro';
      return `<div class="pd pd-${place} ${tier}" data-id="${esc(b.id)}" data-pos="${place}" style="--in:${delay};--fd:${place === 1 ? '0s' : place === 2 ? '-2s' : '-4s'}${seasonVars(place)}">
        <div class="pd-beam"></div>
        ${place === 1 ? `<div class="pd-sparks">${sparks}</div>` : ''}
        <div class="pd-float">
          <div class="pd-card">
            ${place === 1 ? `<div class="pd-crown${sn ? ' pd-topper' : ''}">${sn ? seasonTopper(sn.k) : crownSvg(tier)}</div>` : `<div class="pd-gem">${gemSvg(place)}</div>`}
            <div class="pd-frame"><div class="pd-inner">
              ${pdPhoto(b)}
              <div class="pd-name">${esc(b.name)}</div>
              <hr class="pd-line">
              ${place === 1 ? middle : ''}
              <div class="pd-pts">${score(row.overall)}<small>pts</small></div>
              <div class="pd-money"><span class="pd-coin">$</span>${money0(row.sums.fat)}</div>
              ${t ? '' : `<div class="pd-leads" title="1º lugar em ${row.leads.length} de ${R.N} indicadores">${barsSvg}<span>${leadsTxt}</span></div>`}
              <div class="pd-tierlbl">${tierLbl}</div>
            </div></div>
            <div class="pd-badge"><span>${ord(place)}<small>LUGAR</small></span></div>
            <a class="pd-link" href="#perfil-${esc(b.id)}" aria-label="Ver perfil de ${esc(b.name)}, ${ord(place)} lugar"></a>
          </div>
        </div>
        <div class="pd-ped"></div>
        <div class="pd-base"><i></i><i></i></div>
      </div>`;
    };
    return `<div class="podium-x">${seasonFx(activeSeason())}<div class="pd-row">${card(rows[1], 2)}${card(rows[0], 1)}${card(rows[2], 3)}</div></div>`;
  }

  function podiumLegend(R) {
    return `<div class="pd-legend">
      <div class="lg-mvp">${icon('diamond')}<span><b>MVP</b>Lidera ${R.mvpNeed} ou mais indicadores.<em>${activeSeason() ? 'Selo MVP no 1º lugar.' : MARCA === 'salao' ? 'Contorno rosa (diamante rosa).' : 'Contorno azul (diamante).'}</em></span></div>
      <div class="lg-gold">${icon('crown')}<span><b>Destaque</b>Lidera no mínimo ${R.half} indicadores.<em>${activeSeason() ? 'Selo Destaque no 1º lugar.' : 'Contorno dourado.'}</em></span></div>
      <div class="lg-pts">${icon('trophy')}<span><b>Classificação por pontos</b>${activeSeason() ? `Tema ${esc(activeSeason().n)}: as cores do pódio seguem o tema.` : 'Sem título no período: contorno prata e bronze.'}</span></div>
    </div>`;
  }



  function prevPositions() {
    if (darkFor(range(ui.offset - 1))) return {};
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
        <div class="hl-head">${icon('trophy')}<span>Melhor em ${esc(ind.label)} · ${ind.weight} pts</span>${tip(ind.key)}</div>
        <div class="hl-who"><span class="avatar-stack">${leaders.slice(0, 3).map(b => avatar(b, 44)).join('')}</span><span>${leaders.map(b => esc(b.name)).join(' + ')}</span></div>
        <div class="hl-val num">${fmt(ind, row.values[ind.key])}</div>
        ${leaders.length > 1 ? '<span><span class="chip chip-tie">Empate na liderança</span></span>' : ''}
      </div>`;
    }).join('')}${(R.bonus || []).map(ind => {
      const leaders = ind.leaders.map(barberById).filter(Boolean);
      if (!leaders.length) return '';
      return `<div class="card card-glow hl hl-bonus">
        <div class="hl-head">${icon('trophy')}<span>${esc(ind.label)} · não pontua</span>${tip(ind.key)}</div>
        <div class="hl-who"><span class="avatar-stack">${leaders.slice(0, 3).map(b => avatar(b, 44)).join('')}</span><span>${leaders.map(b => esc(b.name)).join(' + ')}</span></div>
        <div class="hl-val num">${money2(ind.max)}</div>
      </div>`;
    }).join('')}</div>`;
  }

  function titleCard(R) {
    if (!R.title.type) {
      return `<div class="card title-card is-none">
        <div class="eyebrow">${icon('trophy')} Título do período ${tip('title')}</div>
        <h3>Ninguém conquistou título ainda</h3>
        <p class="muted">${R.N >= 2 ? `Destaque: 1º lugar em pelo menos ${R.half} indicadores. MVP: em ${R.mvpNeed}.` : 'Ainda não há indicadores suficientes com dados.'}</p></div>`;
    }
    const row = R.rows.find(r => r.barber.id === R.title.barberId);
    const names = row.leads.map(k => INDICATORS.find(i => i.key === k).label).join(' · ');
    const mvp = R.title.type === 'mvp';
    return `<div class="card title-card ${mvp ? 'is-mvp' : ''}">
      <div class="eyebrow">${icon(mvp ? 'diamond' : 'bolt')} ${mvp ? 'MVP do período' : 'Destaque do período'} ${tip('title')}</div>
      <h3>${esc(row.barber.name)}</h3>
      <p><b>${row.leads.length} de ${R.N} indicadores em 1º lugar</b></p>
      <p class="muted">${esc(names)}</p>
      ${mvp ? '' : '<p class="muted" style="font-size:.88rem;margin-top:6px">Mais um 1º lugar e vira MVP.</p>'}
    </div>`;
  }

  function inactiveNote(R) {
    const none = R.inactive.filter(i => i.reason === 'sem dados');
    if (!none.length) return '';
    return `<p class="section-note">Indicadores ainda sem dados (não aparecem e não pontuam): ${none.map(i => esc(i.label)).join(', ')}.</p>`;
  }



  function emptyBarbers() {
    const u = currentUser();
    return `<div class="card empty">${icon('users')}<h2>Nenhum barbeiro cadastrado</h2>
      <p>${isGestor(u) ? 'Cadastre a equipe e envie os convites para começar o ranking.' : 'O gestor ainda não cadastrou a equipe.'}</p>
      ${isGestor(u) ? `<a class="btn btn-primary" href="#barbeiros">${icon('plus')} Adicionar profissional</a>` : ''}</div>`;
  }

  // ---------- páginas ----------
  // Período do Início e da Tela da loja: Semana, Mês ou Trimestre, com setas.
  function periodBar() {
    const seg = Object.entries(PERIOD_NAMES).map(([k, v]) => `<button type="button" class="${ui.period === k ? 'on' : ''}" aria-pressed="${ui.period === k}" data-action="period" data-period="${k}">${v}</button>`).join('');
    return `<div class="period-bar"><div class="seg" role="group" aria-label="Período">${seg}</div>${periodNav()}</div>`;
  }
  const howLink = () => `<a class="how-link" href="#ajuda">${icon('help')} Como funciona a pontuação</a>`;

  // Na Semana só entram resultados diários; os lançamentos à mão são totais do mês.
  function monthOnlyData(R) {
    if (ui.period !== 'semana' || R.active.length) return false;
    const r = range(), months = new Set([r.start.slice(0, 7), r.end.slice(0, 7)]);
    return (state.monthly || []).some(m => months.has(m.month) && Object.keys(m).some(k => !['barberId', 'month', '_adj', 'aus'].includes(k) && isNum(m[k])));
  }
  // Semana sem dados diários, mas com lançamentos do mês: usa o mês (Tela da loja).
  function tvRange() {
    const r = range();
    if (ui.period !== 'semana') return r;
    const R = computeRanking(state, r);
    if (!monthOnlyData(R)) return r;
    return periodRange('mes', 0, fromIso(r.end > iso(new Date()) ? iso(new Date()) : r.end));
  }

  // ---------- Pódio surpresa ----------
  // Nos últimos dias do mês, a equipe não vê colocações nem pontuações. O gestor revela no Fechamento do mês.
  function revealCfg() {
    const r = state.reveal || {};
    return { on: !!r.on, days: Math.min(5, Math.max(1, Number(r.days) || 2)), since: r.since || '', done: r.done || {} };
  }
  function suspenseWin(ym, days) {
    const end = monthRange(ym).end, d = fromIso(end);
    return { ym, start: iso(new Date(d.getFullYear(), d.getMonth(), d.getDate() - days + 1)), end };
  }
  // Meses em segredo agora: o atual (nos últimos dias) e o anterior, enquanto o gestor não revelar.
  function suspenseWins() {
    const c = revealCfg();
    if (!c.on) return [];
    const today = iso(new Date()), ym = today.slice(0, 7), prev = addMonths(ym, -1), out = [];
    if (!c.done[prev] && c.since && prev >= c.since) out.push(suspenseWin(prev, c.days));
    const w = suspenseWin(ym, c.days);
    if (!c.done[ym] && today >= w.start) out.push(w);
    return out;
  }
  const inSuspense = rg => (rg && suspenseWins().find(w => rg.start <= w.end && rg.end >= w.start)) || null;
  // O gestor vê tudo, menos na Tela da loja (que fica à vista da equipe).
  const darkFor = (rg, tv) => (tv || !isGestor(currentUser()) ? inSuspense(rg) : null);
  function suspenseLeft(w) {
    const ms = fromIso(w.end).getTime() + 86400000 - Date.now();
    if (ms <= 0) return '';
    const d = Math.floor(ms / 86400000), h = Math.floor((ms % 86400000) / 3600000), m = Math.floor((ms % 3600000) / 60000);
    if (d > 0) return `${d} dia${d > 1 ? 's' : ''} e ${h} h`;
    return h > 0 ? `${h} h e ${m} min` : `${Math.max(1, m)} min`;
  }
  function suspenseCard(w, tv) {
    const left = suspenseLeft(w), month = esc(ymLabel(w.ym).replace(' de ', '/'));
    return `<section class="card sus-card ${tv ? 'sus-tv' : ''}">
      <div class="sus-podium" aria-hidden="true"><span class="s2">?</span><span class="s1">${icon('crown')}<b>?</b></span><span class="s3">?</span></div>
      <p class="sus-kicker">Pódio surpresa · ${month}</p>
      <h2>${left ? 'O pódio está guardado' : 'O pódio será revelado no fechamento'}</h2>
      <p>${left ? 'Na reta final do mês, as colocações e as pontuações ficam em segredo. A revelação acontece no fechamento do mês, com toda a equipe.' : 'O mês acabou. As colocações aparecem quando o gestor fizer o fechamento com a equipe.'}</p>
      ${left ? `<p class="sus-count"><b class="num" data-sus-end="${w.end}">${left}</b><small>para o fim do mês</small></p>` : ''}
    </section>`;
  }
  // Os próprios números do barbeiro durante o segredo (sem posição nem pontuação).
  function ownNumbers(R, bid, ym) {
    const row = bid && R.rows.find(r => r.barber.id === bid);
    if (!row) return '';
    const cards = GB.visibleInds(state).map(ind => {
      const v = row.values[ind.key];
      const goal = ym ? GB.goalFor(state, bid, ind.key) : 0;
      const pct = goal > 0 && v != null ? (v / goal) * 100 : null;
      return `<div class="card ind ${pct != null && pct >= 100 ? 'card-glow' : ''}">
        <div class="ind-top"><span>${esc(ind.label)} ${tip(ind.key)}</span>${goal > 0 ? `<span class="chip chip-soft">Meta ${fmtGoal(ind, goal)}</span>` : ''}</div>
        <div class="ind-val num">${fmt(ind, v)}${ind.key === 'check' && v != null ? ' pts' : ''}</div>
        ${pct != null ? `<div class="bar"><i style="width:${Math.max(2, Math.min(100, pct))}%"></i></div><div class="ind-foot"><span class="num">${nf0.format(pct)}% da meta</span></div>` : ''}
      </div>`;
    }).join('');
    return `<section class="section"><h2 class="section-title">Seus números ${ym ? 'no mês' : 'no período'}</h2>
      <p class="section-note">Só você vê estes números agora. Ainda dá tempo de subir: cada atendimento conta.</p>
      <div class="ind-grid">${cards}</div></section>`;
  }
  // Aviso para o gestor: a equipe não está vendo o pódio.
  function suspenseNote() {
    const ws = suspenseWins();
    if (!ws.length) return '';
    const w = ws[0], over = !suspenseLeft(w), month = esc(ymLabel(w.ym).replace(' de ', '/'));
    return `<div class="card sus-note"><p>${icon('crown')}<span><b>Pódio surpresa ativo (${month}).</b> A equipe e a Tela da loja não mostram colocações nem pontuações. ${over ? 'O mês acabou: faça o fechamento para revelar.' : 'Você continua vendo tudo.'}</span></p>
      ${over ? `<button class="btn btn-primary btn-sm" data-action="goFechamento" data-ym="${w.ym}">${icon('clipboard')} Ir ao fechamento</button>` : ''}</div>`;
  }
  function markRevealed(ym) {
    const c = revealCfg();
    const done = { ...c.done, [ym]: Date.now() };
    const keep = Object.keys(done).sort().slice(-12);
    state.reveal = { on: c.on, days: c.days, since: c.since, done: Object.fromEntries(keep.map(k => [k, done[k]])) };
    save();
  }
  // ---------- Revelação no celular da equipe ----------
  const seenKey = () => 'seenReveal:' + ((currentUser() || {}).id || '');
  const seenReveal = () => readJSON(seenKey(), {});
  function setSeen(ym) { const s = seenReveal(); s[ym] = Date.now(); DB.pref.set(seenKey(), JSON.stringify(s)); }
  const revealBC = 'BroadcastChannel' in window ? new BroadcastChannel('gbia-reveal') : null;
  function revealSend(m) {
    if (!ui.fx) return;
    const msg = { ...m, ym: ui.fx.ym };
    if (Cloud.enabled) Cloud.sendReveal(msg);
    else if (revealBC) revealBC.postMessage(msg);
  }
  function fxOpen(ym, mode) {
    ui.fx = { ym, i: 0, mode };
    try { Sound.ensure(); } catch (e) { /* o som pode precisar de um toque */ }
    keepAwake();
    fxRender();
  }
  // Ao vivo: cada passo do gestor aparece no celular de quem está com o app aberto.
  // A colocação vem dos dados deste aparelho; a mensagem só marca o momento.
  function onRevealMsg(m) {
    const u = currentUser();
    if (!u || isGestor(u) || !m || typeof m.ym !== 'string' || !/^\d{4}-\d{2}$/.test(m.ym) || location.hash === '#apresentacao') return;
    let fx = ui.fx;
    if (!(fx && fx.mode === 'live' && fx.ym === m.ym)) {
      if (fx || m.t === 'close' || m.t === 'final') return;
      if (!inSuspense(monthRange(m.ym)) || iso(new Date()) <= monthRange(m.ym).end) return;
      fxOpen(m.ym, 'live'); fx = ui.fx;
    }
    if (m.t === 'close') { if (!seenReveal()[m.ym]) fxClose(); return; }
    const { s } = fxSlides(m.ym);
    const idx = m.t === 'podium' ? 0 : m.t === 'final' ? s.length - 1 : s.findIndex(x => x.place === Number(m.place));
    if (idx < 0) return;
    if (fx.i !== idx) { fx.i = idx; fxRender(); }
    const slide = document.querySelector('#fx .fx-slide');
    if (!slide || !slide.classList.contains('is-suspense')) return;
    if (m.t === 'drum' && !slide.classList.contains('is-drum')) {
      slide.classList.add('is-drum'); Sound.play('rufar');
      clearTimeout(fx.timer); fx.timer = setTimeout(() => fxReveal(slide, Number(m.place)), 8000);
    }
    if (m.t === 'reveal') { clearTimeout(fx.timer); fxReveal(slide, Number(m.place)); }
  }
  if (revealBC) revealBC.onmessage = e => onRevealMsg(e.data);
  Cloud.onReveal = onRevealMsg;
  // Quem não viu ao vivo assiste à revelação uma vez, ao abrir o app.
  function maybeAutoReveal() {
    const u = currentUser();
    if (!u || isGestor(u) || ui.fx || location.hash === '#apresentacao' || document.getElementById('fx')) return;
    const done = revealCfg().done, seen = seenReveal();
    const ym = Object.keys(done).filter(k => !seen[k] && Date.now() - done[k] < 20 * 86400000).sort().pop();
    if (!ym) return;
    setSeen(ym);
    if (monthR(ym).rows.length && monthR(ym).active.length) fxOpen(ym, 'auto');
  }

  // Atualiza a contagem regressiva na tela.
  setInterval(() => {
    document.querySelectorAll('[data-sus-end]').forEach(el => { const t = suspenseLeft({ end: el.dataset.susEnd }); if (t) el.textContent = t; else render(); });
  }, 30000);

  function pageInicio(user) {
    const R = computeRanking(state, range());
    const w = darkFor(range());
    if (w) return `${periodBar()}${suspenseCard(w)}${ownNumbers(R, user.barberId, ui.period === 'mes' ? range().start.slice(0, 7) : null)}${howLink()}`;
    liveDetect(R);
    return `
      ${periodBar()}
      ${isGestor(user) ? suspenseNote() : ''}
      ${monthOnlyData(R) ? `<div class="card week-note"><p>${icon('help')}<span>Os resultados lançados à mão são <b>totais do mês</b>, por isso não aparecem na visão por semana. A Semana mostra só resultados diários (da integração ou do checklist).</span></p>
        <button class="btn btn-primary btn-sm" data-action="period" data-period="mes">Ver o mês</button></div>` : ''}
      <div class="home-cols">
        <section class="section"><h2 class="section-title">Pódio do período ${tip('score')}</h2>${podium(R)}</section>
        <section class="section"><h2 class="section-title">Ranking em tempo real ${tip('live')}</h2>${rankingList(R)}${R.N ? '' : '<p class="section-note">Ainda não há resultados lançados neste período.</p>'}</section>
      </div>
      ${R.rows.length ? titleCard(R) : ''}
      ${howLink()}`;
  }

  // ---------- Performance da equipe (antigo Time e ranking, por mês) ----------
  const curYm = () => iso(new Date()).slice(0, 7);
  const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
  const ymLabel = ym => cap(monthRange(ym).label);
  const ymShort = ym => { const l = monthRange(ym).label; return cap(l.slice(0, 3)) + '/' + ym.slice(2, 4); };
  const monthR = ym => rkCache[ym] || (rkCache[ym] = computeRanking(state, monthRange(ym)));
  const ROLES = ['Barbeiro', 'Barbeiro líder', 'Aprendiz', 'Recepcionista', 'Gerente'];
  // Sugestões para o campo Função (o dono pode escrever qualquer outra).
  const roleList = () => `<datalist id="role-list">${[...new Set([...B().roles, ...state.barbers.map(b => b.role).filter(Boolean)])].map(r => `<option value="${esc(r)}">`).join('')}</datalist>`;
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
      if (darkFor(monthRange(k))) continue;
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
      if (darkFor(monthRange(k))) continue;
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
      ${(isGestor(user) || isAreaMgr(user)) ? `<span class="chip chip-ok tm-saved" id="tm-saved">${icon('check')} Salvo automaticamente</span>` : ''}
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
          <span class="muted num">${r.leads.length} de ${R.N} em 1º${' · ' + money0(r.sums.fat)}</span>
          <div class="cc-meta"><span class="lv ${lv.cls}">${lv.name}</span>${delta}<span class="muted num">carreira ${nf1.format(c.value)}</span></div>
          <div class="cc-chips">${R.active.map(i => `<span class="rk-chip ${i.leaders.includes(r.barber.id) ? 'lead' : ''}">${esc(i.label)}: <b class="num">${ord(r.ranks[i.key])}</b></span>`).join('')}</div>
        </div>
        <span class="cc-score num">${score(r.overall)}</span>
      </article>`;
    }).join('')}</div>`;
  }

  function teamTop(ym) {
    const R = monthR(ym);
    return `<section class="section"><h2 class="section-title">Destaques por indicador ${tip('leaders')}</h2>${highlights(R)}${titleCard(R)}${inactiveNote(R)}</section>
      <section class="section"><h2 class="section-title">Classificação geral ${tip('career')}</h2>
        <p class="section-note">Toque num barbeiro para ver as métricas, a carreira e as metas dele.</p>${classCards(R, ym)}</section>`;
  }

  const r2v = v => Math.round(v * 100) / 100;
  function editorFields(b, ym) {
    const rec = (state.monthly || []).find(m => m.barberId === b.id && m.month === ym) || {};
    const integ = monthFromIntegration(state, b.id, ym);
    const R = monthR(ym);
    const row = R.rows.find(r => r.barber.id === b.id);
    const hidden = state.hidden || [];
    return GB.MONTH_FIELDS.filter(f => !hidden.includes(GB.FIELD_IND[f.key] || f.key)).map(f => {
      if (f.calc) {
        const t = row && row.sums.cli > 0 ? row.sums.fat / row.sums.cli : null;
        return `<div class="field"><span class="tm-flabel"><span class="tm-ft">${esc(f.label)}${tip(FIELD_TIP[f.key])}</span><span class="lock">${icon('chart')} Calculado</span></span>
          <input class="input num" id="m-${f.key}" value="${t == null ? '' : nf2.format(t)}" readonly tabindex="-1" placeholder="Faturamento ÷ clientes"></div>`;
      }
      const fmtV = v => f.key.endsWith('Pct') ? nf2.format(v) + '%' : (f.step === '0.01' ? money2(v) : nf0.format(v));
      if (f.key === 'check' && integ._pop) {
        return `<div class="field"><span class="tm-flabel"><span class="tm-ft">${esc(f.label)}${tip(FIELD_TIP[f.key])}</span><span class="lock">${icon('lock')} Vindo do checklist</span></span>
          <input class="input num" id="m-${f.key}" value="${nf1.format(integ[f.key])}" readonly tabindex="-1"></div>`;
      }
      const fromApi = f.daily && isNum(integ[f.key]);
      const own = isGestor(currentUser());
      if (fromApi && !isNum(rec[f.key])) {
        // Valor da integração: travado. Só o dono destrava para um ajuste manual.
        const ask = ui.confirm === 'unlock' + b.id + f.key;
        return `<div class="field"><span class="tm-flabel"><span class="tm-ft">${esc(f.label)}${tip(FIELD_TIP[f.key])}</span>${own
            ? `<button type="button" class="lock lock-btn" data-action="apiUnlock" data-id="${esc(b.id)}" data-k="${f.key}" aria-label="Destravar ${esc(f.label)} para ajuste manual">${icon('lock')} Vindo da integração</button>`
            : `<span class="lock">${icon('lock')} Vindo da integração</span>`}</span>
          <input class="input num" id="m-${f.key}" value="${fmtV(integ[f.key])}" readonly tabindex="-1">
          ${ask ? `<div class="unlock-ask" role="alert"><p>Este número veio da integração. Ajustar à mão substitui o valor da API neste mês.</p>
            <div class="btn-row"><button type="button" class="btn btn-sm btn-primary" data-action="apiAdjust" data-id="${esc(b.id)}" data-k="${f.key}">${icon('edit')} Ajustar</button>
            <button type="button" class="btn btn-sm" data-action="apiUnlockCancel">Cancelar</button></div></div>` : ''}</div>`;
      }
      if (fromApi && isNum(rec[f.key])) {
        const adj = rec._adj && rec._adj[f.key];
        const meta = `API: ${fmtV(integ[f.key])}${adj ? ` · ajustado por ${esc(adj.by || 'gestão')} em ${new Date(adj.at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}` : ''}`;
        return `<div class="field"><label for="m-${f.key}" class="tm-flabel"><span class="tm-ft">${esc(f.label)}${tip(FIELD_TIP[f.key])}</span><span class="lock lock-adj">${icon('edit')} Ajuste manual</span></label>
          <input class="input ${own ? 'input-edit' : ''} num" id="m-${f.key}" name="${f.key}" type="number" inputmode="decimal" min="0" ${f.max ? `max="${f.max}"` : ''} step="${f.step}" value="${rec[f.key]}" ${own ? `data-auto="month" data-id="${esc(b.id)}"` : 'readonly tabindex="-1"'}>
          <small class="adj-meta">${meta}</small>
          ${own ? `<button type="button" class="link-btn adj-undo" data-action="apiRevert" data-id="${esc(b.id)}" data-k="${f.key}">${icon('undo')} Voltar ao valor da integração</button>` : ''}</div>`;
      }
      const isSum = GB.SUM_KEYS.includes(f.key);
      const hasMan = isSum && GB.manualEntries(state, b.id, ym).some(e => isNum(e[f.key]));
      const shownV = isNum(rec[f.key]) ? rec[f.key] : (hasMan ? GB.manualTotal(state, b.id, ym, f.key) : '');
      if (!fieldOk(b.id, f.key)) {
        return `<div class="field"><span class="tm-flabel"><span class="tm-ft">${esc(f.label)}${tip(FIELD_TIP[f.key])}</span><span class="lock">${icon('eye')} Só leitura</span></span>
          <input class="input num" id="m-${f.key}" value="${shownV === '' ? '' : fmtV(shownV)}" placeholder="—" readonly tabindex="-1"></div>`;
      }
      return `<label class="field"><span class="tm-flabel"><span class="tm-ft">${esc(f.label)}${tip(FIELD_TIP[f.key])}</span>${isSum ? '<span class="lock lock-sum">Total do mês</span>' : ''}</span>
        <input class="input input-edit num" id="m-${f.key}" name="${f.key}" type="number" inputmode="decimal" min="0" ${f.max ? `max="${f.max}"` : ''} step="${f.step}" value="${shownV}" placeholder="—" data-auto="month" ${isSum ? 'data-sum="1"' : ''} data-id="${esc(b.id)}"></label>`;
    }).join('');
  }

  // Data em que entra a diferença do lançamento (dentro do mês escolhido).
  function lanDate(ym) {
    const r = monthRange(ym), t = iso(new Date());
    if (ui.lanDate && ui.lanDate >= r.start && ui.lanDate <= r.end) return ui.lanDate;
    return t >= r.start && t <= r.end ? t : r.end;
  }
  // Histórico do mês: o que entrou à mão em cada dia.
  function lanHistory(b, ym) {
    const L = { fat: v => money0(v), cli: v => nf0.format(v) + ' clientes', serv: v => nf0.format(v) + ' serviços', prod: v => nf0.format(v) + ' produtos', check: v => nf1.format(v) + ' pts checklist', planos: v => nf0.format(v) + ' planos' };
    const days = GB.manualEntries(state, b.id, ym).filter(e => GB.SUM_KEYS.some(k => isNum(e[k]) && Number(e[k]) !== 0)).sort((a, c) => c.date.localeCompare(a.date));
    if (!days.length) return '';
    return `<details class="lan-hist" ${ui.lanHistOpen ? 'open' : ''}><summary>Lançamentos por dia em ${esc(ymLabel(ym).replace(' de ', '/'))} (${days.length})</summary>
      <ul>${days.map(e => `<li><b class="num">${dateBR(e.date).slice(0, 5)}</b><span>${GB.SUM_KEYS.filter(k => isNum(e[k]) && Number(e[k]) !== 0).map(k => L[k](Number(e[k]))).join(' · ')}</span></li>`).join('')}</ul></details>`;
  }

  function teamEditor(ym) {
    const own = isGestor(currentUser());
    const list = state.barbers.filter(b => b.active !== false && canLanB(b.id));
    if (!list.length) return emptyBarbers();
    const sel = list.find(b => b.id === ui.teamBarber) || list[0];
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
      ${own ? '' : canEditB(sel.id) ? `<p class="section-note">Você lança os números das pessoas da sua área.</p>` : `<p class="section-note">Liberado pelo dono para você lançar: <b>${EXTRA_FIELDS().filter(f => myExtras().fields.includes(f.key)).map(f => esc(f.label)).join(', ')}</b>. Os outros campos ficam só para leitura.</p>`}
      <div class="tm-photo">${avatar(sel, 96)}${own ? '' : '</div><!--'}<label class="btn btn-sm" style="cursor:pointer">${icon('camera')} Trocar foto<input type="file" accept="image/*" hidden data-change="barberPhoto" data-id="${esc(sel.id)}"></label>${own ? '</div>' : '-->'}
      <div class="tm-fixed"><small>Nome (fixo)</small><b>${esc(sel.name)}</b></div>
      ${own ? `<div class="grid-2">
        <label class="field"><span class="tm-flabel">Instagram</span><input class="input input-edit" id="m-instagram" name="instagram" value="${esc(sel.instagram || '')}" placeholder="@usuario" data-auto="barber" data-id="${esc(sel.id)}"></label>
        <label class="field"><span class="tm-flabel">Função</span><input class="input input-edit" id="m-role" name="role" list="role-list" value="${esc(sel.role || '')}" placeholder="Ex.: Barbeiro" maxlength="60" data-auto="barber" data-id="${esc(sel.id)}">${roleList()}</label>
      </div>` : ''}
      <div class="lan-date"><label class="field"><span class="tm-flabel">Data do lançamento${tip('lanDate')}</span>
        <input class="input" type="date" id="m-date" value="${lanDate(ym)}" min="${monthRange(ym).start}" max="${monthRange(ym).end}" data-change="lanDate"></label>
        <p class="section-note">Os campos mostram o total do mês. Ao mudar um total, a diferença entra nesta data e já aparece na visão por semana.</p></div>
      <div class="grid-2" id="tm-fields">${editorFields(sel, ym)}</div>
      <div id="tm-hist">${lanHistory(sel, ym)}</div>
      ${own ? `<details class="tm-goals"><summary>Metas individuais de ${esc(sel.name.split(' ')[0])} <span class="muted">(em branco = meta da equipe)</span></summary>
        <div class="grid-2">${GB.visibleInds(state).map(i => `<label class="field"><span class="tm-flabel">${esc(i.label)}</span><input class="input input-edit num" id="g-${i.key}" name="${i.key}" type="number" min="0" step="any" value="${isNum(goals[i.key]) ? goals[i.key] : ''}" placeholder="Equipe: ${esc(fmtGoal(i, GB.goalFor(state, '', i.key)))}" data-auto="goal" data-id="${esc(sel.id)}"></label>`).join('')}</div>
      </details>` : ''}
      <p class="section-note" id="tm-pos">${row ? `Posição atual: ${ord(row.pos)} · pontuação ${score(row.overall)} / 100.` : ''} Tudo é salvo automaticamente no mês selecionado.</p>
    </section>`;
  }

  function strengths(row, prevRow, R, barberId, ymArg) {
    // No mês em andamento, metas de soma ficam proporcionais aos dias já passados.
    const ym = ymArg || ui.teamMonth || curYm();
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
    const note = frac < 1 ? `<p class="section-note">Mês em andamento: metas de faturamento, serviços, clientes, Checklist Agenda Cheia, planos e produtos estão proporcionais aos ${today.getDate()} dias já passados.</p>` : '';
    return `<section class="section card"><h2 class="section-title st-good">Onde é forte</h2>${note}<div class="stack">${strong.map(i => card(i, 'strong')).join('')}</div></section>
      ${weak.length ? `<section class="section card"><h2 class="section-title st-badt">Onde precisa melhorar</h2><div class="stack">${weak.map(i => card(i, 'weak')).join('')}</div></section>` : ''}`;
  }

  function teamInsights(barberId, ym) {
    const b = barberById(barberId);
    if (!b) return '';
    const R = monthR(ym);
    const row = R.rows.find(r => r.barber.id === b.id);
    if (!row) return `<div class="card muted">${esc(b.name)} está inativo e não aparece no ranking.</div>`;
    const c = career(b.id, ym);
    const lv = levelOf(c.value);
    return `
      <section class="card pp-head">
        ${avatar(b, 64)}
        <div class="pp-who"><small class="tm-eyebrow">Profissional selecionado</small><h2>${esc(b.name)} ${titleChip(R, b.id)}</h2>
          <p class="pp-chips"><span class="chip chip-soft num">${ord(row.pos)} de ${R.rows.length}</span><span class="chip chip-soft num">${score(row.overall)} pts</span><span class="chip lv-chip ${lv.cls}">${lv.name}</span><span class="chip chip-soft num">Carreira ${nf1.format(c.value)} pts${tip('career')}</span></p></div>
        <div class="pp-acts"><button class="btn btn-sm" data-action="cmpWith" data-id="${esc(b.id)}">${icon('users')} Comparar com…</button><a class="btn btn-sm" href="#perfil-${esc(b.id)}">${icon('chart')} Performance completa</a>
          <button class="icon-btn" data-action="profClose" aria-label="Fechar">${icon('x')}</button></div>
      </section>`;
  }

  function teamRadars(ym, monthOnly) {
    const R = monthR(ym);
    if (!R.rows.length) return '';
    let sel = (ui.radarSel || []).filter(id => R.rows.some(r => r.barber.id === id));
    if (!sel.length) sel = R.rows.slice(0, monthOnly ? 3 : 2).map(r => r.barber.id);
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
    if (monthOnly) {
      return `<section class="section card">
        <h2 class="section-title">Radar do mês · ${esc(ymLabel(ym).replace(' de ', '/'))} (100 = líder)</h2>
        <p class="section-note">Escolha até 4 profissionais para comparar.</p>
        <div class="rd-chips">${chips}</div>
        <div class="rd-box rd-single">${radarSvg(R.active, monthSeries)}<div class="ch-legend">${legend}</div></div>
        <p class="section-note" style="text-align:center">Mesma régua do ranking e do pódio: 100 = líder do indicador. Cada pessoa mostra o percentual do que fez em relação ao líder.</p>
      </section>`;
    }
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


  // Tabela "Detalhado por profissional" (Performance da equipe). Cada um vê quem pode ver.
  function profTable(ym) {
    const R = monthR(ym);
    const vis = k => GB.visibleInds(state).some(i => i.key === k);
    const rows = R.rows.filter(r => seeNum(r.barber.id)).sort((a, b) => b.sums.fat - a.sums.fat);
    if (!rows.length) return '';
    const cols = [
      ['Faturamento', r => money0(r.sums.fat), true],
      ['Clientes', r => nf0.format(r.sums.cli), true],
      ['Serviços', r => nf0.format(r.sums.serv), true],
      ['Ticket médio', r => r.sums.cli > 0 ? money0(r.sums.fat / r.sums.cli) : '—', vis('ticket')],
      ['Ocupação', r => r.values.ocup != null ? nf1.format(r.values.ocup) + '%' : '—', vis('ocup')],
      ['Produtos', r => nf0.format(r.sums.prod || 0), vis('prod')],
      ['Planos', r => nf0.format(r.sums.planos), vis('planos')],
      ['Maior comanda', r => r.sums.n.comanda ? money0(r.sums.comanda) : '—', true],
    ].filter(c => c[2]);
    const all = rows.length === R.rows.length;
    return `<section class="section card">
        <h2 class="section-title">Detalhado por profissional</h2>
        <p class="section-note">Toque num profissional para ver o resumo dele; o faturamento por mês, a evolução e os pontos fortes e a melhorar ficam na performance completa.${all ? '' : ' Aparecem só os profissionais cujos números detalhados você pode ver.'}</p>
        <div class="table-wrap"><table class="pc-table"><thead><tr><th>Profissional</th>${cols.map(c => `<th>${c[0]}${tip({ Faturamento: 'fat', Clientes: 'cli', Serviços: 'serv', 'Ticket médio': 'ticket', Ocupação: 'ocup', Produtos: 'prod', Planos: 'planos', 'Maior comanda': 'comanda' }[c[0]])}</th>`).join('')}<th>Pontos${tip('score')}</th></tr></thead><tbody>
          ${rows.map(r => `<tr class="${ui.profSel === r.barber.id ? 'on' : ''}" data-action="profPick" data-id="${esc(r.barber.id)}"><td><button type="button" class="td-who" data-action="profPick" data-id="${esc(r.barber.id)}" aria-expanded="${ui.profSel === r.barber.id}">${avatar(r.barber, 36)}<span>${esc(r.barber.name)}</span></button></td>
            ${cols.map(c => `<td>${c[1](r)}</td>`).join('')}<td class="td-score">${score(r.overall)}</td></tr>`).join('')}
        </tbody></table></div>
      </section>`;
  }


  // ---------- Comparativos: profissional × profissional e profissional × ele mesmo ----------
  const CMP_EXTRA = [{ key: '_score', label: 'Pontuação geral', fmt: 'dec1' }, { key: '_leads', label: 'Indicadores em 1º', fmt: 'int' }];
  const cmpFmt = (ind, v) => v == null ? '—' : ind.fmt === 'dec1' ? nf1.format(v) : fmt(ind, v) + (ind.key === 'check' ? ' pts' : '');
  function cmpDiff(ind, a, b) {
    if (a == null || b == null) return '';
    const d = a - b;
    if (Math.abs(d) < 1e-9) return 'Empate';
    const sign = d > 0 ? '+' : '−', ad = Math.abs(d);
    const val = ind.fmt === 'pct' ? nf1.format(ad) + ' p.p.' : ind.fmt === 'dec1' ? nf1.format(ad) + ' pts' : fmt(ind, ad);
    const pct = b > 0 && ind.fmt !== 'pct' ? ` (${sign}${nf0.format((ad / b) * 100)}%)` : '';
    return sign + val + pct;
  }
  // Uma linha: valor de A à esquerda, indicador e diferença no meio, valor de B à direita.
  function cmpRow(ind, a, b, subA, subB) {
    const has = a != null && b != null;
    const ca = !has || Math.abs(a - b) < 1e-9 ? 'eq' : a > b ? 'up' : 'down';
    const cb = ca === 'up' ? 'down' : ca === 'down' ? 'up' : 'eq';
    const ar = c => c === 'up' ? '<i class="cmp-ar" aria-label="maior">▲</i>' : c === 'down' ? '<i class="cmp-ar" aria-label="menor">▼</i>' : has ? '<i class="cmp-ar" aria-label="empate">=</i>' : '';
    return `<div class="cmp-row">
      <div class="cmp-v ${has ? 'c-' + ca : ''}"><b class="num">${cmpFmt(ind, a)}</b>${ar(ca)}${subA ? `<small>${subA}</small>` : ''}</div>
      <div class="cmp-mid"><span>${esc(ind.label)}${tip(ind.key)}</span><small class="num">${cmpDiff(ind, a, b)}</small></div>
      <div class="cmp-v r ${has ? 'c-' + cb : ''}">${ar(cb)}<b class="num">${cmpFmt(ind, b)}</b>${subB ? `<small>${subB}</small>` : ''}</div>
    </div>`;
  }
  const cmpVals = (R, row) => {
    const o = {};
    for (const ind of GB.visibleInds(state)) o[ind.key] = row && R.active.some(a => a.key === ind.key) ? row.values[ind.key] : null;
    o._score = row && R.active.length ? row.overall : null; o._leads = row && R.active.length ? row.leads.length : null;
    return o;
  };
  function cmpList(va, vb, subs, extra = CMP_EXTRA) {
    const inds = [...GB.visibleInds(state), ...extra];
    let wa = 0, wb = 0;
    for (const i of GB.visibleInds(state)) { const a = va[i.key], b = vb[i.key]; if (a != null && b != null) { if (a > b) wa++; else if (b > a) wb++; } }
    return { html: `<div class="cmp-list">${inds.map(i => cmpRow(i, va[i.key], vb[i.key], subs && subs.a && subs.a[i.key], subs && subs.b && subs.b[i.key])).join('')}</div>`, wa, wb };
  }
  const cmpWhoCard = (b, info, winsText, side) => `<div class="cmp-who ${side}">${b ? avatar(b, 52) : `<span class="cmp-crown">${icon('crown')}</span>`}
    <b>${esc(b ? b.name : 'Líder de cada indicador')}</b>${info}${winsText ? `<span class="cmp-wins num">${winsText}</span>` : ''}</div>`;

  // Quem a pessoa pode comparar: dono todos; gestor de área a área; barbeiro só a si mesmo (contra o líder).
  function cmpPeople(R) {
    const u = currentUser();
    return R.rows.filter(r => isGestor(u) || seeNum(r.barber.id)).map(r => r.barber);
  }
  function compareCard(ym) {
    const R = monthR(ym);
    if (!R.rows.length || !R.active.length) return '';
    const people = cmpPeople(R);
    if (!people.length) return '';
    const u = currentUser();
    const ids = people.map(b => b.id);
    let a = ids.includes(ui.cmpA) ? ui.cmpA : (ids.includes(u.barberId) ? u.barberId : ids[0]);
    let b = ui.cmpB === 'lider' || (ids.includes(ui.cmpB) && ui.cmpB !== a) ? ui.cmpB : (ids.find(x => x !== a) || 'lider');
    ui.cmpA = a; ui.cmpB = b;
    const rA = R.rows.find(r => r.barber.id === a);
    const va = cmpVals(R, rA);
    let vb, subB = null, bBarber = null, infoB;
    if (b === 'lider') {
      vb = {}; subB = {};
      for (const ind of GB.visibleInds(state)) {
        const act = R.active.find(x => x.key === ind.key);
        vb[ind.key] = act ? act.max : null;
        subB[ind.key] = act ? act.leaders.map(id => first((barberById(id) || {}).name || '')).join(' + ') : '';
      }
      vb._score = Math.max(...R.rows.map(r => r.overall)); vb._leads = null;
      infoB = `<small>O melhor resultado do mês em cada indicador</small>`;
    } else {
      const rB = R.rows.find(r => r.barber.id === b);
      vb = cmpVals(R, rB); bBarber = rB.barber;
      infoB = `<small class="num">${ord(rB.pos)} de ${R.rows.length} · ${score(rB.overall)} pts</small>${titleChip(R, b)}`;
    }
    const L = cmpList(va, vb, { b: subB });
    const n = GB.visibleInds(state).filter(i => va[i.key] != null && vb[i.key] != null).length;
    const opt = (sel, list, extra) => list.map(x => `<option value="${esc(x.id)}" ${x.id === sel ? 'selected' : ''}>${esc(x.name)}</option>`).join('') + (extra || '');
    const pickA = people.length > 1 ? `<select class="input" id="cmp-a" data-change="cmpA" aria-label="Profissional A">${opt(a, people)}</select>` : `<div class="input cmp-fixed">${esc(rA.barber.name)}</div>`;
    const pickB = `<select class="input" id="cmp-b" data-change="cmpB" aria-label="Comparar com">${opt(b, people.filter(x => x.id !== a))}<option value="lider" ${b === 'lider' ? 'selected' : ''}>Líder de cada indicador</option></select>`;
    // Radar dos dois (mesma régua do ranking: 100 = líder).
    const cA = '#d6b46a', cB = '#5b9dff';
    const sA = { name: rA.barber.name, color: cA, values: rA.scores };
    const sB = b === 'lider' ? { name: 'Líder', color: cB, dashed: true, values: Object.fromEntries(R.active.map(i => [i.key, 100])) } : { name: bBarber.name, color: cB, values: R.rows.find(r => r.barber.id === b).scores };
    const radar = `<div class="rd-grid">
        <div class="rd-box"><h3>Radar do mês (100 = líder)</h3>${radarSvg(R.active, [sB, sA])}<div class="ch-legend"><span><i style="background:${cA}"></i>${esc(rA.barber.name)}</span><span><i style="background:${cB}"></i>${esc(sB.name)}</span></div></div>
        ${b === 'lider' ? '' : `<div class="rd-box"><h3>Radar de carreira (média de todos os meses)</h3>${radarSvg(R.active, [{ name: bBarber.name, color: cB, values: careerByInd(b, ym) }, { name: rA.barber.name, color: cA, values: careerByInd(a, ym) }])}<div class="ch-legend"><span><i style="background:${cA}"></i>${esc(rA.barber.name)}</span><span><i style="background:${cB}"></i>${esc(bBarber.name)}</span></div></div>`}
      </div>`;
    return `<section class="section card cmp">
      <h2 class="section-title">Comparar profissionais ${tip('compare')}</h2>
      <p class="section-note">${isGestor(u) || people.length > 1 ? 'Escolha dois profissionais' : 'Compare seus números com o líder de cada indicador'} em ${esc(ymLabel(ym).replace(' de ', '/'))}. Verde com ▲ é quem está à frente no indicador; vermelho com ▼, quem está atrás.</p>
      <div class="cmp-pick">${pickA}<span class="cmp-vs">×</span>${pickB}</div>
      <div class="cmp-sum">
        ${cmpWhoCard(rA.barber, `<small class="num">${ord(rA.pos)} de ${R.rows.length} · ${score(rA.overall)} pts</small>${titleChip(R, a)}`, b === 'lider' ? `Lidera ${rA.leads.length} de ${R.N}` : `Vence ${L.wa} de ${n}`, 'a')}
        ${cmpWhoCard(bBarber, infoB, b === 'lider' ? '' : `Vence ${L.wb} de ${n}`, 'b')}
      </div>
      ${L.html}
      ${radar}
    </section>`;
  }

  // Evolução: o profissional comparado com ele mesmo em outro período.
  function evoRanges(ym) {
    const ev = ui.evo || {};
    const mode = ev.mode || 'mes', today = iso(new Date());
    // Período em andamento: compara o mesmo número de dias.
    const trim = (cur, prev) => {
      if (ev.full && mode !== 'semana') return [cur, prev];
      if (cur.start <= today && today <= cur.end) {
        const days = Math.round((fromIso(today) - fromIso(cur.start)) / 86400000);
        const s = fromIso(prev.start); const lim = iso(new Date(s.getFullYear(), s.getMonth(), s.getDate() + days));
        return [{ ...cur, end: today }, { ...prev, end: lim < prev.end ? lim : prev.end }];
      }
      return [cur, prev];
    };
    if (mode === 'semana') return trim(periodRange('semana', 0), periodRange('semana', -1));
    if (mode === 'ano') return trim(monthRange(ym), monthRange(addMonths(ym, -12)));
    if (mode === 'livre') {
      const c = monthRange(ym), p = monthRange(addMonths(ym, -1));
      const a1 = ev.a1 || c.start, a2 = ev.a2 || c.end, b1 = ev.b1 || p.start, b2 = ev.b2 || p.end;
      return [{ start: a1 <= a2 ? a1 : a2, end: a1 <= a2 ? a2 : a1 }, { start: b1 <= b2 ? b1 : b2, end: b1 <= b2 ? b2 : b1 }];
    }
    return trim(monthRange(ym), monthRange(addMonths(ym, -1)));
  }
  const dShort = d => d.slice(8, 10) + '/' + d.slice(5, 7) + (d.slice(0, 4) !== String(new Date().getFullYear()) ? '/' + d.slice(2, 4) : '');
  const rLabel = r => `${dShort(r.start)} a ${dShort(r.end)}`;
  const evoRefresh = () => { if ($('#tm-insights')) refreshTeam(); else render(); };
  // Controles do comparativo (modo, datas livres, mês em andamento), usados na evolução do profissional e da empresa.
  function evoControls(ym, ra, rb) {
    const ev = ui.evo || {}, mode = ev.mode || 'mes';
    const modes = [['mes', 'Mês × mês anterior'], ['ano', 'Mês × ano passado'], ['semana', 'Semana × anterior'], ['livre', 'Escolher datas']];
    const running = mode !== 'livre' && mode !== 'semana' && monthRange(ym).start <= iso(new Date()) && iso(new Date()) <= monthRange(ym).end;
    return `<div class="seg evo-seg" role="group" aria-label="Comparar períodos">${modes.map(([k, l]) => `<button type="button" class="${mode === k ? 'on' : ''}" aria-pressed="${mode === k}" data-action="evoMode" data-m="${k}">${l}</button>`).join('')}</div>
      ${mode === 'livre' ? `<div class="evo-dates">
        <label class="field"><span>Período A</span><span class="evo-dd"><input class="input" type="date" data-change="evoDate" data-k="a1" value="${ra.start}"><input class="input" type="date" data-change="evoDate" data-k="a2" value="${ra.end}"></span></label>
        <label class="field"><span>Período B</span><span class="evo-dd"><input class="input" type="date" data-change="evoDate" data-k="b1" value="${rb.start}"><input class="input" type="date" data-change="evoDate" data-k="b2" value="${rb.end}"></span></label></div>` : ''}
      ${running ? `<label class="ind-on evo-full"><input type="checkbox" data-change="evoFull" ${ev.full ? 'checked' : ''}> Comparar com o mês anterior inteiro</label>
        <p class="section-note">${ev.full ? 'O mês atual ainda não acabou: a comparação com o mês inteiro tende a ficar abaixo.' : 'Mês em andamento: compara o mesmo número de dias nos dois períodos.'}</p>` : ''}`;
  }

  // Evolução da empresa: a soma de todos os profissionais comparada com ela mesma em outro período.
  function houseSums(range, scope) {
    const S = { fat: 0, serv: 0, cli: 0, check: 0, hDisp: 0, hOcup: 0, planos: 0, ret: 0, prod: 0, comanda: 0, agend: 0, n: {} };
    for (const b of state.barbers) {
      if (scope && !scope.has(b.id)) continue;
      const a = GB.aggregate(state, b.id, range);
      if (!Object.keys(a.n).length) continue;
      for (const k of Object.keys(a.n)) {
        if (k === 'comanda') S.comanda = Math.max(S.comanda, a.comanda); else S[k] = (S[k] || 0) + (a[k] || 0);
        S.n[k] = (S.n[k] || 0) + a.n[k];
      }
      // Agendamentos: lançados por mês, entram quando o mês inteiro está dentro do período.
      for (const m of state.monthly || []) {
        if (m.barberId !== b.id || !isNum(m.agend)) continue;
        const mr = monthRange(m.month);
        if (mr.start >= range.start && mr.end <= range.end) { S.agend += Number(m.agend); S.n.agend = (S.n.agend || 0) + 1; }
      }
    }
    return S;
  }
  const HOUSE_EXTRA = [{ key: 'agend', label: 'Agendamentos', fmt: 'int' }, { key: 'comanda', label: 'Maior comanda do mês', fmt: 'money2' }];
  function houseVals(S) {
    const o = {};
    for (const ind of GB.visibleInds(state)) o[ind.key] = ind.calc(S);
    o.agend = S.n.agend ? S.agend : null;
    o.comanda = S.n.comanda ? S.comanda : null;
    return o;
  }
  function evoHouse(ym, scope) {
    const [ra, rb] = evoRanges(ym);
    const SA = houseSums(ra, scope), SB = houseSums(rb, scope);
    const va = houseVals(SA), vb = houseVals(SB);
    const L = cmpList(va, vb, null, HOUSE_EXTRA);
    const n = GB.visibleInds(state).filter(i => va[i.key] != null && vb[i.key] != null).length;
    const info = S => Object.keys(S.n).length ? `Faturamento ${money0(S.fat)}` : 'sem dados';
    return `<section class="section card evo">
      <h2 class="section-title">Evolução ${scope ? 'da área' : 'da empresa'} ${tip('evoCasa')}</h2>
      ${evoControls(ym, ra, rb)}
      <div class="cmp-sum">
        <div class="cmp-who a"><b>${rLabel(ra)}</b><small class="num">${info(SA)}</small><span class="cmp-wins num">Melhor em ${L.wa} de ${n}</span></div>
        <div class="cmp-who b"><b>${rLabel(rb)}</b><small class="num">${info(SB)}</small><span class="cmp-wins num">Melhor em ${L.wb} de ${n}</span></div>
      </div>
      ${L.html}
    </section>`;
  }

  function evoBlock(bid, ym) {
    const b = barberById(bid); if (!b) return '';
    const ev = ui.evo || {}, mode = ev.mode || 'mes';
    const [ra, rb] = evoRanges(ym);
    const A = computeRanking(state, ra), B = computeRanking(state, rb);
    const rowA = A.rows.find(r => r.barber.id === bid), rowB = B.rows.find(r => r.barber.id === bid);
    const va = cmpVals(A, rowA), vb = cmpVals(B, rowB);
    const L = cmpList(va, vb);
    const n = GB.visibleInds(state).filter(i => va[i.key] != null && vb[i.key] != null).length;
    const pos = (R, row) => row && R.active.length ? `${ord(row.pos)} de ${R.rows.length} · ${score(row.overall)} pts` : 'sem dados';
    return `<section class="section card evo">
      <h2 class="section-title">Evolução de ${first(b.name)} ${tip('evo')}</h2>
      ${evoControls(ym, ra, rb)}
      <div class="cmp-sum">
        <div class="cmp-who a"><b>${rLabel(ra)}</b><small class="num">${pos(A, rowA)}</small><span class="cmp-wins num">Melhor em ${L.wa} de ${n}</span></div>
        <div class="cmp-who b"><b>${rLabel(rb)}</b><small class="num">${pos(B, rowB)}</small><span class="cmp-wins num">Melhor em ${L.wb} de ${n}</span></div>
      </div>
      ${L.html}
    </section>`;
  }


  // ---------- POPs · Guia do Sucesso (processos operacionais com fotos do passo a passo e vídeo) ----------
  const POPS_BUCKET = 'pops';
  const popsList = () => (Array.isArray(state.pops) ? state.pops : (state.pops = []));
  const popsById = id => popsList().find(x => x.id === id);
  const validUrl = u => /^https?:\/\/[^\s]+\.[^\s]+$/i.test(u);
  const stepImg = (st, cls) => st.path ? `<img class="${cls || ''}" data-file="${POPS_BUCKET}|${esc(st.path)}" alt="${esc(st.cap || 'Passo do POP')}" loading="lazy">` : `<img class="${cls || ''}" src="${esc(st.src || '')}" alt="${esc(st.cap || 'Passo do POP')}" loading="lazy">`;
  async function popsPhotos(files, popId) {
    const out = [];
    for (const file of [...(files || [])].slice(0, 12)) {
      const data = await readImage(file, Cloud.enabled ? 1600 : 1000, 0.82);
      if (Cloud.enabled) out.push({ path: await Cloud.uploadFile(POPS_BUCKET, `${Cloud.companyId}/${popId}/${uid('s_')}.jpg`, data), cap: '' });
      else out.push({ src: data, cap: '' });
    }
    return out;
  }
  function pagePops(user) {
    const own = isGestor(user), list = popsList();
    const card = (p, n) => {
      const open = ui.popsOpen === p.id, steps = p.steps || [];
      const ask = ui.confirm === 'popsDel' + p.id;
      return `<article class="card pops-card ${open ? 'on' : ''}" data-name="${esc((p.name + ' ' + (p.desc || '')).toLowerCase())}">
        <div class="pops-top">
          <span class="pops-n num">${n}</span>
          <div class="pops-who"><h3>${esc(p.name)}</h3>${p.desc ? `<p>${esc(p.desc)}</p>` : ''}
            <p class="pops-chips"><span class="chip chip-soft">${steps.length} passo${steps.length === 1 ? '' : 's'}</span>${p.video ? `<span class="chip chip-ok">${icon('play')} Vídeo</span>` : ''}</p></div>
          ${steps[0] ? `<button class="pops-thumb" data-action="popsView" data-id="${esc(p.id)}" data-i="0" aria-label="Ver o passo 1">${stepImg(steps[0])}</button>` : ''}
        </div>
        <div class="btn-row">
          ${steps.length || own ? `<button class="btn btn-sm ${open ? '' : 'btn-primary'}" data-action="popsOpen" data-id="${esc(p.id)}" aria-expanded="${open}">${icon(open ? 'up' : 'down')} ${open ? 'Fechar' : steps.length ? 'Ver passo a passo' : 'Adicionar fotos'}</button>` : ''}
          ${p.video ? `<a class="btn btn-sm" href="${esc(p.video)}" target="_blank" rel="noopener noreferrer">${icon('play')} Assistir vídeo</a>` : ''}
        </div>
        ${open ? `<div class="pops-steps">
          ${steps.length ? steps.map((st, i) => `<figure class="pops-step">
            <button class="pops-img" data-action="popsView" data-id="${esc(p.id)}" data-i="${i}" aria-label="Ampliar o passo ${i + 1}">${stepImg(st)}</button>
            <figcaption><b>Passo ${i + 1}</b>${own ? `<input class="input" value="${esc(st.cap || '')}" placeholder="Legenda (opcional)" maxlength="140" data-change="popsCap" data-id="${esc(p.id)}" data-i="${i}">` : st.cap ? `<span>${esc(st.cap)}</span>` : ''}</figcaption>
            ${own ? `<div class="pops-stepbtns">
              <button class="icon-btn" data-action="popsMove" data-id="${esc(p.id)}" data-i="${i}" data-d="-1" aria-label="Subir" ${i === 0 ? 'disabled' : ''}>${icon('up')}</button>
              <button class="icon-btn" data-action="popsMove" data-id="${esc(p.id)}" data-i="${i}" data-d="1" aria-label="Descer" ${i === steps.length - 1 ? 'disabled' : ''}>${icon('down')}</button>
              <button class="icon-btn" data-action="popsDelStep" data-id="${esc(p.id)}" data-i="${i}" aria-label="Remover foto">${icon('x')}</button></div>` : ''}
          </figure>`).join('') : '<p class="muted">Ainda não há fotos do passo a passo.</p>'}
          ${own ? `<form class="form pops-edit" data-form="popsEdit" data-id="${esc(p.id)}" novalidate>
            <h4>Editar POP</h4>
            <div class="grid-2"><label class="field"><span>Nome do processo *</span><input class="input" name="name" value="${esc(p.name)}" maxlength="80" required></label>
            <label class="field"><span>Link do vídeo (opcional)</span><input class="input" name="video" type="url" inputmode="url" value="${esc(p.video || '')}" placeholder="https://..."></label></div>
            <label class="field"><span>Descrição (opcional)</span><textarea class="input" name="desc" rows="2" maxlength="400">${esc(p.desc || '')}</textarea></label>
            <label class="field"><span>Adicionar fotos do passo a passo</span><input class="input" name="photos" type="file" accept="image/*" multiple></label>
            <p class="form-msg" data-msg></p>
            <div class="btn-row"><button class="btn btn-primary" type="submit">${icon('check')} Salvar</button>
            <button type="button" class="btn ${ask ? 'btn-danger' : ''}" data-action="popsDel" data-id="${esc(p.id)}">${ask ? 'Confirmar: apagar este POP' : 'Apagar POP'}</button></div>
          </form>` : ''}
        </div>` : ''}
      </article>`;
    };
    return `<section class="card pops-head">
        <div class="pops-hero">${icon('book')}<div><h2>POPs · Guia do Sucesso ${tip('pops')}</h2><p>Os processos operacionais da ${esc(state.company.name || 'barbearia')}: o passo a passo em fotos e, quando houver, o vídeo explicando.</p></div></div>
        ${list.length > 3 ? `<input class="input" id="pops-q" type="search" placeholder="Buscar processo…" aria-label="Buscar processo">` : ''}
      </section>
      ${own ? `<details class="card pops-new" ${list.length ? '' : 'open'}><summary>${icon('plus')} Novo POP</summary>
        <form class="form" data-form="popsNew" novalidate>
          <div class="grid-2"><label class="field"><span>Nome do processo *</span><input class="input" id="pops-name" name="name" maxlength="80" placeholder="Ex.: Recepção do cliente" required></label>
          <label class="field"><span>Link do vídeo (opcional)</span><input class="input" name="video" type="url" inputmode="url" placeholder="https://youtube.com/..."></label></div>
          <label class="field"><span>Descrição (opcional)</span><textarea class="input" name="desc" rows="2" maxlength="400" placeholder="Para que serve e quando usar"></textarea></label>
          <label class="field"><span>Fotos do passo a passo (pode escolher várias, na ordem)</span><input class="input" name="photos" type="file" accept="image/*" multiple></label>
          <p class="form-msg" data-msg></p>
          <div><button class="btn btn-primary" type="submit">${icon('plus')} Adicionar POP</button></div>
        </form></details>` : ''}
      ${list.length ? `<div class="pops-list">${list.map((p, i) => card(p, i + 1)).join('')}</div><p class="muted pops-none" hidden>Nenhum processo encontrado.</p>`
        : `<div class="card empty">${icon('book')}<h2>Nenhum POP cadastrado</h2><p>${own ? 'Adicione o primeiro processo acima.' : 'O dono ainda não cadastrou os processos.'}</p></div>`}
      ${popsViewer()}`;
  }
  function popsViewer() {
    const v = ui.popsView; if (!v) return '';
    const p = popsById(v.id), steps = (p && p.steps) || [], st = steps[v.i];
    if (!st) { ui.popsView = null; return ''; }
    return `<div class="pop-viewer" role="dialog" aria-modal="true" aria-label="Passo do POP"><div class="inst-scrim" data-action="popsViewClose"></div>
      <figure>${stepImg(st, 'full')}<figcaption><b>${esc(p.name)} · Passo ${v.i + 1} de ${steps.length}</b>${st.cap ? `<span>${esc(st.cap)}</span>` : ''}</figcaption>
      <div class="btn-row pops-vnav"><button class="btn" data-action="popsViewGo" data-d="-1" ${v.i === 0 ? 'disabled' : ''}>${icon('left')} Anterior</button>
      <button class="btn" data-action="popsViewGo" data-d="1" ${v.i === steps.length - 1 ? 'disabled' : ''}>Próximo ${icon('right')}</button>
      <button class="btn" data-action="popsViewClose">${icon('x')} Fechar</button></div></figure></div>`;
  }

  function pageTime(user) {
    const ym = ui.teamMonth || curYm();
    if (!isGestor(user) && user.barberId && !seeNum(ui.teamBarber)) ui.teamBarber = user.barberId;
    if (!barberById(ui.teamBarber)) ui.teamBarber = monthR(ym).rows[0]?.barber.id;
    const w = darkFor(monthRange(ym));
    if (w) return `${monthPicker(ym, user)}${suspenseCard(w)}${ownNumbers(monthR(ym), user.barberId, ym)}`;
    return `${monthPicker(ym, user)}
      <div id="tm-prof" class="tm-block">${profTable(ym)}</div>
      <div id="tm-insights" class="tm-block">${ui.profSel ? teamInsights(ui.profSel, ym) : ''}</div>
      <div id="tm-cmp" class="tm-block">${compareCard(ym)}</div>
      <div id="tm-top" class="tm-block">${teamTop(ym)}</div>`;
  }

  function pageLancamentos(user) {
    const ym = ui.teamMonth || curYm();
    return `${monthPicker(ym, user)}
      <p class="section-note">Lance os totais do mês de cada barbeiro. Campos com cadeado vêm da integração e não podem ser editados aqui.</p>
      <div id="tm-editor" class="tm-block">${teamEditor(ym)}</div>
      ${isGestor(user) ? `<a class="btn" href="#integracao">${icon('plug')} Integração com outro sistema</a>` : ''}`;
  }

  function refreshEditorFields() {
    const box = document.getElementById('tm-fields'), b = barberById(ui.teamBarber);
    if (box && b) box.innerHTML = editorFields(b, ui.teamMonth || curYm()); else render();
  }

  // Atualiza as partes da tela sem perder o campo que está sendo digitado.
  function refreshTeam() {
    const ym = ui.teamMonth || curYm();
    const top = $('#tm-top'); if (top) top.innerHTML = teamTop(ym);
    const pf = $('#tm-prof'); if (pf) pf.innerHTML = profTable(ym);
    const ins = $('#tm-insights'); if (ins) ins.innerHTML = ui.profSel ? teamInsights(ui.profSel, ym) : '';
    const cp = $('#tm-cmp'); if (cp) cp.innerHTML = compareCard(ym);
    const R = monthR(ym);
    document.querySelectorAll('[data-pts]').forEach(el => { const r = R.rows.find(x => x.barber.id === el.dataset.pts); el.textContent = (r ? score(r.overall) : '—') + ' pts'; });
    const row = R.rows.find(r => r.barber.id === ui.teamBarber);
    const pos = $('#tm-pos'); if (pos && row) pos.textContent = `Posição atual: ${ord(row.pos)} · pontuação ${score(row.overall)} / 100. Tudo é salvo automaticamente no mês selecionado.`;
    const tk = $('#m-ticket'); if (tk && row) tk.value = row.sums.cli > 0 ? nf2.format(row.sums.fat / row.sums.cli) : '';
    const hist = $('#tm-hist'), hb = barberById(ui.teamBarber); if (hist && hb) { const open = hist.querySelector('details')?.open; ui.lanHistOpen = !!open; hist.innerHTML = lanHistory(hb, ym); }
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
        else if (kind === 'month' && el.dataset.sum) {
          GB.applyManualTotal(state, id, ym, key, v, lanDate(ym));
        }
        else if (kind === 'month') {
          state.monthly = state.monthly || [];
          let rec = state.monthly.find(m => m.barberId === id && m.month === ym);
          if (!rec) { rec = { barberId: id, month: ym }; state.monthly.push(rec); }
          rec[key] = v;
          if (rec._adj && rec._adj[key]) { if (v === null) delete rec._adj[key]; else rec._adj[key] = { by: (currentUser() || {}).name, at: Date.now() }; }
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
    if (!seeNum(barberId)) return `<div class="card empty">${icon('lock')}<h2>Números reservados</h2><p>Você vê o ranking com os números de todos, e a performance detalhada só a sua.</p><a class="btn" href="#performance">Ver minha performance</a></div>`;
    const b = barberById(barberId);
    if (!b) return `<div class="card empty">${icon('users')}<h2>Barbeiro não encontrado</h2><p>Ele pode ter sido removido da equipe.</p></div>`;
    const R = computeRanking(state, range());
    const dk = isGestor(user) ? null : darkFor(range());
    if (dk) return `${periodNav()}${suspenseCard(dk)}${ownNumbers(R, b.id, ui.period === 'mes' ? range().start.slice(0, 7) : null)}`;
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
      if (!act) return `<div class="card ind" style="opacity:.55"><div class="ind-top"><span>${esc(ind.label)} ${tip(ind.key)}</span><span class="chip chip-soft">sem dados</span></div><div class="ind-val">—</div></div>`;
      const v = row.values[ind.key];
      const pv = prow ? prow.values[ind.key] : null;
      let delta = '';
      if (v !== null && pv !== null && pv !== undefined && pv > 0) {
        const d = ((v - pv) / pv) * 100;
        delta = `<span class="${d >= 0 ? 'delta-up' : 'delta-down'}">${d >= 0 ? '+' : ''}${nf1.format(d)}% vs. período anterior</span>`;
      }
      const lead = act.leaders.includes(b.id);
      return `<div class="card ind ${lead ? 'card-glow' : ''}">
        <div class="ind-top"><span>${esc(ind.label)} ${tip(ind.key)}</span>${lead ? '<span class="chip chip-destaque">1º lugar</span>' : `<span class="chip chip-soft">${act.weight} pts</span>`}</div>
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
      <section class="section"><h2 class="section-title">Indicadores ${tip('score')}</h2><div class="ind-grid">${cards}</div></section>
      ${fatHistory(b.id)}
      ${perfStrengths(b.id)}
      ${evoBlock(b.id, ui.period === 'mes' ? range().start.slice(0, 7) : curYm())}`;
  }

  // Faturamento do profissional nos últimos 3, 6 ou 12 meses (performance completa).
  function fatHistory(bid) {
    const b = barberById(bid); if (!b) return '';
    const n = [3, 6, 12].includes(ui.fatN) ? ui.fatN : 6;
    const ym = ui.period === 'mes' ? range().start.slice(0, 7) : curYm();
    const months = Array.from({ length: n }, (_, i) => addMonths(ym, i - (n - 1)));
    const vals = months.map(k => { const r = monthR(k).rows.find(x => x.barber.id === bid); return hasData(r) ? r.sums.fat : null; });
    const got = vals.filter(v => v != null);
    const total = got.reduce((a, v) => a + v, 0);
    const seg = [[3, '3 meses'], [6, '6 meses'], [12, '1 ano']].map(([k, l]) => `<button type="button" class="${n === k ? 'on' : ''}" aria-pressed="${n === k}" data-action="fatRange" data-n="${k}">${l}</button>`).join('');
    return `<section class="section card fat-hist">
      <div class="fat-head"><h2 class="section-title">Faturamento de ${first(b.name)} · ${n === 12 ? 'último ano' : `últimos ${n} meses`}</h2>
        <div class="seg" role="group" aria-label="Período do gráfico">${seg}</div></div>
      <div class="perf-stats fat-stats">
        <div class="stat"><span>Total no período</span><b class="num">${money0(total)}</b></div>
        <div class="stat"><span>Média por mês</span><b class="num">${got.length ? money0(total / got.length) : '—'}</b></div>
        <div class="stat"><span>Melhor mês</span><b class="num">${got.length ? money0(Math.max(...got)) + ' · ' + ymShort(months[vals.indexOf(Math.max(...got))]) : '—'}</b></div>
      </div>
      ${lineSvg({ labels: months.map(ymShort), series: [{ values: vals, color: '#d6b46a', fill: true }], yFmt: v => v >= 1000 ? 'R$' + nf0.format(v / 1000) + 'k' : 'R$' + nf0.format(v) })}
    </section>`;
  }

  // Onde é forte / Onde precisa melhorar: só na performance completa do profissional (metas do mês).
  function perfStrengths(bid) {
    const ym = ui.period === 'mes' ? range().start.slice(0, 7) : curYm();
    const R = monthR(ym), row = R.rows.find(r => r.barber.id === bid);
    if (!row || !R.active.length) return '';
    const prevRow = monthR(addMonths(ym, -1)).rows.find(r => r.barber.id === bid);
    return `<div class="pp-grid">${strengths(row, prevRow, R, bid, ym)}</div>`;
  }

  // Visão da barbearia inteira (gestor): totais do mês, detalhe por profissional e radar.
  // ---------- Metas da empresa ----------
  // Padrão (state.houseGoals) para todos os meses; um mês pode ter metas próprias (state.houseGoalsM[ym]).
  const HG_KEYS = ['fat', 'agend', 'cli', 'serv', 'prod', 'planos', 'ticket', 'ocup', 'fid'];
  const HG_LABEL = { fat: 'Faturamento total', agend: 'Agendamentos', cli: 'Clientes atendidos', serv: 'Serviços realizados', prod: 'Produtos vendidos', planos: 'Planos mensais', ticket: 'Ticket médio da casa', ocup: 'Ocupação média', fid: 'Fidelização da casa' };
  const hgFmt = (k, v) => k === 'fat' || k === 'ticket' ? money0(v) : k === 'ocup' || k === 'fid' ? nf1.format(v) + '%' : nf0.format(v);
  function houseGoalsFor(ym) {
    const m = (state.houseGoalsM || {})[ym];
    const g = m && Object.keys(m).length ? m : (state.houseGoals || {});
    const vis = k => !['prod', 'planos', 'ocup'].includes(k) || GB.visibleInds(state).some(i => i.key === k);
    return Object.fromEntries(Object.entries(g).filter(([k, v]) => HG_KEYS.includes(k) && vis(k) && isNum(v) && v > 0));
  }
  // Totais do mês: soma de todos os profissionais (inclusive desligados com resultados no mês).
  function houseTotals(ym, scope) {
    const R = monthR(ym);
    const vis = k => GB.visibleInds(state).some(i => i.key === k);
    const rows = [...R.rows].filter(r => !scope || scope.has(r.barber.id)).sort((a, b) => b.sums.fat - a.sums.fat);
    const gone = state.barbers.filter(b => b.active === false && (!scope || scope.has(b.id)))
      .map(b => ({ barber: b, sums: GB.aggregate(state, b.id, monthRange(ym)), values: {} })).filter(r => Object.keys(r.sums.n).length);
    const all = rows.concat(gone);
    const has = all.some(r => Object.keys(r.sums.n).length);
    const sum = k => all.reduce((a, r) => a + (r.sums[k] || 0), 0);
    const ids = new Set(all.map(r => r.barber.id));
    const agend = (state.monthly || []).filter(m => m.month === ym && ids.has(m.barberId) && isNum(m.agend)).reduce((a, m) => a + Number(m.agend), 0);
    const fat = sum('fat'), cli = sum('cli');
    const ocups = rows.map(r => r.values.ocup).filter(v => v != null);
    const vals = { fat, agend, cli, serv: sum('serv'), prod: vis('prod') ? sum('prod') : null, planos: vis('planos') ? sum('planos') : null,
      ticket: cli > 0 ? fat / cli : null, ocup: vis('ocup') && ocups.length ? ocups.reduce((a, v) => a + v, 0) / ocups.length : null };
    // Fidelização da casa: clientes que voltaram ÷ clientes atendidos, só de quem lançou a fidelização.
    const fr = all.filter(r => r.sums.n.ret), fCli = fr.reduce((a, r) => a + (r.sums.cli || 0), 0);
    vals.fid = fr.length && fCli > 0 ? (fr.reduce((a, r) => a + (r.sums.ret || 0), 0) / fCli) * 100 : null;
    return { rows, gone, all, has, sum, agend, fat, cli, ocups, vals };
  }

  // Conquista: quando uma meta da empresa é batida, aparece um card de parabéns (uma vez por meta e por mês, em cada aparelho).
  function maybeGoalCelebrate(user) {
    if (!user || !isGestor(user) || location.hash === '#apresentacao' || document.querySelector('.gc-ov')) return;
    const seen = readJSON('hgSeen', {});
    // Mês atual; o mês anterior só nos primeiros dias do mês novo (metas batidas no fechamento).
    const months = [curYm(), ...(new Date().getDate() <= 7 ? [addMonths(curYm(), -1)] : [])];
    for (const ym of months) {
      const g = houseGoalsFor(ym), keys = Object.keys(g);
      if (!keys.length) continue;
      const T = houseTotals(ym);
      const hit = keys.filter(k => T.vals[k] != null && T.vals[k] >= g[k]);
      const was = seen[ym] || [], fresh = hit.filter(k => !was.includes(k));
      if (!fresh.length) continue;
      seen[ym] = [...new Set([...was, ...hit])];
      for (const k of Object.keys(seen)) if (k < addMonths(curYm(), -3)) delete seen[k];
      DB.pref.set('hgSeen', JSON.stringify(seen));
      showGoalCelebrate(ym, keys, hit, fresh, T.vals, g);
      return;
    }
  }
  function showGoalCelebrate(ym, keys, hit, fresh, vals, g) {
    const allHit = hit.length === keys.length;
    const next = addMonths(ym, 1), nextName = monthRange(next).label.split(' de ')[0];
    const title = allHit ? (keys.length > 1 ? 'Todas as metas batidas!' : 'Meta batida!') : fresh.length > 1 ? `${fresh.length} metas batidas!` : 'Meta batida!';
    const colors = ['#ffd66b', '#3ee07a', '#6cc0ff', '#ff8fc7', '#ffffff', '#ff9a2e'];
    const conf = Array.from({ length: 36 }, (_, i) => `<span style="left:${(i * 29 + 5) % 100}%;--c:${colors[i % colors.length]};--dl:${((i * 0.37) % 2.4).toFixed(2)}s;--dur:${(3 + (i % 5) * 0.5).toFixed(1)}s;--sz:${(0.7 + (i % 4) * 0.2).toFixed(1)}"></span>`).join('');
    const el = document.createElement('div');
    el.className = 'gc-ov' + (allHit ? ' gc-all' : '');
    el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-labelledby', 'gc-t');
    el.innerHTML = `<div class="gc-conf" aria-hidden="true">${conf}</div>
      <div class="gc-card">
        <div class="gc-rays" aria-hidden="true"></div>
        <div class="gc-trophy" aria-hidden="true">${icon('trophy')}</div>
        <p class="gc-eyebrow">Conquista desbloqueada · ${esc(cap(monthRange(ym).label))}</p>
        <h2 id="gc-t">${title}</h2>
        <p class="gc-sub">Parabéns${state.company.name ? ', ' + esc(state.company.name) : ''}! ${allHit ? `A equipe bateu ${keys.length > 1 ? `as ${keys.length} metas` : 'a meta'} do mês.` : `A equipe já bateu ${hit.length} de ${keys.length} metas do mês.`}</p>
        <ul class="gc-list">${fresh.map(k => `<li><span class="gc-ck">${icon('check')}</span><span><b>${HG_LABEL[k]}</b><small class="num">${hgFmt(k, vals[k])} de ${hgFmt(k, g[k])} · ${nf0.format((vals[k] / g[k]) * 100)}%</small></span></li>`).join('')}</ul>
        <p class="gc-next">${allHit ? 'Hora de subir a régua:' : 'Já pensando no próximo passo?'} configure as metas de ${esc(nextName)}.</p>
        <div class="gc-btns"><button class="btn btn-primary" data-action="gcNext" data-ym="${next}">${icon('target')} Configurar metas de ${esc(nextName)}</button>
        <button class="btn" data-action="gcClose">Agora não</button></div>
      </div>`;
    // Fica fora do #root (não some quando a tela redesenha), então trata os próprios cliques.
    el.addEventListener('click', e => {
      const b = e.target.closest('[data-action]');
      if (b && ACTIONS[b.dataset.action]) ACTIONS[b.dataset.action](b, e);
      else if (e.target === el) el.remove();
    });
    document.body.appendChild(el);
    setTimeout(() => { const b = el.querySelector('.btn-primary'); if (b) b.focus(); }, 400);
    try { Sound.play(allHit ? 'aplausos' : 'fanfarra'); } catch (e) { /* som é opcional */ }
  }

  // Faturamento mês a mês (até 12 meses), com a meta de cada mês e a projeção do mês em andamento.
  function houseTrend(ym, scope) {
    const months = [];
    for (let k = ym, i = 0; i < 12 && k >= firstYm(); i++, k = addMonths(k, -1)) months.unshift(k);
    if (months.length < 2) return '';
    const data = months.map(m => { const T = houseTotals(m, scope); return { m, v: T.vals.fat || 0, g: !scope ? houseGoalsFor(m).fat || null : null }; });
    const now = new Date(), cm = curYm();
    const last = data[data.length - 1];
    if (last.m === cm) { const dim = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate(), f = now.getDate() / dim; if (f < 1 && last.v > 0) last.p = last.v / f; }
    const max = Math.max(1, ...data.map(d => Math.max(d.v, d.g || 0, d.p || 0))) * 1.12;
    const W = 640, H = 230, L = 66, B = 26, T = 18, n = data.length, slot = (W - L - 6) / n, bw = Math.min(34, slot * 0.56);
    const y = v => T + (H - T - B) * (1 - v / max);
    const kfmt = v => v >= 1000 ? 'R$ ' + nf0.format(v / 1000) + ' mil' : money0(v);
    const ticks = [0, 0.5, 1].map(t => max / 1.12 * t);
    const grid = ticks.map(v => `<line x1="${L}" x2="${W - 4}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" class="tr-grid"/><text x="${L - 6}" y="${(y(v) + 4).toFixed(1)}" class="tr-ax" text-anchor="end">${kfmt(v)}</text>`).join('');
    const bars = data.map((d, i) => {
      const cx = L + slot * i + slot / 2, x = cx - bw / 2, top = y(d.v), sel = d.m === ym;
      const lbl = ymLabel(d.m).replace(' de ', '/');
      const short = monthRange(d.m).label.slice(0, 3);
      const tipTxt = `${lbl}: ${money0(d.v)}${d.g ? ` · meta ${money0(d.g)} (${nf0.format((d.v / d.g) * 100)}%)` : ''}${d.p ? ` · no ritmo atual: ${money0(d.p)}` : ''}`;
      const r = Math.min(4, bw / 2), h = Math.max(0, y(0) - top);
      const path = h > r ? `M${x} ${y(0)}V${top + r}Q${x} ${top} ${x + r} ${top}H${x + bw - r}Q${x + bw} ${top} ${x + bw} ${top + r}V${y(0)}Z` : `M${x} ${y(0)}h${bw}v${-h}h${-bw}Z`;
      return `<g class="tr-bar ${sel ? 'sel' : ''} ${d.g && d.v >= d.g ? 'hit' : ''}" data-action="pcMonth" data-ym="${d.m}" tabindex="0" role="button" aria-label="${esc(tipTxt)}"><title>${esc(tipTxt)}</title>
        <rect x="${(cx - slot / 2).toFixed(1)}" y="${T}" width="${slot.toFixed(1)}" height="${H - T - B + 20}" class="tr-hit"/>
        ${d.p ? `<rect x="${x.toFixed(1)}" y="${y(d.p).toFixed(1)}" width="${bw.toFixed(1)}" height="${(y(0) - y(d.p)).toFixed(1)}" rx="4" class="tr-proj"/>` : ''}
        <path d="${path}" class="tr-fill"/>
        ${d.g ? `<line x1="${(x - 4).toFixed(1)}" x2="${(x + bw + 4).toFixed(1)}" y1="${y(d.g).toFixed(1)}" y2="${y(d.g).toFixed(1)}" class="tr-goal"/>` : ''}
        ${sel ? `<text x="${cx.toFixed(1)}" y="${(Math.min(top, d.p ? y(d.p) : top, d.g ? y(d.g) : top) - 6).toFixed(1)}" class="tr-val" text-anchor="middle">${kfmt(d.v)}</text>` : ''}
        <text x="${cx.toFixed(1)}" y="${H - 8}" class="tr-ax ${sel ? 'on' : ''}" text-anchor="middle">${short}</text></g>`;
    }).join('');
    const vals = data.filter(d => d.v > 0 && d.m !== cm);
    const avg = vals.length ? vals.reduce((a, d) => a + d.v, 0) / vals.length : 0;
    const best = vals.reduce((a, d) => (!a || d.v > a.v ? d : a), null);
    const first = data.find(d => d.v > 0), lastFull = [...vals].pop();
    const growth = first && lastFull && first !== lastFull && first.v > 0 ? ((lastFull.v - first.v) / first.v) * 100 : null;
    return `<section class="section card pc-trend">
      <h2 class="section-title">Faturamento mês a mês</h2>
      <div class="tr-wrap"><svg viewBox="0 0 ${W} ${H}" class="tr-svg" role="img" aria-label="Faturamento dos últimos ${n} meses">${grid}${bars}</svg></div>
      <div class="tr-legend"><span><i class="lg-bar"></i>Faturamento</span>${data.some(d => d.g) ? '<span><i class="lg-goal"></i>Meta do mês</span>' : ''}${data.some(d => d.p) ? '<span><i class="lg-proj"></i>Projeção do mês em andamento</span>' : ''}</div>
      ${vals.length ? `<div class="tr-facts">
        <div><span>Média por mês</span><b class="num">${money0(avg)}</b></div>
        ${best ? `<div><span>Melhor mês</span><b class="num">${esc(ymLabel(best.m).replace(' de ', '/'))}</b><small class="num">${money0(best.v)}</small></div>` : ''}
        ${growth != null ? `<div><span>Crescimento no período</span><b class="num ${growth >= 0 ? 'up' : 'down'}">${growth >= 0 ? '▲ +' : '▼ −'}${nf0.format(Math.abs(growth))}%</b><small>${esc(monthRange(first.m).label.slice(0, 3))} → ${esc(monthRange(lastFull.m).label.slice(0, 3))}</small></div>` : ''}
      </div>` : ''}
      <p class="section-note">Toque numa barra para abrir aquele mês.</p>
    </section>`;
  }
  // Participação de cada profissional no faturamento do mês.
  function houseShare(all) {
    const list = all.filter(r => r.sums.fat > 0).sort((a, b) => b.sums.fat - a.sums.fat);
    const tot = list.reduce((a, r) => a + r.sums.fat, 0);
    if (!list.length || tot <= 0) return '';
    const top = list.slice(0, 10), rest = list.slice(10), restV = rest.reduce((a, r) => a + r.sums.fat, 0);
    const lead = list[0], leadPct = (lead.sums.fat / tot) * 100, even = 100 / list.length;
    const row = (b, v, extra) => { const pc = (v / tot) * 100; return `<li class="sh-row"><span class="sh-who">${b ? avatar(b, 30) : ''}<span>${esc(b ? b.name : extra)}${b && b.active === false ? ' <small class="muted">(desligado)</small>' : ''}</span></span>
      <span class="sh-bar"><i style="width:${Math.max(1.5, (pc / ((list[0].sums.fat / tot) * 100)) * 100).toFixed(1)}%"></i></span><span class="sh-v num"><b>${nf1.format(pc)}%</b><small>${money0(v)}</small></span></li>`; };
    return `<section class="section card pc-share">
      <h2 class="section-title">Participação no faturamento</h2>
      ${list.length > 2 && leadPct >= Math.max(35, even * 1.8) ? `<p class="sh-alert">${icon('help')}<span><b>${first(lead.barber.name)} responde por ${nf0.format(leadPct)}% do faturamento.</b> A empresa depende muito de uma pessoa: vale treinar e dar agenda para os outros crescerem.</span></p>` : ''}
      <ol class="sh-list">${top.map(r => row(r.barber, r.sums.fat)).join('')}${rest.length ? row(null, restV, `Outros (${rest.length})`) : ''}</ol>
      <p class="section-note">Se todos tivessem a mesma fatia, cada um teria ${nf1.format(even)}%.</p>
    </section>`;
  }
  // Quantos profissionais bateram a meta individual de cada indicador.
  function indivGoals(rows) {
    const inds = GB.visibleInds(state).filter(i => i.key !== 'check');
    const items = inds.map(i => {
      const withV = rows.filter(r => r.values[i.key] != null);
      const hit = withV.filter(r => r.values[i.key] >= GB.goalFor(state, r.barber.id, i.key));
      return { i, n: withV.length, hit };
    }).filter(x => x.n);
    if (!items.length) return '';
    return `<section class="section card pc-indiv">
      <h2 class="section-title">Metas individuais</h2>
      <p class="section-note">Quantos profissionais já bateram a própria meta em cada indicador.</p>
      <ul class="ig-list">${items.map(({ i, n, hit }) => `<li class="ig-row ${hit.length === n ? 'all' : ''}">
        <span class="ig-l">${esc(i.label)}</span>
        <span class="ig-bar" role="img" aria-label="${hit.length} de ${n}"><i style="width:${((hit.length / n) * 100).toFixed(1)}%"></i></span>
        <span class="ig-n num"><b>${hit.length}</b> de ${n}</span>
        <span class="ig-who">${hit.slice(0, 6).map(r => `<span title="${esc(r.barber.name)}">${avatar(r.barber, 24)}</span>`).join('')}${hit.length > 6 ? `<small>+${hit.length - 6}</small>` : ''}</span>
      </li>`).join('')}</ul>
      <p class="section-note">As metas individuais ficam em Configurações (equipe) e em Lançamentos (de cada profissional).</p>
    </section>`;
  }

  function pagePerfCasa(scope) {
    const ym = ui.teamMonth || curYm();
    const R = monthR(ym);
    const dk = darkFor(monthRange(ym));
    if (dk) return `<div class="card tm-month"><label class="field"><span class="tm-eyebrow">Mês</span>
        <select class="input" id="pc-month" data-change="teamMonth">${monthOptions(ym)}</select></label></div>${suspenseCard(dk)}${ownNumbers(R, (currentUser() || {}).barberId, ym)}`;
    const vis = k => GB.visibleInds(state).some(i => i.key === k);
    const T = houseTotals(ym, scope), { rows, gone, all, has, sum, agend, fat, cli, ocups } = T;
    // Metas da empresa (só o dono define; valem para todos os meses).
    const user = currentUser(), own = !scope && isGestor(user);
    const hg = !scope ? houseGoalsFor(ym) : {};
    const tgt = ui.hgYm || ym, tg = houseGoalsFor(tgt);
    const tgtOpts = [...new Set([ym, curYm(), addMonths(curYm(), 1)])].sort();
    const cur = ym === curYm(), now = new Date(), dim = new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0).getDate();
    const frac = cur ? Math.min(1, now.getDate() / dim) : 1;
    const HG_FMT = { fat: money0, ticket: money0, ocup: v => nf1.format(v) + '%', fid: v => nf1.format(v) + '%' };
    // Dias úteis que faltam no mês (sem domingos), contando hoje.
    let restDays = 0;
    if (cur) for (let d = now.getDate(); d <= dim; d++) if (new Date(now.getFullYear(), now.getMonth(), d).getDay() !== 0) restDays++;
    const fmtG = (k, v) => (HG_FMT[k] || (x => nf0.format(x)))(v);
    const SUMK = ['fat', 'agend', 'cli', 'serv', 'prod', 'planos'];
    const stat = (label, value, k, raw) => {
      const g = k && hg[k];
      if (!isNum(g) || g <= 0 || raw == null) return `<div class="pc-stat"><span>${label}</span><b class="num">${value}</b></div>`;
      const pct = (raw / g) * 100, done = raw >= g;
      const gap = k === 'ocup' || k === 'fid' ? nf1.format(Math.abs(g - raw)) + ' p.p.' : fmtG(k, Math.abs(g - raw));
      const perDay = cur && !done && SUMK.includes(k) && restDays > 0 ? (k === 'fat' ? (g - raw) / restDays : Math.ceil((g - raw) / restDays)) : null;
      const proj = cur && frac < 1 && SUMK.includes(k) && raw > 0 ? raw / frac : null;
      return `<div class="pc-stat has-goal ${done ? 'done' : ''}"><span>${label}</span><b class="num">${value}</b>
        <div class="pc-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(Math.min(pct, 100))}" aria-label="${esc(label)}: ${nf0.format(pct)}% da meta"><i style="width:${Math.min(100, pct).toFixed(1)}%"></i></div>
        <div class="pc-goal num"><span>Meta ${fmtG(k, g)}</span><em>${nf0.format(pct)}%</em></div>
        <small class="pc-left num">${done ? `${icon('check')} Meta batida${raw > g ? ` · ${gap} acima` : ''}` : `Faltam <b>${gap}</b>`}</small>
        ${perDay != null ? `<small class="pc-day num">Para bater: <b>${fmtG(k, perDay)} por dia</b> ${restDays === 1 ? 'hoje, último dia útil' : `nos ${restDays} dias úteis que faltam`}</small>` : ''}
        ${proj != null && !done ? `<small class="pc-proj num ${proj >= g ? 'ok' : 'low'}">No ritmo atual: ${fmtG(k, proj)} no fim do mês</small>` : ''}
      </div>`;
    };
    // Sugestão: soma das metas individuais dos profissionais ativos.
    const act = state.barbers.filter(b => b.active !== false);
    const sugg = k => k === 'agend' ? null : ['ticket', 'ocup', 'fid'].includes(k) ? GB.goalFor(state, '', k) : act.reduce((a, b) => a + GB.goalFor(state, b.id, k), 0);
    const HG_FIELDS = [['fat', 'Faturamento total (R$)', '0.01'], ['agend', 'Agendamentos', '1'], ['cli', 'Clientes atendidos', '1'], ['serv', 'Serviços realizados', '1'],
      ...(vis('prod') ? [['prod', 'Produtos vendidos', '1']] : []), ...(vis('planos') ? [['planos', 'Planos mensais', '1']] : []),
      ['ticket', 'Ticket médio da casa (R$)', '0.01'], ...(vis('ocup') ? [['ocup', 'Ocupação média (%)', '0.1']] : []), ...(vis('fid') || T.vals.fid != null ? [['fid', 'Fidelização da casa (%)', '0.1']] : [])];
    const goalForm = own && ui.hgEdit ? `<section class="section card">
        <h2 class="section-title">Metas mensais da empresa</h2>
        <p class="section-note">Deixe em branco o indicador que não tiver meta. A sugestão em cinza é a soma das metas individuais da equipe.</p>
        <form class="form" data-form="houseGoals" novalidate>
          <label class="field hg-month"><span>Mês das metas</span><select class="input" name="hgYm" data-change="hgYm">${tgtOpts.map(o => `<option value="${o}" ${o === tgt ? 'selected' : ''}>${ymLabel(o).replace(' de ', '/')}</option>`).join('')}</select></label>
          <div class="grid-2">${HG_FIELDS.map(([k, l, st]) => { const sg = sugg(k); return `<label class="field"><span>${l}</span><input class="input num" type="number" min="0" step="${st}" name="${k}" id="hg-${k}" value="${isNum(tg[k]) ? tg[k] : ''}" placeholder="${sg ? 'Sugestão: ' + (st === '1' ? Math.round(sg) : Math.round(sg * 100) / 100) : ''}"></label>`; }).join('')}</div>
          <label class="ind-on"><input type="checkbox" name="dflt" checked> Usar estas metas também nos meses seguintes</label>
          <p class="form-msg" data-msg></p>
          <div class="btn-row"><button class="btn btn-primary" type="submit">${icon('check')} Salvar metas</button><button class="btn" type="button" data-action="hgEdit">Cancelar</button></div>
        </form>
      </section>` : '';
    return `
      <div class="card tm-month"><label class="field"><span class="tm-eyebrow">Mês</span>
        <select class="input" id="pc-month" data-change="teamMonth">${monthOptions(ym)}</select></label>
        ${own && !ui.hgEdit ? (Object.keys(hg).length || Object.keys(state.houseGoals || {}).length || Object.keys(state.houseGoalsM || {}).length
          ? `<button class="btn btn-sm pc-goal-btn" data-action="hgEdit">${icon('target')} Editar metas da empresa</button>`
          : `<button class="pc-goal-cta" data-action="hgEdit"><span class="pc-goal-ico">${icon('target')}</span><span><b>Cadastrar metas da empresa</b><small>Defina a meta de cada indicador e acompanhe o progresso, quanto falta e a conquista quando bater.</small></span>${icon('right')}</button>`) : ''}
        ${has ? `<button class="btn btn-sm pc-print-btn" data-action="pcPrint">${icon('download')} Baixar relatório do mês (PDF)</button>` : ''}</div>
      <div class="pc-print-head"><b>${esc(state.company.name || '')}</b><span>Relatório de performance ${scope ? 'da área' : 'da empresa'} · ${esc(cap(monthRange(ym).label))}</span><small>Gerado em ${new Date().toLocaleDateString('pt-BR')}</small></div>
      ${goalForm}
      ${has ? '' : `<div class="pc-empty">Nenhum dado lançado ainda. Assim que você cadastrar profissionais e lançar as métricas do mês, os totais e o comparativo aparecem aqui automaticamente.</div>`}
      <section class="section card pc-totals">
        ${stat('Faturamento total', money0(fat), 'fat', fat)}
        ${stat('Agendamentos', nf0.format(agend), 'agend', agend)}
        ${stat('Clientes atendidos', nf0.format(cli), 'cli', cli)}
        ${stat('Serviços realizados', nf0.format(sum('serv')), 'serv', sum('serv'))}
        ${vis('prod') ? stat('Produtos vendidos', nf0.format(sum('prod')), 'prod', sum('prod')) : ''}
        ${vis('planos') ? stat('Planos mensais', nf0.format(sum('planos')), 'planos', sum('planos')) : ''}
        ${stat('Ticket médio da casa', cli > 0 ? money0(fat / cli) : '—', 'ticket', cli > 0 ? fat / cli : null)}
        ${all.some(r => r.sums.n.comanda) ? stat('Maior comanda do mês', money2(Math.max(...all.map(r => r.sums.n.comanda ? r.sums.comanda : 0)))) : ''}
        ${vis('ocup') ? stat('Ocupação média', ocups.length ? nf1.format(ocups.reduce((a, v) => a + v, 0) / ocups.length) + '%' : '—', 'ocup', ocups.length ? ocups.reduce((a, v) => a + v, 0) / ocups.length : null) : ''}
        ${T.vals.fid != null || vis('fid') ? stat('Fidelização da casa', T.vals.fid != null ? nf1.format(T.vals.fid) + '%' : '—', 'fid', T.vals.fid) : ''}
        ${stat('Profissionais', nf0.format(all.length))}
      </section>
      ${all.length ? `<p class="section-note">Cada número acima é a soma dos ${nf0.format(all.length)} profissionais ${scope ? 'da sua área' : 'da equipe'} no mês${gone.length ? `, incluindo ${gone.length === 1 ? '1 profissional desligado que tem' : `${gone.length} profissionais desligados que têm`} resultados lançados nesse mês` : ''}. O ticket médio da casa é o faturamento total dividido pelo total de clientes, e a ocupação é a média dos profissionais.</p>` : ''}
      ${has ? houseTrend(ym, scope) : ''}
      ${has ? houseShare(all) : ''}
      ${has ? indivGoals(rows) : ''}
      ${has ? evoHouse(ym, scope) : ''}
${rows.length ? '' : emptyBarbers()}
      <p class="section-note">O detalhado por profissional, o ranking e o radar estão em Performance da equipe.</p>`;
  }

  function pagePerformance(user) {
    if (isGestor(user)) return pagePerfCasa();
    if (hasGrants(user)) return pagePerfCasa(new Set([...areaIds(user, ['gestor', 'membro']), user.barberId].filter(Boolean)));
    return user.barberId ? perfFor(user.barberId, user) : `<div class="card muted">Seu cadastro ainda não está ligado a um barbeiro. Fale com o gestor.</div>`;
  }

  function inviteLink(code) { return location.origin + location.pathname + '?marca=' + MARCA + '#convite-' + code; }

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
        <div class="grow"><b>${esc(b.name)}</b>${status} ${b.active === false ? '<span class="chip chip-soft">inativo</span>' : ''}${u ? `<div class="muted" style="font-size:.88rem">${esc(u.email)}</div>` : ''}
          <div class="acc-edit">
            <label class="field"><span>Função</span><input class="input" name="role" list="role-list" value="${esc(b.role || '')}" placeholder="Ex.: Barbeiro" maxlength="60" data-change="barberRole" data-id="${esc(b.id)}"></label>
            <label class="field"><span>Nível de acesso</span><select class="input" data-change="barberAccess" data-id="${esc(b.id)}">${ACCESS.map(([k, l]) => `<option value="${k}" ${accessOf(b.id) === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
          </div>${accessOf(b.id) === 'lider' ? leaderExtrasBox(b) : ''}</div>
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
        <h2 class="section-title">Adicionar profissional ${tip('access_lv')}</h2>
        ${billing() && billing().max_barbers ? `<p class="section-note">Seu plano: <b class="num">${activeBarbers()} de ${billing().max_barbers}</b> barbeiros ativos. <a href="#assinatura">Trocar de plano</a></p>` : ''}
        <form class="form" data-form="addBarber" novalidate>
          <div class="grid-2"><label class="field"><span>Nome *</span><input class="input" id="nb-name" name="name" required></label>
          <label class="field"><span>Foto</span><input class="input" id="nb-photo" name="photo" type="file" accept="image/*"></label>
          <label class="field"><span>Função</span><input class="input" id="nb-role" name="role" list="role-list" placeholder="Ex.: Barbeiro, Barbeiro líder, Recepcionista" maxlength="60"></label>
          <label class="field"><span>Nível de acesso</span><select class="input" id="nb-access" name="access">${ACCESS.map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></label></div>
          <ul class="acc-help">${ACCESS.map(([, l, d]) => `<li><b>${l}:</b> ${d}</li>`).join('')}</ul>
          ${roleList()}
          <p class="form-msg" data-msg></p>
          <div><button class="btn btn-primary" type="submit">${icon('plus')} Adicionar</button></div>
        </form>
      </section>
      ${ui.lastReset ? `<div class="card card-glow"><b>Senha provisória de ${esc(ui.lastReset.name)}:</b> <span class="invite-link" style="display:inline-block">${esc(ui.lastReset.pass)}</span><p class="section-note">Passe essa senha para o barbeiro. Ele pode trocá-la em Meu cadastro.</p></div>` : ''}
      <section class="section"><h2 class="section-title">Equipe (${state.barbers.length})</h2>
        ${state.barbers.length ? `<ul class="list">${rows}</ul>` : '<div class="card muted">Ninguém cadastrado ainda.</div>'}</section>`;
  }

  function pageConfig(part) {
    const w = state.weights, rv = revealCfg(), oc = GB.ocupCfgOf(state), oh = GB.hoursPerDay(oc);
    const hidden = state.hidden || [];
    const total = INDICATORS.filter(i => !hidden.includes(i.key)).reduce((a, i) => a + Number(w[i.key] ?? i.weight), 0);
    if (part === 'dados') return `
      <section class="section card">
        <h2 class="section-title">${Cloud.enabled ? 'Dados da barbearia' : 'Dados deste aparelho'}</h2>
        <p class="section-note">${Cloud.enabled ? `Os dados ficam salvos na nuvem e valem em todos os aparelhos. ${Cloud.error ? `<b style="color:var(--danger)">Última tentativa de salvar falhou: ${esc(Cloud.error)}</b>` : 'Tudo sincronizado.'}` : 'Nesta versão os dados ficam salvos neste navegador. Quando o app for ligado a um servidor, eles passam a valer em todos os aparelhos.'}</p>
        <div class="btn-row">
          ${Cloud.enabled ? '' : `<button class="btn ${ui.confirm === 'demo' ? 'btn-danger' : ''}" data-action="resetDemo">${ui.confirm === 'demo' ? 'Confirmar: apagar e restaurar demonstração' : 'Restaurar dados de demonstração'}</button>`}
          <button class="btn btn-danger" data-action="clearData">${ui.confirm === 'clear' ? 'Confirmar: apagar equipe e lançamentos' : 'Apagar equipe e lançamentos'}</button>
        </div>
      </section>`;
    return `
      <section class="section card">
        <h2 class="section-title">Indicadores e pesos ${tip('weights')}</h2>
        <p class="section-note">O peso define quanto cada indicador vale na pontuação geral. Desmarque "Ativo" para ocultar um indicador do app inteiro; os dados dele ficam guardados para quando você reativar. Soma dos ativos: <b class="num">${total} pts</b>.</p>
        <form class="form" data-form="weights" novalidate>
          <div class="grid-2">${INDICATORS.map(i => { const off = hidden.includes(i.key); return `<div class="field ind-cfg ${off ? 'is-off' : ''}"><label for="w-${i.key}">${esc(i.label)} ${tip(i.key)}${off ? ' <span class="chip chip-soft">oculto</span>' : ''}</label>
            <div class="ind-row"><input class="input num" id="w-${i.key}" name="${i.key}" type="number" min="0" max="100" step="1" value="${w[i.key] ?? i.weight}">
            <label class="ind-on"><input type="checkbox" id="on-${i.key}" name="on-${i.key}" ${off ? '' : 'checked'}> Ativo</label></div></div>`; }).join('')}</div>
          <p class="form-msg" data-msg></p>
          <div class="btn-row"><button class="btn btn-primary" type="submit">${icon('check')} Salvar indicadores</button>
          <button class="btn" type="button" data-action="defaultWeights">Voltar aos pesos padrão</button></div>
        </form>
      </section>
      <section class="section card">
        <h2 class="section-title">Metas mensais da equipe ${tip('goals')}</h2>
        <p class="section-note">Valem para todos os barbeiros. Para ajustar a meta de alguém, abra o barbeiro em Lançamentos, em "Metas individuais". Percentuais em %, valores em R$.</p>
        <form class="form" data-form="goals" novalidate>
          <div class="grid-2">${GB.visibleInds(state).map(i => `<label class="field"><span>${esc(i.label)} ${tip(i.key)}</span><input class="input num" id="gt-${i.key}" name="${i.key}" type="number" min="0" step="any" value="${GB.goalFor(state, '', i.key)}"></label>`).join('')}</div>
          <p class="form-msg" data-msg></p>
          <div class="btn-row"><button class="btn btn-primary" type="submit">${icon('check')} Salvar metas</button>
          <button class="btn" type="button" data-action="defaultGoals">Voltar às metas padrão</button></div>
        </form>
      </section>
      <section class="section card">
        <h2 class="section-title">Regra da taxa de ocupação ${tip('ocup')}</h2>
        <p class="section-note">Ocupação = horas em comandas finalizadas ÷ horas da agenda no mês. Hoje, 100% = <b class="num">${nf1.format(oh)} h por dia × ${oc.days} dias = ${nf0.format(oh * oc.days)} h no mês</b>. Atendimentos antes da abertura, depois do fechamento ou no almoço compensam horários vagos; quem passa da capacidade fica acima de 100%. No mês em andamento a capacidade cresce dia a dia, e as ausências de cada barbeiro (férias, atestado) são lançadas em Lançamentos.</p>
        <form class="form" data-form="ocup" novalidate>
          <div class="grid-2">
            <label class="field"><span>Abertura da agenda</span><input class="input" type="time" id="oc-open" name="open" value="${esc(oc.open)}"></label>
            <label class="field"><span>Fechamento da agenda</span><input class="input" type="time" id="oc-close" name="close" value="${esc(oc.close)}"></label>
            <label class="field"><span>Almoço (minutos)</span><input class="input num" type="number" id="oc-lunch" name="lunch" min="0" max="240" step="5" value="${oc.lunch}"></label>
            <label class="field"><span>Dias trabalhados no mês</span><input class="input num" type="number" id="oc-days" name="days" min="1" max="31" step="1" value="${oc.days}"></label>
          </div>
          <p class="form-msg" data-msg></p>
          <div class="btn-row"><button class="btn btn-primary" type="submit">${icon('check')} Salvar regra</button>
          <button class="btn" type="button" data-action="defaultOcup">Voltar ao padrão (9h às 20h, 1 h de almoço, 22 dias)</button></div>
        </form>
      </section>
      <section class="section card">
        <h2 class="section-title">Pódio surpresa ${tip('reveal')}</h2>
        <p class="section-note">Nos últimos dias do mês, os barbeiros deixam de ver as colocações, as pontuações e os números dos colegas; cada um continua vendo os próprios números. A Tela da loja mostra uma contagem regressiva. Você revela o pódio no Fechamento do mês, do 3º ao 1º lugar.</p>
        <form class="form" data-form="reveal" novalidate>
          <label class="ind-on"><input type="checkbox" id="rv-on" name="rv-on" ${rv.on ? 'checked' : ''}> Ligar o pódio surpresa</label>
          <label class="field"><span>Quantos dias antes do fim do mês</span><select class="input" id="rv-days" name="rv-days">
            ${[1, 2, 3, 4, 5].map(d => `<option value="${d}" ${rv.days === d ? 'selected' : ''}>${d} dia${d > 1 ? 's' : ''}</option>`).join('')}</select></label>
          <p class="form-msg" data-msg></p>
          <div class="btn-row"><button class="btn btn-primary" type="submit">${icon('check')} Salvar pódio surpresa</button></div>
        </form>
      </section>`;
  }

  const CFG_TABS = [['empresa', 'Empresa', 'building'], ['indicadores', 'Indicadores e metas', 'chart'], ['integracao', 'Integração & API', 'plug'], ['dados', 'Dados', 'gear']];
  function pageConfiguracoes() {
    const t = CFG_TABS.some(x => x[0] === ui.cfgTab) ? ui.cfgTab : 'empresa';
    const body = t === 'empresa' ? pageEmpresa() : t === 'indicadores' ? pageConfig() : t === 'integracao' ? pageIntegracao() : pageConfig('dados');
    return `<div class="org-tabs cfg-tabs" role="toolbar">${CFG_TABS.map(([k, l, i]) => `<button type="button" class="${t === k ? 'on' : ''}" aria-pressed="${t === k}" data-action="cfgTab" data-t="${k}">${icon(i)}<span>${l}</span></button>`).join('')}</div>${body}`;
  }

  function pageIntegracao() {
    if (billing() && !billing().api) {
      return `<section class="section card empty">${icon('plug')}<h2>Integração com o seu sistema</h2>
        <p>Nos planos pagos, a agenda ou o caixa que você já usa envia os resultados direto para o Gestão Barber IA, sem digitar nada. No teste grátis, os resultados são lançados à mão em Lançamentos.</p>
        <div class="btn-row" style="justify-content:center"><a class="btn btn-primary" href="#assinatura">${icon('card')} Ver planos</a><a class="btn" href="#lancamentos">Lançar à mão</a></div></section>`;
    }
    const ex = JSON.stringify([
      { data: iso(new Date()), barbeiro: state.barbers[0]?.name || 'Nome do barbeiro', faturamento: 420.5, servicos: 9, clientes: 8, checklist_pop: 1, horas_disponiveis: 8, horas_ocupadas: 6.5, planos_mensais: 1, clientes_retorno: 5, venda_produtos: 2 },
    ], null, 2);
    return `
      <section class="section card">
        <h2 class="section-title">Como funciona ${tip('api')}</h2>
        <p class="section-note">Outro sistema (agenda, caixa, ERP) envia os resultados de cada barbeiro por dia. Os números entram no ranking na hora, junto com os lançados à mão.</p>
        <div class="field"><span>Chave da API</span><div class="invite-link" id="api-key">${esc(state.apiKey)}</div></div>
        <div class="btn-row"><button class="btn btn-sm" data-action="copyKey">${icon('copy')} Copiar chave</button>
        <button class="btn btn-sm ${ui.confirm === 'key' ? 'btn-danger' : ''}" data-action="newKey">${ui.confirm === 'key' ? 'Confirmar: a chave antiga para de funcionar' : 'Gerar nova chave'}</button></div>
        <pre class="code">POST ${esc(Cloud.enabled ? Cloud.apiUrl : '/api/v1/lancamentos')}
Authorization: Bearer ${esc(state.apiKey)}
Content-Type: application/json</pre>
        <p class="section-note">Campos aceitos: <code>data</code> (AAAA-MM-DD), <code>barbeiro</code> (nome) ou <code>barbeiro_id</code>, ${FIELDS.filter(f => !f.legacy).map(f => `<code>${f.api}</code>`).join(', ')}. Campos ausentes ficam em branco. Enviar a mesma data e barbeiro de novo substitui os números.</p>
        <p class="section-note"><code>horas_ocupadas</code>: soma das horas das comandas finalizadas do barbeiro no dia, inclusive fora do horário da agenda. A taxa de ocupação é calculada pela regra em Configurações → Indicadores e metas.</p>
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
        <label class="field"><span>Tipo de negócio (muda o logo, as cores e os nomes do sistema)</span><select class="input" id="co-brand" name="brand">
          ${Object.values(BRANDS).map(x => `<option value="${x.key}" ${MARCA === x.key ? 'selected' : ''}>${esc(x.name + ' · ' + x.tagline.replace('Para ', ''))}</option>`).join('')}</select></label>
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
    const amNote = isGestor(currentUser()) ? '' : '<p class="section-note">O fechamento mostra só as pessoas da sua área.</p>';
    const ym = ui.teamMonth || curYm();
    const R = scopedR(ym);
    const own = isGestor(currentUser());
    const dk = own ? null : darkFor(monthRange(ym));
    if (dk) return `<section class="card fc-head">${amNote}<div class="fc-controls">
        <label class="field"><span>Mês do fechamento</span><select class="input" id="fc-month" data-change="teamMonth">${monthOptions(ym)}</select></label></div></section>${suspenseCard(dk)}`;
    // Pódio surpresa: o resumo não entrega o resultado antes da revelação.
    const secret = own ? inSuspense(monthRange(ym)) : null;
    const top = R.rows.slice(0, 3);
    const total = R.rows.reduce((a, r) => a + r.sums.fat, 0);
    const t = R.title.type ? R.rows.find(r => r.barber.id === R.title.barberId) : null;
    // A tela pode estar espelhada na TV: o título e o top 3 ficam escondidos até o gestor pedir para ver.
    const hide = !ui.fcPeek;
    const ended = iso(new Date()) > monthRange(ym).end;
    const secretNote = secret ? `<div class="sus-note sus-in"><p>${icon('crown')}<span><b>Pódio surpresa.</b> A equipe ainda não viu as colocações de ${esc(ymLabel(ym).replace(' de ', '/'))}. ${ended ? 'Na apresentação, cada lugar do pódio só aparece quando você tocar em Revelar. Ao revelar o 1º lugar, o pódio é liberado no app de todos.' : 'O mês ainda não acabou: a apresentação agora é só uma prévia e não libera o pódio.'}</span></p>
        <button class="btn btn-sm ${ui.confirm === 'reveal' ? 'btn-danger' : ''}" data-action="revealNow" data-ym="${ym}">${ui.confirm === 'reveal' ? 'Confirmar: liberar sem apresentação' : 'Liberar o pódio sem apresentação'}</button></div>` : '';
    return `<section class="card fc-head">
        ${amNote}
        ${secretNote}
        <div class="fc-brand">${logo('fc-logo')}<div><h2>Fechamento do mês</h2><p>Cada atendimento conta.</p></div></div>
        <div class="fc-controls">
          <label class="field"><span>Mês do fechamento</span><select class="input" id="fc-month" data-change="teamMonth">${monthOptions(ym)}</select></label>
          <button class="btn btn-primary fc-start" data-action="fxStart" ${R.rows.length && R.active.length ? '' : 'disabled'}>${icon('monitor')} Iniciar fechamento</button>
        </div>
        ${R.rows.length && R.active.length ? '' : '<p class="section-note">Este mês ainda não tem resultados lançados.</p>'}
      </section>
      ${R.rows.length && R.active.length ? `<section class="section card">
        <h2 class="section-title">Resumo de ${esc(ymLabel(ym).replace(' de ', '/'))} ${tip('fechamento')}</h2>
        <div class="perf-stats">
          <div class="stat"><span>Faturamento da equipe</span><b class="num">${money0(total)}</b></div>
          <div class="stat"><span>Barbeiros</span><b class="num">${R.rows.length}</b></div>
          <div class="stat"><span>Indicadores</span><b class="num">${R.N}</b></div>
          <div class="stat"><span>Título</span><b>${hide ? 'Surpresa' : t ? (R.title.type === 'mvp' ? 'MVP' : 'Destaque') + ' · ' + esc(first(t.barber.name)) : 'Nenhum'}</b></div>
        </div>
        <div class="fc-peek"><p class="section-note">${hide ? 'O título e as colocações ficam escondidos aqui para não estragar a surpresa se a tela estiver espelhada na TV.' : 'Só você deveria estar vendo isto.'}</p>
          <button class="btn btn-sm" data-action="fcPeek">${icon(hide ? 'eye' : 'lock')} ${hide ? 'Ver o resultado (só para mim)' : 'Esconder de novo'}</button></div>
        ${hide ? '' : `<ol class="fc-top">${top.map(r => `<li>${avatar(r.barber, 40)}<span><b>${ord(r.pos)} ${esc(r.barber.name)}</b><small class="muted num">${score(r.overall)} pts · ${r.leads.length}/${R.N} lideradas</small></span></li>`).join('')}</ol>`}
        <p class="section-note">A apresentação mostra cada barbeiro do último ao 4º colocado. Depois vem o pódio: cada lugar, do 3º ao 1º, só aparece quando você tocar em Revelar. Use em tela cheia na TV da loja.</p>
      </section>` : ''}`;
  }

  function fxPhoto(b) {
    const ini = (b.name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0]).join('').toUpperCase();
    return `<div class="fx-photo"><span>${b.photo ? `<img src="${esc(b.photo)}" alt="">` : esc(ini)}</span></div>`;
  }
  function fxSlides(ym) {
    // No celular da equipe (ao vivo ou depois), a revelação mostra só o pódio.
    const mode = ui.fx && ui.fx.mode;
    const R = mode ? monthR(ym) : scopedR(ym);
    const rows = R.rows, s = mode ? [] : [{ k: 'intro' }];
    if (!mode) for (let i = rows.length - 1; i >= 3; i--) s.push({ k: 'card', row: rows[i] });
    s.push({ k: 'podium' });
    for (const p of [3, 2, 1]) if (rows[p - 1]) s.push({ k: 'card', row: rows[p - 1], place: p });
    s.push({ k: 'final' });
    return { R, s };
  }
  const fxDots = n => Array.from({ length: n }, (_, i) => `<i class="fx-dot" style="left:${(i * 37.7) % 100}%;top:${(i * 61.3) % 100}%;--d:${(i % 7) * 0.9}s;--s:${2 + (i % 4)}px"></i>`).join('');
  const fxConfetti = n => Array.from({ length: n }, (_, i) => `<i class="fx-cf" style="left:${(i * 47.3) % 100}%;--d:${((i * 0.37) % 2.6).toFixed(2)}s;--r:${(i * 53) % 360}deg;--c:${(MARCA === 'salao' ? ['#eab35a', '#eaa59f', '#fff6ee', '#ff8fc8', '#f3d9c4'] : ['#d6b46a', '#6cc8ff', '#ffffff', '#f4a95c', '#9b8cff'])[i % 5]};--x:${((i % 9) - 4) * 14}px"></i>`).join('');

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
        ${place ? `<div class="fx-suspense"><span class="fx-q" aria-hidden="true">?</span><p>${place === 1 ? 'E o 1º lugar é de…' : `O ${place}º lugar é de…`}</p><span class="fx-drum"><i></i><i></i><i></i></span>
          ${!ui.fx || !ui.fx.mode ? `<button class="fx-reveal-btn" data-fx="next">${icon('crown')} Revelar o ${place}º lugar</button>` : ui.fx.mode === 'live' ? '<small class="fx-wait">Aguardando o gestor revelar…</small>' : ''}</div>` : ''}
        ${place === 1 ? `<div class="fx-confetti">${fxConfetti(80)}</div>` : ''}
      </article></div>`;
  }

  function fxCount(scope) {
    scope.querySelectorAll('[data-count]').forEach(el => {
      const target = Number(el.dataset.count), dec = Number(el.dataset.dec || 0);
      const f = dec ? nf1 : nf0;
      if (reduceMotion()) { el.textContent = f.format(target); return; }
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
    const pages = `<span class="fx-pages">${s.map((_, k) => `<i class="${k === fx.i ? 'on' : k < fx.i ? 'done' : ''}"></i>`).join('')}</span>`;
    // No celular da equipe não há avançar/voltar: quem conduz é o gestor (ou a revelação segue sozinha).
    ov.querySelector('.fx-ctrl').innerHTML = (fx.mode ? pages : `
      <button class="fx-btn" data-fx="prev" aria-label="Anterior" ${fx.i === 0 ? 'disabled' : ''}>${icon('left')}</button>
      ${pages}
      <button class="fx-btn" data-fx="next" aria-label="Próximo" ${fx.i === s.length - 1 ? 'disabled' : ''}>${icon('right')}</button>`) + `
      <button class="fx-btn sm" data-fx="full" aria-label="Tela cheia">${icon('expand')}</button>
      <button class="fx-btn sm" data-fx="close" aria-label="Fechar apresentação">${icon('x')}</button>`;
    clearTimeout(fx.timer);
    const slide = stage.firstElementChild;
    if (slide.classList.contains('is-suspense')) {
      // Espera o gestor tocar em Revelar (ou, depois, segue sozinho no celular da equipe).
      if (fx.mode === 'auto') fx.timer = setTimeout(() => fxDrum(slide), 1400);
    } else {
      fxCount(slide);
      if (sl.k === 'podium') Sound.play('sino');
      if (sl.k === 'final') Sound.play('aplausos');
      if (fx.mode === 'auto' && sl.k !== 'final') fx.timer = setTimeout(() => fxStep(1), 3400);
    }
    if (fx.live && (sl.k === 'podium' || sl.k === 'final' || sl.place)) revealSend({ t: sl.place ? 'card' : sl.k, place: sl.place || 0 });
  }
  function fxReveal(slide, place) {
    if (!slide || !slide.classList.contains('is-suspense')) return;
    slide.classList.remove('is-suspense', 'is-drum'); slide.classList.add('is-revealed');
    Sound.play(place === 1 ? 'fanfarra' : 'moeda');
    if (place === 1) setTimeout(() => Sound.play('aplausos'), 900);
    fxCount(slide);
    const fx = ui.fx;
    if (fx && fx.live) revealSend({ t: 'reveal', place });
    if (fx && fx.mode && place === 1) setSeen(fx.ym);
    if (fx && fx.mode === 'auto') fx.timer = setTimeout(() => fxStep(1), place === 1 ? 5200 : 4200);
    // Revelou o 1º lugar de um mês encerrado: libera o pódio no app de todos.
    if (place === 1 && fx && isGestor(currentUser()) && inSuspense(monthRange(fx.ym)) && iso(new Date()) > monthRange(fx.ym).end) {
      markRevealed(fx.ym);
      setTimeout(() => toast('Pódio liberado: a equipe já vê as colocações no app.'), 1500);
    }
  }
  // 1º toque: rufar de tambores. Depois de alguns segundos (ou no 2º toque), revela.
  function fxDrum(slide) {
    const fx = ui.fx;
    if (slide.classList.contains('is-drum')) { clearTimeout(fx.timer); fxReveal(slide, Number(slide.dataset.place)); return; }
    slide.classList.add('is-drum');
    Sound.play('rufar');
    if (fx.live) revealSend({ t: 'drum', place: Number(slide.dataset.place) });
    fx.timer = setTimeout(() => fxReveal(slide, Number(slide.dataset.place)), 2600);
  }
  function fxGo(d) {
    const fx = ui.fx; if (!fx || fx.mode) return; // no celular da equipe, quem conduz é o gestor
    const slide = document.querySelector('#fx .fx-slide');
    if (d > 0 && slide && slide.classList.contains('is-suspense')) { fxDrum(slide); return; }
    fxStep(d);
  }
  function fxStep(d) {
    const fx = ui.fx; if (!fx) return;
    const ni = fx.i + d;
    if (ni < 0 || ni >= fx.total) return;
    fx.i = ni; fx.dir = d; fxRender();
  }
  function fxClose() {
    const ov = document.getElementById('fx');
    if (ui.fx) clearTimeout(ui.fx.timer);
    if (ui.fx && ui.fx.live) revealSend({ t: 'close' });
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
  // ---------- balão de explicação (?) ----------
  let tipBox = null, tipBtn = null, tipPinned = false;
  function tipShow(btn, pinned) {
    const t = TIPS[btn.dataset.tip]; if (!t) return;
    if (!tipBox) {
      tipBox = document.createElement('div'); tipBox.id = 'tipbox'; tipBox.className = 'tipbox'; tipBox.setAttribute('role', 'tooltip');
      document.body.appendChild(tipBox);
    }
    const body = typeof t[1] === 'function' ? t[1]() : t[1];
    tipBox.innerHTML = `<b>${esc(L(t[0]))}</b><p>${esc(L(body))}</p>`;
    tipBox.hidden = false; tipBox.classList.add('on');
    tipBtn = btn; tipPinned = !!pinned;
    btn.setAttribute('aria-expanded', 'true'); btn.setAttribute('aria-describedby', 'tipbox');
    const r = btn.getBoundingClientRect(), w = Math.min(320, window.innerWidth - 24);
    tipBox.style.width = w + 'px';
    const h = tipBox.offsetHeight;
    let left = r.left + r.width / 2 - w / 2;
    left = Math.max(12, Math.min(left, window.innerWidth - w - 12));
    const below = r.bottom + 10 + h <= window.innerHeight - 8 || r.top - 10 - h < 8;
    tipBox.style.left = left + 'px';
    tipBox.style.top = (below ? r.bottom + 10 : r.top - 10 - h) + 'px';
    tipBox.style.setProperty('--ax', (r.left + r.width / 2 - left) + 'px');
    tipBox.dataset.side = below ? 'below' : 'above';
  }
  function tipHide() {
    if (tipBox) { tipBox.classList.remove('on'); tipBox.hidden = true; }
    if (tipBtn) { tipBtn.setAttribute('aria-expanded', 'false'); tipBtn.removeAttribute('aria-describedby'); }
    tipBtn = null; tipPinned = false;
  }
  // Toque ou clique: abre e fixa; toca de novo ou fora para fechar. Não aciona o que estiver por trás.
  document.addEventListener('click', e => {
    const b = e.target.closest && e.target.closest('.tip');
    if (b) { e.preventDefault(); e.stopPropagation(); if (tipBtn === b && tipPinned) tipHide(); else tipShow(b, true); return; }
    if (tipBtn && !(e.target.closest && e.target.closest('#tipbox'))) tipHide();
  }, true);
  // Mouse: aparece ao passar por cima.
  document.addEventListener('pointerover', e => { if (e.pointerType !== 'mouse') return; const b = e.target.closest && e.target.closest('.tip'); if (b && !tipPinned) tipShow(b, false); });
  document.addEventListener('pointerout', e => { if (e.pointerType !== 'mouse' || tipPinned) return; const b = e.target.closest && e.target.closest('.tip'); if (b && b === tipBtn) tipHide(); });
  document.addEventListener('focusin', e => { if (e.target.classList && e.target.classList.contains('tip') && !tipPinned) tipShow(e.target, false); });
  document.addEventListener('focusout', e => { if (e.target === tipBtn && !tipPinned) tipHide(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && tipBtn) tipHide(); });
  window.addEventListener('scroll', () => { if (tipBtn) tipHide(); }, true);
  window.addEventListener('resize', () => { if (tipBtn) tipHide(); });
  window.addEventListener('hashchange', tipHide);

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
  const adminTabs = () => `<div class="org-tabs" role="toolbar">${[['empresas', 'building', 'Empresas'], ['leads', 'users', 'Interessados']].map(([k, ic, l]) => `<button type="button" class="${(ui.adminTab || 'empresas') === k ? 'on' : ''}" aria-pressed="${(ui.adminTab || 'empresas') === k}" data-action="adminTab" data-t="${k}">${icon(ic)}<span>${l}</span></button>`).join('')}</div>`;
  // Interessados que se cadastraram na página de vendas (/oferta).
  const LEAD_TIPO = { barbearia: 'Barbearia', salao: 'Salão de beleza', esmalteria: 'Esmalteria', estetica: 'Clínica de estética' };
  const LEAD_EQ = { 4: 'até 4', 10: '5 a 10', 99: 'mais de 10' };
  const LEAD_ST = [['novo', 'Novo'], ['contatado', 'Contatado'], ['cliente', 'Virou cliente'], ['descartado', 'Descartado']];
  function adminLeads() {
    if (!ui.leadsData) {
      ui.leadsData = 'loading';
      Cloud.admin.leads().then(list => { ui.leadsData = { list }; render(); }).catch(e => { ui.leadsData = { error: Cloud.message(e) }; render(); });
    }
    if (ui.leadsData === 'loading') return `<div class="card muted">Carregando interessados…</div>`;
    if (ui.leadsData.error) return `<div class="card">${esc(ui.leadsData.error)} <button class="btn btn-sm" data-action="leadsReload">Tentar de novo</button></div>`;
    const list = ui.leadsData.list, f = ui.leadFilter || 'novo';
    const rows = list.filter(l => f === 'todos' || l.status === f);
    const cnt = k => list.filter(l => l.status === k).length;
    const when = d => new Date(d).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    const wa = l => { const n = String(l.celular || '').replace(/\D/g, ''); const msg = `Olá, ${l.nome}! Aqui é da equipe do ${l.tipo && l.tipo !== 'barbearia' ? 'Gestão Salão IA' : 'Gestão Barber IA'}. Vi que você se cadastrou para conhecer o sistema. Posso te mostrar como funciona?`; return `https://wa.me/55${n}?text=${encodeURIComponent(msg)}`; };
    return `<section class="section card">
        <h2 class="section-title">Interessados ${tip('leads')}</h2>
        <p class="section-note">Pessoas que se cadastraram na página de vendas antes do quiz. Contatos de quem veio pelo formulário do Instagram ficam na Central de Cadastros do Meta.</p>
        <div class="perf-stats">${LEAD_ST.map(([k, l]) => `<div class="stat"><span>${l}</span><b class="num">${cnt(k)}</b></div>`).join('')}<div class="stat"><span>Total</span><b class="num">${list.length}</b></div></div>
      </section>
      <section class="section">
        <div class="btn-row">${[['novo', 'Novos'], ['contatado', 'Contatados'], ['cliente', 'Clientes'], ['descartado', 'Descartados'], ['todos', 'Todos']].map(([k, l]) => `<button class="btn btn-sm ${k === f ? 'btn-primary' : ''}" data-action="leadFilter" data-f="${k}">${l}</button>`).join('')}
          <button class="btn btn-sm" data-action="leadsReload">${icon('check')} Atualizar</button>
          <button class="btn btn-sm" data-action="leadsCsv">${icon('download')} Baixar planilha</button></div>
        ${rows.length ? `<ul class="list lead-list">${rows.map(l => `<li class="list-row">
          <div class="grow"><b>${esc(l.nome)} ${esc(l.sobrenome || '')}</b>
            <span class="muted">${esc(l.celular)}${l.email ? ' · ' + esc(l.email) : ''}</span>
            <span class="muted">${l.tipo ? esc(LEAD_TIPO[l.tipo] || l.tipo) : 'Quiz não respondido'}${l.equipe ? ' · equipe ' + LEAD_EQ[l.equipe] : ''} · ${when(l.created_at)}${l.origem ? ' · ' + esc(l.origem) : ''}</span></div>
          <div class="btn-row"><a class="btn btn-sm btn-primary" href="${wa(l)}" target="_blank" rel="noopener">${icon('chat')} WhatsApp</a>
            <select class="input lead-st" data-change="leadStatus" data-id="${esc(l.id)}" aria-label="Situação">${LEAD_ST.map(([k, t]) => `<option value="${k}" ${l.status === k ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
        </li>`).join('')}</ul>` : '<div class="card muted">Nenhum interessado nesta lista.</div>'}
      </section>`;
  }
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
    if (ui.adminTab === 'leads') return adminTabs() + adminLeads();
    return `${adminTabs()}
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

  // ---------- Organograma: estrutura, níveis e quem vê o quê ----------
  const ORG_ROOT = 'root';
  // Garante a estrutura e encaixa sozinho quem ainda não tem lugar (embaixo do dono).
  function org() {
    if (!state.org || typeof state.org !== 'object') state.org = {};
    const o = state.org;
    if (!Array.isArray(o.nodes)) o.nodes = [];
    if (!Array.isArray(o.grants)) o.grants = [];
    if (!Array.isArray(o.levels) || !o.levels.length) o.levels = [{ id: 'l1', name: 'Nível 1' }, { id: 'l2', name: 'Nível 2' }, { id: 'l3', name: 'Nível 3' }];
    let root = o.nodes.find(n => n.id === ORG_ROOT);
    if (!root) { root = { id: ORG_ROOT, name: '', parentId: null, people: [] }; o.nodes.unshift(root); }
    root.parentId = null;
    const bids = new Set(state.barbers.map(b => b.id));
    const ids = new Set(o.nodes.map(n => n.id));
    const placed = new Set();
    for (const n of o.nodes) {
      n.people = (n.people || []).filter(p => p.startsWith('b:') && bids.has(p.slice(2)) && !placed.has(p));
      n.people.forEach(p => placed.add(p));
      if (n.id !== ORG_ROOT && (!n.parentId || !ids.has(n.parentId) || n.parentId === n.id)) n.parentId = ORG_ROOT;
    }
    // quebra ciclos (alguém abaixo de si mesmo)
    for (const n of o.nodes) { const seen = new Set([n.id]); let p = n.parentId; while (p) { if (seen.has(p)) { n.parentId = ORG_ROOT; break; } seen.add(p); p = (o.nodes.find(x => x.id === p) || {}).parentId; } }
    o.nodes = o.nodes.filter(n => !(n.auto && !n.people.length));
    for (const b of state.barbers) {
      if (b.active === false || placed.has('b:' + b.id)) continue;
      o.nodes.push({ id: 'n_' + b.id, name: b.name, parentId: ORG_ROOT, people: ['b:' + b.id], auto: true });
    }
    const uids = new Set(state.users.map(u => u.id));
    o.grants = o.grants.filter(g => uids.has(g.userId) && (g.nodeId === null || o.nodes.some(n => n.id === g.nodeId)));
    if (!o.access || typeof o.access !== 'object') o.access = {};
    if (!o.extras || typeof o.extras !== 'object') o.extras = {};
    for (const k of Object.keys(o.extras)) if (!bids.has(k)) delete o.extras[k];
    for (const k of Object.keys(o.access)) if (!bids.has(k) || !['lider', 'gestor'].includes(o.access[k])) delete o.access[k];
    return o;
  }
  const orgNode = id => org().nodes.find(n => n.id === id);
  const orgKids = id => org().nodes.filter(n => n.parentId === id);
  function orgDepth(n) { let d = 0, p = n.parentId; while (p && d < 50) { d++; p = (orgNode(p) || {}).parentId; } return d; }
  const orgLevel = d => (org().levels[d] && org().levels[d].name) || `Nível ${d + 1}`;
  const personName = ref => (barberById(ref.slice(2)) || {}).name || '?';
  function orgName(n) {
    if (n.id === ORG_ROOT) return `Dono · ${state.company.name || 'Barbearia'}`;
    if (n.auto && n.people[0]) return personName(n.people[0]);
    return n.name || 'Sem nome';
  }
  function orgSub(id) { const out = [id]; for (let i = 0; i < out.length; i++) orgKids(out[i]).forEach(k => out.push(k.id)); return out; }
  function orgBarbers(id) {
    const s = new Set();
    for (const nid of orgSub(id)) for (const p of (orgNode(nid) || { people: [] }).people) { const b = barberById(p.slice(2)); if (b && b.active !== false) s.add(b.id); }
    return s;
  }
  const userOfBarber = bid => state.users.find(u => u.barberId === bid && u.status === 'ativo');
  function orgRole(n) {
    if (n.id === ORG_ROOT) return 'Dono';
    const us = n.people.map(p => userOfBarber(p.slice(2))).filter(Boolean).map(u => u.id);
    return org().grants.some(g => us.includes(g.userId) && g.role === 'gestor') ? 'Gestor' : 'Membro';
  }
  // Barbeiros cujos números a pessoa vê (roles: gestor e/ou membro).
  // Nível de acesso do profissional (Adicionar profissional): líder vê toda a equipe; gestor também lança e confere.
  const ACCESS = [
    ['profissional', 'Profissional', 'Vê o ranking e a própria performance, e preenche o próprio checklist.'],
    ['lider', 'Líder', 'Também vê a performance detalhada de toda a equipe (detalhado, comparativos e perfis).'],
    ['gestor', 'Gestor', 'Também lança os resultados e confere o checklist de toda a equipe. Configurações, cadastro de profissionais e assinatura continuam só com o dono.'],
  ];
  const accessOf = bid => (bid && (org().access || {})[bid]) || 'profissional';
  // Acessos extras que o dono pode dar a cada líder: conferir o checklist e lançar métricas específicas.
  function extrasOf(bid) {
    if (accessOf(bid) !== 'lider') return { review: false, fields: [] };
    const e = (org().extras || {})[bid] || {};
    return { review: !!e.review, fields: Array.isArray(e.fields) ? e.fields : [] };
  }
  const myExtras = () => { const u = currentUser(); return u && !isGestor(u) ? extrasOf(u.barberId) : { review: false, fields: [] }; };
  const EXTRA_FIELDS = () => GB.MONTH_FIELDS.filter(f => !f.calc && !(state.hidden || []).includes(GB.FIELD_IND[f.key] || f.key));
  function areaIds(u, roles) {
    const s = new Set();
    if (!u) return s;
    const lv = u.role !== 'gestor' ? accessOf(u.barberId) : 'profissional';
    if ((lv === 'gestor' && roles.some(r => r === 'gestor' || r === 'membro')) || (lv === 'lider' && roles.includes('membro'))) state.barbers.forEach(b => s.add(b.id));
    for (const g of org().grants) {
      if (g.userId !== u.id || !roles.includes(g.role)) continue;
      const ids = g.nodeId ? orgBarbers(g.nodeId) : new Set(state.barbers.map(b => b.id));
      ids.forEach(i => s.add(i));
    }
    return s;
  }
  const hasGrants = u => !!u && !isGestor(u) && (accessOf(u.barberId) !== 'profissional' || org().grants.some(g => g.userId === u.id));
  const isAreaMgr = u => !!u && !isGestor(u) && (accessOf(u.barberId) === 'gestor' || org().grants.some(g => g.userId === u.id && g.role === 'gestor'));
  // Quem pode ver os números (faturamento, clientes...) de um barbeiro.
  function seeNum(bid) {
    const u = currentUser();
    if (!u || isGestor(u) || u.barberId === bid) return true;
    return areaIds(u, ['gestor', 'membro']).has(bid);
  }
  // Quem pode lançar os números do mês de um barbeiro.
  function canEditB(bid) { const u = currentUser(); return !!u && (isGestor(u) || areaIds(u, ['gestor']).has(bid)); }
  // Lançamentos: quem lança tudo de alguém, ou o líder com métricas liberadas (só essas).
  const canLanB = bid => canEditB(bid) || myExtras().fields.length > 0;
  const fieldOk = (bid, key) => canEditB(bid) || myExtras().fields.includes(key);
  // Ranking só com os barbeiros da área (fechamento do gestor de área).
  function scopedR(ym) {
    const u = currentUser();
    if (!u || isGestor(u)) return monthR(ym);
    const ids = areaIds(u, ['gestor', 'membro']);
    return computeRanking({ ...state, barbers: state.barbers.filter(b => ids.has(b.id)) }, monthRange(ym));
  }

  function orgTabs() {
    const t = ui.orgTab || 'ver';
    const b = (k, ic, l) => `<button type="button" class="${t === k ? 'on' : ''}" data-action="orgTab" data-t="${k}" aria-pressed="${t === k}">${icon(ic)}<span>${l}</span></button>`;
    return `<div class="org-tabs" role="toolbar">${b('ver', 'eye', 'Visualizar')}${b('montar', 'org', 'Montar cadeia')}${b('avancado', 'edit', 'Avançado')}</div>`;
  }

  function orgVer() {
    const cur = ui.orgNode && orgNode(ui.orgNode) ? orgNode(ui.orgNode) : null;
    const path = []; let p = cur; while (p) { path.unshift(p); p = p.parentId ? orgNode(p.parentId) : null; }
    const crumbs = `<nav class="org-crumbs" aria-label="Caminho">
      <button class="${cur ? '' : 'on'}" data-action="orgGo" data-id="">${icon('building')} Início</button>
      ${path.map((n, i) => `<span aria-hidden="true">›</span><button class="${i === path.length - 1 ? 'on' : ''}" data-action="orgGo" data-id="${esc(n.id)}">${esc(orgName(n))}</button>`).join('')}
    </nav>`;
    const card = n => {
      const total = orgBarbers(n.id).size;
      return `<button class="org-card" data-action="orgGo" data-id="${esc(n.id)}">
        <span class="org-lv">${esc(orgLevel(orgDepth(n)))}</span>
        <b>${esc(orgName(n))}</b>
        <span class="muted">${total} ${total === 1 ? 'pessoa' : 'pessoas'}${orgKids(n.id).length ? '' : ' · sem ninguém abaixo'}</span>
        ${icon('right')}
      </button>`;
    };
    if (!cur) return `${crumbs}<div class="org-list">${card(orgNode(ORG_ROOT))}</div>`;
    const here = cur.id === ORG_ROOT ? state.users.filter(u => u.role === 'gestor').map(u => u.name) : cur.people.map(personName);
    const kids = orgKids(cur.id);
    return `${crumbs}
      <div class="org-here card"><b>${esc(orgName(cur))}</b><span>Pessoas aqui: ${here.length ? here.map(esc).join(', ') : 'ninguém'}</span>
        <button class="btn btn-sm" data-action="orgEdit" data-id="${esc(cur.id)}">${icon('edit')} Editar</button></div>
      <div class="org-list">${kids.length ? kids.map(card).join('') : '<p class="section-note">Ninguém abaixo deste ponto. Use Montar cadeia para adicionar.</p>'}</div>`;
  }

  function orgMontar() {
    const o = org();
    const rows = [];
    const walk = (ids, d) => { if (!ids.length || d > 30) return; rows[d] = (rows[d] || []).concat(ids); walk(ids.flatMap(id => orgKids(id).map(k => k.id)), d + 1); };
    walk([ORG_ROOT], 0);
    const card = id => {
      const n = orgNode(id), below = orgBarbers(id).size - (n.people.length);
      return `<div class="org-chain-item">
        <div class="org-chain-row">
          <button class="org-node" data-action="orgEdit" data-id="${esc(id)}">${icon(id === ORG_ROOT ? 'crown' : 'users')}<span><b>${esc(orgName(n))}</b><small>${orgRole(n)} · ${Math.max(0, below)} abaixo</small></span></button>
          ${id === ORG_ROOT ? '' : `<button class="org-plus" data-action="orgAdd" data-parent="${esc(n.parentId)}" aria-label="Adicionar ao lado de ${esc(orgName(n))}">${icon('plus')}</button>`}
        </div>
        <button class="org-below" data-action="orgAdd" data-parent="${esc(id)}">${icon('plus')} abaixo</button>
      </div>`;
    };
    return `<p class="section-note">Toque num cartão para editar. <b>+</b> cria alguém no mesmo nível; <b>+ abaixo</b> cria alguém que responde a ele.</p>
      ${rows.map((ids, d) => `<section class="org-chain"><span class="org-lv">${esc(orgLevel(d))}</span><div class="org-chain-line">${ids.map(card).join('')}</div></section>`).join('')}`;
  }

  function orgOptions(sel, excludeSub) {
    const ex = excludeSub ? new Set(orgSub(excludeSub)) : new Set();
    const out = [];
    const walk = (id, d) => { const n = orgNode(id); if (!ex.has(id)) out.push(`<option value="${esc(id)}" ${id === sel ? 'selected' : ''}>${'— '.repeat(d)}${esc(orgName(n))}</option>`); orgKids(id).forEach(k => walk(k.id, d + 1)); };
    walk(ORG_ROOT, 0);
    return out.join('');
  }
  const grantArea = g => g.nodeId ? orgName(orgNode(g.nodeId)) : 'Empresa inteira';

  function orgAvancado() {
    const o = org();
    const tree = (id, d) => {
      const n = orgNode(id);
      return `<li style="--d:${d}"><span class="org-lvchip">${esc(orgLevel(d))}</span><b>${esc(orgName(n))}</b>
        <button class="link-btn" data-action="orgEdit" data-id="${esc(id)}">editar</button>
        ${id === ORG_ROOT ? '' : `<button class="icon-btn org-del ${ui.confirm === 'node' + id ? 'is-confirm' : ''}" data-action="orgDel" data-id="${esc(id)}" aria-label="${ui.confirm === 'node' + id ? 'Confirmar exclusão' : 'Excluir'} ${esc(orgName(n))}">${ui.confirm === 'node' + id ? 'Confirmar' : icon('trash')}</button>`}
      </li>${orgKids(id).map(k => tree(k.id, d + 1)).join('')}`;
    };
    const people = state.users.filter(u => u.status === 'ativo' && u.role !== 'gestor');
    return `
      <section class="section card">
        <h2 class="section-title">1. Níveis da empresa</h2>
        <p class="section-note">Ex.: Regional → Unidade → Time. A ordem define quem fica abaixo de quem.</p>
        <ol class="org-levels">${o.levels.map((l, i) => `<li><input class="input" id="lv-${esc(l.id)}" value="${esc(l.name)}" data-change="orgLevelName" data-id="${esc(l.id)}" aria-label="Nome do nível ${i + 1}">
          <button class="icon-btn" data-action="orgLevelDel" data-id="${esc(l.id)}" aria-label="Excluir nível ${esc(l.name)}">${icon('trash')}</button></li>`).join('')}</ol>
        <form class="org-inline" data-form="orgLevel" novalidate><input class="input" id="lv-new" name="name" placeholder="Nome do nível"><button class="btn btn-primary" type="submit">${icon('plus')} Adicionar</button></form>
      </section>
      <section class="section card">
        <h2 class="section-title">2. Estrutura</h2>
        <ul class="org-tree">${tree(ORG_ROOT, 0)}</ul>
        <form class="form" data-form="orgCreate" novalidate>
          <label class="field"><span>Nome</span><input class="input" id="oc-name" name="name" placeholder="Ex.: Regional Sul, Unidade Centro"></label>
          <label class="field"><span>Fica abaixo de</span><select class="input" id="oc-parent" name="parentId">${orgOptions(ORG_ROOT)}</select></label>
          <p class="form-msg" data-msg></p>
          <div><button class="btn btn-primary" type="submit">${icon('plus')} Criar</button></div>
        </form>
      </section>
      <section class="section card">
        <h2 class="section-title">3. Quem vê o quê ${tip('access')}</h2>
        <p class="section-note">No ranking, todos veem os números de todos. Quem não tiver acesso definido vê a performance detalhada só dos próprios números. <b>Gestor</b> vê e lança os resultados de quem está na área; <b>Membro</b> só vê. Uma pessoa pode ter mais de uma área.</p>
        <ul class="list">${o.grants.map(g => { const u = state.users.find(x => x.id === g.userId); return `<li class="list-row"><div class="grow"><b>${esc(u ? u.name : '?')}</b> <span class="muted">· ${g.role === 'gestor' ? 'Gestor' : 'Membro'} · ${esc(grantArea(g))}</span></div>
          <button class="icon-btn" data-action="orgGrantDel" data-id="${esc(g.id)}" aria-label="Remover acesso">${icon('trash')}</button></li>`; }).join('') || '<li class="muted">Ninguém com acesso extra ainda.</li>'}</ul>
        ${people.length ? `<form class="form" data-form="orgGrant" novalidate>
          <div class="grid-2">
            <label class="field"><span>Pessoa</span><select class="input" id="og-user" name="userId"><option value="">Escolha a pessoa</option>${people.map(u => `<option value="${esc(u.id)}">${esc(u.name)}</option>`).join('')}</select></label>
            <label class="field"><span>Papel</span><select class="input" id="og-role" name="role"><option value="gestor">Gestor</option><option value="membro">Membro</option></select></label>
          </div>
          <label class="field"><span>Área</span><select class="input" id="og-node" name="nodeId"><option value="">Empresa inteira</option>${orgOptions(null)}</select></label>
          <label class="check"><input type="checkbox" id="og-extra" name="extra"><span><b>Acesso extra</b><small>Soma esta área às que a pessoa já tem. Desmarcado, substitui as anteriores.</small></span></label>
          <p class="form-msg" data-msg></p>
          <div><button class="btn btn-primary" type="submit">${icon('plus')} Dar acesso</button></div>
        </form>` : '<p class="section-note">Os acessos aparecem aqui depois que os barbeiros entram pelo convite e são aprovados.</p>'}
      </section>`;
  }

  function orgSheet() {
    const sh = ui.orgSheet;
    if (!sh) return '';
    const n = sh.id ? orgNode(sh.id) : null;
    if (sh.id && !n) { ui.orgSheet = null; return ''; }
    const isRoot = n && n.id === ORG_ROOT;
    const mine = new Set(n ? n.people : []);
    const where = bid => { const m = org().nodes.find(x => x.people.includes('b:' + bid)); return m && (!n || m.id !== n.id) ? ` <small class="muted">(hoje em ${esc(orgName(m))})</small>` : ''; };
    const barbers = state.barbers.filter(b => b.active !== false);
    return `<div class="org-sheet-wrap"><div class="inst-scrim" data-action="orgSheetClose"></div>
      <section class="inst-sheet org-sheet" role="dialog" aria-modal="true" aria-labelledby="os-t">
        <h2 id="os-t">${n ? 'Editar ' + esc(orgName(n)) : 'Novo lugar na estrutura'}</h2>
        <form class="form" data-form="orgNode" novalidate>
          ${isRoot ? `<p class="section-note">O topo é sempre o dono da barbearia.</p>` : `
          <label class="field"><span>Nome</span><input class="input" id="os-name" name="name" value="${esc(n ? orgName(n) : '')}" placeholder="Nome da pessoa ou da área"></label>
          <label class="field"><span>Fica abaixo de</span><select class="input" id="os-parent" name="parentId">${orgOptions(n ? n.parentId : sh.parent, n ? n.id : null)}</select></label>
          <fieldset class="org-people"><legend>Pessoas neste lugar</legend>
            ${barbers.map(b => `<label class="check"><input type="checkbox" name="p" value="${esc(b.id)}" ${mine.has('b:' + b.id) ? 'checked' : ''}><span><b>${esc(b.name)}</b>${where(b.id)}</span></label>`).join('') || '<p class="muted">Cadastre barbeiros em Barbeiros.</p>'}
          </fieldset>`}
          <p class="form-msg" data-msg></p>
          <div class="btn-row">${isRoot ? '' : `<button class="btn btn-primary" type="submit">${icon('check')} Salvar</button>`}
            <button class="btn" type="button" data-action="orgSheetClose">${isRoot ? 'Fechar' : 'Cancelar'}</button>
            ${n && !isRoot ? `<button class="btn btn-danger" type="button" data-action="orgDel" data-id="${esc(n.id)}">${ui.confirm === 'node' + n.id ? 'Confirmar exclusão' : 'Excluir'}</button>` : ''}</div>
        </form>
      </section></div>`;
  }

  function pageOrganograma() {
    org();
    const t = ui.orgTab || 'ver';
    return `${orgTabs()}<div class="org-body">${t === 'montar' ? orgMontar() : t === 'avancado' ? orgAvancado() : orgVer()}</div>${orgSheet()}`;
  }

  // ---------- Checklist Agenda Cheia (POP) ----------
  const popCfg = () => GB.popCfgOf(state);
  const todayIso = () => iso(new Date());
  const daysInMonth = ym => Number(monthRange(ym).end.slice(8));
  const popRec = (bid, day) => (state.pop || []).find(r => r.barberId === bid && r.day === day);
  function popRecW(bid, day) {
    state.pop = state.pop || [];
    let r = popRec(bid, day);
    if (!r) { r = { barberId: bid, day, ev: {}, notes: {}, msg: {} }; state.pop.push(r); }
    r.ev = r.ev || {}; r.notes = r.notes || {}; r.msg = r.msg || {};
    const u = currentUser();
    r.by = u && u.barberId === bid ? 'profissional' : 'gestao'; r.at = Date.now();
    return r;
  }
  const r1 = v => Math.round(v * 10) / 10;
  const fmtPts = v => nf1.format(r1(v)).replace(/,0$/, '');
  function popMonth(bid, ym) {
    const cfg = popCfg(), n = daysInMonth(ym), max = GB.popDayMax(cfg) * n;
    let total = 0;
    for (let d = 1; d <= n; d++) total += GB.popDayPts(cfg, popRec(bid, `${ym}-${String(d).padStart(2, '0')}`));
    return { total: r1(total), max, pct: max ? total / max * 100 : 0 };
  }
  function popLevel(pts) {
    const lv = [...popCfg().levels].sort((a, b) => b.min - a.min);
    return lv.find(l => pts >= Number(l.min)) || lv[lv.length - 1];
  }
  function popStatus(bid, day) {
    const cfg = popCfg(), rec = popRec(bid, day);
    if (!rec || !rec.ev || !Object.values(rec.ev).some(l => Array.isArray(l) && l.some(GB.evLive))) return 'none';
    return GB.popDayPts(cfg, rec) >= GB.popDayMax(cfg) - 0.01 ? 'done' : 'part';
  }
  const popPendingOf = (bid, day) => { const rec = popRec(bid, day); return rec && rec.ev ? Object.values(rec.ev).reduce((a, l) => a + (Array.isArray(l) ? l.filter(e => e.status === 'pendente').length : 0), 0) : 0; };
  // Quem confere: o dono, ou o gestor de área para as pessoas dele (nunca a própria prova).
  function canReview(bid) { const u = currentUser(); if (!u) return false; if (isGestor(u)) return true; return u.barberId !== bid && (areaIds(u, ['gestor']).has(bid) || myExtras().review); }
  const popPendingCount = (bid, ym) => (state.pop || []).filter(r => r.barberId === bid && r.day.startsWith(ym) && r.day.length === 10).reduce((a, r) => a + popPendingOf(bid, r.day), 0);
  const popPeople = () => state.barbers.filter(b => b.active !== false && (canEditB(b.id) || canReview(b.id) || (currentUser() || {}).barberId === b.id));
  const canPopEdit = bid => canEditB(bid) || (currentUser() || {}).barberId === bid;

  const EV_TXT = { pendente: 'Aguardando conferência', aprovado: 'Aprovada', recusado: 'Recusada' };
  const PROOF_DAYS = 7;
  function proofImg(e, cls = '') {
    if (e.photoGone) return `<span class="pop-ph pop-ph-none ${cls}">${icon('clock')}<small>Foto apagada após ${PROOF_DAYS} dias</small></span>`;
    if (e.photo) return `<img class="pop-ph ${cls}" src="${esc(e.photo)}" alt="Prova" loading="lazy">`;
    if (e.path) return `<img class="pop-ph ${cls}" data-proof="${esc(e.path)}" alt="Prova" src="data:image/gif;base64,R0lGODlhAQABAAAAACw=">`;
    return `<span class="pop-ph pop-ph-none ${cls}">${icon('camera')}<small>Exemplo</small></span>`;
  }
  function popItemCard(it, rec, bid) {
    const list = rec && rec.ev && Array.isArray(rec.ev[it.id]) ? rec.ev[it.id] : [];
    const t = it.type === 'check' ? 1 : Math.max(1, Number(it.target) || 1);
    const ok = list.filter(e => GB.evOk(it, e)).length, pend = list.filter(e => e.status === 'pendente').length, live = list.filter(GB.evLive).length;
    const pts = GB.popItemPts(it, list), ppend = GB.popItemPts(it, list, true);
    const pct = Math.min(100, ok / t * 100), pctP = Math.min(100 - pct, pend / t * 100);
    const me = currentUser(), mayAdd = canPopEdit(bid) && live < t, rev = canReview(bid);
    const draft = ui.popDraft && ui.popDraft.it === it.id && ui.popDraft.bid === bid ? ui.popDraft : null;
    const evs = list.map((e, i) => `<li class="pop-ev st-${e.status}">
        <button class="pop-evimg" data-action="popView" data-it="${esc(it.id)}" data-i="${i}" aria-label="Ver prova ${i + 1}">${proofImg(e)}</button>
        <div class="pop-evbody"><b>${it.type === 'phones' ? esc(e.phone || '') : `${it.type === 'check' ? 'Prova' : 'Unidade'} ${i + 1}`}</b>
          <span class="pop-evst">${EV_TXT[e.status] || ''}${e.by === 'gestao' ? ' · lançada pela gestão' : ''}</span>
          ${e.desc ? `<p>${esc(e.desc)}</p>` : ''}
          ${e.status === 'pendente' && rev ? `<div class="btn-row"><button class="btn btn-sm btn-ok" data-action="popEvOk" data-it="${esc(it.id)}" data-i="${i}">${icon('check')} Aprovar</button><button class="btn btn-sm btn-danger" data-action="popEvNo" data-it="${esc(it.id)}" data-i="${i}">${icon('x')} Recusar</button></div>` : ''}
          ${e.status !== 'pendente' && rev ? `<button class="link-btn" data-action="popEvUndo" data-it="${esc(it.id)}" data-i="${i}">Voltar para conferência</button>` : ''}
          ${e.status === 'pendente' && canPopEdit(bid) && (!e.byUser || !me || e.byUser === me.id || rev) ? `<button class="link-btn" data-action="popEvDel" data-it="${esc(it.id)}" data-i="${i}">${ui.confirm === 'ev' + it.id + i ? 'Confirmar exclusão' : 'Excluir'}</button>` : ''}
        </div></li>`).join('');
    const composer = draft ? `<div class="pop-draft">
        <div class="pop-draft-ph">${draft.photo ? `<img class="pop-ph big" src="${esc(draft.photo)}" alt="Prova escolhida">` : `<span class="pop-ph big pop-ph-none">${icon('camera')}<small>Anexe a foto ou o print</small></span>`}
          <div class="btn-row"><label class="btn btn-sm" style="cursor:pointer">${icon('camera')} Tirar foto<input type="file" accept="image/*" capture="environment" hidden data-change="popPhoto"></label>
          <label class="btn btn-sm" style="cursor:pointer">${icon('upload')} Galeria / print<input type="file" accept="image/*" hidden data-change="popPhoto"></label></div></div>
        ${it.type === 'phones' ? `<label class="field"><span class="tm-flabel">Telefone do cliente *</span><input class="input" type="tel" inputmode="tel" id="pd-phone" value="${esc(draft.phone || '')}" placeholder="(00) 00000-0000" data-pop="draft" data-k="phone"></label>` : ''}
        <label class="field"><span class="tm-flabel">Descrição (opcional)</span><textarea class="input pop-ta" id="pd-desc" data-pop="draft" data-k="desc" placeholder="Ex.: story do corte degradê, cliente marcou a barbearia">${esc(draft.desc || '')}</textarea></label>
        <p class="form-msg" data-msg id="pd-msg"></p>
        <div class="btn-row"><button class="btn btn-primary" data-action="popConfirm" id="pd-ok" ${draft.photo && (it.type !== 'phones' || GB.validPhone(draft.phone)) && !draft.busy ? '' : 'disabled'}>${icon('check')} ${draft.busy ? 'Enviando…' : 'Confirmar'}</button>
          <button class="btn" data-action="popAddCancel">Cancelar</button></div>
        <p class="section-note">${rev ? 'Como você confere esta pessoa, a prova já entra aprovada.' : 'Os pontos entram depois que a gestão aprovar a prova.'}</p>
      </div>` : '';
    return `<article class="pop-item ${pct >= 100 ? 'is-done' : ''}" id="pi-${esc(it.id)}">
      <div class="pop-ihead"><div><h3>${esc(it.title)}</h3><p>${esc(it.desc || '')}</p></div><span class="pop-badge num">${fmtPts(pts)}/${fmtPts(it.pts)} pts</span></div>
      <div class="pop-bar"><i style="width:${pct}%"></i><i class="pend" style="width:${pctP}%"></i></div>
      <p class="pop-ist num"><b>${ok}/${t}</b> aprovadas${pend ? ` · <span class="pend">${pend} aguardando conferência (+${fmtPts(ppend)} pts)</span>` : ''}</p>
      ${list.length ? `<ul class="pop-evs">${evs}</ul>` : ''}
      ${composer}
      ${!draft && mayAdd ? `<button class="btn pop-add" data-action="popAddOpen" data-it="${esc(it.id)}">${icon('camera')} ${it.type === 'check' ? 'Anexar prova e confirmar' : `Adicionar prova ${live + 1} de ${t}`}</button>` : ''}
      ${!canPopEdit(bid) && !list.length ? '<p class="muted">Sem registro.</p>' : ''}
      ${it.type === 'phones' ? `<label class="field"><span class="tm-flabel">Texto da mensagem enviada (prompt)</span><textarea class="input pop-ta" id="pm-${esc(it.id)}" data-pop="msg" data-it="${esc(it.id)}" placeholder="Cole aqui a mensagem ou abordagem que você enviou" ${canPopEdit(bid) ? '' : 'readonly'}>${esc(rec && rec.msg ? rec.msg[it.id] || '' : '')}</textarea></label>` : ''}
      <label class="field"><span class="tm-flabel">Resultado / observação por pessoa (opcional)</span><textarea class="input pop-ta" id="pn-${esc(it.id)}" data-pop="note" data-it="${esc(it.id)}" placeholder="Ex.: João agendou sábado, Pedro pediu preço" ${canPopEdit(bid) ? '' : 'readonly'}>${esc(rec && rec.notes ? rec.notes[it.id] || '' : '')}</textarea></label>
    </article>`;
  }

  // Provas aguardando conferência (para quem confere).
  function popReviewPanel(ym) {
    const cfg = popCfg(), rows = [];
    for (const b of popPeople()) {
      if (!canReview(b.id)) continue;
      for (const r of (state.pop || [])) {
        if (r.barberId !== b.id || !r.day.startsWith(ym) || r.day.length !== 10 || !r.ev) continue;
        for (const it of cfg.items) (r.ev[it.id] || []).forEach((e, i) => { if (e.status === 'pendente') rows.push({ b, r, it, e, i }); });
      }
    }
    if (!rows.length) return '';
    rows.sort((x, y) => x.r.day.localeCompare(y.r.day));
    const shown = rows.slice(0, ui.popRevAll ? 60 : 5);
    return `<section class="section card pop-review">
      <div class="pop-dhead"><div><h2 class="pop-h2">${icon('checksq')} Conferência ${tip('proof')}</h2><p class="muted">${rows.length} prova(s) aguardando. Os pontos entram no ranking quando você aprova.</p></div>
</div>
      <ul class="pop-rlist">${shown.map(x => `<li>
        <button class="pop-evimg" data-action="popView" data-bid="${esc(x.b.id)}" data-day="${esc(x.r.day)}" data-it="${esc(x.it.id)}" data-i="${x.i}" aria-label="Ver prova">${proofImg(x.e)}</button>
        <div class="pop-evbody"><b>${esc(x.b.name)}</b><span class="muted">Dia ${Number(x.r.day.slice(8))} · ${esc(x.it.title)}${x.it.type === 'phones' ? ' · ' + esc(x.e.phone || '') : ''}</span>${x.e.desc ? `<p>${esc(x.e.desc)}</p>` : ''}
          <div class="btn-row"><button class="btn btn-sm btn-ok" data-action="popEvOk" data-bid="${esc(x.b.id)}" data-day="${esc(x.r.day)}" data-it="${esc(x.it.id)}" data-i="${x.i}">${icon('check')} Aprovar</button>
          <button class="btn btn-sm btn-danger" data-action="popEvNo" data-bid="${esc(x.b.id)}" data-day="${esc(x.r.day)}" data-it="${esc(x.it.id)}" data-i="${x.i}">${icon('x')} Recusar</button></div></div></li>`).join('')}</ul>
      ${rows.length > shown.length ? `<button class="btn btn-sm" data-action="popRevMore">Ver mais (${rows.length - shown.length})</button>` : ''}
    </section>`;
  }

  function popViewer() {
    const v = ui.popView; if (!v) return '';
    const r = popRec(v.bid, v.day), it = popCfg().items.find(x => x.id === v.it), e = r && r.ev && r.ev[v.it] ? r.ev[v.it][v.i] : null;
    if (!e || !it) { ui.popView = null; return ''; }
    return `<div class="pop-viewer" role="dialog" aria-modal="true" aria-label="Prova"><div class="inst-scrim" data-action="popViewClose"></div>
      <figure>${proofImg(e, 'full')}<figcaption><b>${esc(barberById(v.bid)?.name || '')} · ${esc(it.title)} · dia ${Number(v.day.slice(8))}</b>${it.type === 'phones' ? `<span>${esc(e.phone || '')}</span>` : ''}${e.desc ? `<span>${esc(e.desc)}</span>` : ''}<span class="pop-evst">${EV_TXT[e.status]}</span></figcaption>
      <button class="btn" data-action="popViewClose">${icon('x')} Fechar</button></figure></div>`;
  }

  // Busca as fotos guardadas na nuvem (links temporários).
  function hydrateProofs() {
    if (!Cloud.enabled) return;
    document.querySelectorAll('img[data-file]').forEach(img => {
      const [bucket, ...rest] = img.dataset.file.split('|');
      Cloud.fileUrl(bucket, rest.join('|')).then(u => { img.src = u; img.removeAttribute('data-file'); }).catch(() => { img.alt = 'Foto indisponível'; });
    });
    document.querySelectorAll('img[data-proof]').forEach(img => {
      Cloud.proofUrl(img.dataset.proof).then(u => { img.src = u; img.removeAttribute('data-proof'); }).catch(() => { img.alt = 'Prova indisponível'; });
    });
  }

  function popEditor() {
    const c = popCfg();
    const f = (k, label, type = 'text') => `<label class="field"><span class="tm-flabel">${label}</span><input class="input" id="pcfg-${k}" type="${type}" value="${esc(c[k] ?? '')}" data-popcfg="${k}"></label>`;
    return `<section class="section card pop-edit">
      ${f('title', 'Programa')}${f('subtitle', 'Subtítulo')}${f('shop', 'Barbearia')}${f('phrase', 'Frase motivacional')}
      <div class="field"><span class="tm-flabel">Dias no mês</span><b>${daysInMonth(ui.popMonth)} (calendário real, automático)</b></div>
      ${f('minProfit', 'Meta de lucro mínimo (R$)', 'number')}
      <h3 class="pop-h3">Itens do checklist</h3>
      ${c.items.map((it, i) => `<div class="pop-eitem">
        <div class="grid-2"><label class="field"><span class="tm-flabel">Nome</span><input class="input" id="pei-t-${i}" value="${esc(it.title)}" data-popitem="title" data-i="${i}"></label>
        <label class="field"><span class="tm-flabel">Tipo</span><select class="input" id="pei-y-${i}" data-popitem="type" data-i="${i}">
          ${[['count', 'Contador'], ['phones', 'Telefones'], ['check', 'Marcar como feito']].map(([k, l]) => `<option value="${k}" ${it.type === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label></div>
        <label class="field"><span class="tm-flabel">Descrição</span><input class="input" id="pei-d-${i}" value="${esc(it.desc || '')}" data-popitem="desc" data-i="${i}"></label>
        <div class="grid-2">${it.type === 'check' ? '' : `<label class="field"><span class="tm-flabel">Meta (quantidade)</span><input class="input num" type="number" min="1" id="pei-m-${i}" value="${it.target}" data-popitem="target" data-i="${i}"></label>`}
        <label class="field"><span class="tm-flabel">Pontos</span><input class="input num" type="number" min="0" step="0.5" id="pei-p-${i}" value="${it.pts}" data-popitem="pts" data-i="${i}"></label></div>
        <div class="btn-row"><button class="btn btn-sm" data-action="popItemMove" data-i="${i}" data-d="-1" ${i ? '' : 'disabled'}>${icon('up')} Subir</button>
          <button class="btn btn-sm" data-action="popItemMove" data-i="${i}" data-d="1" ${i < c.items.length - 1 ? '' : 'disabled'}>${icon('down')} Descer</button>
          <button class="btn btn-sm btn-danger" data-action="popItemDel" data-i="${i}">${ui.confirm === 'pitem' + i ? 'Confirmar exclusão' : 'Excluir'}</button></div>
      </div>`).join('')}
      <button class="btn" data-action="popItemAdd">${icon('plus')} Adicionar item</button>
      <p class="section-note">Soma do dia: <b class="num">${fmtPts(GB.popDayMax(c))} pts</b> · mês de ${daysInMonth(ui.popMonth)} dias: <b class="num">${fmtPts(GB.popDayMax(c) * daysInMonth(ui.popMonth))} pts</b>.</p>
      <h3 class="pop-h3">Níveis e garantia</h3>
      ${c.levels.map((l, i) => `<div class="grid-2 pop-elevel">
        <label class="field"><span class="tm-flabel">Nível</span><input class="input" id="pel-n-${i}" value="${esc(l.name)}" data-poplevel="name" data-i="${i}"></label>
        <label class="field"><span class="tm-flabel">Garantia (R$, vazio = sem)</span><input class="input num" type="number" min="0" id="pel-v-${i}" value="${l.value ?? ''}" data-poplevel="value" data-i="${i}"></label>
        <label class="field"><span class="tm-flabel">De (pts)</span><input class="input num" type="number" min="0" id="pel-a-${i}" value="${l.min}" data-poplevel="min" data-i="${i}"></label>
        <label class="field"><span class="tm-flabel">Até (pts)</span><input class="input num" type="number" min="0" id="pel-b-${i}" value="${l.max}" data-poplevel="max" data-i="${i}"></label>
      </div>`).join('')}
      <label class="field"><span class="tm-flabel">Regras do programa</span><textarea class="input pop-ta" id="pcfg-rules" data-popcfg="rules">${esc(c.rules || '')}</textarea></label>
      <label class="field"><span class="tm-flabel">Perde a garantia quem (um por linha)</span><textarea class="input pop-ta" id="pcfg-lose" data-popcfg="lose">${esc((c.lose || []).join('\n'))}</textarea></label>
    </section>`;
  }

  // Modo demonstração: mesma regra da nuvem, apaga as fotos conferidas com mais de 7 dias.
  function popPruneLocal() {
    if (Cloud.enabled || ui.popPruned) return;
    ui.popPruned = true;
    const lim = Date.now() - PROOF_DAYS * 86400000; let n = 0;
    for (const r of (state.pop || [])) for (const l of Object.values(r.ev || {})) for (const e of (l || [])) {
      if (e && e.photo && !e.photoGone && e.status !== 'pendente' && Number(e.at || 0) < lim) { e.photo = null; e.photoGone = true; n++; }
    }
    if (n) save();
  }

  function pageChecklist(user) {
    popPruneLocal();
    const cfg = popCfg();
    ui.popMonth = ui.teamMonth || curYm();
    const ym = ui.popMonth;
    const people = popPeople();
    if (!people.length) return `<div class="card empty">${icon('checksq')}<h2>Sem profissionais</h2><p>${isGestor(user) ? 'Cadastre os barbeiros em Barbeiros para usar o checklist.' : 'Seu cadastro ainda não está ligado a um barbeiro. Fale com o gestor.'}</p></div>`;
    if (!people.some(b => b.id === ui.popBarber)) ui.popBarber = (people.find(b => b.id === user.barberId) || people[0]).id;
    const bid = ui.popBarber, b = barberById(bid);
    const n = daysInMonth(ym);
    const isCur = ym === curYm();
    if (!ui.popDay || ui.popDay > n || ui.popDayYm !== ym) { ui.popDay = isCur ? new Date().getDate() : 1; ui.popDayYm = ym; }
    const day = `${ym}-${String(ui.popDay).padStart(2, '0')}`;
    const rec = popRec(bid, day);
    const today = todayIso();
    const st = people.map(x => popStatus(x.id, today));
    const cnt = k => st.filter(x => x === k).length;
    const monthRecs = (state.pop || []).filter(r => r.barberId === bid && r.day.startsWith(ym) && r.at).sort((a, c) => c.at - a.at);
    const last = monthRecs[0];
    const editing = !!ui.popEdit && isGestor(user);
    const dayPts = GB.popDayPts(cfg, rec), dayMax = GB.popDayMax(cfg);
    const M = popMonth(bid, ym), lv = popLevel(M.total);
    // últimos 7 dias até o dia escolhido
    const days7 = Array.from({ length: 7 }, (_, i) => { const d = fromIso(day); d.setDate(d.getDate() - 6 + i); return iso(d); }).filter(d => d.startsWith(ym) || true);
    const vals7 = days7.map(d => d > today ? null : r1(GB.popDayPts(cfg, popRec(bid, d))));
    const won7 = vals7.reduce((a, v) => a + (v || 0), 0), poss7 = vals7.filter(v => v !== null).length * dayMax;
    const resRec = popRec(bid, ym) || {}; const res = resRec.res || {};
    const ro = !canPopEdit(bid);
    const dot = k => `<i class="pop-dot ${k}" aria-hidden="true"></i>`;
    return `
      <section class="section card">
        <h2 class="pop-h2">Escolha o profissional</h2>
        <p class="pop-today">Hoje: <b class="ok">${cnt('done')} completos</b> · <b class="part">${cnt('part')} incompletos</b> · <b class="none">${cnt('none')} sem registro</b></p>
        <div class="pop-month"><select class="input" id="pop-month" data-change="popMonth">${monthOptions(ym)}</select></div>
        <div class="pop-people">${people.map((x, i) => `<button class="pop-person ${x.id === bid ? 'on' : ''}" data-action="popPick" data-id="${esc(x.id)}"><span class="pop-av">${avatar(x, 42)}${dot(st[i])}</span><b>${esc(x.name)}</b><span class="num">${fmtPts(popMonth(x.id, ym).total)} pts</span>${canReview(x.id) && popPendingCount(x.id, ym) ? `<span class="pop-pcount" title="Provas aguardando conferência">${popPendingCount(x.id, ym)}</span>` : ''}</button>`).join('')}</div>
      </section>
      ${popReviewPanel(ym)}
      <p class="pop-who">Checklist de <b>${esc(b.name)}</b>${last ? ` · último registro feito ${last.by === 'profissional' ? 'pelo profissional' : 'pela gestão'}` : ' · ainda sem registro neste mês'}</p>
      <div class="pop-tools">
        <p class="pop-phrase">${icon('sparkle')}<span>${esc(cfg.phrase || '')}</span></p>
        ${isGestor(user) ? `<label class="pop-switch"><input type="checkbox" id="pop-edit" data-change="popEdit" ${editing ? 'checked' : ''}><span></span>Editar estrutura</label>` : ''}
        <div class="btn-row">
          <button class="icon-btn pop-tb" data-action="popCsv" title="Baixar planilha do mês" aria-label="Baixar planilha do mês">${icon('download')}</button>
          <button class="icon-btn pop-tb" data-action="popPrint" title="Relatório para imprimir ou salvar em PDF" aria-label="Relatório para imprimir ou salvar em PDF">${icon('file')}</button>
          <button class="icon-btn pop-tb is-primary" data-action="popSave" title="Salvar agora" aria-label="Salvar agora">${icon('save')}</button>
          ${ro ? '' : `<button class="icon-btn pop-tb ${ui.confirm === 'popReset' ? 'is-confirm' : ''}" data-action="popReset" title="${editing ? 'Restaurar modelo padrão' : 'Limpar o registro do dia'}" aria-label="${editing ? 'Restaurar modelo padrão' : 'Limpar o registro do dia'}">${ui.confirm === 'popReset' ? 'Confirmar' : icon('undo')}</button>`}
        </div>
      </div>
      ${editing ? popEditor() : `<section class="section card pop-hero"><h2>${esc(cfg.title)}</h2><p>${esc(cfg.subtitle || '')}</p>${cfg.shop ? `<span class="muted">${esc(cfg.shop)}</span>` : ''}</section>`}
      <section class="section card pop-day">
        <div class="pop-dhead"><div><h2 class="pop-h2">${icon('sparkle')} Registro do dia ${tip('proof')}</h2><p class="muted">Preencha stories, posts, abordagens e convites. Salva sozinho.</p></div>
          <span class="pop-cloud" id="pop-saved" title="Salvo">${icon('cloud')}</span></div>
        <span class="tm-flabel">Dia do mês</span>
        <div class="pop-days" id="pop-days">${Array.from({ length: n }, (_, i) => { const d = `${ym}-${String(i + 1).padStart(2, '0')}`; const s2 = popStatus(bid, d); return `<button class="pop-dn ${i + 1 === ui.popDay ? 'on' : ''} st-${s2} ${d > today ? 'future' : ''}" data-action="popDay" data-d="${i + 1}" aria-label="Dia ${i + 1}">${i + 1}</button>`; }).join('')}</div>
        <p class="pop-sum"><b class="num" id="pop-daypts">${fmtPts(dayPts)}/${fmtPts(dayMax)} pts aprovados no dia</b>${GB.popDayPts(cfg, rec, true) ? ` · <span class="pend num">+${fmtPts(GB.popDayPts(cfg, rec, true))} pts aguardando conferência</span>` : ''}</p>
        <p class="section-note">Cada unidade precisa de uma prova: foto ou print. Anexe, escreva uma descrição se quiser e toque em Confirmar. As fotos são apagadas ${PROOF_DAYS} dias depois do envio (as que ainda aguardam conferência ficam até serem conferidas); a prova e os pontos continuam.</p>
        ${ro ? '<p class="section-note">Você está vendo este checklist sem poder editar.</p>' : ''}
        <div class="pop-items">${cfg.items.map(it => popItemCard(it, rec, bid)).join('')}</div>
      </section>
      <section class="section card pop-rem">
        <div class="pop-dhead"><div><h2 class="pop-h2">${icon('bell')} Lembretes de posts</h2><p class="muted">Aviso diário para preencher o checklist enquanto a meta do dia não for batida.</p></div>
          <label class="pop-switch"><input type="checkbox" id="pop-rem" data-change="popRem" ${DB.pref.get('popRem', '0') === '1' ? 'checked' : ''}><span></span><span class="sr">Lembretes</span></label></div>
      </section>
      <section class="section card">
        <h2 class="pop-h2">${icon('chart')} Evolução — últimos 7 dias</h2>
        <p class="muted">Pontos feitos em cada dia, de ${fmtPts(dayMax)} possíveis.</p>
        ${lineSvg({ labels: days7.map(d => 'Dia ' + Number(d.slice(8))), series: [{ values: vals7, color: '#d6b46a', fill: true }], yMax: dayMax || 1, yFmt: v => fmtPts(v) })}
        <div class="pc-totals pop-kpis">
          <div class="pc-stat"><span>Aderência da semana</span><b class="num">${poss7 ? nf0.format(won7 / poss7 * 100) : 0}%</b></div>
          <div class="pc-stat"><span>Pontos ganhos</span><b class="num">${fmtPts(won7)} pts</b></div>
          <div class="pc-stat"><span>Pontos deixados na mesa</span><b class="num">${fmtPts(Math.max(0, poss7 - won7))} pts</b></div>
          <div class="pc-stat"><span>Total no ranking (mês)</span><b class="num">${fmtPts(M.total)} / ${fmtPts(M.max)} pts</b></div>
        </div>
        <p class="section-note">Cada dia completo vale ${fmtPts(dayMax)} pts. Completar todos os dias deste mês soma ${fmtPts(M.max)} pts no indicador Checklist Agenda Cheia do ranking.</p>
      </section>
      <section class="section card">
        <h2 class="pop-h2">Níveis e garantia</h2>
        <div class="pop-levels">${cfg.levels.map(l => `<div class="pop-lv t-${esc(l.tone || 'plain')} ${l === lv ? 'is-cur' : ''}"><div><b>${esc(l.name)}</b><span class="num">${l.min} a ${l.max} pts</span></div><strong class="num">${l.value ? money2(l.value) : 'Sem garantia'}</strong></div>`).join('')}</div>
      </section>
      <section class="section card">
        <h2 class="pop-h2">Resumo do mês</h2>
        <dl class="pop-res">
          <div><dt>Pontuação total</dt><dd class="num">${fmtPts(M.total)} / ${fmtPts(M.max)}</dd></div>
          <div><dt>Percentual</dt><dd class="num">${nf0.format(M.pct)}%</dd></div>
          <div><dt>Nível alcançado</dt><dd>${esc(lv ? lv.name : '—')}</dd></div>
          <div><dt>Garantia conquistada</dt><dd>${lv && lv.value ? money2(lv.value) : 'Sem garantia'}</dd></div>
          ${cfg.minProfit ? `<div><dt>Meta de lucro mínimo</dt><dd class="num">${money2(Number(cfg.minProfit))}</dd></div>` : ''}
        </dl>
        <div class="pop-bar big"><i style="width:${Math.min(100, M.pct)}%"></i></div>
      </section>
      <section class="section card">
        <h2 class="pop-h2">Resultados do mês</h2>
        ${[['cli', 'Clientes atendidos', '1'], ['agend', 'Agendamentos gerados', '1'], ['vendido', 'Valor vendido (R$)', '0.01']].map(([k, l, step]) => `<label class="field"><span class="tm-flabel">${l}</span><input class="input num" type="number" min="0" step="${step}" id="pr-${k}" value="${isNum(res[k]) ? res[k] : ''}" data-pop="res" data-k="${k}" ${ro ? 'readonly' : ''}></label>`).join('')}
      </section>
      <section class="section card"><h2 class="pop-h2">Regras do programa</h2><p class="pop-rules">${esc(cfg.rules || '')}</p></section>
      <section class="section card"><h2 class="pop-h2">Perde a garantia quem</h2><ul class="pop-lose">${(cfg.lose || []).map(x => `<li>${esc(x)}</li>`).join('')}</ul></section>
      ${popViewer()}`;
  }

  let popTimer = null;
  function popInput(el) {
    const bid = ui.popBarber; if (!canPopEdit(bid)) return;
    const day = `${ui.popMonth}-${String(ui.popDay).padStart(2, '0')}`;
    const kind = el.dataset.pop, it = el.dataset.it;
    if (kind === 'draft') {
      if (!ui.popDraft) return;
      ui.popDraft[el.dataset.k] = el.value;
      const d = ui.popDraft, item = popCfg().items.find(x => x.id === d.it), btn = $('#pd-ok');
      if (btn) btn.disabled = !(d.photo && (item.type !== 'phones' || GB.validPhone(d.phone)));
      if (el.dataset.k === 'phone') el.classList.toggle('input-bad', !!el.value.trim() && !GB.validPhone(el.value));
      return;
    }
    if (kind === 'res') { const r = popRecW(bid, ui.popMonth); r.res = r.res || {}; const v = el.value.trim(); r.res[el.dataset.k] = v === '' ? null : Number(v); }
    else {
      const r = popRecW(bid, day);
      if (kind === 'note') r.notes[it] = el.value;
      if (kind === 'msg') r.msg[it] = el.value;
    }
    const c = $('#pop-saved'); if (c) c.classList.add('saving');
    clearTimeout(popTimer);
    popTimer = setTimeout(() => { save(); const c2 = $('#pop-saved'); if (c2) c2.classList.remove('saving'); }, 600);
  }
  function popCfgW() { if (!state.popCfg || !Array.isArray(state.popCfg.items)) state.popCfg = JSON.parse(JSON.stringify(GB.popDefault())); return state.popCfg; }

  function popCsv() {
    const cfg = popCfg(), bid = ui.popBarber, b = barberById(bid), ym = ui.popMonth, n = daysInMonth(ym);
    const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const rows = [['Dia', ...cfg.items.map(i => i.title + ' (aprovadas)'), 'Pontos aprovados']];
    for (let d = 1; d <= n; d++) {
      const day = `${ym}-${String(d).padStart(2, '0')}`, rec = popRec(bid, day);
      rows.push([`${String(d).padStart(2, '0')}/${ym.slice(5)}/${ym.slice(0, 4)}`, ...cfg.items.map(it => { const l = rec && rec.ev && Array.isArray(rec.ev[it.id]) ? rec.ev[it.id] : []; const okl = l.filter(e => GB.evOk(it, e)), pl = l.filter(e => e.status === 'pendente').length; return (it.type === 'phones' ? okl.map(e => e.phone).join(' / ') : String(okl.length || '')) + (pl ? ` (+${pl} aguardando)` : ''); }), fmtPts(GB.popDayPts(cfg, rec))]);
    }
    const M = popMonth(bid, ym), lv = popLevel(M.total);
    rows.push([], ['Total do mês', fmtPts(M.total) + ' / ' + fmtPts(M.max)], ['Nível', lv.name], ['Garantia', lv.value ? money2(lv.value) : 'Sem garantia']);
    const csv = '﻿' + rows.map(r => r.map(q).join(';')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = `checklist-${b.name.replace(/\s+/g, '-').toLowerCase()}-${ym}.csv`;
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
    toast('Planilha baixada.');
  }

  function pageSoon(route) {
    const item = NAV.flatMap(g => g.items).find(i => i.r === route);
    return `<div class="card empty">${icon(item?.i || 'clock')}<h2>${esc(item?.t || 'Em breve')}</h2>
      <p>${esc(SOON_TEXT[route] || '')}</p><span class="chip chip-soft">Chega numa próxima etapa</span>
      <a class="btn" href="#inicio">Voltar ao início</a></div>`;
  }


  // ---------- Temas ----------
  function sampleRanking() {
    const names = MARCA === 'salao' ? ['Ana Beatriz', 'Carla Nunes', 'Paula Reis'] : ['Rafael Lima', 'Diego Moura', 'Thiago Alves'];
    const rows = names.map((name, i) => ({ barber: { id: 'ex' + i, name, photo: null }, overall: [92.4, 84, 79.1][i], sums: { fat: [18400, 15900, 13200][i] }, leads: Array(5 - i * 2).fill('x'), pos: i + 1 }));
    return { rows, N: 8, title: { barberId: 'ex0', type: 'mvp' }, mvpNeed: 5, half: 4 };
  }
  function bdayText(bday) {
    if (!bday) return 'Cadastre a data de inauguração abaixo.';
    const [y, m, d] = bday.split('-').map(Number), now = new Date();
    const anos = now.getFullYear() - y - (now < new Date(now.getFullYear(), m - 1, d) ? 1 : 0);
    return `Semana de ${d} de ${['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'][m - 1]}${anos > 0 ? ` · ${anos} ano${anos > 1 ? 's' : ''}` : ''}`;
  }
  function pageTemas() {
    const th = pdTheme(), R0 = computeRanking(state, range());
    const R = R0.rows.length >= 3 ? R0 : sampleRanking();
    const auto = seasonBy(seasonOn(new Date()));
    const opt = (on, action, v, body) => `<button type="button" class="th-opt ${on ? 'on' : ''}" aria-pressed="${on}" data-action="${action}" data-v="${v}">${body}${on ? `<span class="th-check">${icon('check')}</span>` : ''}</button>`;
    const sw = s => `<span class="th-sw">${s.c.map(([a, b]) => `<i style="background:linear-gradient(135deg, ${a}, ${b})"></i>`).join('')}</span>`;
    return `
      <section class="section card">
        <h2 class="section-title">Prévia do pódio</h2>
        <p class="section-note">O tema vale para o pódio da Tela da loja e do Início, em todos os aparelhos da equipe. ${R === R0 ? 'A prévia usa o ranking atual.' : 'Prévia com nomes de exemplo.'}</p>
        <div class="th-stage">${podium(R)}</div>
      </section>
      <section class="section card">
        <h2 class="section-title">Formato do escudo</h2>
        <div class="th-grid">${PD_LAYOUTS.map(l => opt(th.layout === l.k, 'pdLayout', l.k, `<span class="th-shape th-${l.k}"><i></i></span><b>${esc(l.n)}</b><small>${esc(l.d)}</small>`)).join('')}</div>
      </section>
      <section class="section card">
        <h2 class="section-title">Tema da temporada</h2>
        <p class="section-note">Muda as cores do pódio, troca a coroa do 1º lugar por um enfeite do tema e coloca um efeito no fundo. No automático, o app escolhe o tema pela data.</p>
        <div class="th-grid th-seasons">
          ${opt(th.season === 'off', 'pdSeason', 'off', `<span class="th-ico th-plain">${icon('x')}</span><b>Sem tema</b><small>Cores normais: MVP, Destaque, prata e bronze.</small>`)}
          ${opt(th.season === 'auto', 'pdSeason', 'auto', `<span class="th-ico th-plain">${icon('clock')}</span><b>Automático pelo calendário</b><small>${auto ? `Hoje: ${esc(auto.n)}.` : 'Hoje: sem tema.'}${th.season === 'auto' ? '' : ' Toque para escolher os temas.'}</small>`)}
          ${th.season === 'auto' ? `<div class="th-auto">
            <b>Temas que entram no automático</b>
            <small>Toque para ligar ou desligar. Os desligados não aparecem sozinhos na data deles.</small>
            <div class="th-auto-list">${AUTO_KEYS.map(k => { const s = seasonBy(k), on = !th.autoOff.includes(k);
              return `<button type="button" class="th-auto-it ${on ? 'on' : ''}" role="switch" aria-checked="${on}" data-action="pdAutoToggle" data-v="${k}"><span class="th-ico">${seasonTopper(k)}</span><span><b>${esc(s.n)}</b><small>${esc(k === 'aniversario' ? bdayText(th.bday) : s.when)}</small></span><i class="th-tg" aria-hidden="true"></i></button>`; }).join('')}</div>
            <small>Copa do Mundo fica fora do automático porque as datas mudam a cada Copa: escolha à mão.</small>
          </div>` : ''}
          ${SEASONS.map(s => opt(th.season === s.k, 'pdSeason', s.k, `<span class="th-ico">${seasonTopper(s.k)}</span><b>${esc(s.n)}</b><small>${esc(s.k === 'aniversario' ? bdayText(th.bday) : s.when)}</small>${sw(s)}`)).join('')}
        </div>
        <form class="form th-bday" data-form="pdBday" novalidate>
          <label class="field"><span>Data de inauguração ${MARCA === 'salao' ? 'do salão' : 'da barbearia'}</span><input class="input" type="date" id="th-bday" name="bday" value="${esc(th.bday)}"></label>
          <button class="btn btn-primary" type="submit">${icon('check')} Salvar data</button>
          <p class="form-msg" data-msg>No automático, o tema Aniversário entra 3 dias antes e sai 3 dias depois dessa data.</p>
        </form>
      </section>`;
  }

  const PAGES = {
    inicio: { t: 'Início', r: pageInicio },
    fechamento: { t: 'Fechamento do mês', r: pageFechamento, g: 1, a: 1 },
    temas: { t: 'Temas', r: pageTemas, g: 1 },
    organograma: { t: 'Organograma', r: pageOrganograma, g: 1 },
    checklist: { t: 'Checklist Agenda Cheia', r: pageChecklist },
    pops: { t: 'POPs · Guia do Sucesso', r: pagePops },
    time: { t: 'Performance da equipe', r: pageTime },
    performance: { t: 'Minha performance', r: pagePerformance },
    lancamentos: { t: 'Lançamentos', r: pageLancamentos, g: 1, a: 1 },
    barbeiros: { t: 'Adicionar profissional', r: pageBarbeiros, g: 1 },
    configuracoes: { t: 'Configurações', r: pageConfiguracoes, g: 1 },
    assinatura: { t: 'Assinatura', r: pageAssinatura, g: 1 },
    admin: { t: 'Painel do SaaS', r: pageAdmin, g: 1 },
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
    const reduce = reduceMotion();
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
      case 'check': return `somar mais ${g.delta} ponto(s) no Checklist Agenda Cheia`;
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
    const extra = (R.bonus || []).map(ind => {
      const leaders = ind.leaders.map(barberById).filter(Boolean);
      if (!leaders.length) return '';
      const names = leaders.length > 1 ? leaders.map(b => first(b.name)).join(' + ') : esc(leaders[0].name);
      return `<div class="gd gd-bonus ${leaders.length > 1 ? 'gd-tie' : ''}">
        <span class="gd-label">${esc(ind.label)}</span>
        <div class="gd-photos"><span class="gd-crown">${crownSvg('tier-gold')}</span>${leaders.slice(0, 3).map(b => `<span class="gd-photo">${pdPhoto(b).replace('pd-photo', 'gd-ring')}</span>`).join('')}</div>
        <b class="gd-name">${names}</b>
        <span class="gd-val num">${money2(ind.max)}</span>
        <span class="chip chip-soft">Não pontua</span>
      </div>`;
    }).join('');
    const nCards = R.active.length + (R.bonus || []).filter(i => i.leaders.length).length;
    return `<p class="tv-eyebrow gold">${icon('crown')} Líderes do período</p>
      <h2 class="tv-h">Quem está puxando cada resultado</h2>
      ${cards ? `<div class="gd-grid" style="--gd-cols:${Math.min(5, Math.max(3, Math.ceil(nCards / 2)))}">${cards}${extra}</div>` : '<div class="card muted">Ainda não há lançamentos neste período.</div>'}`;
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
    document.body.classList.remove('has-nav');
    document.documentElement.classList.add('tv-motion');
    if (!Cloud.enabled) state = DB.load();
    applyBrand(DB.demo || state.brand || 'barber');
    applyPdTheme();
    const tr = tvRange();
    const R = computeRanking(state, tr);
    const dk = darkFor(tr, true);
    if (!dk) liveDetect(R);
    const slides = dk ? [() => suspenseCard(dk, true)] : [tvRanking, tvGuardians, tvAlerts];
    const i = ((ui.tvIndex % slides.length) + slides.length) % slides.length;
    const reduce = reduceMotion();
    root.innerHTML = `<div class="tv">
      <div class="tv-progress" aria-hidden="true"><i style="animation-duration:${TV_SECONDS}s${reduce ? ';animation:none;width:100%' : ''}"></i></div>
      <div class="tv-fit">
      <header class="tv-head">
        ${logo('tv-logo')}
        <div class="tv-title"><b>${esc(state.company.name)}</b><span>Tela da loja · ${esc(tr.type === 'mes' ? 'Mês' : PERIOD_NAMES[ui.period])}: ${esc(tr.label)}</span></div>
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
      </div>
    </div>`;
    fitTV();
    root.querySelectorAll('.tv img').forEach(im => { if (!im.complete) im.addEventListener('load', fitTV, { once: true }); });
    [300, 900, 2000, 4000].forEach(ms => setTimeout(fitTV, ms));
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(fitTV);
    applyLive();
    clearTimeout(ui.tvTimer);
    ui.tvTimer = setTimeout(() => { ui.tvIndex = i + 1; if (location.hash === '#apresentacao') { renderTV(); window.scrollTo(0, 0); } }, TV_SECONDS * 1000);
  }

  // A Tela da loja é uma vitrine: mantém as animações mesmo com "reduzir movimento" ligado no aparelho.
  function reduceMotion() { return matchMedia('(prefers-reduced-motion: reduce)').matches && !document.documentElement.classList.contains('tv-motion'); }
  // Computador, notebook e TV (tela deitada): a Tela da loja se ajusta ao tamanho da tela, sem rolagem.
  // No celular em pé continua rolando normalmente.
  function fitTV() {
    const tv = root.querySelector('.tv'), box = tv && tv.querySelector('.tv-fit');
    if (!box) return;
    const W = window.innerWidth, H = window.innerHeight;
    const on = W >= 900 && W > H;
    tv.classList.toggle('tv-fitted', on);
    box.style.width = box.style.transform = box.style.left = box.style.top = '';
    if (!on) return;
    const cs = getComputedStyle(tv);
    const pt = parseFloat(cs.paddingTop), pb = parseFloat(cs.paddingBottom), pl = parseFloat(cs.paddingLeft), pr = parseFloat(cs.paddingRight);
    const availW = W - pl - pr, availH = H - pt - pb;
    // Escala por transform (funciona em qualquer navegador, inclusive de Smart TV).
    // O layout é montado numa largura "virtual" e depois reduzido/ampliado para caber na tela.
    const maxZ = Math.min(2.4, availW / 1100);
    let z = Math.min(1, maxZ), h = 0;
    for (let k = 0; k < 5; k++) {
      box.style.width = (availW / z) + 'px';
      h = box.offsetHeight;
      if (!h) return;
      const nz = Math.max(0.35, Math.min(maxZ, availH / h));
      if (Math.abs(nz - z) < 0.005) { z = Math.min(z, availH / h); break; }
      z = nz;
    }
    box.style.width = (availW / z) + 'px';
    h = box.offsetHeight;
    if (h * z > availH) z = availH / h;
    box.style.width = (availW / z) + 'px';
    h = box.offsetHeight;
    box.style.left = pl + 'px';
    box.style.top = (pt + Math.max(0, (availH - h * z) / 2)) + 'px';
    box.style.transform = `scale(${z})`;
  }
  window.addEventListener('resize', () => { if (location.hash === '#apresentacao') fitTV(); });

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
    // Logado: vale a marca da empresa (e fica lembrada para a tela de login).
    applyBrand(DB.demo || state.brand || 'barber');
    if (DB.pref.get('brand', '') !== MARCA) DB.pref.set('brand', MARCA);
    applyPdTheme();

    let route = h || 'inicio';
    if (route !== 'fechamento') ui.fcPeek = false;
    if (route !== 'time') ui.profSel = null;
    const alias = { empresa: 'empresa', integracao: 'integracao' };
    if (alias[route]) { ui.cfgTab = alias[route]; route = 'configuracoes'; }
    if (route === 'gestao-visual') route = 'inicio';
    if (route === 'apresentacao') { renderTV(); return; }
    document.documentElement.classList.remove('tv-motion');
    let page, title;
    if (route.startsWith('perfil-')) {
      const id = route.slice(7);
      page = { r: () => perfFor(id, user) }; title = 'Perfil';
    } else if (PAGES[route]) {
      page = PAGES[route]; title = route === 'performance' && (isGestor(user) || hasGrants(user)) ? (isGestor(user) || accessOf(user.barberId) !== 'profissional' ? 'Performance da empresa' : 'Performance da área') : page.t;
    } else if (SOON_TEXT[route]) {
      page = { r: () => pageSoon(route) }; title = NAV.flatMap(g => g.items).find(i => i.r === route).t;
    } else { route = 'inicio'; page = PAGES.inicio; title = page.t; }
    if (page.g && !isGestor(user) && !(page.a && isAreaMgr(user)) && !(route === 'lancamentos' && myExtras().fields.length)) { route = 'inicio'; page = PAGES.inicio; title = page.t; }

    const pending = isGestor(user) ? state.users.filter(u => u.status === 'pendente').length : 0;
    const who = isGestor(user) ? { name: state.company.name, photo: state.company.logo } : (barberById(user.barberId) || { name: user.name });
    root.innerHTML = `
      <header class="topbar">
        <button class="icon-btn" data-action="openDrawer" aria-label="Abrir menu">${icon('menu')}</button>
        <div class="topbar-title"><h1>${esc(title)}</h1><p>${esc(state.company.name || 'Gestão Barber IA')}</p></div>
        <a class="icon-btn" href="#apresentacao" aria-label="Tela da loja" title="Tela da loja">${icon('monitor')}</a>
        <button class="icon-btn" data-action="fontSize" aria-label="Tamanho da letra" title="Tamanho da letra">${icon('type')}</button>
        <button class="icon-btn theme-btn" data-action="toggleTheme" aria-label="${getTheme() === 'light' ? 'Ativar modo escuro' : 'Ativar modo claro'}" title="${getTheme() === 'light' ? 'Modo escuro' : 'Modo claro'}">${icon(getTheme() === 'light' ? 'moon' : 'sun')}</button>
        ${(() => { const n = pending + unseenOvertakes(); return `<button class="icon-btn" data-action="notifOpen" aria-expanded="${!!ui.notifOpen}" aria-label="Notificações${n ? ': ' + n + ' novas' : ''}">${icon('bell')}${n ? `<span class="badge-dot">${n > 9 ? '9+' : n}</span>` : ''}</button>`; })()}
        <button class="avatar-btn" data-action="togglePopover" aria-label="Perfil e conta">${avatar(who, 40)}</button>
      </header>
      ${demoBar(user)}
      ${trialBanner(user)}
      <main class="main" id="main">${page.r(user)}</main>
      <button class="fab" data-action="openDrawer" aria-label="Abrir menu">${icon('menu')}</button>
      ${drawer(user, route)}
      ${popover(user)}
      ${notifPanel(user, pending)}`;
    document.body.classList.add('has-nav');
    applyLive();
    maybeOfferInstall();
    maybeRemindPop(user);
    maybeOvertakeToast();
    hydrateProofs();
    setTimeout(maybeAutoReveal, 700);
    setTimeout(() => maybeGoalCelebrate(user), 1200);
  }

  // Lembrete do checklist: uma vez por dia, enquanto a meta do dia não foi batida.
  function maybeRemindPop(user) {
    if (DB.pref.get('popRem', '0') !== '1' || !user || !user.barberId || location.hash === '#checklist') return;
    const today = todayIso();
    if (DB.pref.get('popRemDay', '') === today || popStatus(user.barberId, today) === 'done') return;
    DB.pref.set('popRemDay', today);
    setTimeout(() => {
      toast('Seu Checklist Agenda Cheia de hoje ainda não está completo.');
      try { if ('Notification' in window && Notification.permission === 'granted' && document.hidden) new Notification('Gestão Barber IA', { body: 'Complete o seu Checklist Agenda Cheia de hoje.', icon: 'assets/icon-192.png' }); } catch (e) { /* opcional */ }
    }, 1500);
  }

  // ---------- ações ----------
  function setMsg(form, text, ok) {
    const m = form.querySelector('[data-msg]');
    if (m) { m.textContent = L(text); m.classList.toggle('ok', !!ok); }
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
    approve(el) { const u = state.users.find(x => x.id === el.dataset.id); if (u) { u.status = 'ativo'; save(); toast(`${U(u.name)} agora tem acesso.`); render(); } },
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
    popPick(el) { ui.popBarber = el.dataset.id; ui.confirm = null; ui.popDraft = null; render(); },
    popDay(el) { ui.popDay = Number(el.dataset.d); ui.confirm = null; ui.popDraft = null; render(); },
    popAddOpen(el) {
      if (!canPopEdit(ui.popBarber)) return;
      ui.popDraft = { it: el.dataset.it, bid: ui.popBarber, photo: null, phone: '', desc: '' }; ui.confirm = null; render();
      setTimeout(() => document.getElementById('pi-' + el.dataset.it)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 40);
    },
    popAddCancel() { ui.popDraft = null; render(); },
    async popConfirm() {
      const d = ui.popDraft; if (!d || d.busy) return;
      const it = popCfg().items.find(x => x.id === d.it), msg = $('#pd-msg');
      if (!d.photo) { if (msg) msg.textContent = 'Anexe a foto ou o print para confirmar.'; return; }
      if (it.type === 'phones' && !GB.validPhone(d.phone)) { if (msg) msg.textContent = 'Digite o telefone completo do cliente, com DDD.'; return; }
      const day = `${ui.popMonth}-${String(ui.popDay).padStart(2, '0')}`, u = currentUser();
      const e = { id: uid('e_'), desc: (d.desc || '').trim(), at: Date.now(), by: u && u.barberId === d.bid ? 'profissional' : 'gestao', byUser: u ? u.id : null, status: 'pendente' };
      if (it.type === 'phones') e.phone = d.phone.trim();
      if (canReview(d.bid)) { e.status = 'aprovado'; e.reviewedBy = u.id; e.reviewedAt = Date.now(); }
      if (Cloud.enabled) {
        d.busy = true; render();
        try { e.path = await Cloud.uploadProof(`${Cloud.companyId}/${d.bid}/${day}/${e.id}.jpg`, d.photo); }
        catch (err) { d.busy = false; render(); toast('Não foi possível enviar a foto: ' + Cloud.message(err)); return; }
      } else e.photo = d.photo;
      const r = popRecW(d.bid, day); (r.ev[it.id] = r.ev[it.id] || []).push(e);
      ui.popDraft = null; save();
      toast(e.status === 'aprovado' ? 'Prova registrada e aprovada.' : 'Prova enviada. Os pontos entram depois da conferência.'); render();
    },
    popEvDel(el) {
      const k = 'ev' + el.dataset.it + el.dataset.i;
      if (ui.confirm !== k) { ui.confirm = k; render(); return; }
      const r = popRecW(ui.popBarber, `${ui.popMonth}-${String(ui.popDay).padStart(2, '0')}`), list = r.ev[el.dataset.it] || [];
      const [e] = list.splice(Number(el.dataset.i), 1);
      if (e && e.path && Cloud.enabled) Cloud.removeProof(e.path);
      ui.confirm = null; save(); toast('Prova excluída.'); render();
    },
    popEvOk(el) { popReview(el, 'aprovado'); },
    popEvNo(el) { popReview(el, 'recusado'); },
    popEvUndo(el) { popReview(el, 'pendente'); },
    popView(el) { ui.popView = { bid: el.dataset.bid || ui.popBarber, day: el.dataset.day || `${ui.popMonth}-${String(ui.popDay).padStart(2, '0')}`, it: el.dataset.it, i: Number(el.dataset.i) }; render(); },
    popViewClose() { ui.popView = null; render(); },
    popRevMore() { ui.popRevAll = true; render(); },
    popCsv() { popCsv(); },
    popPrint() { document.body.classList.add('printing'); setTimeout(() => { window.print(); document.body.classList.remove('printing'); }, 50); },
    popSave() { save(); toast('Checklist salvo.'); },
    popReset() {
      if (ui.confirm !== 'popReset') { ui.confirm = 'popReset'; render(); return; }
      ui.confirm = null;
      if (ui.popEdit && isGestor(currentUser())) { state.popCfg = JSON.parse(JSON.stringify(GB.popDefault())); toast('Modelo padrão restaurado.'); }
      else { const r = popRecW(ui.popBarber, `${ui.popMonth}-${String(ui.popDay).padStart(2, '0')}`); for (const k of Object.keys(r.ev)) { const l = r.ev[k] || []; l.filter(e => e.status === 'pendente' && e.path && Cloud.enabled).forEach(e => Cloud.removeProof(e.path)); r.ev[k] = l.filter(e => e.status !== 'pendente'); } r.notes = {}; r.msg = {}; toast('Provas pendentes e anotações do dia foram limpas. Provas já conferidas ficam.'); }
      save(); render();
    },
    popItemAdd() { popCfgW().items.push({ id: uid('it_'), title: 'Novo item', desc: '', type: 'count', target: 1, pts: 1 }); save(); render(); },
    popItemDel(el) {
      const i = Number(el.dataset.i);
      if (ui.confirm !== 'pitem' + i) { ui.confirm = 'pitem' + i; render(); return; }
      const c = popCfgW(); if (c.items.length <= 1) { toast('Mantenha pelo menos um item.'); return; }
      c.items.splice(i, 1); ui.confirm = null; save(); render();
    },
    popItemMove(el) { const c = popCfgW(), i = Number(el.dataset.i), j = i + Number(el.dataset.d); if (j < 0 || j >= c.items.length) return; [c.items[i], c.items[j]] = [c.items[j], c.items[i]]; save(); render(); },
    pcMonth(el) { ui.teamMonth = el.dataset.ym; render(); },
    pcPrint() {
      const t = document.title, ym = ui.teamMonth || curYm();
      document.title = `Relatório ${state.company.name || ''} - ${cap(monthRange(ym).label)}`.trim();
      document.body.classList.add('printing', 'printing-pc');
      setTimeout(() => { window.print(); document.body.classList.remove('printing', 'printing-pc'); document.title = t; }, 80);
    },
    gcClose() { const o = $('.gc-ov'); if (o) o.remove(); },
    gcNext(el) {
      const o = $('.gc-ov'); if (o) o.remove();
      ui.teamMonth = curYm(); ui.hgEdit = true; ui.hgYm = el.dataset.ym;
      if (location.hash !== '#performance') location.hash = 'performance'; else render();
      setTimeout(() => { const f = $('#hg-fat'); if (f) { f.focus(); f.scrollIntoView({ block: 'center' }); } }, 150);
    },
    hgEdit() { ui.hgEdit = !ui.hgEdit; ui.hgYm = null; render(); if (ui.hgEdit) setTimeout(() => { const f = $('#hg-fat'); if (f) { f.focus(); f.scrollIntoView({ block: 'center' }); } }, 50); },
    cfgTab(el) { ui.cfgTab = el.dataset.t; ui.confirm = null; render(); },
    pdLayout(el) { state.theme = { ...pdTheme(), layout: el.dataset.v }; save(); render(); toast('Formato do escudo: ' + (PD_LAYOUTS.find(l => l.k === el.dataset.v) || {}).n + '.'); },
    pdAutoToggle(el) {
      const th = pdTheme(), k = el.dataset.v, off = th.autoOff.includes(k);
      state.theme = { ...th, autoOff: off ? th.autoOff.filter(x => x !== k) : [...th.autoOff, k] }; save(); render();
      toast(`${seasonBy(k).n} ${off ? 'entra' : 'saiu do'}${off ? ' no' : ''} automático.`);
    },
    pdSeason(el) {
      const v = el.dataset.v;
      state.theme = { ...pdTheme(), season: v }; save(); render();
      toast(v === 'off' ? 'Pódio sem tema.' : v === 'auto' ? 'Tema automático pelo calendário.' : 'Tema ' + seasonBy(v).n + ' aplicado.');
    },
    orgTab(el) { ui.orgTab = el.dataset.t; ui.orgSheet = null; ui.confirm = null; render(); },
    orgGo(el) { ui.orgNode = el.dataset.id || null; render(); },
    orgEdit(el) { ui.orgSheet = { id: el.dataset.id }; ui.confirm = null; render(); setTimeout(() => $('#os-name')?.focus(), 30); },
    orgAdd(el) { ui.orgSheet = { parent: el.dataset.parent || ORG_ROOT }; ui.confirm = null; render(); setTimeout(() => $('#os-name')?.focus(), 30); },
    orgSheetClose() { ui.orgSheet = null; ui.confirm = null; render(); },
    orgDel(el) {
      const id = el.dataset.id; if (id === ORG_ROOT) return;
      if (ui.confirm !== 'node' + id) { ui.confirm = 'node' + id; render(); return; }
      const o = org(), n = orgNode(id);
      o.nodes.forEach(k => { if (k.parentId === id) k.parentId = n.parentId; });
      o.nodes = o.nodes.filter(k => k.id !== id);
      o.grants = o.grants.filter(g => g.nodeId !== id);
      ui.confirm = null; ui.orgSheet = null; if (ui.orgNode === id) ui.orgNode = n.parentId;
      save(); toast(`${U(orgName(n))} saiu da estrutura. Quem estava abaixo subiu um nível.`); render();
    },
    orgLevelDel(el) {
      const o = org(); if (o.levels.length <= 1) { toast('Mantenha pelo menos um nível.'); return; }
      o.levels = o.levels.filter(l => l.id !== el.dataset.id); save(); render();
    },
    orgGrantDel(el) { const o = org(); o.grants = o.grants.filter(g => g.id !== el.dataset.id); save(); toast('Acesso removido.'); render(); },
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
      const ym = ui.teamMonth || curYm();
      ui.fcPeek = false;
      // Revelação de verdade (mês encerrado e em segredo): os celulares da equipe acompanham ao vivo.
      ui.fx = { ym, i: 0, live: isGestor(currentUser()) && !!inSuspense(monthRange(ym)) && iso(new Date()) > monthRange(ym).end };
      Sound.ensure(); keepAwake();
      const d = document.documentElement;
      if (d.requestFullscreen) d.requestFullscreen().catch(() => {});
      fxRender();
    },
    apiUnlock(el) { ui.confirm = 'unlock' + el.dataset.id + el.dataset.k; refreshEditorFields(); },
    apiUnlockCancel() { ui.confirm = null; refreshEditorFields(); },
    apiAdjust(el) {
      const u = currentUser(); if (!isGestor(u)) return;
      const ym = ui.teamMonth || curYm(), id = el.dataset.id, k = el.dataset.k;
      const integ = monthFromIntegration(state, id, ym);
      state.monthly = state.monthly || [];
      let rec = state.monthly.find(m => m.barberId === id && m.month === ym);
      if (!rec) { rec = { barberId: id, month: ym }; state.monthly.push(rec); }
      rec[k] = Math.round(Number(integ[k]) * 100) / 100;
      rec._adj = { ...(rec._adj || {}), [k]: { by: u.name, at: Date.now() } };
      ui.confirm = null; save(); refreshEditorFields(); refreshTeam();
      setTimeout(() => { const i = document.getElementById('m-' + k); if (i) { i.focus(); i.select(); } }, 30);
      toast('Campo destravado. O valor digitado substitui o da integração neste mês.');
    },
    apiRevert(el) {
      const ym = ui.teamMonth || curYm(), id = el.dataset.id, k = el.dataset.k;
      const rec = (state.monthly || []).find(m => m.barberId === id && m.month === ym); if (!rec) return;
      rec[k] = null; if (rec._adj) delete rec._adj[k];
      save(); refreshEditorFields(); refreshTeam(); toast('Voltou para o valor da integração.');
    },
    cmpWith(el) {
      ui.cmpA = el.dataset.id; if (ui.cmpB === ui.cmpA) ui.cmpB = null;
      refreshTeam(); $('#tm-cmp')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    },
    fatRange(el) { ui.fatN = Number(el.dataset.n); render(); },
    evoMode(el) { ui.evo = { ...(ui.evo || {}), mode: el.dataset.m }; evoRefresh(); },
    profPick(el) {
      const id = el.dataset.id;
      ui.profSel = ui.profSel === id ? null : id;
      refreshTeam();
      if (ui.profSel) $('#tm-insights')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    },
    profClose() { ui.profSel = null; refreshTeam(); $('#tm-prof')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); },
    teamPick(el) {
      ui.teamBarber = el.dataset.id;
      const u = currentUser();
      if (!isGestor(u) && !seeNum(el.dataset.id)) { ui.teamBarber = u.barberId; toast('No ranking você vê todos. A performance detalhada é só a sua.'); return; }
      if (!$('#tm-editor')) { ui.profSel = el.dataset.id; refreshTeam(); $('#tm-insights')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
      const ed = $('#tm-editor');
      if (ed) { ed.innerHTML = teamEditor(ui.teamMonth || curYm()); refreshTeam(); ed.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
      else render();
    },
    radarToggle(el) {
      const id = el.dataset.id; let sel = ui.radarSel || [];
      if (sel.includes(id)) { if (sel.length > 1) sel = sel.filter(x => x !== id); }
      else { sel = [...sel, id]; if (sel.length > 4) sel = sel.slice(1); }
      ui.radarSel = sel; const rd = $('#tm-radar'); if (rd) rd.innerHTML = teamRadars(ui.teamMonth || curYm(), rd.dataset.only === '1');
    },
    fcPeek() { ui.fcPeek = !ui.fcPeek; render(); },
    popsOpen(el) { ui.popsOpen = ui.popsOpen === el.dataset.id ? null : el.dataset.id; ui.confirm = null; render(); },
    popsView(el) { ui.popsView = { id: el.dataset.id, i: Number(el.dataset.i) }; render(); },
    popsViewGo(el) { if (ui.popsView) { ui.popsView.i += Number(el.dataset.d); render(); } },
    popsViewClose() { ui.popsView = null; render(); },
    popsMove(el) {
      if (!isGestor(currentUser())) return;
      const p = popsById(el.dataset.id); if (!p) return;
      const i = Number(el.dataset.i), j = i + Number(el.dataset.d);
      if (j < 0 || j >= p.steps.length) return;
      [p.steps[i], p.steps[j]] = [p.steps[j], p.steps[i]]; p.at = Date.now(); save(); render();
    },
    popsDelStep(el) {
      if (!isGestor(currentUser())) return;
      const p = popsById(el.dataset.id); if (!p) return;
      const [st] = p.steps.splice(Number(el.dataset.i), 1);
      if (st && st.path && Cloud.enabled) Cloud.removeFile(POPS_BUCKET, st.path);
      p.at = Date.now(); save(); toast('Foto removida.'); render();
    },
    popsDel(el) {
      if (!isGestor(currentUser())) return;
      if (ui.confirm !== 'popsDel' + el.dataset.id) { ui.confirm = 'popsDel' + el.dataset.id; render(); return; }
      const p = popsById(el.dataset.id); ui.confirm = null;
      if (p && Cloud.enabled) (p.steps || []).forEach(st => st.path && Cloud.removeFile(POPS_BUCKET, st.path));
      state.pops = popsList().filter(x => x.id !== el.dataset.id); ui.popsOpen = null; save(); toast('POP apagado.'); render();
    },
    notifOpen() {
      if (!ui.notifOpen) { ui.notifSeenBefore = DB.pref.get(OVT_SEEN, ''); const f = overtakeFeed(); if (f[0]) DB.pref.set(OVT_SEEN, f[0].key); }
      ui.notifOpen = !ui.notifOpen; render();
    },
    adminTab(el) { ui.adminTab = el.dataset.t; render(); },
    leadFilter(el) { ui.leadFilter = el.dataset.f; render(); },
    leadsReload() { ui.leadsData = null; render(); },
    leadsCsv() {
      const list = (ui.leadsData && ui.leadsData.list) || [];
      const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
      const rows = [['Data', 'Nome', 'Sobrenome', 'Celular', 'E-mail', 'Tipo', 'Equipe', 'Origem', 'Situação']].concat(list.map(l => [new Date(l.created_at).toLocaleString('pt-BR'), l.nome, l.sobrenome, l.celular, l.email, LEAD_TIPO[l.tipo] || '', l.equipe ? LEAD_EQ[l.equipe] : '', l.origem, (LEAD_ST.find(x => x[0] === l.status) || [, l.status])[1]]));
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob(['\ufeff' + rows.map(r => r.map(q).join(';')).join('\r\n')], { type: 'text/csv;charset=utf-8' }));
      a.download = `interessados-${iso(new Date())}.csv`; document.body.appendChild(a); a.click(); a.remove();
    },
    toggleTheme() {
      const t = getTheme() === 'light' ? 'dark' : 'light';
      try { localStorage.setItem(THEME_KEY, t); } catch (e) { /* opcional */ }
      applyTheme(t); render();
    },
    startDemo(el) {
      const b = BRANDS[el.dataset.b] ? el.dataset.b : 'barber';
      try { sessionStorage.setItem('gbia.demo', b); } catch (e) { toast('Este navegador bloqueou o modo apresentação.'); return; }
      location.href = location.origin + location.pathname;
    },
    demoAs(el) { demoLogin(el.dataset.r); location.hash = 'inicio'; render(); window.scrollTo(0, 0); },
    demoReset() { state = DB.reset(); rkCache = {}; demoLogin('dono'); toast('Demonstração reiniciada.'); location.hash = 'inicio'; render(); },
    demoExit() { try { sessionStorage.removeItem('gbia.demo'); } catch (e) { /* opcional */ } location.href = location.origin + location.pathname; },
    pickBrand(el) { const b = el.dataset.b; if (!BRANDS[b]) return; DB.pref.set('brand', b); applyBrand(b); renderAuth(ui.authMode || 'entrar'); },
    goFechamento(el) { ui.teamMonth = el.dataset.ym; location.hash = 'fechamento'; },
    revealNow(el) {
      if (!isGestor(currentUser())) return;
      if (ui.confirm !== 'reveal') { ui.confirm = 'reveal'; render(); return; }
      ui.confirm = null; markRevealed(el.dataset.ym); toast('Pódio liberado: a equipe já vê as colocações no app.'); render();
    },
    defaultOcup() { state.ocupCfg = null; save(); toast('Regra de ocupação padrão restaurada.'); render(); },
    defaultGoals() { state.goals = { ...(state.goals || {}), team: { ...GB.DEFAULT_GOALS } }; save(); toast('Metas padrão restauradas.'); render(); },
    defaultWeights() { state.weights = Object.fromEntries(INDICATORS.map(i => [i.key, i.weight])); save(); toast('Pesos padrão restaurados.'); render(); },
    resetDemo() {
      if (ui.confirm !== 'demo') { ui.confirm = 'demo'; render(); return; }
      state = DB.reset(); ui.confirm = null; DB.session.set(state.users[0].id, true); toast('Dados de demonstração restaurados. Você entrou como Gestor Demo.'); location.hash = 'inicio'; render();
    },
    clearData() {
      if (ui.confirm !== 'clear') { ui.confirm = 'clear'; render(); return; }
      const me = currentUser();
      state.barbers = []; state.entries = []; state.monthly = []; state.invites = []; state.demo = false; state.org = null;
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

  function popReview(el, status) {
    const bid = el.dataset.bid || ui.popBarber, day = el.dataset.day || `${ui.popMonth}-${String(ui.popDay).padStart(2, '0')}`;
    if (!canReview(bid)) { toast('Somente a gestão confere as provas.'); return; }
    const r = popRec(bid, day), e = r && r.ev && r.ev[el.dataset.it] ? r.ev[el.dataset.it][Number(el.dataset.i)] : null; if (!e) return;
    const u = currentUser(); e.status = status; e.reviewedBy = status === 'pendente' ? null : u.id; e.reviewedAt = status === 'pendente' ? null : Date.now();
    ui.popView = null; save(); toast(status === 'aprovado' ? 'Prova aprovada.' : status === 'recusado' ? 'Prova recusada. Os pontos não contam.' : 'Prova voltou para conferência.'); render();
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
        const { data, error } = await Cloud.signUp(email, pass, { company, name, phone: val(f, 'phone'), brand: MARCA, terms_accepted_at: new Date().toISOString() });
        if (error) return setMsg(f, Cloud.message(error));
        if (data.session) { if (await loadCloud()) { toast('Conta criada. Agora cadastre sua equipe.'); location.hash = 'barbeiros'; } render(); return; }
        ui.authEmail = email; ui.authInvite = false; ui.authMode = 'confirmar'; renderAuth('confirmar'); return;
      }
      if (!state.demo && state.users.some(u => u.email.toLowerCase() === email)) return setMsg(f, 'Este e-mail já tem conta. Use Entrar.');
      const gestor = { id: uid('u_'), name, email, pass: passHash(email, pass), role: 'gestor', status: 'ativo', barberId: null };
      state = DB.replace({ ...emptyState({ name: company, cnpj: '', phone: '', email, logo: null }, gestor), brand: MARCA });
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
        const { data, error } = await Cloud.signUp(email, pass, { invite_code: code, name, phone: val(f, 'phone'), brand: MARCA });
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
    orgLevel(f) {
      const name = val(f, 'name'); if (!name) return setMsg(f, 'Digite o nome do nível.');
      org().levels.push({ id: uid('l_'), name }); save(); render();
    },
    orgCreate(f) {
      const name = val(f, 'name'); if (!name) return setMsg(f, 'Digite o nome.');
      org().nodes.push({ id: uid('n_'), name, parentId: val(f, 'parentId') || ORG_ROOT, people: [] }); save(); toast(`${U(name)} criado.`); render();
    },
    orgGrant(f) {
      const userId = val(f, 'userId'); if (!userId) return setMsg(f, 'Escolha a pessoa.');
      const o = org(), role = val(f, 'role'), nodeId = val(f, 'nodeId') || null;
      if (!f.elements.extra.checked) o.grants = o.grants.filter(g => g.userId !== userId);
      o.grants = o.grants.filter(g => !(g.userId === userId && g.nodeId === nodeId));
      o.grants.push({ id: uid('g_'), userId, role, nodeId });
      save(); toast('Acesso salvo.'); render();
    },
    orgNode(f) {
      const o = org(), sh = ui.orgSheet || {};
      const name = val(f, 'name'); if (!name) return setMsg(f, 'Digite o nome.');
      const people = [...f.querySelectorAll('input[name="p"]:checked')].map(i => 'b:' + i.value);
      o.nodes.forEach(k => { k.people = k.people.filter(p => !people.includes(p)); });
      let n = sh.id ? orgNode(sh.id) : null;
      if (!n) { n = { id: uid('n_'), name, parentId: ORG_ROOT, people: [] }; o.nodes.push(n); }
      n.name = name; n.auto = false; n.parentId = val(f, 'parentId') || ORG_ROOT; n.people = people;
      ui.orgSheet = null; save(); toast('Estrutura salva.'); render();
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
      if (!name) return setMsg(f, 'Digite o nome do profissional.');
      let photo = null;
      const file = f.elements.photo.files[0];
      const lim = billing() && billing().max_barbers;
      if (lim && activeBarbers() >= lim) return setMsg(f, `Seu plano permite até ${lim} barbeiros ativos. Troque de plano em Assinatura para cadastrar mais.`);
      if (file) { try { photo = await readImage(file); } catch (e) { return setMsg(f, e.message); } }
      const id = uid('b_'), access = val(f, 'access');
      state.barbers.push({ id, name, photo, active: true, role: val(f, 'role') || B().role, instagram: '' });
      if (access === 'lider' || access === 'gestor') { const o = org(); o.access[id] = access; }
      save();
      toast(`${U(name)} adicionado. Agora envie o convite.`); render();
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
    ocup(f) {
      const open = val(f, 'open'), close = val(f, 'close');
      const lunch = Number(val(f, 'lunch')), days = Number(val(f, 'days'));
      if (!/^\d{2}:\d{2}$/.test(open) || !/^\d{2}:\d{2}$/.test(close)) return setMsg(f, 'Informe a abertura e o fechamento da agenda.');
      if (!Number.isFinite(lunch) || lunch < 0 || lunch > 240) return setMsg(f, 'O almoço deve ficar entre 0 e 240 minutos.');
      if (!Number.isInteger(days) || days < 1 || days > 31) return setMsg(f, 'Os dias trabalhados devem ficar entre 1 e 31.');
      const cfg = { open, close, lunch, days };
      if (GB.hoursPerDay(cfg) <= 0) return setMsg(f, 'O fechamento precisa ser depois da abertura, descontado o almoço.');
      state.ocupCfg = cfg; save(); toast(`Regra salva: 100% = ${nf0.format(GB.hoursPerDay(cfg) * days)} h no mês.`); render();
    },
    async popsNew(f) {
      if (!isGestor(currentUser())) return;
      const name = val(f, 'name'), video = val(f, 'video'), desc = val(f, 'desc');
      if (!name) return setMsg(f, 'Digite o nome do processo.');
      if (video && !validUrl(video)) return setMsg(f, 'O link do vídeo precisa começar com https:// (ex.: https://youtube.com/...).');
      const id = uid('pop_');
      setMsg(f, f.elements.photos.files.length ? 'Enviando as fotos…' : '', true);
      let steps;
      try { steps = await popsPhotos(f.elements.photos.files, id); } catch (e) { return setMsg(f, Cloud.enabled ? Cloud.message(e) : e.message); }
      popsList().push({ id, name: name.slice(0, 80), desc: desc.slice(0, 400), video, steps, at: Date.now() });
      ui.popsOpen = id; save(); toast('POP adicionado.'); render();
    },
    async popsEdit(f) {
      if (!isGestor(currentUser())) return;
      const p = popsById(f.dataset.id); if (!p) return;
      const name = val(f, 'name'), video = val(f, 'video'), desc = val(f, 'desc');
      if (!name) return setMsg(f, 'Digite o nome do processo.');
      if (video && !validUrl(video)) return setMsg(f, 'O link do vídeo precisa começar com https:// (ex.: https://youtube.com/...).');
      setMsg(f, f.elements.photos.files.length ? 'Enviando as fotos…' : '', true);
      let more;
      try { more = await popsPhotos(f.elements.photos.files, p.id); } catch (e) { return setMsg(f, Cloud.enabled ? Cloud.message(e) : e.message); }
      Object.assign(p, { name: name.slice(0, 80), desc: desc.slice(0, 400), video, steps: [...(p.steps || []), ...more], at: Date.now() });
      save(); toast('POP salvo.'); render();
    },
    houseGoals(f) {
      const g = {};
      for (const el of f.querySelectorAll('input[type=number][name]')) {
        const v = el.value.trim().replace(',', '.');
        if (v === '') continue;
        const n = Number(v);
        if (!isFinite(n) || n < 0) { setMsg(f, 'Confira os valores: use só números positivos.'); el.focus(); return; }
        if (n > 0) g[el.name] = n;
      }
      const tgt = f.elements.hgYm.value, dflt = f.elements.dflt.checked;
      const M = { ...(state.houseGoalsM || {}) };
      if (dflt) {
        // Os meses anteriores guardam as metas que valiam neles.
        const old = state.houseGoals || {};
        if (Object.keys(old).length) for (let k = firstYm(); k < tgt; k = addMonths(k, 1)) if (!M[k]) M[k] = { ...old };
        for (const k of Object.keys(M)) if (k >= tgt) delete M[k];
        state.houseGoals = g;
      } else M[tgt] = g;
      state.houseGoalsM = M;
      ui.hgEdit = false; ui.hgYm = null; save(); render();
      toast(Object.keys(g).length ? `Metas de ${monthRange(tgt).label.split(' de ')[0]} salvas${dflt ? ' (valem também para os meses seguintes)' : ''}.` : 'Metas removidas.');
    },
    pdBday(f) {
      const v = val(f, 'bday');
      if (v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) { setMsg(f, 'Data inválida.'); return; }
      state.theme = { ...pdTheme(), bday: v }; save(); render();
      toast(v ? 'Data de inauguração salva.' : 'Data de inauguração removida.');
    },
    reveal(f) {
      const c = revealCfg();
      const on = f.elements['rv-on'].checked, days = Math.min(5, Math.max(1, Number(val(f, 'rv-days')) || 2));
      // Ao ligar, só vale dali para a frente (não esconde o mês passado).
      state.reveal = { on, days, since: on ? (c.on && c.since ? c.since : curYm()) : '', done: c.done };
      save(); toast(on ? `Pódio surpresa ligado: ${days} dia${days > 1 ? 's' : ''} antes do fim do mês.` : 'Pódio surpresa desligado.'); render();
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
      const nb = val(f, 'brand');
      if (BRANDS[nb] && nb !== (state.brand || 'barber')) { state.brand = nb; DB.pref.set('brand', nb); }
      save(); applyBrand(state.brand); toast('Dados da barbearia salvos.'); render();
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
    perfBarber(el) { ui.perfBarber = el.value; location.hash = 'perfil-' + el.value; },
    teamMonth(el) { ui.teamMonth = el.value; ui.fcPeek = false; render(); },
    hgYm(el) { ui.hgYm = el.value; render(); },
    lanDate(el) { ui.lanDate = el.value; },
    async leadStatus(el) {
      const l = ui.leadsData && ui.leadsData.list && ui.leadsData.list.find(x => x.id === el.dataset.id); if (!l) return;
      const prev = l.status; l.status = el.value;
      try { await Cloud.admin.leadUpdate(l.id, { status: el.value }); toast('Situação atualizada.'); render(); } catch (e) { l.status = prev; toast(Cloud.message(e)); render(); }
    },
    popsCap(el) { if (!isGestor(currentUser())) return; const p = popsById(el.dataset.id); if (!p || !p.steps[Number(el.dataset.i)]) return; p.steps[Number(el.dataset.i)].cap = el.value.trim().slice(0, 140); p.at = Date.now(); save(); toast('Legenda salva.'); },
    barberRole(el) { const b = barberById(el.dataset.id); if (!b) return; b.role = el.value.trim().slice(0, 60) || B().role; save(); toast('Função salva.'); },
    leaderExtra(el) {
      if (!isGestor(currentUser())) return;
      const o = org(), id = el.dataset.id, k = el.dataset.k;
      const x = o.extras[id] = { review: false, fields: [], ...(o.extras[id] || {}) };
      if (k === 'review') x.review = el.checked;
      else { const f = k.slice(2); x.fields = el.checked ? [...new Set([...x.fields, f])] : x.fields.filter(v => v !== f); }
      ui.lxOpen = id; save(); toast('Acesso do líder atualizado.'); render();
    },
    barberAccess(el) {
      if (!isGestor(currentUser())) return;
      const o = org(), v = el.value, b = barberById(el.dataset.id);
      if (v === 'lider' || v === 'gestor') o.access[el.dataset.id] = v; else delete o.access[el.dataset.id];
      save(); toast(`${b ? first(b.name) : 'Profissional'}: acesso de ${ACCESS.find(a => a[0] === v)[1]}.`); render();
    },
    cmpA(el) { ui.cmpA = el.value; if (ui.cmpB === ui.cmpA) ui.cmpB = null; refreshTeam(); },
    cmpB(el) { ui.cmpB = el.value; refreshTeam(); },
    evoFull(el) { ui.evo = { ...(ui.evo || {}), full: el.checked }; evoRefresh(); },
    evoDate(el) { if (!el.value) return; ui.evo = { ...(ui.evo || {}), [el.dataset.k]: el.value }; evoRefresh(); },
    popMonth(el) { ui.teamMonth = ui.popMonth = el.value; ui.popDraft = null; render(); },
    async popPhoto(el) {
      const f = el.files && el.files[0]; if (!f || !ui.popDraft) return;
      try { ui.popDraft.photo = await readImage(f, 1100, 0.72); render(); } catch (e) { toast(e.message); }
    },
    popEdit(el) { ui.popEdit = el.checked; ui.confirm = null; render(); },
    async popRem(el) {
      DB.pref.set('popRem', el.checked ? '1' : '0');
      if (el.checked && 'Notification' in window && Notification.permission === 'default') { try { await Notification.requestPermission(); } catch (e) { /* opcional */ } }
      toast(el.checked ? 'Lembretes ligados. O app avisa enquanto a meta do dia não for batida.' : 'Lembretes desligados.');
    },
    orgLevelName(el) { const l = org().levels.find(x => x.id === el.dataset.id); if (l && el.value.trim()) { l.name = el.value.trim(); save(); render(); } },
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
    const tr = e.target.closest('tr[data-href]');
    if (tr && !e.target.closest('a')) { location.hash = tr.dataset.href; return; }
    const el = e.target.closest('[data-action]');
    if (el && ACTIONS[el.dataset.action]) { ACTIONS[el.dataset.action](el, e); return; }
    const pop = $('.popover');
    if (pop && !pop.hidden && !e.target.closest('.popover')) pop.hidden = true;
    if (ui.notifOpen && !e.target.closest('.notif-panel')) { ui.notifOpen = false; render(); }
  });
  root.addEventListener('submit', e => {
    const f = e.target.closest('form[data-form]');
    if (!f) return;
    e.preventDefault();
    FORMS[f.dataset.form]?.(f);
  });
  root.addEventListener('input', e => {
    if (e.target.id === 'pops-q') {
      const q = e.target.value.trim().toLowerCase(); let n = 0;
      document.querySelectorAll('.pops-card').forEach(c => { const ok = !q || c.dataset.name.includes(q); c.hidden = !ok; if (ok) n++; });
      const none = $('.pops-none'); if (none) none.hidden = n > 0;
      return;
    }
    const pp = e.target.closest('[data-pop]');
    if (pp) { popInput(pp); return; }
    const el = e.target.closest('[data-auto]');
    if (el && el.tagName !== 'SELECT') autoSave(el);
  });
  root.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.matches('tr[data-href]')) { location.hash = e.target.dataset.href; return; }
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('article[data-action]')) { e.preventDefault(); ACTIONS[e.target.dataset.action](e.target, e); }
  });
  root.addEventListener('change', e => {
    const pc = e.target.closest('[data-popcfg],[data-popitem],[data-poplevel]');
    if (pc) {
      const c = popCfgW(), v = pc.value;
      if (pc.dataset.popcfg) { const k = pc.dataset.popcfg; c[k] = k === 'minProfit' ? Number(v) || 0 : k === 'lose' ? v.split('\n').map(x => x.trim()).filter(Boolean) : v; }
      if (pc.dataset.popitem) { const it = c.items[Number(pc.dataset.i)], k = pc.dataset.popitem; it[k] = ['target', 'pts'].includes(k) ? Math.max(k === 'target' ? 1 : 0, Number(v) || 0) : v; if (k === 'type' && v === 'check') it.target = 1; }
      if (pc.dataset.poplevel) { const l = c.levels[Number(pc.dataset.i)], k = pc.dataset.poplevel; l[k] = k === 'name' ? v : k === 'value' ? (v === '' ? null : Number(v)) : Number(v) || 0; }
      save(); render(); return;
    }
    const au = e.target.closest('select[data-auto]');
    if (au) { autoSave(au); return; }
    const el = e.target.closest('[data-change]');
    if (el && CHANGES[el.dataset.change]) CHANGES[el.dataset.change](el);
  });
  window.addEventListener('hashchange', () => {
    ui.notifOpen = false;
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
    if (e.key === 'Escape' && $('.gc-ov')) { $('.gc-ov').remove(); return; }
    if (e.key === 'Escape' && ui.orgSheet) { ui.orgSheet = null; render(); return; }
    if (e.key === 'Escape' && ui.popView) { ui.popView = null; render(); return; }
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
    else if (['', '#inicio'].includes(location.hash) && currentUser()) { state = DB.load(); rkCache = {}; render(); }
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
        setTimeout(maybeAutoReveal, 600);
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
  {
    const pm = new URLSearchParams(location.search).get('marca');
    if (BRANDS[pm]) DB.pref.set('brand', pm);
    applyBrand(DB.demo || DB.pref.get('brand', '') || 'barber');
  }
  if (Cloud.enabled) {
    const wait = new Promise(r => setTimeout(r, 1900));
    splash(() => {});
    Promise.all([bootCloud(), wait]).then(() => { if (ui.authMode === 'novaSenha') renderAuth('novaSenha'); else render(); });
  } else {
    if (DEMO_ON && !currentUser()) demoLogin('dono');
    splash(render);
  }
})();
