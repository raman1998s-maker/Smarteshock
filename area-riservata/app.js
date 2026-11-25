// Area riservata Meekon Displays — gestionale.
// Regole: il browser parla solo con /api/* (stessa origine, cookie HttpOnly);
// i dati del server si inseriscono SOLO con textContent / creazione di nodi (mai innerHTML).
// L'interfaccia nasconde a tecnici e base le funzioni della gestione, ma i permessi
// veri li controllano le API e la Row Level Security.
(() => {
  'use strict';

  const LOGIN = '/area-riservata/';
  const main = document.getElementById('main');
  const nav = document.getElementById('nav');
  const userBox = document.getElementById('user');
  const toastEl = document.getElementById('toast');

  const state = {
    me: null,
    filters: { q: '', stato: '', da: '', a: '' },
    richiesteTab: 'nuova',
    richieste: new Map(),
    clienti: new Map(),
  };
  const isAdmin = () => state.me && state.me.ruolo === 'admin';
  // admin + ufficio: richieste, clienti, eventi, offerte, magazzino
  const isGestione = () => state.me && (state.me.ruolo === 'admin' || state.me.ruolo === 'ufficio');

  // ------------------------------------------------------------ etichette
  const STATI = { richiesta: 'Richiesta', offerta: 'Offerta', confermato: 'Confermato', completato: 'Completato', annullato: 'Annullato' };
  const STATI_RICHIESTA = { nuova: 'Nuova', gestita: 'Gestita', scartata: 'Scartata' };
  const PAESI = { CH: 'Svizzera', IT: 'Italia', DE: 'Germania', FR: 'Francia' };
  const LINGUE = { it: 'Italiano', de: 'Tedesco', fr: 'Francese', en: 'Inglese' };
  const RUOLI = { admin: 'Amministratore', ufficio: 'Ufficio', tecnico: 'Tecnico', base: 'Base (solo agenda del giorno)', partner: 'Partner (DJ)' };

  // Dettagli tecnici sul luogo (richieste_web.dettagli_tecnici): etichette e valori in italiano.
  // Le chiavi e i valori sono quelli di dettagliTecniciSchema (netlify/functions/_lib/schemas.js).
  const SNN = { si: 'Sì', no: 'No', non_so: 'Non so' };
  const DETTAGLI = [
    ['spazio', 'Tipo di spazio', { sala: 'Sala chiusa', tendone: 'Tendone', capannone: 'Capannone o spazio molto alto', aperto: "All'aperto" }],
    ['copertura', 'Copertura (all\'aperto)', SNN],
    ['grandezza', 'Grandezza della sala', { piccola: 'Piccola (fino a ~80 persone)', media: 'Media', grande: 'Grande (oltre ~300 persone)', non_so: 'Non so' }],
    ['superficie_m2', 'Superficie', (v) => `${v} m²`],
    ['altezza_m', 'Altezza della sala', (v) => `${String(v).replace('.', ',')} m`],
    ['accesso', 'Accesso per il materiale', { piano_terra: 'Piano terra senza gradini', ascensore: 'Ascensore', scale: 'Scale', non_so: 'Non so' }],
    ['scarico', 'Parcheggio / scarico vicino', SNN],
    ['prese', 'Prese di corrente', { '230v': 'Normali 230 V', cee400: 'CEE 400 V (forza)', non_so: 'Non so' }],
    ['prese_vicine', 'Prese vicine al punto di installazione', { si: 'Sì', no: 'No, a più di ~20 m', non_so: 'Non so' }],
    ['montaggio_giorno_prima', 'Montaggio il giorno prima', { possibile: 'Possibile', richiesto: 'Richiesto dalla location', non_possibile: 'Non possibile', non_so: 'Non so' }],
    ['montaggio_dalle', 'Montaggio possibile dalle', null],
    ['smontaggio_entro', 'Smontaggio entro', null],
    ['volume_limiti', 'Limiti di volume / orari di silenzio', SNN],
    ['volume_quali', 'Quali limiti', null],
    ['musica_fino', 'Musica spenta entro le', null],
    ['decibel_max', 'Limite massimo', (v) => `${v} dB`],
    ['discorsi', 'Discorsi con microfono', SNN],
    ['oratori', 'Persone che parlano', { '1_2': '1–2', '3_5': '3–5', oltre_5: 'Più di 5' }],
    ['rilevatori_fumo', 'Rilevatori di fumo', SNN],
    ['nebbia_permessa', 'Fumo / nebbia permessi', { si: 'Sì', no: 'No', da_chiedere: 'Da chiedere alla location' }],
    ['uscite_libere', 'Uscite di emergenza libere dagli schermi', { si: 'Sì', verifichiamo: 'Da verificare con la location', non_so: 'Non so' }],
    ['contenuti_da', 'Video e contenuti forniti da', { cliente: 'Cliente', agenzia: 'Agenzia o fotografo', meekon: 'Meekon Displays' }],
  ];
  const FORNITORI = [['decorazioni', 'Decorazioni / fiorista'], ['foto', 'Fotografo / videomaker'], ['musica', 'DJ o band esterni'], ['planner', 'Wedding planner / organizzatore'], ['location', 'Referente della location']];
  function dettagliTecnici(d) {
    if (!d || typeof d !== 'object' || Array.isArray(d)) return null;
    const fmt = (v, map) => {
      const one = (x) => (typeof map === 'function' ? map(x) : map && Object.prototype.hasOwnProperty.call(map, x) ? map[x] : String(x));
      return Array.isArray(v) ? v.map(one).join(', ') : one(v);
    };
    const rows = DETTAGLI.filter(([k]) => d[k] !== undefined && d[k] !== null && d[k] !== '').map(([k, label, map]) => [label, fmt(d[k], map)]);
    FORNITORI.forEach(([k, label]) => {
      const nome = d[`forn_${k}_nome`];
      const contatto = d[`forn_${k}_contatto`];
      if (nome || contatto) rows.push([label, [nome, contatto].filter(Boolean).map(String).join(' · ')]);
    });
    return rows.length ? rows : null;
  }

  // ------------------------------------------------------------ API
  class ApiError extends Error {
    constructor(status, code, field, data) {
      super(code);
      this.status = status;
      this.code = code;
      this.field = field || null;
      this.data = data || null; // corpo della risposta d'errore (es. attesa_secondi per il 429)
    }
  }

  async function api(path, { method = 'GET', body, redirect401 = true } = {}) {
    const headers = { 'X-Requested-With': 'meekon' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    let res;
    try {
      res = await fetch(`/api/${path}`, {
        method,
        credentials: 'same-origin',
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch (err) {
      throw new ApiError(0, 'network');
    }
    if (res.status === 401) {
      if (redirect401) window.location.replace(LOGIN);
      throw new ApiError(401, 'unauthorized');
    }
    let data = null;
    try { data = await res.json(); } catch (err) { data = null; }
    if (!res.ok) {
      throw new ApiError(res.status, (data && typeof data.error === 'string' && data.error) || 'server_error', data && data.field, data && typeof data === 'object' ? data : null);
    }
    return data || {};
  }

  function errorMessage(err) {
    if (!(err instanceof ApiError)) return 'Si è verificato un errore imprevisto. Ricaricate la pagina.';
    if (err.status === 0) return 'Connessione non riuscita. Controllate la connessione a internet e riprovate.';
    if (err.status === 400) return 'Alcuni dati non sono validi. Controllate i campi evidenziati.';
    if (err.status === 403) return 'Non avete i permessi per questa operazione.';
    if (err.status === 404) return 'Elemento non trovato: forse è stato eliminato.';
    if (err.status === 409) return 'Operazione non possibile: il dato esiste già o è stato modificato nel frattempo.';
    if (err.status === 413) return 'Il testo inserito è troppo lungo.';
    if (err.status === 429) return 'Troppe richieste in poco tempo. Attendete un momento e riprovate.';
    return 'Il server non risponde correttamente. Riprovate tra qualche istante.';
  }

  // ------------------------------------------------------------ DOM
  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    if (props) {
      for (const [k, v] of Object.entries(props)) {
        if (v === null || v === undefined || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'text') el.textContent = v;
        else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else if (k === 'value' || k === 'checked' || k === 'disabled' || k === 'selected') el[k] = v;
        else el.setAttribute(k, v === true ? '' : String(v));
      }
    }
    add(el, kids);
    return el;
  }
  function add(el, kids) {
    for (const k of kids.flat(Infinity)) {
      if (k === null || k === undefined || k === false) continue;
      el.append(k instanceof Node ? k : document.createTextNode(String(k)));
    }
    return el;
  }
  function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); }

  let uid = 0;
  const nextId = (p) => `${p}-${++uid}`;

  // ------------------------------------------------------------ formati
  const pad = (n) => String(n).padStart(2, '0');
  function isoDate(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
  function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }

  function fmtDate(s) {
    if (!s || typeof s !== 'string') return '—';
    const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(s);
    if (!m) return '—';
    const date = `${m[3]}.${m[2]}.${m[1]}`;
    return m[4] && `${m[4]}:${m[5]}` !== '00:00' ? `${date} ${m[4]}:${m[5]}` : date;
  }
  function fmtRange(a, b) {
    if (!b || fmtDate(a) === fmtDate(b)) return fmtDate(a);
    if (a && a.slice(0, 10) === b.slice(0, 10)) {
      const end = fmtDate(b).slice(11);
      return end ? `${fmtDate(a)} – ${end}` : fmtDate(a);
    }
    return `${fmtDate(a)} – ${fmtDate(b)}`;
  }
  function fmtMoney(n) {
    if (n === null || n === undefined || n === '') return '—';
    const v = Number(n);
    if (!Number.isFinite(v)) return '—';
    const [int, dec] = Math.abs(v).toFixed(2).split('.');
    return `${v < 0 ? '-' : ''}${int.replace(/\B(?=(\d{3})+(?!\d))/g, "'")}.${dec}`;
  }
  const yesNo = (b) => (b ? 'Sì' : 'No');
  const dash = (v) => (v === null || v === undefined || v === '' ? '—' : String(v));

  function telLink(phone) {
    if (!phone) return '—';
    const num = String(phone).replace(/[^0-9+]/g, '');
    return num ? h('a', { href: `tel:${num}` }, String(phone)) : String(phone);
  }
  /** Apre l'indirizzo su Google Maps (nuova scheda). */
  function mapLink(...parti) {
    const q = parti.filter(Boolean).join(', ').trim();
    if (!q) return '—';
    return h('a', { href: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`, target: '_blank', rel: 'noopener noreferrer' }, 'Apri su Maps');
  }
  function mailLink(email) {
    if (!email) return '—';
    return /^[^\s@<>"]+@[^\s@<>"]+$/.test(email) ? h('a', { href: `mailto:${email}` }, email) : String(email);
  }
  function badge(stato, labels) {
    if (!Object.prototype.hasOwnProperty.call(labels, stato)) return h('span', { class: 'badge' }, dash(stato));
    return h('span', { class: `badge badge--${stato}` }, labels[stato]);
  }
  function multiline(text) {
    if (!text) return h('p', { class: 'muted' }, '—');
    const p = h('p');
    String(text).split(/\r?\n/).forEach((line, i) => { if (i) p.append(h('br')); p.append(document.createTextNode(line)); });
    return p;
  }
  function dl(rows) {
    const list = h('dl', { class: 'dl' });
    rows.forEach((row) => { if (!row) return; const [k, v] = row; if (v !== undefined) add(list, [h('dt', null, k), h('dd', null, v === null ? '—' : v)]); });
    return list;
  }
  // ogni pannello della griglia sta in un <div>: così ".panel + .panel" non aggiunge margini nella griglia
  // i pannelli "larghi" (tabelle) occupano tutta la riga (grid-column 1 / -1 di .field--full)
  function panels(...list) {
    return h('div', { class: 'panels' }, list.flat().filter(Boolean).map((p) => (p.wide ? h('div', { class: 'field--full' }, p.el) : h('div', null, p))));
  }
  const wide = (el) => ({ wide: true, el });
  function td(label, ...kids) { return h('td', { 'data-label': label }, h('span', null, ...kids)); }
  const clienteNome = (e) => (e.cliente && e.cliente.nome) || e.cliente_nome || null;

  // ------------------------------------------------------------ notifiche
  let toastTimer = null;
  function toast(msg, kind = 'ok') {
    clearTimeout(toastTimer);
    clear(toastEl);
    toastEl.className = `toast toast--${kind}`;
    add(toastEl, [h('span', null, msg), h('button', { type: 'button', 'aria-label': 'Chiudi la notifica', onclick: () => { toastEl.hidden = true; } }, '×')]);
    toastEl.hidden = false;
    toastTimer = setTimeout(() => { toastEl.hidden = true; }, kind === 'error' ? 8000 : 4000);
  }

  // ------------------------------------------------------------ pagina
  let seq = 0;
  let firstRender = true;
  function page({ title, sub, actions, back }, ...content) {
    clear(main);
    document.title = `${title} — Area riservata Meekon Displays`;
    const h1 = h('h1', { tabindex: '-1' }, title);
    const head = h('header', { class: 'app__head' },
      h('div', null, back ? h('a', { class: 'btn btn--ghost btn--sm', href: back[0] }, `← ${back[1]}`) : null, h1, sub ? h('p', null, sub) : null),
      actions && actions.length ? h('div', null, actions.flatMap((a, i) => (i ? [' ', a] : [a]))) : null);
    add(main, [head, content]);
    if (firstRender) firstRender = false;
    else h1.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }
  function loading() { clear(main); main.append(h('p', { class: 'muted', role: 'status' }, 'Caricamento…')); }
  function failure(title, err) {
    page({ title },
      h('p', { class: 'alert alert--error', role: 'alert' }, errorMessage(err)),
      h('p', null, h('button', { class: 'btn', type: 'button', onclick: route }, 'Riprova')));
  }
  function empty(title, text) { return h('div', { class: 'empty' }, h('strong', null, title), text ? h('p', null, text) : null); }

  function field(label, input, { full = false, hint = null } = {}) {
    const id = input.id || nextId('f');
    input.id = id;
    const wrap = h('div', { class: `field${full ? ' field--full' : ''}` }, h('label', { for: id }, label), input);
    if (hint) { const hid = `${id}-hint`; input.setAttribute('aria-describedby', hid); wrap.append(h('p', { class: 'field__hint', id: hid }, hint)); }
    return wrap;
  }
  function select(name, options, value) {
    return h('select', { name }, options.map(([v, l]) => h('option', { value: v, selected: v === (value ?? '') }, l)));
  }
  function check(name, label, checked) {
    return h('label', { class: 'check' }, h('input', { type: 'checkbox', name, checked: !!checked }), label);
  }

  // errori di validazione dal server (400 invalid_input con "field")
  function markInvalid(form, err) {
    form.querySelectorAll('[aria-invalid="true"]').forEach((el) => el.removeAttribute('aria-invalid'));
    form.querySelectorAll('.field__error').forEach((el) => el.remove());
    form.querySelectorAll('.field--invalid').forEach((el) => el.classList.remove('field--invalid'));
    if (!(err instanceof ApiError) || !err.field || !/^[a-z_]+$/.test(err.field)) return;
    const input = form.querySelector(`[name="${err.field}"]`);
    if (!input) return;
    input.setAttribute('aria-invalid', 'true');
    const wrap = input.closest('.field');
    if (wrap) {
      wrap.classList.add('field--invalid');
      const eid = nextId('err');
      wrap.append(h('p', { class: 'field__error', id: eid }, 'Valore non valido: controllate questo campo.'));
      input.setAttribute('aria-describedby', eid);
    }
    input.focus();
  }
  async function busy(btn, fn) {
    btn.disabled = true;
    btn.setAttribute('aria-busy', 'true');
    try { return await fn(); } finally { btn.disabled = false; btn.removeAttribute('aria-busy'); }
  }

  // ------------------------------------------------------------ eventi: tabella
  function eventsTable(list) {
    const admin = isGestione();
    const head = ['Data', 'Evento', 'Località', 'Stato'];
    if (admin) head.push('Importo CHF');
    const rows = list.map((e) => {
      const href = `#/evento/${encodeURIComponent(e.id)}`;
      const cliente = clienteNome(e);
      const azienda = e.cliente && e.cliente.azienda;
      const tr = h('tr', { class: 'is-link' },
        td('Data', fmtRange(e.data_inizio, e.data_fine)),
        h('td', { 'data-label': 'Evento', class: 'table__primary' },
          h('span', null, h('a', { href }, e.titolo || 'Senza titolo'),
            h('span', { class: 'table__sub' }, [e.numero_ordine ? `N. ${e.numero_ordine}` : null, cliente, azienda].filter(Boolean).join(' · ')))),
        td('Località', dash(e.localita), h('span', { class: 'table__sub' }, [e.sala, PAESI[e.paese]].filter(Boolean).join(' · '))),
        td('Stato', badge(e.stato, STATI)),
        admin ? h('td', { 'data-label': 'Importo CHF', class: 'num' }, h('span', null, fmtMoney(e.importo_chf))) : null);
      tr.addEventListener('click', (ev) => { if (!ev.target.closest('a, button, input')) window.location.hash = href; });
      return tr;
    });
    return h('div', { class: 'table-wrap' },
      h('table', { class: 'table' },
        h('thead', null, h('tr', null, head.map((t) => h('th', { scope: 'col', class: t === 'Importo CHF' ? 'num' : null }, t)))),
        h('tbody', null, rows)));
  }

  // ------------------------------------------------------------ viste
  async function viewProssimi(_, alive) {
    loading();
    const oggi = new Date();
    const giorni = 90;
    let data;
    try { data = await api(`eventi?da=${isoDate(oggi)}&a=${isoDate(addDays(oggi, giorni))}`); } catch (err) { if (alive()) failure('Prossimi eventi', err); return; }
    if (!alive()) return;
    const list = (data.eventi || []).filter((e) => e.stato !== 'annullato');
    page({
      title: 'Prossimi eventi',
      sub: `Prossimi ${giorni} giorni · ${list.length} ${list.length === 1 ? 'evento' : 'eventi'}${isGestione() ? '' : ' a cui siete assegnati'}`,
      actions: isGestione() ? [h('a', { class: 'btn btn--primary', href: '#/eventi/nuovo' }, 'Nuovo evento')] : null,
    }, list.length ? eventsTable(list) : empty('Nessun evento in programma', isGestione()
      ? 'Nei prossimi 90 giorni non ci sono eventi. Potete crearne uno nuovo o convertire una richiesta dal sito.'
      : 'Nei prossimi 90 giorni non siete assegnati a nessun evento.'));
  }

  async function viewEventi(_, alive) {
    const f = state.filters;
    const q = h('input', { type: 'search', name: 'q', value: f.q, placeholder: 'Titolo, cliente, località, numero…', autocomplete: 'off' });
    const stato = select('stato', [['', 'Tutti gli stati'], ...Object.entries(STATI)], f.stato);
    const da = h('input', { type: 'date', name: 'da', value: f.da });
    const a = h('input', { type: 'date', name: 'a', value: f.a });
    const count = h('span', { class: 'toolbar__count', role: 'status' });
    const results = h('div', null, h('p', { class: 'muted' }, 'Caricamento…'));
    const reset = h('button', { class: 'btn btn--ghost', type: 'button' }, 'Azzera filtri');
    const toolbar = h('form', { class: 'toolbar', role: 'search', 'aria-label': 'Filtra gli eventi', onsubmit: (e) => e.preventDefault() },
      h('div', { class: 'field field--search' }, h('label', { for: 'f-q' }, 'Cerca'), Object.assign(q, { id: 'f-q' })),
      field('Stato', stato), field('Dal', da), field('Al', a), reset, count);

    page({
      title: 'Eventi',
      sub: isGestione() ? 'Tutti gli eventi e gli ordini' : 'Gli eventi a cui siete assegnati',
      actions: isGestione() ? [h('a', { class: 'btn btn--primary', href: '#/eventi/nuovo' }, 'Nuovo evento')] : null,
    }, toolbar, results);

    let list = [];
    const draw = () => {
      const term = f.q.trim().toLowerCase();
      const shown = term
        ? list.filter((e) => [e.titolo, e.numero_ordine, clienteNome(e), e.cliente && e.cliente.azienda, e.localita, e.sala, e.tipo]
          .some((v) => v && String(v).toLowerCase().includes(term)))
        : list;
      count.textContent = `${shown.length} ${shown.length === 1 ? 'evento' : 'eventi'}`;
      clear(results);
      results.append(shown.length ? eventsTable(shown) : empty('Nessun evento trovato', 'Modificate o azzerate i filtri.'));
    };
    const load = async () => {
      const params = new URLSearchParams();
      if (f.stato) params.set('stato', f.stato);
      if (f.da) params.set('da', f.da);
      if (f.a) params.set('a', f.a);
      clear(results);
      results.append(h('p', { class: 'muted' }, 'Caricamento…'));
      try {
        const data = await api(`eventi${params.toString() ? `?${params}` : ''}`);
        if (!alive()) return;
        list = data.eventi || [];
        draw();
      } catch (err) {
        if (!alive()) return;
        clear(results);
        count.textContent = '';
        results.append(h('p', { class: 'alert alert--error', role: 'alert' }, errorMessage(err)));
      }
    };
    q.addEventListener('input', () => { f.q = q.value; draw(); });
    stato.addEventListener('change', () => { f.stato = stato.value; load(); });
    da.addEventListener('change', () => { f.da = da.value; load(); });
    a.addEventListener('change', () => { f.a = a.value; load(); });
    reset.addEventListener('click', () => {
      Object.assign(f, { q: '', stato: '', da: '', a: '' });
      q.value = ''; stato.value = ''; da.value = ''; a.value = '';
      load();
    });
    await load();
  }

  async function viewEvento([id], alive) {
    loading();
    let data;
    try { data = await api(`eventi/${encodeURIComponent(id)}`); } catch (err) { if (alive()) failure('Evento', err); return; }
    if (!alive()) return;
    const e = data.evento || {};
    const admin = isGestione();
    const actions = [];
    const cal = G().calendarLink(e, 'btn');
    if (cal) actions.push(cal);
    if (admin) actions.push(h('a', { class: 'btn', href: `#/evento/${encodeURIComponent(e.id)}/modifica` }, 'Modifica'));
    if (isAdmin()) {
      const del = h('button', { class: 'btn btn--danger', type: 'button' }, 'Elimina');
      del.addEventListener('click', () => {
        if (!window.confirm(`Eliminare definitivamente l'evento "${e.titolo || ''}"? L'operazione non si può annullare.`)) return;
        busy(del, async () => {
          try {
            await api(`eventi/${encodeURIComponent(e.id)}`, { method: 'DELETE' });
            toast('Evento eliminato.');
            window.location.hash = '#/eventi';
          } catch (err) { toast(errorMessage(err), 'error'); }
        });
      });
      actions.push(del);
    }

    const sub = h('span', null, e.numero_ordine ? `N. ${e.numero_ordine} · ` : '', badge(e.stato, STATI));

    const dati = h('section', { class: 'panel' }, h('div', { class: 'panel__head' }, h('h2', null, "Dati dell'evento")),
      dl([
        ['Tipo', dash(e.tipo)],
        e.montaggio_da ? ['Montaggio da', fmtDate(e.montaggio_da)] : undefined,
        ['Inizio', fmtDate(e.data_inizio)],
        ['Fine', fmtDate(e.data_fine)],
        e.smontaggio_da ? ['Smontaggio', fmtDate(e.smontaggio_da)] : undefined,
        ['Località', dash(e.localita)],
        ['Sala', dash(e.sala)],
        ['Indirizzo', e.indirizzo ? h('span', null, e.indirizzo, ' ', mapLink(e.indirizzo, e.localita)) : (e.localita ? mapLink(e.localita) : '—')],
        ['Contatto sul posto', e.contatto_luogo_nome || e.contatto_luogo_telefono ? h('span', null, e.contatto_luogo_nome || '', ' ', telLink(e.contatto_luogo_telefono)) : '—'],
        ['Paese', PAESI[e.paese] || dash(e.paese)],
        ['Ospiti', dash(e.ospiti)],
        ['Servizi', Array.isArray(e.servizi) && e.servizi.length ? e.servizi.join(', ') : '—'],
      ]));

    const c = e.cliente || null;
    const clienteRows = c
      ? [['Nome', dash(c.nome)], ['Azienda', dash(c.azienda)], ['Telefono', telLink(c.telefono)], ['E-mail', mailLink(c.email)], ['Lingua', LINGUE[c.lingua] || dash(c.lingua)]]
      : (e.cliente_nome || e.cliente_telefono ? [['Nome', dash(e.cliente_nome)], ['Telefono', telLink(e.cliente_telefono)]] : null);
    const cliente = h('section', { class: 'panel' }, h('div', { class: 'panel__head' }, h('h2', null, 'Cliente')),
      clienteRows ? dl(clienteRows) : h('p', { class: 'muted' }, 'Nessun cliente collegato.'));

    // campi economici: solo se l'API li ha inviati (mai per i tecnici)
    const hasMoney = admin && ['importo_chf', 'acconto_pagato', 'saldo_pagato'].some((k) => Object.prototype.hasOwnProperty.call(e, k));
    const economia = hasMoney
      ? h('section', { class: 'panel' }, h('div', { class: 'panel__head' }, h('h2', null, 'Dati economici')),
        dl([['Importo', h('span', { class: 'num' }, `CHF ${fmtMoney(e.importo_chf)}`)], ['Acconto pagato', yesNo(e.acconto_pagato)], ['Saldo pagato', yesNo(e.saldo_pagato)]]))
      : null;

    const programma = h('section', { class: 'panel' }, h('div', { class: 'panel__head' }, h('h2', null, 'Programma')), multiline(e.programma));
    const has = (k) => Object.prototype.hasOwnProperty.call(e, k);
    // note per la squadra: admin e tecnici assegnati, solo se presenti
    const noteSquadra = e.note_squadra
      ? h('section', { class: 'panel' }, h('div', { class: 'panel__head' }, h('h2', null, 'Note per la squadra')), multiline(e.note_squadra))
      : null;
    // note interne: solo per la gestione e solo se l'API le ha inviate (mai per i tecnici)
    const note = admin && has('note_interne')
      ? h('section', { class: 'panel' }, h('div', { class: 'panel__head' }, h('h2', null, 'Note interne')), multiline(e.note_interne))
      : null;

    const offerte = admin ? wide(G().offertePanel(e)) : null;
    const paga = admin ? wide(G().compensiPanel(e, data.staff || [])) : null;
    // ruolo base: niente checklist (l'API non la restituisce)
    const lista = state.me.ruolo === 'base' ? [] : [].concat(checklistPanel(e, data.checklist || [])).map(wide);
    page({ title: e.titolo || 'Evento', sub, actions, back: ['#/eventi', 'Eventi'] },
      panels(dati, cliente, economia, programma, noteSquadra, note, offerte,
        wide(staffPanel(e, data.staff || [])),
        paga,
        lista));
  }

  function staffPanel(e, staff) {
    const panel = h('section', { class: 'panel' });
    const show = () => {
      clear(panel);
      const head = h('div', { class: 'panel__head' }, h('h2', null, 'Staff assegnato'));
      if (isGestione()) head.append(h('button', { class: 'btn btn--sm', type: 'button', onclick: edit }, 'Modifica staff'));
      panel.append(head);
      if (!staff.length) { panel.append(h('p', { class: 'muted' }, 'Nessun collaboratore assegnato.')); return; }
      panel.append(h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
        h('thead', null, h('tr', null, ['Nome', 'Ruolo', 'Telefono'].map((t) => h('th', { scope: 'col' }, t)))),
        h('tbody', null, staff.map((s) => h('tr', null, td('Nome', dash(s.nome)), td('Ruolo', dash(s.ruolo_evento)), td('Telefono', telLink(s.telefono))))))));
    };
    const edit = async () => {
      clear(panel);
      panel.append(h('div', { class: 'panel__head' }, h('h2', null, 'Modifica staff')), h('p', { class: 'muted' }, 'Caricamento…'));
      let all;
      const assenti = new Map();
      try {
        const giorno = (v) => (v ? String(v).slice(0, 10) : null);
        const da = giorno(e.data_inizio);
        const [st, as] = await Promise.all([
          api('staff'),
          da ? api(`assenze?da=${da}&a=${giorno(e.data_fine) || da}`) : Promise.resolve({ assenze: [] }),
        ]);
        all = st.staff || [];
        (as.assenze || []).forEach((x) => assenti.set(x.staff_id, x));
      } catch (err) { toast(errorMessage(err), 'error'); show(); return; }
      const current = new Map(staff.map((s) => [s.staff_id, s.ruolo_evento || '']));
      const rows = all.filter((s) => s.ruolo !== 'partner' && (s.attivo !== false || current.has(s.id))).map((s) => {
        const cb = h('input', { type: 'checkbox', value: s.id, checked: current.has(s.id) });
        const role = h('input', { type: 'text', maxlength: '80', value: current.get(s.id) || '', placeholder: 'es. audio, luci, video', 'aria-label': `Ruolo nell'evento di ${s.nome || ''}` });
        return { s, cb, role, tr: h('tr', null,
          h('td', { 'data-label': 'Assegnato' }, h('label', { class: 'check' }, cb, h('span', null, s.nome || '—')),
            assenti.has(s.id) ? h('span', { class: 'badge badge--annullato' }, `Assente${assenti.get(s.id).motivo ? `: ${assenti.get(s.id).motivo}` : ''}`) : null),
          td('Profilo', RUOLI[s.ruolo] || dash(s.ruolo)),
          h('td', { 'data-label': "Ruolo nell'evento" }, h('div', { class: 'field' }, role))) };
      });
      const save = h('button', { class: 'btn btn--primary', type: 'submit' }, 'Salva staff');
      const form = h('form', null,
        rows.length
          ? h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
            h('thead', null, h('tr', null, ['Collaboratore', 'Profilo', "Ruolo nell'evento"].map((t) => h('th', { scope: 'col' }, t)))),
            h('tbody', null, rows.map((r) => r.tr))))
          : h('p', { class: 'muted' }, 'Nessun collaboratore attivo.'),
        h('div', { class: 'panel__foot' }, h('button', { class: 'btn', type: 'button', onclick: show }, 'Annulla'), save));
      form.addEventListener('submit', (ev) => {
        ev.preventDefault();
        const occupati = rows.filter((r) => r.cb.checked && assenti.has(r.s.id) && !current.has(r.s.id)).map((r) => r.s.nome);
        if (occupati.length && !window.confirm(`${occupati.join(', ')} ha segnato un'assenza in queste date. Assegnare comunque?`)) return;
        const assegnazioni = rows.filter((r) => r.cb.checked).map((r) => ({ staff_id: r.s.id, ruolo_evento: r.role.value.trim() || null }));
        busy(save, async () => {
          try {
            await api(`eventi/${encodeURIComponent(e.id)}/staff`, { method: 'PUT', body: { assegnazioni } });
            staff = rows.filter((r) => r.cb.checked).map((r) => ({ staff_id: r.s.id, nome: r.s.nome, telefono: r.s.telefono, ruolo_evento: r.role.value.trim() || null }));
            toast('Staff aggiornato.');
            show();
          } catch (err) { toast(errorMessage(err), 'error'); }
        });
      });
      clear(panel);
      panel.append(h('div', { class: 'panel__head' }, h('h2', null, 'Modifica staff')), form);
    };
    show();
    return panel;
  }

  function checklistPanel(e, items) {
    const counter = h('span', { class: 'muted' });
    const updateCount = () => {
      const done = items.filter((i) => i.caricato).length;
      counter.textContent = items.length ? `${done} di ${items.length} caricati` : '';
    };
    const tbody = h('tbody');
    const rowFor = (item) => {
      const cb = h('input', { type: 'checkbox', checked: !!item.caricato, 'aria-label': `Caricato: ${item.voce || ''}` });
      cb.addEventListener('change', async () => {
        const value = cb.checked;
        cb.disabled = true;
        try {
          const res = await api(`checklist/${encodeURIComponent(item.id)}`, { method: 'PATCH', body: { caricato: value } });
          item.caricato = res.voce ? !!res.voce.caricato : value;
          cb.checked = item.caricato;
          updateCount();
        } catch (err) {
          cb.checked = !value;
          toast(errorMessage(err), 'error');
        } finally { cb.disabled = false; }
      });
      const note = h('input', { type: 'text', maxlength: '1000', value: item.note || '', placeholder: 'Annotazione', 'aria-label': `Note: ${item.voce || ''}` });
      note.addEventListener('change', async () => {
        const value = note.value.trim();
        try {
          await api(`checklist/${encodeURIComponent(item.id)}`, { method: 'PATCH', body: { note: value || null } });
          item.note = value;
          toast('Nota salvata.');
        } catch (err) {
          note.value = item.note || '';
          toast(errorMessage(err), 'error');
        }
      });
      // al rientro: quanti pezzi mancano e quanti sono danneggiati
      const contatore = (campo, label) => {
        const el = h('input', { type: 'number', min: '0', max: String(item.quantita || 100000), class: 'input--num', value: String(item[campo] || 0), 'aria-label': `${label}: ${item.voce || ''}`, title: label });
        el.addEventListener('change', async () => {
          const n = Math.max(0, Math.floor(Number(el.value) || 0));
          try { await api(`checklist/${encodeURIComponent(item.id)}`, { method: 'PATCH', body: { [campo]: n } }); item[campo] = n; el.value = String(n); } catch (err) { el.value = String(item[campo] || 0); toast(errorMessage(err), 'error'); }
        });
        return h('label', null, h('span', { class: 'rientro__label' }, label), el);
      };
      const back = h('input', { type: 'checkbox', checked: !!item.rientrato, 'aria-label': `Rientrato: ${item.voce || ''}` });
      back.addEventListener('change', async () => {
        const value = back.checked;
        back.disabled = true;
        try {
          await api(`checklist/${encodeURIComponent(item.id)}`, { method: 'PATCH', body: { rientrato: value } });
          item.rientrato = value;
        } catch (err) {
          back.checked = !value;
          toast(errorMessage(err), 'error');
        } finally { back.disabled = false; }
      });
      const tr = h('tr', null,
        h('td', { 'data-label': 'Caricato' }, h('label', { class: 'check' }, cb, h('span', { class: 'sr-only' }, 'Caricato'))),
        h('td', { 'data-label': 'Voce', class: 'table__primary' }, h('span', null, dash(item.voce), item.articolo_id ? h('span', { class: 'table__sub' }, 'dal magazzino') : null)),
        h('td', { 'data-label': 'Quantità', class: 'num' }, h('span', null, dash(item.quantita))),
        h('td', { 'data-label': 'Rientrato' }, h('label', { class: 'check' }, back, h('span', { class: 'sr-only' }, 'Rientrato'))),
        h('td', { 'data-label': 'Mancanti / danneggiati' }, h('div', { class: 'rientro' }, contatore('mancanti', 'Mancanti'), contatore('danneggiati', 'Danneggiati'))),
        h('td', { 'data-label': 'Note' }, h('div', { class: 'field' }, note)));
      if (isGestione()) {
        const del = h('button', { class: 'btn btn--ghost btn--sm', type: 'button', 'aria-label': `Togli ${item.voce || 'voce'}` }, 'Togli');
        del.addEventListener('click', () => {
          if (!window.confirm(`Togliere "${item.voce || ''}" dalla lista?`)) return;
          busy(del, async () => {
            try {
              await api(`checklist/${encodeURIComponent(item.id)}`, { method: 'DELETE' });
              items.splice(items.indexOf(item), 1);
              tr.remove();
              updateCount();
            } catch (err) { toast(errorMessage(err), 'error'); }
          });
        });
        tr.append(h('td', { 'data-label': '' }, del));
      }
      return tr;
    };
    items.forEach((i) => tbody.append(rowFor(i)));
    updateCount();

    const table = h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
      h('thead', null, h('tr', null, h('th', { scope: 'col' }, 'Caricato'), h('th', { scope: 'col' }, 'Voce'), h('th', { scope: 'col', class: 'num' }, 'Quantità'), h('th', { scope: 'col' }, 'Rientrato'), h('th', { scope: 'col' }, 'Mancanti / danneggiati'), h('th', { scope: 'col' }, 'Note'), isGestione() ? h('th', { scope: 'col' }, h('span', { class: 'sr-only' }, 'Azioni')) : null)),
      tbody));
    const emptyMsg = h('p', { class: 'muted' }, 'La lista del materiale è vuota.');
    const body = h('div', null, items.length ? table : emptyMsg);

    const panel = h('section', { class: 'panel' },
      h('div', { class: 'panel__head' }, h('h2', null, 'Materiale e checklist'), counter), body);

    if (isGestione()) {
      const voce = h('input', { type: 'text', name: 'voce', maxlength: '200', required: true });
      // scelta dal magazzino, con la disponibilità nelle date dell'evento
      const articolo = h('select', { name: 'articolo_id' }, h('option', { value: '' }, '— Voce libera —'));
      const dispHint = h('p', { class: 'field__hint', role: 'status' });
      const catalogo = new Map();
      (async () => {
        try {
          const giorno = (v) => (v ? String(v).slice(0, 10) : null);
          const da = giorno(e.data_inizio);
          const [cat, disp] = await Promise.all([
            api('articoli'),
            da ? api(`articoli/disponibilita?da=${da}&a=${giorno(e.data_fine) || da}&escludi=${encodeURIComponent(e.id)}`) : Promise.resolve({ disponibilita: [] }),
          ]);
          const d = new Map((disp.disponibilita || []).map((x) => [x.articolo_id, x]));
          (cat.articoli || []).forEach((a) => {
            const x = d.get(a.id);
            catalogo.set(a.id, { ...a, disp: x });
            articolo.append(h('option', { value: a.id }, `${a.categoria} · ${a.descrizione}${x ? ` — liberi ${x.disponibili} di ${a.quantita}` : ''}`));
          });
        } catch (err) { dispHint.textContent = 'Catalogo non disponibile: potete comunque scrivere una voce libera.'; }
      })();
      articolo.addEventListener('change', () => {
        const a = catalogo.get(articolo.value);
        dispHint.textContent = '';
        if (!a) return;
        voce.value = [a.marca && !a.descrizione.includes(a.marca) ? a.marca : null, a.descrizione].filter(Boolean).join(' ').slice(0, 200);
        if (a.disp) {
          dispHint.textContent = `In quelle date: ${a.disp.disponibili} liberi su ${a.quantita}`
            + (a.disp.in_offerta ? `, ${a.disp.in_offerta} in offerte non ancora confermate` : '')
            + (a.disp.fuori ? `, ${a.disp.fuori} fuori adesso` : '') + '.';
        }
      });
      const qta = h('input', { type: 'number', name: 'quantita', min: '1', max: '100000', value: '1', inputmode: 'numeric' });
      const nota = h('input', { type: 'text', name: 'note', maxlength: '1000' });
      const btn = h('button', { class: 'btn btn--primary', type: 'submit' }, 'Aggiungi voce');
      const form = h('form', { class: 'panel', 'aria-labelledby': 'add-voce-title' },
        h('div', { class: 'panel__head' }, h('h2', { id: 'add-voce-title' }, 'Aggiungi una voce alla checklist')),
        h('div', { class: 'fields' }, h('div', { class: 'field field--full' }, field('Dal magazzino', articolo), dispHint), field('Voce', voce), field('Quantità', qta), field('Note', nota)),
        h('div', { class: 'panel__foot' }, btn));
      form.addEventListener('submit', (ev) => {
        ev.preventDefault();
        if (!voce.value.trim()) { voce.setAttribute('aria-invalid', 'true'); voce.focus(); return; }
        voce.removeAttribute('aria-invalid');
        busy(btn, async () => {
          try {
            const res = await api(`eventi/${encodeURIComponent(e.id)}/checklist`, {
              method: 'POST', body: { voce: voce.value.trim(), quantita: qta.value ? Number(qta.value) : null, articolo_id: articolo.value || null, note: nota.value.trim() || null },
            });
            if (res.voce) {
              items.push(res.voce);
              if (items.length === 1) { clear(body); body.append(table); }
              tbody.append(rowFor(res.voce));
              updateCount();
            }
            voce.value = ''; qta.value = '1'; nota.value = ''; articolo.value = ''; dispHint.textContent = '';
            voce.focus();
            toast('Voce aggiunta.');
          } catch (err) { markInvalid(form, err); toast(errorMessage(err), 'error'); }
        });
      });
      return [panel, form];
    }
    return panel;
  }

  async function viewEventoForm([id], alive) {
    loading();
    let e = {};
    let clienti = [];
    try {
      const [det, cl] = await Promise.all([id ? api(`eventi/${encodeURIComponent(id)}`) : Promise.resolve(null), api('clienti')]);
      if (det) e = det.evento || {};
      clienti = cl.clienti || [];
    } catch (err) { if (alive()) failure(id ? 'Modifica evento' : 'Nuovo evento', err); return; }
    if (!alive()) return;
    clienti.forEach((c) => state.clienti.set(c.id, c));

    const dt = (v) => (v ? String(v).slice(0, 16) : '');
    const inp = (name, attrs = {}) => h('input', { name, type: 'text', ...attrs });
    const f = {
      titolo: inp('titolo', { maxlength: '200', required: true, value: e.titolo || '' }),
      cliente_id: select('cliente_id', [['', '— Nessun cliente —'], ...clienti.map((c) => [c.id, c.azienda ? `${c.nome} (${c.azienda})` : c.nome])], e.cliente_id || ''),
      tipo: inp('tipo', { maxlength: '80', value: e.tipo || '' }),
      stato: select('stato', Object.entries(STATI), e.stato || 'richiesta'),
      data_inizio: inp('data_inizio', { type: 'datetime-local', value: dt(e.data_inizio) }),
      data_fine: inp('data_fine', { type: 'datetime-local', value: dt(e.data_fine) }),
      montaggio_da: inp('montaggio_da', { type: 'datetime-local', value: dt(e.montaggio_da) }),
      smontaggio_da: inp('smontaggio_da', { type: 'datetime-local', value: dt(e.smontaggio_da) }),
      localita: inp('localita', { maxlength: '200', value: e.localita || '' }),
      sala: inp('sala', { maxlength: '200', value: e.sala || '' }),
      indirizzo: inp('indirizzo', { maxlength: '300', value: e.indirizzo || '', autocomplete: 'off' }),
      contatto_luogo_nome: inp('contatto_luogo_nome', { maxlength: '120', value: e.contatto_luogo_nome || '' }),
      contatto_luogo_telefono: inp('contatto_luogo_telefono', { type: 'tel', maxlength: '40', value: e.contatto_luogo_telefono || '' }),
      paese: select('paese', Object.entries(PAESI), e.paese || 'CH'),
      ospiti: inp('ospiti', { type: 'number', min: '0', max: '100000', inputmode: 'numeric', value: e.ospiti ?? '' }),
      servizi: inp('servizi', { value: Array.isArray(e.servizi) ? e.servizi.join(', ') : '' }),
      programma: h('textarea', { name: 'programma', rows: '5', maxlength: '10000' }),
      note_squadra: h('textarea', { name: 'note_squadra', rows: '4', maxlength: '10000' }),
      note_interne: isGestione() ? h('textarea', { name: 'note_interne', rows: '4', maxlength: '10000' }) : null,
      importo_chf: inp('importo_chf', { inputmode: 'decimal', value: e.importo_chf ?? '', placeholder: '0.00' }),
    };
    f.programma.value = e.programma || '';
    f.note_squadra.value = e.note_squadra || '';
    if (f.note_interne) f.note_interne.value = e.note_interne || '';
    const acconto = check('acconto_pagato', 'Acconto pagato', e.acconto_pagato);
    const saldo = check('saldo_pagato', 'Saldo pagato', e.saldo_pagato);
    const alert = h('div');
    const save = h('button', { class: 'btn btn--primary', type: 'submit' }, id ? 'Salva le modifiche' : 'Crea evento');
    const cancel = h('a', { class: 'btn', href: id ? `#/evento/${encodeURIComponent(id)}` : '#/eventi' }, 'Annulla');

    const form = h('form', { class: 'panel', novalidate: true },
      alert,
      h('div', { class: 'fields' },
        field('Titolo *', f.titolo, { full: true }),
        field('Cliente', f.cliente_id, { hint: 'Il cliente non è in elenco? Createlo prima in "Clienti".' }),
        field('Tipo di evento', f.tipo),
        field('Stato', f.stato),
        field('Inizio (servizio)', f.data_inizio),
        field('Fine (servizio)', f.data_fine),
        field('Montaggio da', f.montaggio_da),
        field('Smontaggio', f.smontaggio_da),
        field('Località', f.localita),
        field('Sala', f.sala),
        field('Indirizzo', f.indirizzo, { full: true, hint: 'Via, numero e località: la squadra lo apre su Google Maps.' }),
        field('Contatto sul posto', f.contatto_luogo_nome, { hint: 'Chi incontra la squadra sul luogo.' }),
        field('Telefono del contatto', f.contatto_luogo_telefono),
        field('Paese', f.paese),
        field('Ospiti', f.ospiti),
        field('Servizi', f.servizi, { full: true, hint: 'Separate i servizi con una virgola (es. Ledwall, Luci, Audio).' }),
        field('Programma', f.programma, { full: true }),
        field('Note per la squadra', f.note_squadra, { full: true, hint: 'Visibili ai tecnici assegnati a questo evento.' }),
        f.note_interne ? field('Note interne (solo ufficio)', f.note_interne, { full: true, hint: 'Non visibili ai tecnici.' }) : null),
      h('h2', null, 'Dati economici'),
      h('div', { class: 'fields' },
        field('Importo (CHF)', f.importo_chf, { hint: 'Es. 2450.00' }),
        h('div', { class: 'field' }, acconto, saldo)),
      h('div', { class: 'panel__foot' }, cancel, save));

    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      clear(alert);
      if (!f.titolo.value.trim()) {
        markInvalid(form, new ApiError(400, 'invalid_input', 'titolo'));
        alert.append(h('p', { class: 'alert alert--error', role: 'alert' }, 'Il titolo è obbligatorio.'));
        return;
      }
      const importo = f.importo_chf.value.replace(/['\s]/g, '').replace(',', '.');
      const body = {
        titolo: f.titolo.value.trim(),
        cliente_id: f.cliente_id.value || null,
        tipo: f.tipo.value.trim() || null,
        stato: f.stato.value,
        data_inizio: f.data_inizio.value || null,
        data_fine: f.data_fine.value || null,
        montaggio_da: f.montaggio_da.value || null,
        smontaggio_da: f.smontaggio_da.value || null,
        localita: f.localita.value.trim() || null,
        sala: f.sala.value.trim() || null,
        indirizzo: f.indirizzo.value.trim() || null,
        contatto_luogo_nome: f.contatto_luogo_nome.value.trim() || null,
        contatto_luogo_telefono: f.contatto_luogo_telefono.value.trim() || null,
        paese: f.paese.value,
        ospiti: f.ospiti.value === '' ? null : Number(f.ospiti.value),
        servizi: f.servizi.value.split(',').map((s) => s.trim()).filter(Boolean),
        programma: f.programma.value.trim() || null,
        note_squadra: f.note_squadra.value.trim() || null,
        ...(f.note_interne ? { note_interne: f.note_interne.value.trim() || null } : {}),
        importo_chf: importo === '' ? null : importo,
        acconto_pagato: acconto.querySelector('input').checked,
        saldo_pagato: saldo.querySelector('input').checked,
      };
      busy(save, async () => {
        try {
          const res = await api(id ? `eventi/${encodeURIComponent(id)}` : 'eventi', { method: id ? 'PATCH' : 'POST', body });
          const newId = (res.evento && res.evento.id) || id;
          toast(id ? 'Evento aggiornato.' : `Evento creato${res.evento && res.evento.numero_ordine ? ` (N. ${res.evento.numero_ordine})` : ''}.`);
          window.location.hash = newId ? `#/evento/${encodeURIComponent(newId)}` : '#/eventi';
        } catch (err) {
          markInvalid(form, err);
          alert.append(h('p', { class: 'alert alert--error', role: 'alert' }, errorMessage(err)));
        }
      });
    });

    page({ title: id ? 'Modifica evento' : 'Nuovo evento', sub: e.numero_ordine ? `N. ${e.numero_ordine}` : null, back: id ? [`#/evento/${encodeURIComponent(id)}`, 'Evento'] : ['#/eventi', 'Eventi'] }, form);
  }

  // ------------------------------------------------------------ richieste dal sito
  async function viewRichieste(_, alive) {
    loading();
    const tab = state.richiesteTab;
    const fetchList = async () => (await api(`richieste${tab ? `?stato=${tab}` : ''}`)).richieste || [];
    let list;
    try { list = await fetchList(); } catch (err) { if (alive()) failure('Richieste dal sito', err); return; }
    if (!alive()) return;

    const tabsWrap = h('div');
    const listWrap = h('div', { id: 'richieste-panel', role: 'tabpanel' });
    const draw = () => {
      list.forEach((r) => state.richieste.set(r.id, r));
      clear(tabsWrap);
      clear(listWrap);
      tabsWrap.append(h('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Stato delle richieste' },
        [['nuova', 'Nuove'], ['gestita', 'Gestite'], ['scartata', 'Scartate'], ['', 'Tutte']].map(([v, l]) => {
          const sel = v === tab;
          return h('button', {
            type: 'button', role: 'tab', 'aria-selected': String(sel), 'aria-controls': 'richieste-panel',
            onclick: () => { state.richiesteTab = v; route(); },
          }, l, sel ? h('span', { class: 'count' }, String(list.length)) : null);
        })));
      listWrap.append(list.length
        ? h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
          h('thead', null, h('tr', null, ['Ricevuta', 'Richiedente', 'Evento', 'Ospiti', 'Stato', ''].map((t, i) => h('th', { scope: 'col', class: i === 3 ? 'num' : null }, t || h('span', { class: 'sr-only' }, 'Azioni'))))),
          h('tbody', null, list.map((r) => {
            const href = `#/richiesta/${encodeURIComponent(r.id)}`;
            const tr = h('tr', { class: 'is-link' },
              td('Ricevuta', fmtDate(r.created_at)),
              h('td', { 'data-label': 'Richiedente', class: 'table__primary' }, h('span', null, h('a', { href }, r.nome || '—'), h('span', { class: 'table__sub' }, [r.email, r.telefono].filter(Boolean).join(' · ')))),
              td('Evento', dash(r.tipo), h('span', { class: 'table__sub' }, [r.data ? fmtDate(r.data) : null, r.localita].filter(Boolean).join(' · '))),
              h('td', { 'data-label': 'Ospiti', class: 'num' }, h('span', null, dash(r.ospiti))),
              td('Stato', badge(r.stato, STATI_RICHIESTA)),
              h('td', { 'data-label': '', class: 'table__actions' }, h('a', { class: 'btn btn--sm', href }, 'Apri')));
            tr.addEventListener('click', (ev) => { if (!ev.target.closest('a, button')) window.location.hash = href; });
            return tr;
          }))))
        : empty('Nessuna richiesta', tab === 'nuova' ? 'Non ci sono nuove richieste dal modulo del sito.' : 'Nessuna richiesta in questo elenco.'));
    };
    draw();

    page({ title: 'Richieste dal sito', sub: 'Richieste di offerta inviate dal modulo del sito pubblico' },
      tabsWrap, h('div', { class: 'panels' },
        h('div', { class: 'field--full' }, listWrap),
        h('div', { class: 'field--full' }, puliziaPanel(async () => {
          const fresh = await fetchList();
          if (!alive()) return;
          list = fresh;
          draw();
        }))));
  }

  // pulizia manuale delle richieste senza seguito (POST /api/richieste/pulizia, solo admin)
  function puliziaPanel(reload) {
    const status = h('div', { role: 'status', 'aria-live': 'polite' });
    const errBox = h('div', { role: 'alert' });
    const confirmSlot = h('div');
    // testo visibile più corto (il bottone non va a capo: a 390 px uscirebbe dal pannello);
    // il nome accessibile completo contiene il testo visibile (WCAG 2.5.3)
    const opener = h('button', { class: 'btn btn--danger', type: 'button', 'aria-label': 'Elimina richieste senza seguito più vecchie di 24 mesi' }, 'Elimina richieste senza seguito');
    const say = (box, text, kind) => { clear(status); clear(errBox); if (text) box.append(h('p', { class: `alert alert--${kind}` }, text)); };
    const puliziaError = (err) => {
      if (err instanceof ApiError && err.status === 401) return h('span', null, 'Sessione scaduta: nessuna richiesta è stata eliminata. ', h('a', { href: LOGIN }, 'Accedete di nuovo'), ' e riprovate.');
      if (err instanceof ApiError && err.status === 403) return 'Solo un amministratore può eliminare le richieste.';
      if (err instanceof ApiError && err.status === 502) return 'Il database non ha risposto: nessuna richiesta è stata eliminata. Riprovate tra qualche minuto.';
      return errorMessage(err);
    };
    opener.addEventListener('click', () => {
      if (confirmSlot.querySelector('.confirm')) return;
      say(status, '', 'ok');
      const tid = nextId('c');
      const cancel = h('button', { class: 'btn', type: 'button' }, 'Annulla');
      const ok = h('button', { class: 'btn btn--danger', type: 'button' }, 'Elimina definitivamente');
      const box = h('div', { class: 'confirm', role: 'group', 'aria-labelledby': tid },
        h('p', { class: 'confirm__text', id: tid }, h('strong', null, 'Eliminare le richieste senza seguito più vecchie di 24 mesi?'),
          ' Le richieste convertite in evento restano. L\'operazione non si può annullare.'),
        h('div', { class: 'confirm__actions' }, ok, cancel));
      const close = () => { box.remove(); opener.disabled = false; if (opener.isConnected) opener.focus(); };
      cancel.addEventListener('click', close);
      box.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') { ev.preventDefault(); close(); } });
      ok.addEventListener('click', () => busy(ok, async () => {
        cancel.disabled = true;
        try {
          const res = await api('richieste/pulizia', { method: 'POST', redirect401: false });
          const n = Number.isSafeInteger(res.cancellate) && res.cancellate >= 0 ? res.cancellate : 0;
          close();
          say(status, n === 1 ? '1 richiesta eliminata.' : `${n} richieste eliminate.`, 'ok');
          try { await reload(); } catch (err) { errBox.append(h('p', { class: 'alert alert--error' }, `L'elenco non si è aggiornato: ${errorMessage(err)}`)); }
        } catch (err) {
          close();
          clear(status); clear(errBox);
          errBox.append(h('p', { class: 'alert alert--error' }, puliziaError(err)));
        } finally { cancel.disabled = false; }
      }));
      opener.disabled = true;
      confirmSlot.append(box);
      cancel.focus();
    });
    return h('section', { class: 'panel', 'aria-labelledby': 'pulizia-title' },
      h('div', { class: 'panel__head' }, h('h2', { id: 'pulizia-title' }, 'Conservazione dei dati')),
      h('p', { class: 'muted' }, 'Le richieste senza seguito (non convertite in evento) più vecchie di 24 mesi vengono eliminate automaticamente ogni notte. Con questo pulsante potete eseguire subito la stessa pulizia.'),
      status, errBox, confirmSlot,
      h('div', { class: 'panel__foot' }, opener));
  }

  async function viewRichiesta([id], alive) {
    let r = state.richieste.get(id);
    if (!r) {
      loading();
      try {
        const list = (await api('richieste')).richieste || [];
        list.forEach((x) => state.richieste.set(x.id, x));
        r = state.richieste.get(id);
      } catch (err) { if (alive()) failure('Richiesta', err); return; }
      if (!alive()) return;
      if (!r) { failure('Richiesta', new ApiError(404, 'not_found')); return; }
    }

    const setStato = (stato, btn) => busy(btn, async () => {
      try {
        const res = await api(`richieste/${encodeURIComponent(r.id)}`, { method: 'PATCH', body: { stato } });
        state.richieste.set(r.id, res.richiesta || { ...r, stato });
        toast(`Richiesta segnata come "${STATI_RICHIESTA[stato]}".`);
        route();
      } catch (err) { toast(errorMessage(err), 'error'); }
    });

    const azioni = h('section', { class: 'panel' }, h('div', { class: 'panel__head' }, h('h2', null, 'Azioni')));
    if (r.evento_id) {
      add(azioni, [
        h('p', { class: 'alert alert--ok' }, 'Questa richiesta è già stata convertita in evento.'),
        h('div', { class: 'panel__foot' }, h('a', { class: 'btn btn--primary', href: `#/evento/${encodeURIComponent(r.evento_id)}` }, "Apri l'evento")),
      ]);
    } else {
      const titolo = h('input', { type: 'text', maxlength: '200', value: [r.tipo, r.nome].filter(Boolean).join(' — ') });
      const conv = h('button', { class: 'btn btn--primary', type: 'submit' }, 'Converti in evento');
      const form = h('form', null,
        h('p', { class: 'muted' }, "Crea il cliente (o riusa quello con la stessa e-mail) e un nuovo evento con i dati della richiesta."),
        h('div', { class: 'fields' }, field("Titolo dell'evento", titolo, { full: true, hint: 'Facoltativo: potete modificarlo anche dopo.' })),
        h('div', { class: 'panel__foot' },
          r.stato !== 'scartata' ? h('button', { class: 'btn', type: 'button', onclick: (ev) => setStato('scartata', ev.currentTarget) }, 'Scarta') : null,
          r.stato !== 'gestita' ? h('button', { class: 'btn', type: 'button', onclick: (ev) => setStato('gestita', ev.currentTarget) }, 'Segna come gestita') : null,
          r.stato !== 'nuova' ? h('button', { class: 'btn', type: 'button', onclick: (ev) => setStato('nuova', ev.currentTarget) }, 'Riporta tra le nuove') : null,
          conv));
      form.addEventListener('submit', (ev) => {
        ev.preventDefault();
        busy(conv, async () => {
          try {
            const t = titolo.value.trim();
            const res = await api(`richieste/${encodeURIComponent(r.id)}/converti`, { method: 'POST', body: t ? { titolo: t } : {} });
            state.richieste.delete(r.id);
            toast(`Evento creato${res.numero_ordine ? ` (N. ${res.numero_ordine})` : ''}.`);
            window.location.hash = res.evento_id ? `#/evento/${encodeURIComponent(res.evento_id)}` : '#/richieste';
          } catch (err) { toast(errorMessage(err), 'error'); }
        });
      });
      azioni.append(form);
    }

    page({ title: r.nome || 'Richiesta', sub: h('span', null, `Ricevuta il ${fmtDate(r.created_at)} · `, badge(r.stato, STATI_RICHIESTA)), back: ['#/richieste', 'Richieste'] },
      panels(
        h('section', { class: 'panel' }, h('div', { class: 'panel__head' }, h('h2', null, 'Dati della richiesta')),
          dl([
            ['E-mail', mailLink(r.email)],
            ['Telefono', telLink(r.telefono)],
            ['Tipo di evento', dash(r.tipo)],
            ['Data', fmtDate(r.data)],
            ['Località', dash(r.localita)],
            ['Ospiti', dash(r.ospiti)],
            ['Servizi', Array.isArray(r.servizi) && r.servizi.length ? r.servizi.join(', ') : dash(typeof r.servizi === 'string' ? r.servizi : null)],
            ['Lingua', LINGUE[r.lingua] || dash(r.lingua)],
          ])),
        h('section', { class: 'panel' }, h('div', { class: 'panel__head' }, h('h2', null, 'Messaggio')), multiline(r.messaggio)),
        dettagliTecnici(r.dettagli_tecnici) && h('section', { class: 'panel' }, h('div', { class: 'panel__head' }, h('h2', null, 'Dettagli tecnici sul luogo')), dl(dettagliTecnici(r.dettagli_tecnici))),
        wide(azioni)));
  }

  // ------------------------------------------------------------ clienti
  async function viewClienti(_, alive) {
    const q = h('input', { type: 'search', id: 'c-q', placeholder: 'Nome, azienda o e-mail…', autocomplete: 'off', maxlength: '60' });
    const count = h('span', { class: 'toolbar__count', role: 'status' });
    const results = h('div', null, h('p', { class: 'muted' }, 'Caricamento…'));
    page({ title: 'Clienti', actions: [h('a', { class: 'btn btn--primary', href: '#/clienti/nuovo' }, 'Nuovo cliente')] },
      h('form', { class: 'toolbar', role: 'search', 'aria-label': 'Cerca un cliente', onsubmit: (e) => e.preventDefault() },
        h('div', { class: 'field field--search' }, h('label', { for: 'c-q' }, 'Cerca'), q), count),
      results);
    let timer = null;
    let last = 0;
    const load = async () => {
      const my = ++last;
      const term = q.value.trim();
      try {
        const list = (await api(`clienti${term ? `?q=${encodeURIComponent(term)}` : ''}`)).clienti || [];
        if (!alive() || my !== last) return;
        list.forEach((c) => state.clienti.set(c.id, c));
        count.textContent = `${list.length} ${list.length === 1 ? 'cliente' : 'clienti'}`;
        clear(results);
        results.append(list.length
          ? h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
            h('thead', null, h('tr', null, ['Nome', 'E-mail', 'Telefono', 'Lingua'].map((t) => h('th', { scope: 'col' }, t)))),
            h('tbody', null, list.map((c) => {
              const href = `#/cliente/${encodeURIComponent(c.id)}`;
              const tr = h('tr', { class: 'is-link' },
                h('td', { 'data-label': 'Nome', class: 'table__primary' }, h('span', null, h('a', { href }, c.nome || '—'), c.azienda ? h('span', { class: 'table__sub' }, c.azienda) : null)),
                td('E-mail', mailLink(c.email)), td('Telefono', telLink(c.telefono)), td('Lingua', LINGUE[c.lingua] || dash(c.lingua)));
              tr.addEventListener('click', (ev) => { if (!ev.target.closest('a, button')) window.location.hash = href; });
              return tr;
            }))))
          : empty('Nessun cliente trovato', term ? 'Provate con un altro termine di ricerca.' : 'Non ci sono ancora clienti.'));
      } catch (err) {
        if (!alive() || my !== last) return;
        clear(results);
        count.textContent = '';
        results.append(h('p', { class: 'alert alert--error', role: 'alert' }, errorMessage(err)));
      }
    };
    q.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(load, 300); });
    await load();
  }

  async function viewClienteForm([id], alive) {
    let c = {};
    if (id) {
      c = state.clienti.get(id);
      if (!c) {
        loading();
        try { ((await api('clienti')).clienti || []).forEach((x) => state.clienti.set(x.id, x)); } catch (err) { if (alive()) failure('Cliente', err); return; }
        if (!alive()) return;
        c = state.clienti.get(id);
        if (!c) { failure('Cliente', new ApiError(404, 'not_found')); return; }
      }
    }
    const f = {
      nome: h('input', { name: 'nome', type: 'text', maxlength: '120', required: true, value: c.nome || '', autocomplete: 'off' }),
      azienda: h('input', { name: 'azienda', type: 'text', maxlength: '160', value: c.azienda || '', autocomplete: 'off' }),
      email: h('input', { name: 'email', type: 'email', maxlength: '254', value: c.email || '', autocomplete: 'off' }),
      telefono: h('input', { name: 'telefono', type: 'tel', maxlength: '40', value: c.telefono || '', autocomplete: 'off' }),
      lingua: select('lingua', Object.entries(LINGUE), c.lingua || 'it'),
      indirizzo: h('textarea', { name: 'indirizzo', rows: '3', maxlength: '300', placeholder: 'Via e numero\nCAP Località' }),
      anrede: h('input', { name: 'anrede', type: 'text', maxlength: '200', value: c.anrede || '', placeholder: 'es. Liebe Anna, lieber Marco · Sehr geehrte Frau Muster' }),
      note: h('textarea', { name: 'note', rows: '4', maxlength: '4000' }),
    };
    f.note.value = c.note || '';
    f.indirizzo.value = c.indirizzo || '';
    const alert = h('div');
    const save = h('button', { class: 'btn btn--primary', type: 'submit' }, id ? 'Salva le modifiche' : 'Crea cliente');
    const form = h('form', { class: 'panel', novalidate: true }, alert,
      h('div', { class: 'fields' },
        field('Nome e cognome *', f.nome), field('Azienda', f.azienda), field('E-mail', f.email), field('Telefono', f.telefono), field('Lingua', f.lingua),
        field('Indirizzo completo', f.indirizzo, { hint: "Obbligatorio prima di inviare un'offerta." }),
        field('Saluto nelle offerte (Anrede)', f.anrede, { hint: 'Privati: "Liebe Anna, lieber Marco" o "Guten Tag Anna und Marco". Aziende: "Sehr geehrte Frau Muster".' }),
        field('Note', f.note, { full: true })),
      h('div', { class: 'panel__foot' }, h('a', { class: 'btn', href: '#/clienti' }, 'Annulla'), save));
    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      clear(alert);
      if (!f.nome.value.trim()) {
        markInvalid(form, new ApiError(400, 'invalid_input', 'nome'));
        alert.append(h('p', { class: 'alert alert--error', role: 'alert' }, 'Il nome è obbligatorio.'));
        return;
      }
      const body = {
        nome: f.nome.value.trim(), azienda: f.azienda.value.trim() || null, email: f.email.value.trim() || null,
        telefono: f.telefono.value.trim() || null, lingua: f.lingua.value, note: f.note.value.trim() || null,
        indirizzo: f.indirizzo.value.trim() || null, anrede: f.anrede.value.trim() || null,
      };
      busy(save, async () => {
        try {
          const res = await api(id ? `clienti/${encodeURIComponent(id)}` : 'clienti', { method: id ? 'PATCH' : 'POST', body });
          if (res.cliente) state.clienti.set(res.cliente.id, res.cliente);
          toast(id ? 'Cliente aggiornato.' : 'Cliente creato.');
          window.location.hash = '#/clienti';
        } catch (err) {
          markInvalid(form, err);
          alert.append(h('p', { class: 'alert alert--error', role: 'alert' }, errorMessage(err)));
        }
      });
    });
    page({ title: id ? 'Modifica cliente' : 'Nuovo cliente', back: ['#/clienti', 'Clienti'] }, form);
  }

  function viewVietato() {
    page({ title: 'Accesso non consentito' },
      h('p', { class: 'alert alert--error', role: 'alert' }, 'Il vostro profilo non ha accesso a questa sezione.'),
      h('p', null, h('a', { class: 'btn', href: homeHash() }, 'Torna alla pagina iniziale')));
  }

  // ------------------------------------------------------------ contenuti del sito (CMS, contenuti.js)
  let cms = null;
  function viewContenuti(params, alive) {
    if (!cms) {
      if (!window.MeekonContenuti) throw new Error('contenuti.js non caricato');
      cms = window.MeekonContenuti.create({ h, add, clear, api, ApiError, errorMessage, page, toast, nextId, field, busy });
    }
    return cms.view(params, alive);
  }

  // ------------------------------------------------------------ gestionale (gestionale.js)
  let gest = null;
  function G() {
    if (!gest) {
      if (!window.MeekonGestionale) throw new Error('gestionale.js non caricato');
      gest = window.MeekonGestionale.create({
        h, add, clear, api, ApiError, errorMessage, page, toast, field, busy, select, check, loading, failure, empty,
        td, dl, badge, wide, nextId, dash, fmtDate, fmtRange, fmtMoney, isoDate, addDays, telLink, mailLink, mapLink, markInvalid, panels,
        state, isAdmin, isGestione, RUOLI, STATI,
      });
    }
    return gest;
  }

  // ------------------------------------------------------------ area partner (partner.js)
  let part = null;
  function PT() {
    if (!part) {
      if (!window.MeekonPartner) throw new Error('partner.js non caricato');
      part = window.MeekonPartner.create({
        h, add, clear, api, ApiError, errorMessage, page, toast, field, busy, select, check, loading, failure, empty,
        td, dl, fmtDate, fmtRange, fmtMoney, isoDate, telLink, mailLink, panels, wide, state,
      });
    }
    return part;
  }
  const isPartner = () => state.me && state.me.ruolo === 'partner';
  const homeHash = () => (isPartner() ? '#/partner' : state.me.ruolo === 'base' ? '#/agenda' : '#/prossimi');

  // ------------------------------------------------------------ router
  const ID = '([0-9A-Za-z-]{1,64})';
  const ROUTES = [
    [/^#\/prossimi$/, viewProssimi, 'tutti', 'prossimi'],
    [/^#\/eventi$/, viewEventi, 'tutti', 'eventi'],
    [/^#\/eventi\/nuovo$/, viewEventoForm, 'gestione', 'eventi'],
    [new RegExp(`^#/evento/${ID}$`), viewEvento, 'tutti', 'eventi'],
    [new RegExp(`^#/evento/${ID}/modifica$`), viewEventoForm, 'gestione', 'eventi'],
    [/^#\/richieste$/, viewRichieste, 'gestione', 'richieste'],
    [new RegExp(`^#/richiesta/${ID}$`), viewRichiesta, 'gestione', 'richieste'],
    [/^#\/clienti$/, viewClienti, 'gestione', 'clienti'],
    [/^#\/clienti\/nuovo$/, viewClienteForm, 'gestione', 'clienti'],
    [new RegExp(`^#/cliente/${ID}$`), viewClienteForm, 'gestione', 'clienti'],
    [/^#\/contenuti$/, viewContenuti, 'admin', 'contenuti'],
    [/^#\/contenuti\/(galleria|location|dj|partner|testi)$/, viewContenuti, 'admin', 'contenuti'],
    [/^#\/agenda$/, (p, a) => G().viewAgenda(p, a), 'tutti', 'agenda'],
    [/^#\/agenda\/(\d{4}-\d{2}-\d{2})$/, (p, a) => G().viewAgenda(p, a), 'tutti', 'agenda'],
    [/^#\/assenze$/, (p, a) => G().viewAssenze(p, a), 'tutti', 'assenze'],
    [/^#\/magazzino$/, (p, a) => G().viewMagazzino(p, a), 'gestione', 'magazzino'],
    [/^#\/magazzino\/importa$/, (p, a) => G().viewImporta(p, a), 'gestione', 'magazzino'],
    [new RegExp(`^#/offerta/${ID}$`), (p, a) => G().viewOfferta(p, a), 'gestione', 'eventi'],
    [/^#\/utenti$/, (p, a) => G().viewUtenti(p, a), 'admin', 'utenti'],
    [/^#\/impostazioni$/, (p, a) => G().viewImpostazioni(p, a), 'admin', 'impostazioni'],
    [/^#\/paga$/, (p, a) => G().viewPaga(p, a), 'tutti', 'paga'],
    [/^#\/partner$/, (p, a) => PT().viewOfferte(p, a), 'partner', 'partner'],
    [/^#\/partner\/profilo$/, (p, a) => PT().viewProfilo(p, a), 'partner', 'partner-profilo'],
    [new RegExp(`^#/partner/offerta/${ID}$`), (p, a) => PT().viewOfferta(p, a), 'partner_o_gestione', 'partner'],
    [/^#\/richieste-partner$/, (p, a) => PT().viewRichieste(p, a), 'gestione', 'richieste-partner'],
  ];

  function route() {
    const my = ++seq;
    const alive = () => my === seq;
    const hash = window.location.hash || homeHash();
    for (const [re, view, accesso, section] of ROUTES) {
      const m = re.exec(hash);
      if (!m) continue;
      nav.querySelectorAll('a').forEach((a) => {
        if (a.dataset.section === section) a.setAttribute('aria-current', 'page');
        else a.removeAttribute('aria-current');
      });
      // il partner vede solo la propria area
      if (isPartner() && accesso !== 'partner' && accesso !== 'partner_o_gestione') { window.location.replace('#/partner'); return; }
      if ((accesso === 'admin' && !isAdmin()) || (accesso === 'gestione' && !isGestione())
        || (accesso === 'partner' && !isPartner()) || (accesso === 'partner_o_gestione' && !isPartner() && !isGestione())) { viewVietato(); return; }
      Promise.resolve(view(m.slice(1).map(decodeURIComponent), alive)).catch((err) => { if (alive()) failure('Errore', err); });
      return;
    }
    window.location.replace(homeHash());
  }

  function buildShell() {
    clear(nav);
    const links = isPartner()
      ? [['#/partner', 'Le mie offerte', 'partner'], ['#/partner/profilo', 'Profilo', 'partner-profilo']]
      : state.me.ruolo === 'base'
      ? [['#/agenda', 'Agenda di oggi', 'agenda']]
      : [['#/agenda', 'Agenda', 'agenda'], ['#/prossimi', 'Prossimi eventi', 'prossimi'], ['#/eventi', 'Eventi', 'eventi']];
    if (isGestione()) links.push(['#/richieste', 'Richieste dal sito', 'richieste'], ['#/richieste-partner', 'Richieste partner', 'richieste-partner'], ['#/clienti', 'Clienti', 'clienti'], ['#/magazzino', 'Magazzino', 'magazzino']);
    if (!isPartner()) links.push(['#/assenze', 'Giorni di assenza', 'assenze'], ['#/paga', 'Paga e spese', 'paga']);
    if (isAdmin()) links.push(['#/utenti', 'Utenti e ruoli', 'utenti'], ['#/impostazioni', 'Impostazioni', 'impostazioni'], ['#/contenuti', 'Contenuti del sito', 'contenuti']);
    links.forEach(([href, label, section]) => nav.append(h('a', { href, 'data-section': section }, label)));
    const logout = h('button', { class: 'app__link', type: 'button' }, 'Esci');
    logout.addEventListener('click', async () => {
      logout.disabled = true;
      try { await api('auth/logout', { method: 'POST' }); } catch (err) { /* si esce comunque */ }
      window.location.replace(LOGIN);
    });
    nav.append(logout);
    clear(userBox);
    add(userBox, [h('strong', null, state.me.nome || 'Utente'), RUOLI[state.me.ruolo] || '']);
  }

  async function init() {
    try {
      const me = await api('me');
      if (!me || !me.ruolo) throw new ApiError(500, 'server_error');
      state.me = me;
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return;
      if (err instanceof ApiError && err.status === 403) { window.location.replace(LOGIN); return; }
      clear(main);
      add(main, [h('h1', null, 'Area riservata'),
        h('p', { class: 'alert alert--error', role: 'alert' }, errorMessage(err)),
        h('p', null, h('button', { class: 'btn', type: 'button', onclick: () => window.location.reload() }, 'Riprova'))]);
      return;
    }
    buildShell();
    window.addEventListener('hashchange', route);
    route();
  }

  init();
})();
