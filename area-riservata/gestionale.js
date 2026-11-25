// Area riservata Meekon Displays — gestionale: agenda, assenze, magazzino, offerte, utenti.
// Regole come app.js: si parla solo con /api/* (ctx.api), dati inseriti SOLO con
// textContent / creazione di nodi (mai innerHTML), nessun attributo style=.
// I permessi veri li controllano API e Row Level Security: qui si nasconde solo ciò che non serve.
// Il modulo non fa nulla da solo: app.js chiama MeekonGestionale.create(ctx).
(() => {
  'use strict';

  const STATI_OFFERTA = { bozza: 'Bozza', inviata: 'Inviata', accettata: 'Accettata', rifiutata: 'Rifiutata', scaduta: 'Scaduta' };
  // colori dei badge: si riusano quelli degli stati evento
  const BADGE_OFFERTA = { bozza: 'richiesta', inviata: 'offerta', accettata: 'confermato', rifiutata: 'annullato', scaduta: 'completato' };
  const GIORNI = ['Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato', 'Domenica'];
  const CONTATTI_DITTA = 'Meekon Displays · info@meekondisplay.ch · 079 945 00 00';

  function create(ctx) {
    const {
      h, add, clear, api, ApiError, errorMessage, page, toast, field, busy, select, check, loading, failure, empty,
      td, dl, badge, dash, fmtDate, fmtRange, fmtMoney, isoDate, addDays, telLink, mailLink, mapLink, markInvalid, panels,
      wide, state, isAdmin, isGestione, RUOLI, STATI,
    } = ctx;

    // ---------------------------------------------------------------- utilità
    // come el.append, ma salta null/undefined (el.append scriverebbe "null")
    const put = (el, ...kids) => add(el, kids);
    const giorno = (v) => (v ? String(v).slice(0, 10) : null);
    const ora = (v) => (v && String(v).length > 10 ? String(v).slice(11, 16) : '');
    const oggi = () => isoDate(new Date());
    const parseDate = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
    const lunedi = (d) => addDays(d, -((d.getDay() + 6) % 7));
    const nomeGiorno = (d) => `${GIORNI[(d.getDay() + 6) % 7]} ${d.getDate()}.${d.getMonth() + 1}.`;
    const chf = (n) => `CHF ${fmtMoney(n)}`;
    /** Numero da un campo: accetta "1'600.50", "1.600,50", "2,5". */
    function numero(raw) {
      let s = String(raw ?? '').replace(/['’\s]/g, '').replace(/^CHF/i, '');
      if (!s) return null;
      if (s.includes(',') && s.includes('.')) s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
      else if (s.includes(',')) s = s.replace(',', '.');
      else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
      const n = Number(s);
      return Number.isFinite(n) ? n : NaN;
    }
    const round2 = (n) => Math.round(n * 100) / 100;
    function badgeOfferta(stato) {
      return h('span', { class: `badge badge--${BADGE_OFFERTA[stato] || 'richiesta'}` }, STATI_OFFERTA[stato] || stato);
    }
    function alertBox(text, kind = 'error') {
      return h('p', { class: `alert alert--${kind}`, role: kind === 'error' ? 'alert' : 'status' }, text);
    }
    function tabella(head, rows) {
      return h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
        h('thead', null, h('tr', null, head.map((t) => h('th', { scope: 'col', class: /CHF|Q\.tà|Liberi|Fuori|Totale|Importo|Prezzo|Giorni|Sconto/.test(t) ? 'num' : null }, t)))),
        rows instanceof HTMLTableSectionElement ? rows : h('tbody', null, rows)));
    }
    /** Totali come nel database (vista offerte_totali + IVA, totale ai 5 centesimi). */
    function calcolaTotali(righe, scontoChf, ivaPct) {
      const subtotale = round2(righe.reduce((s, r) => s + round2((r.quantita || 0) * (r.giorni || 0) * (r.prezzo_unitario || 0) * (1 - (r.sconto_percento || 0) / 100)), 0));
      const imponibile = Math.max(round2(subtotale - (scontoChf || 0)), 0);
      const iva = Math.round(imponibile * (ivaPct || 0)) / 100;
      return { subtotale, sconto_chf: scontoChf || 0, imponibile, iva_percento: ivaPct || 0, iva, totale: Math.round((imponibile + iva) * 20) / 20 };
    }

    // ---------------------------------------------------------------- agenda
    async function viewAgenda([dataParam], alive) {
      loading();
      const base = state.me.ruolo === 'base';
      const start = base ? new Date() : lunedi(dataParam ? parseDate(dataParam) : new Date());
      const fine = base ? start : addDays(start, 6);
      const da = isoDate(start);
      const a = isoDate(fine);
      let eventi;
      let assenze;
      try {
        [eventi, assenze] = await Promise.all([api(`eventi?da=${da}&a=${a}`), api(`assenze?da=${da}&a=${a}`)]);
      } catch (err) { if (alive()) failure('Agenda', err); return; }
      if (!alive()) return;
      const lista = (eventi.eventi || []).filter((e) => e.stato !== 'annullato' && e.data_inizio);
      const ass = assenze.assenze || [];

      // per il ruolo base: dettagli (squadra, contatto sul posto, note) degli eventi di oggi
      const dettagli = new Map();
      if (base && lista.length) {
        try {
          const det = await Promise.all(lista.slice(0, 10).map((e) => api(`eventi/${encodeURIComponent(e.id)}`)));
          det.forEach((d) => { if (d.evento) dettagli.set(d.evento.id, d); });
        } catch (err) { /* si mostra comunque l'elenco */ }
        if (!alive()) return;
      }

      const giorni = [];
      for (let d = new Date(start); isoDate(d) <= a; d = addDays(d, 1)) giorni.push(new Date(d));
      const blocchi = giorni.map((d) => {
        const g = isoDate(d);
        const delGiorno = lista.filter((e) => giorno(e.data_inizio) <= g && (giorno(e.data_fine) || giorno(e.data_inizio)) >= g);
        const assenti = ass.filter((x) => x.dal <= g && x.al >= g);
        const titolo = h('h2', null, nomeGiorno(d), g === oggi() ? h('span', { class: 'badge badge--confermato' }, 'Oggi') : null);
        const cards = delGiorno.map((e) => cardEvento(e, dettagli.get(e.id)));
        return h('section', { class: `panel agenda__giorno${g === oggi() ? ' agenda__giorno--oggi' : ''}` },
          h('div', { class: 'panel__head' }, titolo),
          cards.length ? cards : h('p', { class: 'muted' }, 'Nessun evento.'),
          assenti.length ? h('p', { class: 'agenda__assenti' }, 'Assenti: ', assenti.map((x) => x.nome || 'io').join(', ')) : null);
      });

      const actions = [];
      if (!base) {
        actions.push(h('a', { class: 'btn btn--sm', href: `#/agenda/${isoDate(addDays(start, -7))}` }, '← Settimana prima'));
        actions.push(h('a', { class: 'btn btn--sm', href: '#/agenda' }, 'Oggi'));
        actions.push(h('a', { class: 'btn btn--sm', href: `#/agenda/${isoDate(addDays(start, 7))}` }, 'Settimana dopo →'));
        if (isGestione()) actions.push(h('a', { class: 'btn btn--primary btn--sm', href: '#/eventi/nuovo' }, 'Nuovo evento'));
      }
      page({
        title: base ? 'Agenda di oggi' : 'Agenda',
        sub: base ? fmtDate(da) : `Settimana dal ${fmtDate(da)} al ${fmtDate(a)}${isGestione() ? '' : ' · i vostri eventi'}`,
        actions,
      }, h('div', { class: 'agenda' }, blocchi),
      base && !lista.length ? empty('Oggi non siete assegnati a nessun evento.') : null);
    }

    function cardEvento(e, det) {
      const href = `#/evento/${encodeURIComponent(e.id)}`;
      const ev = det?.evento || e;
      const luogo = [ev.localita, ev.sala].filter(Boolean).join(' · ');
      const righe = [
        ['Orario', [ora(ev.data_inizio), ora(ev.data_fine)].filter(Boolean).join(' – ') || '—'],
        ['Luogo', luogo || '—'],
        ['Indirizzo', ev.indirizzo || ev.localita ? h('span', null, ev.indirizzo || '', ' ', mapLink(ev.indirizzo || ev.localita, ev.indirizzo ? ev.localita : null)) : '—'],
      ];
      if (det) {
        righe.push(['Contatto sul posto', ev.contatto_luogo_nome || ev.contatto_luogo_telefono ? h('span', null, ev.contatto_luogo_nome || '', ' ', telLink(ev.contatto_luogo_telefono)) : '—']);
        righe.push(['Cliente', ev.cliente_nome ? h('span', null, ev.cliente_nome, ' ', telLink(ev.cliente_telefono)) : '—']);
        righe.push(['Squadra', (det.staff || []).length ? h('span', null, det.staff.map((s, i) => [i ? ', ' : '', s.nome || '—', s.telefono ? [' ', telLink(s.telefono)] : ''])) : '—']);
        if (ev.note_squadra) righe.push(['Note per la squadra', ev.note_squadra]);
      }
      return h('article', { class: 'agenda__evento' },
        h('h3', null, h('a', { href }, ev.titolo || 'Evento'), ' ', badge(ev.stato, STATI)),
        dl(righe));
    }

    // ---------------------------------------------------------------- assenze
    async function viewAssenze(_, alive) {
      loading();
      const gestione = isGestione();
      let data;
      let staff = [];
      try {
        const da = isoDate(addDays(new Date(), -30));
        [data, staff] = await Promise.all([
          api(`assenze?da=${da}`),
          gestione ? api('staff').then((r) => (r.staff || []).filter((s) => s.attivo !== false)) : Promise.resolve([]),
        ]);
      } catch (err) { if (alive()) failure('Giorni di assenza', err); return; }
      if (!alive()) return;
      const lista = data.assenze || [];

      const tbody = h('tbody');
      const riga = (x) => {
        const del = h('button', { class: 'btn btn--ghost btn--sm', type: 'button' }, 'Elimina');
        const tr = h('tr', null,
          gestione ? td('Persona', dash(x.nome)) : null,
          td('Dal', fmtDate(x.dal)), td('Al', fmtDate(x.al)), td('Motivo', dash(x.motivo)),
          h('td', { 'data-label': '' }, del));
        del.addEventListener('click', () => busy(del, async () => {
          try { await api(`assenze/${encodeURIComponent(x.id)}`, { method: 'DELETE' }); tr.remove(); toast('Assenza eliminata.'); } catch (err) { toast(errorMessage(err), 'error'); }
        }));
        return tr;
      };
      lista.forEach((x) => tbody.append(riga(x)));
      const head = [...(gestione ? ['Persona'] : []), 'Dal', 'Al', 'Motivo', ''];
      const table = h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
        h('thead', null, h('tr', null, head.map((t) => h('th', { scope: 'col' }, t)))), tbody));

      const dal = h('input', { type: 'date', name: 'dal', required: true, value: oggi() });
      const al = h('input', { type: 'date', name: 'al', required: true, value: oggi() });
      const motivo = h('input', { type: 'text', name: 'motivo', maxlength: '200', placeholder: 'es. vacanza, altro lavoro (facoltativo)' });
      const chi = gestione ? select('staff_id', staff.map((s) => [s.id, s.nome]), state.me.id) : null;
      const save = h('button', { class: 'btn btn--primary', type: 'submit' }, 'Segna assenza');
      const form = h('form', { class: 'panel', novalidate: true },
        h('div', { class: 'panel__head' }, h('h2', null, 'Segna i giorni in cui non ci siete')),
        h('div', { class: 'fields' }, chi ? field('Persona', chi) : null, field('Dal', dal), field('Al (compreso)', al), field('Motivo', motivo, { full: true })),
        h('div', { class: 'panel__foot' }, save));
      form.addEventListener('submit', (ev) => {
        ev.preventDefault();
        if (!dal.value || !al.value || al.value < dal.value) { al.setAttribute('aria-invalid', 'true'); toast('Controllate le date: "al" non può essere prima di "dal".', 'error'); return; }
        al.removeAttribute('aria-invalid');
        busy(save, async () => {
          try {
            const res = await api('assenze', { method: 'POST', body: { dal: dal.value, al: al.value, motivo: motivo.value.trim() || null, ...(chi ? { staff_id: chi.value } : {}) } });
            if (res.assenza) tbody.prepend(riga(res.assenza));
            motivo.value = '';
            toast('Assenza segnata: l\'ufficio la vede quando assegna la squadra.');
          } catch (err) { markInvalid(form, err); toast(errorMessage(err), 'error'); }
        });
      });

      page({ title: 'Giorni di assenza', sub: gestione ? 'Le assenze di tutta la squadra' : 'I giorni in cui non siete disponibili' },
        form, h('section', { class: 'panel' }, h('div', { class: 'panel__head' }, h('h2', null, 'Assenze segnate')),
          lista.length ? table : h('p', { class: 'muted' }, 'Nessuna assenza segnata.')));
    }

    // ---------------------------------------------------------------- magazzino
    const filtroMag = { q: '', vendita: false, da: '', a: '' };

    async function viewMagazzino(_, alive) {
      loading();
      if (!filtroMag.da) { filtroMag.da = oggi(); filtroMag.a = oggi(); }
      let cat;
      let disp;
      try {
        [cat, disp] = await Promise.all([api('articoli'), api(`articoli/disponibilita?da=${filtroMag.da}&a=${filtroMag.a}`)]);
      } catch (err) { if (alive()) failure('Magazzino', err); return; }
      if (!alive()) return;
      const articoli = cat.articoli || [];
      const d = new Map((disp.disponibilita || []).map((x) => [x.articolo_id, x]));

      const q = h('input', { type: 'search', placeholder: 'Cerca articolo, marca, categoria', value: filtroMag.q, 'aria-label': 'Cerca' });
      const vendita = check('vendita', 'Solo materiale in vendita', filtroMag.vendita);
      const da = h('input', { type: 'date', value: filtroMag.da, 'aria-label': 'Disponibilità dal' });
      const a = h('input', { type: 'date', value: filtroMag.a, 'aria-label': 'Disponibilità al' });
      const tbody = h('tbody');
      const editor = h('div');

      const render = () => {
        clear(tbody);
        const testo = q.value.trim().toLowerCase();
        const soloVendita = vendita.querySelector('input').checked;
        const lista = articoli.filter((x) => (!soloVendita || x.in_vendita)
          && (!testo || `${x.categoria} ${x.marca || ''} ${x.descrizione}`.toLowerCase().includes(testo)));
        lista.forEach((x) => {
          const y = d.get(x.id);
          const tr = h('tr', { class: 'is-link' },
            td('Categoria', x.categoria),
            h('td', { 'data-label': 'Articolo', class: 'table__primary' }, h('span', null, x.descrizione,
              h('span', { class: 'table__sub' }, [x.marca, x.in_vendita ? 'in vendita' : null, x.note].filter(Boolean).join(' · ')))),
            h('td', { 'data-label': 'Q.tà', class: 'num' }, h('span', null, x.quantita)),
            h('td', { 'data-label': 'Liberi', class: 'num' }, h('span', { class: y && y.disponibili < 0 ? 'text-danger' : null }, y ? y.disponibili : x.quantita)),
            h('td', { 'data-label': 'Fuori', class: 'num' }, h('span', null, y ? y.fuori : 0)),
            h('td', { 'data-label': 'Noleggio CHF/giorno', class: 'num' }, h('span', null, x.prezzo_noleggio_giorno == null ? '—' : fmtMoney(x.prezzo_noleggio_giorno))),
            h('td', { 'data-label': 'Vendita CHF', class: 'num' }, h('span', null, x.prezzo_vendita == null ? '—' : fmtMoney(x.prezzo_vendita))));
          tr.addEventListener('click', () => apriEditor(x));
          tbody.append(tr);
        });
        conta.textContent = `${lista.length} di ${articoli.length} articoli`;
      };
      const conta = h('span', { class: 'muted' });
      q.addEventListener('input', () => { filtroMag.q = q.value; render(); });
      vendita.querySelector('input').addEventListener('change', (ev) => { filtroMag.vendita = ev.target.checked; render(); });
      const aggiornaDate = () => {
        if (!da.value) return;
        filtroMag.da = da.value;
        filtroMag.a = a.value && a.value >= da.value ? a.value : da.value;
        viewMagazzino([], alive);
      };
      da.addEventListener('change', aggiornaDate);
      a.addEventListener('change', aggiornaDate);

      function apriEditor(x) {
        clear(editor);
        editor.append(formArticolo(x, (salvato, eliminato) => {
          const i = articoli.findIndex((y) => y.id === (salvato || x || {}).id);
          if (eliminato || (salvato && !salvato.attivo)) { if (i >= 0) articoli.splice(i, 1); } else if (salvato) { if (i >= 0) articoli[i] = salvato; else articoli.push(salvato); }
          clear(editor);
          render();
        }, () => clear(editor)));
        editor.scrollIntoView({ block: 'start' });
      }

      render();
      page({
        title: 'Magazzino',
        sub: 'Catalogo del materiale, disponibilità e materiale in vendita (prezzi esclusa IVA)',
        actions: [
          h('a', { class: 'btn', href: '#/magazzino/importa' }, 'Importa una lista'),
          h('button', { class: 'btn btn--primary', type: 'button', onclick: () => apriEditor(null) }, 'Nuovo articolo'),
        ],
      },
      editor,
      h('section', { class: 'panel' },
        h('div', { class: 'toolbar' }, q, vendita, h('span', null, 'Disponibilità dal '), da, h('span', null, ' al '), a, conta),
        articoli.length
          ? tabella(['Categoria', 'Articolo', 'Q.tà', 'Liberi', 'Fuori', 'Noleggio CHF/giorno', 'Vendita CHF'], tbody)
          : empty('Il catalogo è vuoto', 'Aggiungete gli articoli uno alla volta o importate una lista da Excel.')));
    }

    function formArticolo(x, onDone, onCancel) {
      const v = x || {};
      const inp = (name, attrs = {}) => h('input', { name, type: 'text', ...attrs });
      const f = {
        categoria: inp('categoria', { maxlength: '60', required: true, value: v.categoria || '', list: 'mk-categorie' }),
        marca: inp('marca', { maxlength: '80', value: v.marca || '' }),
        descrizione: inp('descrizione', { maxlength: '300', required: true, value: v.descrizione || '' }),
        quantita: inp('quantita', { type: 'number', min: '0', max: '100000', inputmode: 'numeric', value: v.quantita ?? 0 }),
        prezzo_noleggio_giorno: inp('prezzo_noleggio_giorno', { inputmode: 'decimal', value: v.prezzo_noleggio_giorno ?? '', placeholder: '0.00' }),
        prezzo_vendita: inp('prezzo_vendita', { inputmode: 'decimal', value: v.prezzo_vendita ?? '', placeholder: '0.00' }),
        accessori: h('textarea', { name: 'accessori', rows: '2', maxlength: '1000' }),
        note: h('textarea', { name: 'note', rows: '2', maxlength: '1000' }),
      };
      f.accessori.value = v.accessori || '';
      f.note.value = v.note || '';
      const inVendita = check('in_vendita', 'In vendita (materiale usato)', !!v.in_vendita);
      const alert = h('div');
      const save = h('button', { class: 'btn btn--primary', type: 'submit' }, x ? 'Salva' : 'Aggiungi al catalogo');
      const foot = h('div', { class: 'panel__foot' }, h('button', { class: 'btn', type: 'button', onclick: onCancel }, 'Annulla'));
      if (x) {
        const off = h('button', { class: 'btn', type: 'button' }, 'Togli dal catalogo');
        off.addEventListener('click', () => {
          if (!window.confirm(`Togliere "${v.descrizione}" dal catalogo? Resta collegato alle offerte e agli eventi passati.`)) return;
          busy(off, async () => {
            try { const r = await api(`articoli/${encodeURIComponent(v.id)}`, { method: 'PATCH', body: { attivo: false } }); toast('Articolo tolto dal catalogo.'); onDone(r.articolo); } catch (err) { toast(errorMessage(err), 'error'); }
          });
        });
        foot.append(off);
        if (isAdmin()) {
          const del = h('button', { class: 'btn btn--danger', type: 'button' }, 'Elimina');
          del.addEventListener('click', () => {
            if (!window.confirm(`Eliminare definitivamente "${v.descrizione}"? Le righe collegate restano ma senza collegamento.`)) return;
            busy(del, async () => {
              try { await api(`articoli/${encodeURIComponent(v.id)}`, { method: 'DELETE' }); toast('Articolo eliminato.'); onDone(null, true); } catch (err) { toast(errorMessage(err), 'error'); }
            });
          });
          foot.append(del);
        }
      }
      foot.append(save);
      const form = h('form', { class: 'panel', novalidate: true },
        h('div', { class: 'panel__head' }, h('h2', null, x ? 'Modifica articolo' : 'Nuovo articolo')),
        alert,
        h('div', { class: 'fields' },
          field('Categoria *', f.categoria, { hint: 'es. Audio, Licht, Rigging, Video, LED Wand' }),
          field('Marca', f.marca),
          field('Descrizione *', f.descrizione, { full: true }),
          field('Quantità in magazzino', f.quantita),
          field('Noleggio CHF al giorno', f.prezzo_noleggio_giorno),
          field('Prezzo di vendita CHF', f.prezzo_vendita),
          h('div', { class: 'field' }, inVendita),
          field('Accessori inclusi', f.accessori, { full: true }),
          field('Note (stato, difetti…)', f.note, { full: true })),
        foot);
      form.addEventListener('submit', (ev) => {
        ev.preventDefault();
        clear(alert);
        const body = {
          categoria: f.categoria.value.trim(),
          marca: f.marca.value.trim() || null,
          descrizione: f.descrizione.value.trim(),
          quantita: f.quantita.value === '' ? 0 : Number(f.quantita.value),
          prezzo_noleggio_giorno: numero(f.prezzo_noleggio_giorno.value),
          prezzo_vendita: numero(f.prezzo_vendita.value),
          in_vendita: inVendita.querySelector('input').checked,
          accessori: f.accessori.value.trim() || null,
          note: f.note.value.trim() || null,
        };
        if (!body.categoria || !body.descrizione) { alert.append(alertBox('Categoria e descrizione sono obbligatorie.')); return; }
        if (Number.isNaN(body.prezzo_noleggio_giorno) || Number.isNaN(body.prezzo_vendita)) { alert.append(alertBox('Controllate i prezzi: usate solo numeri, es. 1600.00')); return; }
        busy(save, async () => {
          try {
            const r = await api(x ? `articoli/${encodeURIComponent(v.id)}` : 'articoli', { method: x ? 'PATCH' : 'POST', body });
            toast(x ? 'Articolo salvato.' : 'Articolo aggiunto.');
            onDone(r.articolo);
          } catch (err) { markInvalid(form, err); alert.append(alertBox(errorMessage(err))); }
        });
      });
      return form;
    }

    // ---------------------------------------------------------------- importazione da Excel
    /** Divide il testo copiato da Excel (tabulazioni, celle tra virgolette anche su più righe). */
    function parseTsv(text) {
      const rows = [];
      let row = [];
      let cell = '';
      let quoted = false;
      for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (quoted) {
          if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') quoted = false; else cell += c;
        } else if (c === '"' && cell === '') quoted = true;
        else if (c === '\t') { row.push(cell); cell = ''; } else if (c === '\n' || c === '\r') {
          if (c === '\r' && text[i + 1] === '\n') i++;
          row.push(cell); rows.push(row); row = []; cell = '';
        } else cell += c;
      }
      if (cell || row.length) { row.push(cell); rows.push(row); }
      return rows.map((r) => r.map((x) => x.trim()));
    }
    const COLONNE = {
      categoria: /^(kategorie|categoria|category|catégorie)$/i,
      marca: /^(marke|marca|brand|marque|hersteller)$/i,
      descrizione: /^(bezeichnung|descrizione|articolo|description|artikel|désignation)$/i,
      quantita: /^(anzahl|quantit[aà]|q\.?t[aà]|menge|stk|pezzi|quantité)$/i,
      prezzo: /^(preis|prezzo|price|prix)/i,
      accessori: /^(zubeh[oö]r|accessori|accessoires)$/i,
      note: /^(bemerkung|note|osservazioni|remarque|zustand)$/i,
    };
    function righeImport(rows) {
      const iHead = rows.findIndex((r) => r.some((c) => COLONNE.descrizione.test(c)));
      if (iHead < 0) return { errore: 'Non trovo la riga di intestazione: serve almeno una colonna "Bezeichnung" o "Descrizione".' };
      const idx = {};
      rows[iHead].forEach((c, i) => { for (const [k, re] of Object.entries(COLONNE)) if (idx[k] === undefined && re.test(c)) idx[k] = i; });
      const out = [];
      const scartate = [];
      rows.slice(iHead + 1).forEach((r, n) => {
        const get = (k) => (idx[k] === undefined ? '' : (r[idx[k]] || '').replace(/\s+/g, ' ').trim());
        const descrizione = get('descrizione');
        if (!descrizione) {
          const testo = r.join(' ').trim();
          if (testo) scartate.push(testo);
          return;
        }
        const q = numero(get('quantita'));
        const p = numero(get('prezzo'));
        out.push({
          riga: iHead + n + 2,
          categoria: (get('categoria') || 'Varie').slice(0, 60),
          marca: get('marca').slice(0, 80) || null,
          descrizione: descrizione.slice(0, 300),
          quantita: Number.isInteger(q) && q >= 0 ? q : 0,
          prezzo: Number.isFinite(p) && p >= 0 ? round2(p) : null,
          accessori: (idx.accessori === undefined ? '' : (r[idx.accessori] || '').trim()).slice(0, 1000) || null,
          note: get('note').slice(0, 1000) || null,
        });
      });
      return { righe: out, scartate };
    }

    function viewImporta() {
      const area = h('textarea', { rows: '12', 'aria-label': 'Lista da importare', placeholder: 'Selezionate la tabella in Excel (con la riga delle intestazioni), copiatela e incollatela qui.' });
      const tipoPrezzo = select('tipo_prezzo', [['vendita', 'Prezzo di vendita (materiale in vendita)'], ['noleggio', 'Prezzo di noleggio al giorno']], 'vendita');
      const anteprima = h('div');
      const importa = h('button', { class: 'btn btn--primary', type: 'button', disabled: true }, 'Importa nel catalogo');
      let pronte = [];

      const aggiorna = () => {
        clear(anteprima);
        importa.disabled = true;
        pronte = [];
        if (!area.value.trim()) return;
        const res = righeImport(parseTsv(area.value));
        if (res.errore) { put(anteprima, alertBox(res.errore)); return; }
        pronte = res.righe;
        const vendita = tipoPrezzo.value === 'vendita';
        put(anteprima, 
          alertBox(`${pronte.length} articoli pronti da importare${res.scartate.length ? `, ${res.scartate.length} righe senza descrizione saltate (es. note a piè di pagina)` : ''}.`, 'info'),
          tabella(['Riga', 'Categoria', 'Marca', 'Descrizione', 'Q.tà', vendita ? 'Vendita CHF' : 'Noleggio CHF/giorno', 'Accessori', 'Note'],
            pronte.slice(0, 300).map((r) => h('tr', null, td('Riga', r.riga), td('Categoria', r.categoria), td('Marca', dash(r.marca)),
              h('td', { 'data-label': 'Descrizione', class: 'table__primary' }, h('span', null, r.descrizione)),
              h('td', { class: 'num', 'data-label': 'Q.tà' }, h('span', null, r.quantita)),
              h('td', { class: 'num', 'data-label': 'Prezzo' }, h('span', null, r.prezzo == null ? '—' : fmtMoney(r.prezzo))),
              td('Accessori', dash(r.accessori)), td('Note', dash(r.note))))),
          pronte.length > 300 ? h('p', { class: 'muted' }, `… e altri ${pronte.length - 300}.`) : null);
        importa.disabled = !pronte.length;
      };
      area.addEventListener('input', aggiorna);
      tipoPrezzo.addEventListener('change', aggiorna);

      importa.addEventListener('click', () => {
        const vendita = tipoPrezzo.value === 'vendita';
        if (!window.confirm(`Aggiungere ${pronte.length} articoli al catalogo?`)) return;
        busy(importa, async () => {
          const articoli = pronte.map((r) => ({
            categoria: r.categoria, marca: r.marca, descrizione: r.descrizione, quantita: r.quantita,
            accessori: r.accessori, note: r.note, in_vendita: vendita,
            ...(vendita ? { prezzo_vendita: r.prezzo } : { prezzo_noleggio_giorno: r.prezzo }),
          }));
          let fatti = 0;
          try {
            for (let i = 0; i < articoli.length; i += 500) {
              const r = await api('articoli/importa', { method: 'POST', body: { articoli: articoli.slice(i, i + 500) } });
              fatti += r.importati || 0;
            }
            toast(`${fatti} articoli importati.`);
            window.location.hash = '#/magazzino';
          } catch (err) {
            const riga = err instanceof ApiError && err.data && err.data.riga ? pronte[(err.data.riga - 1) + Math.floor(fatti / 500) * 500] : null;
            toast(riga ? `Riga ${riga.riga} non valida (${err.data.field || 'dato'}). Nessun articolo di quel blocco è stato importato.` : errorMessage(err), 'error');
          }
        });
      });

      page({ title: 'Importa una lista', sub: 'Da Excel al catalogo del magazzino', back: ['#/magazzino', 'Magazzino'] },
        h('section', { class: 'panel' },
          h('p', null, 'Colonne riconosciute (tedesco o italiano): Kategorie/Categoria, Marke/Marca, Bezeichnung/Descrizione, Anzahl/Quantità, Preis/Prezzo, Zubehör/Accessori, Bemerkung/Note. Le altre colonne vengono ignorate. I prezzi si intendono esclusa IVA.'),
          h('div', { class: 'fields' }, field('Lista copiata da Excel', area, { full: true }), field('La colonna del prezzo è', tipoPrezzo)),
          anteprima,
          h('div', { class: 'panel__foot' }, h('a', { class: 'btn', href: '#/magazzino' }, 'Annulla'), importa)));
    }

    // ---------------------------------------------------------------- offerte
    function offertePanel(e) {
      const panel = h('section', { class: 'panel' });
      const nuova = h('button', { class: 'btn btn--sm btn--primary', type: 'button' }, 'Nuova offerta');
      panel.append(h('div', { class: 'panel__head' }, h('h2', null, 'Offerte'), nuova), h('p', { class: 'muted' }, 'Caricamento…'));
      let ultime = [];
      nuova.addEventListener('click', () => busy(nuova, async () => {
        try {
          const copia = ultime[0] ? ultime[0].id : null;
          const r = await api('offerte', { method: 'POST', body: { evento_id: e.id, ...(copia ? { copia_da: copia } : {}) } });
          toast(copia ? 'Nuova versione creata partendo dalla precedente.' : 'Offerta creata.');
          window.location.hash = `#/offerta/${encodeURIComponent(r.id)}`;
        } catch (err) { toast(errorMessage(err), 'error'); }
      }));
      api(`offerte?evento=${encodeURIComponent(e.id)}`).then((r) => {
        ultime = r.offerte || [];
        panel.lastChild.remove();
        if (!ultime.length) { panel.append(h('p', { class: 'muted' }, 'Nessuna offerta. Create la prima: potete scegliere gli articoli dal magazzino.')); return; }
        panel.append(tabella(['Versione', 'Stato', 'Valida fino', 'Totale CHF', ''], ultime.map((o) => h('tr', null,
          td('Versione', `N. ${e.numero_ordine || ''}/${o.versione}`), td('Stato', badgeOfferta(o.stato)), td('Valida fino', fmtDate(o.valida_fino)),
          h('td', { class: 'num', 'data-label': 'Totale CHF' }, h('span', null, fmtMoney(o.totali.totale))),
          h('td', { 'data-label': '' }, h('a', { class: 'btn btn--sm', href: `#/offerta/${encodeURIComponent(o.id)}` }, o.stato === 'bozza' ? 'Modifica' : 'Apri'))))));
      }).catch((err) => { panel.lastChild.textContent = errorMessage(err); });
      return panel;
    }

    async function viewOfferta([id], alive) {
      loading();
      let data;
      let catalogo = [];
      try {
        data = await api(`offerte/${encodeURIComponent(id)}`);
        if (data.offerta.stato === 'bozza') catalogo = (await api('articoli')).articoli || [];
      } catch (err) { if (alive()) failure('Offerta', err); return; }
      if (!alive()) return;
      const o = data.offerta;
      const ev = data.evento || {};
      const cli = ev.cliente || {};
      const bozza = o.stato === 'bozza';
      const numeroOfferta = `${ev.numero_ordine || ''}/${o.versione}`;
      const giorniEvento = ev.data_inizio
        ? Math.max(1, Math.round((parseDate(giorno(ev.data_fine) || giorno(ev.data_inizio)) - parseDate(giorno(ev.data_inizio))) / 86400000) + 1)
        : 1;
      const righe = (data.righe || []).map((r) => ({
        articolo_id: r.articolo_id, descrizione: r.descrizione, quantita: Number(r.quantita), giorni: Number(r.giorni),
        prezzo_unitario: Number(r.prezzo_unitario), sconto_percento: Number(r.sconto_percento),
      }));

      // campi dell'offerta
      const valida = h('input', { type: 'date', value: o.valida_fino || '', disabled: !bozza });
      const iva = h('input', { inputmode: 'decimal', value: String(o.iva_percento ?? 8.1), disabled: !bozza });
      const sconto = h('input', { inputmode: 'decimal', value: String(o.sconto_chf ?? 0), disabled: !bozza });
      const intro = h('textarea', { rows: '3', maxlength: '4000', disabled: !bozza });
      intro.value = o.introduzione || (cli.nome ? `Gentile ${cli.nome},\ngrazie per la vostra richiesta. Di seguito trovate la nostra offerta per "${ev.titolo || 'il vostro evento'}".` : '');
      const cond = h('textarea', { rows: '3', maxlength: '4000', disabled: !bozza, placeholder: 'es. modalità di pagamento, acconto, orari di montaggio' });
      cond.value = o.condizioni || '';

      const tbody = h('tbody');
      const totBox = h('div', { class: 'offerta__totali' });
      const totali = () => calcolaTotali(righe, numero(sconto.value) || 0, numero(iva.value) || 0);
      const disegnaTotali = () => {
        const t = totali();
        clear(totBox);
        totBox.append(dl([
          ['Subtotale', chf(t.subtotale)],
          t.sconto_chf ? ['Sconto', `– ${chf(t.sconto_chf)}`] : undefined,
          ['Imponibile', chf(t.imponibile)],
          [`IVA ${t.iva_percento}%`, chf(t.iva)],
          ['Totale', h('strong', null, chf(t.totale))],
        ].filter(Boolean)));
      };
      const disegnaRighe = () => {
        clear(tbody);
        righe.forEach((r, i) => {
          const importo = h('span', null, fmtMoney(round2(r.quantita * r.giorni * r.prezzo_unitario * (1 - r.sconto_percento / 100))));
          const num = (k, attrs = {}) => {
            const el = h('input', { inputmode: 'decimal', value: String(r[k]), class: 'input--num', disabled: !bozza, 'aria-label': `${k} riga ${i + 1}`, ...attrs });
            el.addEventListener('input', () => {
              const n = numero(el.value);
              if (Number.isFinite(n)) { r[k] = n; el.removeAttribute('aria-invalid'); } else el.setAttribute('aria-invalid', 'true');
              importo.textContent = fmtMoney(round2(r.quantita * r.giorni * r.prezzo_unitario * (1 - r.sconto_percento / 100)));
              disegnaTotali();
            });
            return el;
          };
          const desc = h('textarea', { rows: '1', maxlength: '500', disabled: !bozza, 'aria-label': `Descrizione riga ${i + 1}` });
          desc.value = r.descrizione;
          desc.addEventListener('input', () => { r.descrizione = desc.value; });
          const azioni = bozza ? h('td', { 'data-label': '' },
            h('button', { class: 'btn btn--ghost btn--sm', type: 'button', 'aria-label': `Sposta su riga ${i + 1}`, disabled: i === 0, onclick: () => { righe.splice(i - 1, 0, righe.splice(i, 1)[0]); disegnaRighe(); } }, '↑'),
            h('button', { class: 'btn btn--ghost btn--sm', type: 'button', 'aria-label': `Togli riga ${i + 1}`, onclick: () => { righe.splice(i, 1); disegnaRighe(); disegnaTotali(); } }, '×')) : null;
          tbody.append(h('tr', null,
            h('td', { 'data-label': 'Descrizione', class: 'table__primary' }, desc),
            h('td', { 'data-label': 'Q.tà', class: 'num' }, num('quantita')),
            h('td', { 'data-label': 'Giorni', class: 'num' }, num('giorni')),
            h('td', { 'data-label': 'Prezzo CHF', class: 'num' }, num('prezzo_unitario')),
            h('td', { 'data-label': 'Sconto %', class: 'num' }, num('sconto_percento')),
            h('td', { 'data-label': 'Importo CHF', class: 'num' }, importo),
            azioni));
        });
        if (!righe.length) tbody.append(h('tr', null, h('td', { colspan: '7' }, h('span', { class: 'muted' }, 'Nessuna riga: aggiungete articoli dal magazzino o righe libere.'))));
      };
      [iva, sconto].forEach((el) => el.addEventListener('input', disegnaTotali));

      // aggiunta righe
      let aggiungi = null;
      if (bozza) {
        const scelta = h('select', { 'aria-label': 'Articolo dal magazzino' }, h('option', { value: '' }, '— Scegliete un articolo —'),
          catalogo.map((a) => h('option', { value: a.id }, `${a.categoria} · ${a.descrizione}${a.prezzo_noleggio_giorno != null ? ` — ${fmtMoney(a.prezzo_noleggio_giorno)}/giorno` : ''}${a.in_vendita && a.prezzo_vendita != null ? ` — vendita ${fmtMoney(a.prezzo_vendita)}` : ''}`)));
        const comeVendita = check('vendita', 'Come vendita (prezzo di vendita, 1 giorno)', false);
        const addArt = h('button', { class: 'btn', type: 'button' }, 'Aggiungi articolo');
        addArt.addEventListener('click', () => {
          const a = catalogo.find((x) => x.id === scelta.value);
          if (!a) { scelta.focus(); return; }
          const vendita = comeVendita.querySelector('input').checked;
          righe.push({
            articolo_id: a.id,
            descrizione: [a.marca && !a.descrizione.includes(a.marca) ? a.marca : null, a.descrizione].filter(Boolean).join(' ').slice(0, 500),
            quantita: 1,
            giorni: vendita ? 1 : giorniEvento,
            prezzo_unitario: Number(vendita ? a.prezzo_vendita : a.prezzo_noleggio_giorno) || 0,
            sconto_percento: 0,
          });
          scelta.value = '';
          disegnaRighe(); disegnaTotali();
        });
        const addFree = h('button', { class: 'btn', type: 'button', onclick: () => { righe.push({ articolo_id: null, descrizione: '', quantita: 1, giorni: 1, prezzo_unitario: 0, sconto_percento: 0 }); disegnaRighe(); disegnaTotali(); tbody.querySelector('tr:last-child textarea')?.focus(); } }, 'Riga libera (es. montaggio, trasporto)');
        aggiungi = h('div', { class: 'toolbar' }, scelta, comeVendita, addArt, addFree);
      }

      // azioni
      const alert = h('div');
      const salva = async () => {
        clear(alert);
        const errata = righe.findIndex((r) => !r.descrizione.trim() || !(r.quantita > 0) || !(r.giorni > 0) || !(r.prezzo_unitario >= 0) || !(r.sconto_percento >= 0 && r.sconto_percento <= 100));
        if (errata >= 0) { alert.append(alertBox(`Controllate la riga ${errata + 1}: descrizione obbligatoria, quantità e giorni maggiori di zero.`)); return false; }
        const ivaN = numero(iva.value);
        const scN = numero(sconto.value);
        if (!Number.isFinite(ivaN) || !Number.isFinite(scN ?? 0)) { alert.append(alertBox('Controllate IVA e sconto: solo numeri.')); return false; }
        await api(`offerte/${encodeURIComponent(o.id)}`, { method: 'PATCH', body: {
          valida_fino: valida.value || null, iva_percento: ivaN, sconto_chf: scN || 0,
          introduzione: intro.value.trim() || null, condizioni: cond.value.trim() || null,
        } });
        await api(`offerte/${encodeURIComponent(o.id)}/righe`, { method: 'PUT', body: { righe: righe.map((r) => ({ ...r, descrizione: r.descrizione.trim() })) } });
        return true;
      };
      const actions = [];
      const btnStampa = h('button', { class: 'btn', type: 'button' }, 'PDF / Stampa');
      btnStampa.addEventListener('click', () => busy(btnStampa, async () => {
        try {
          if (bozza && !(await salva())) return;
          stampa();
        } catch (err) { alert.append(alertBox(errorMessage(err))); }
      }));
      actions.push(btnStampa);
      const cambiaStato = (stato, conferma, msg) => {
        const b = h('button', { class: `btn${stato === 'accettata' ? ' btn--primary' : ''}`, type: 'button' }, conferma);
        b.addEventListener('click', () => {
          if (stato === 'accettata' && !window.confirm("Segnare l'offerta come accettata? L'evento diventa confermato e il suo importo si aggiorna con il totale dell'offerta.")) return;
          busy(b, async () => {
            try {
              if (bozza && !(await salva())) return;
              await api(`offerte/${encodeURIComponent(o.id)}`, { method: 'PATCH', body: { stato } });
              toast(msg);
              viewOfferta([id], alive);
            } catch (err) { alert.append(alertBox(errorMessage(err))); }
          });
        });
        return b;
      };
      if (bozza) {
        const save = h('button', { class: 'btn btn--primary', type: 'button' }, 'Salva bozza');
        save.addEventListener('click', () => busy(save, async () => {
          try { if (await salva()) toast('Offerta salvata.'); } catch (err) { alert.append(alertBox(errorMessage(err))); }
        }));
        actions.push(cambiaStato('inviata', 'Segna come inviata', 'Offerta segnata come inviata: non si modifica più. Per cambiarla create una nuova versione.'), save);
      }
      if (o.stato === 'inviata') {
        actions.push(cambiaStato('rifiutata', 'Rifiutata', 'Offerta segnata come rifiutata.'), cambiaStato('accettata', 'Accettata dal cliente', 'Offerta accettata: evento confermato.'));
      }
      if (!bozza) {
        const nv = h('button', { class: 'btn', type: 'button' }, 'Nuova versione');
        nv.addEventListener('click', () => busy(nv, async () => {
          try {
            const r = await api('offerte', { method: 'POST', body: { evento_id: o.evento_id, copia_da: o.id } });
            window.location.hash = `#/offerta/${encodeURIComponent(r.id)}`;
          } catch (err) { toast(errorMessage(err), 'error'); }
        }));
        actions.push(nv);
      } else {
        const del = h('button', { class: 'btn btn--danger', type: 'button' }, 'Elimina bozza');
        del.addEventListener('click', () => {
          if (!window.confirm('Eliminare questa bozza di offerta?')) return;
          busy(del, async () => {
            try { await api(`offerte/${encodeURIComponent(o.id)}`, { method: 'DELETE' }); toast('Bozza eliminata.'); window.location.hash = `#/evento/${encodeURIComponent(o.evento_id)}`; } catch (err) { toast(errorMessage(err), 'error'); }
          });
        });
        actions.unshift(del);
      }

      // documento da stampare (nascosto a schermo, visibile solo in stampa)
      const doc = h('section', { class: 'stampa', 'aria-hidden': 'true' });
      function stampa() {
        const t = totali();
        clear(doc);
        put(doc, 
          h('header', { class: 'stampa__head' },
            h('img', { src: '/assets/img/logo.png', alt: 'Meekon Displays', class: 'stampa__logo', width: '595', height: '246' }),
            h('div', { class: 'stampa__cliente' },
              [cli.azienda, cli.nome, cli.email, cli.telefono].filter(Boolean).map((x) => h('div', null, x)))),
          h('h1', null, `Offerta N. ${numeroOfferta}`),
          dl([
            ['Data', fmtDate(oggi())],
            ['Evento', ev.titolo || '—'],
            ['Quando', fmtRange(ev.data_inizio, ev.data_fine)],
            ['Dove', [ev.sala, ev.localita, ev.indirizzo].filter(Boolean).join(', ') || '—'],
            valida.value ? ['Valida fino al', fmtDate(valida.value)] : undefined,
          ].filter(Boolean)),
          intro.value.trim() ? h('p', { class: 'stampa__testo' }, intro.value.trim()) : null,
          h('table', { class: 'stampa__righe' },
            h('thead', null, h('tr', null, ['Pos.', 'Descrizione', 'Q.tà', 'Giorni', 'Prezzo CHF', 'Sconto', 'Importo CHF'].map((x) => h('th', null, x)))),
            h('tbody', null, righe.map((r, i) => h('tr', null,
              h('td', null, i + 1), h('td', null, r.descrizione), h('td', { class: 'num' }, r.quantita), h('td', { class: 'num' }, r.giorni),
              h('td', { class: 'num' }, fmtMoney(r.prezzo_unitario)), h('td', { class: 'num' }, r.sconto_percento ? `${r.sconto_percento}%` : ''),
              h('td', { class: 'num' }, fmtMoney(round2(r.quantita * r.giorni * r.prezzo_unitario * (1 - r.sconto_percento / 100)))))))),
          h('table', { class: 'stampa__totali' }, h('tbody', null,
            [['Subtotale', t.subtotale], t.sconto_chf ? ['Sconto', -t.sconto_chf] : null, ['Imponibile', t.imponibile], [`IVA ${t.iva_percento}%`, t.iva], ['Totale CHF', t.totale]]
              .filter(Boolean).map(([k, v], i, arr) => h('tr', { class: i === arr.length - 1 ? 'stampa__totale' : null }, h('th', null, k), h('td', { class: 'num' }, fmtMoney(v)))))),
          cond.value.trim() ? h('div', { class: 'stampa__testo' }, h('h2', null, 'Condizioni'), h('p', null, cond.value.trim())) : null,
          h('footer', { class: 'stampa__piede' }, CONTATTI_DITTA));
        const titolo = document.title;
        document.title = `Offerta ${numeroOfferta} ${cli.azienda || cli.nome || ''}`.trim();
        window.print();
        document.title = titolo;
      }

      disegnaRighe();
      disegnaTotali();
      page({
        title: `Offerta N. ${numeroOfferta}`,
        sub: h('span', null, badgeOfferta(o.stato), ` · ${ev.titolo || ''}${o.inviata_il ? ` · inviata il ${fmtDate(giorno(o.inviata_il))}` : ''}`),
        actions,
        back: [`#/evento/${encodeURIComponent(o.evento_id)}`, 'Evento'],
      },
      alert,
      bozza ? null : alertBox(o.stato === 'accettata' ? "Offerta accettata: l'evento è confermato." : 'Questa offerta non si modifica più. Per cambiarla create una nuova versione.', 'info'),
      panels(
        h('section', { class: 'panel' }, h('div', { class: 'panel__head' }, h('h2', null, 'Cliente')),
          dl([['Nome', dash(cli.nome)], ['Azienda', dash(cli.azienda)], ['E-mail', mailLink(cli.email)], ['Telefono', telLink(cli.telefono)]])),
        h('section', { class: 'panel' }, h('div', { class: 'panel__head' }, h('h2', null, 'Evento')),
          dl([['Quando', fmtRange(ev.data_inizio, ev.data_fine)], ['Dove', [ev.sala, ev.localita].filter(Boolean).join(', ') || '—'], ['Ospiti', dash(ev.ospiti)]])),
        wide(h('section', { class: 'panel' },
          h('div', { class: 'panel__head' }, h('h2', null, 'Righe')),
          h('div', { class: 'table-wrap' }, h('table', { class: 'table offerta__righe' },
            h('thead', null, h('tr', null, ['Descrizione', 'Q.tà', 'Giorni', 'Prezzo CHF', 'Sconto %', 'Importo CHF', ''].map((x, i) => h('th', { scope: 'col', class: i && i < 6 ? 'num' : null }, x)))),
            tbody)),
          aggiungi,
          totBox)),
        wide(h('section', { class: 'panel' },
          h('div', { class: 'fields' },
            field('Testo iniziale', intro, { full: true }),
            field('Condizioni', cond, { full: true }),
            field('Valida fino al', valida),
            field('IVA %', iva, { hint: '8,1 % per tutti i clienti.' }),
            field('Sconto sul totale (CHF)', sconto))))),
      doc);
    }

    // ---------------------------------------------------------------- utenti e ruoli
    async function viewUtenti(_, alive) {
      loading();
      let lista;
      try { lista = (await api('staff')).staff || []; } catch (err) { if (alive()) failure('Utenti e ruoli', err); return; }
      if (!alive()) return;
      const righe = lista.map((s) => {
        const ruolo = select('ruolo', Object.entries(RUOLI), s.ruolo);
        const attivo = h('input', { type: 'checkbox', checked: s.attivo !== false, 'aria-label': `Attivo: ${s.nome}` });
        const tel = h('input', { type: 'tel', maxlength: '40', value: s.telefono || '', 'aria-label': `Telefono di ${s.nome}` });
        const save = h('button', { class: 'btn btn--sm', type: 'button' }, 'Salva');
        const io = s.id === state.me.id;
        if (io) { ruolo.disabled = true; attivo.disabled = true; }
        save.addEventListener('click', () => busy(save, async () => {
          try {
            const body = { telefono: tel.value.trim() || null, ...(io ? {} : { ruolo: ruolo.value, attivo: attivo.checked }) };
            await api(`staff/${encodeURIComponent(s.id)}`, { method: 'PATCH', body });
            toast(`${s.nome}: salvato.`);
          } catch (err) {
            toast(err instanceof ApiError && err.status === 409 ? 'Serve sempre almeno un amministratore attivo.' : errorMessage(err), 'error');
          }
        }));
        return h('tr', null,
          h('td', { 'data-label': 'Nome', class: 'table__primary' }, h('span', null, s.nome, io ? h('span', { class: 'table__sub' }, 'siete voi') : null)),
          h('td', { 'data-label': 'Ruolo' }, ruolo),
          h('td', { 'data-label': 'Attivo' }, h('label', { class: 'check' }, attivo, h('span', null, 'Attivo'))),
          h('td', { 'data-label': 'Telefono' }, tel),
          h('td', { 'data-label': '' }, save));
      });
      page({ title: 'Utenti e ruoli', sub: 'Chi può fare cosa nel gestionale' },
        h('section', { class: 'panel' }, tabella(['Nome', 'Ruolo', 'Attivo', 'Telefono', ''], righe)),
        h('section', { class: 'panel' },
          h('div', { class: 'panel__head' }, h('h2', null, 'Cosa vede ogni ruolo')),
          dl([
            ['Amministratore', 'Tutto: anche utenti e ruoli, contenuti del sito, cancellazioni definitive.'],
            ['Ufficio', 'Richieste, clienti, eventi, offerte con i prezzi, magazzino, agenda di tutti e assegnazione della squadra.'],
            ['Tecnico', 'Solo gli eventi a cui è assegnato, senza prezzi; spunta materiale caricato e rientrato.'],
            ['Base', "Solo l'agenda di oggi con indirizzo, mappa e contatti, per gli eventi a cui è assegnato."],
            ['Disattivato', 'Non entra più, ma il suo nome resta negli eventi passati.'],
          ]),
          h('p', { class: 'muted' }, 'Per aggiungere una persona: create il suo account in Supabase (Authentication → Users → Add user, con la sua e-mail), poi aggiungete la riga nella tabella "staff" con lo stesso id, il nome e il ruolo. Da qui potete poi cambiare ruolo e stato.')));
    }

    return { viewAgenda, viewAssenze, viewMagazzino, viewImporta, viewOfferta, viewUtenti, offertePanel };
  }

  window.MeekonGestionale = { create };
})();
