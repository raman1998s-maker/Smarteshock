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
    /** Totali come nel database (vista offerte_totali): sconti, IVA inclusa o aggiunta, totale ai 5 centesimi. */
    function calcolaTotali(righe, { scontoPct = 0, scontoChf = 0, ivaPct = 0, inclusa = true } = {}) {
      const subtotale = round2(righe.filter((r) => !r.opzionale).reduce((s, r) => s + round2((r.quantita || 0) * (r.giorni || 0) * (r.prezzo_unitario || 0) * (1 - (r.sconto_percento || 0) / 100)), 0));
      const scontoPctChf = round2(subtotale * scontoPct / 100);
      const imponibile = Math.max(round2(subtotale - scontoPctChf - scontoChf), 0);
      const totale = inclusa ? Math.round(imponibile * 20) / 20 : Math.round((imponibile + round2(imponibile * ivaPct / 100)) * 20) / 20;
      const iva = inclusa ? Math.round(totale * ivaPct / (100 + ivaPct) * 20) / 20 : round2(imponibile * ivaPct / 100);
      return { subtotale, sconto_percento: scontoPct, sconto_percento_chf: scontoPctChf, sconto_chf: scontoChf, imponibile, iva_percento: ivaPct, prezzi_iva_inclusa: inclusa, iva, totale };
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
        dl(righe),
        h('p', null, calendarLink({ ...e, ...ev }, 'btn btn--ghost btn--sm')));
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

    const LINGUE_OFFERTA = { de: 'Tedesco', it: 'Italiano', fr: 'Francese', en: 'Inglese' };
    const importoRiga = (r) => round2(r.quantita * r.giorni * r.prezzo_unitario * (1 - r.sconto_percento / 100));
    const testoCliente = (txt, cli) => String(txt || '').replace(/\{cliente\}/g, cli.azienda || cli.nome || '');

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
      const imp = data.impostazioni || {};
      const ditta = imp.ditta || {};
      const testiDi = (l) => (imp.testi && (imp.testi[l] || imp.testi.de)) || {};
      const bozza = o.stato === 'bozza';
      const numeroOfferta = o.versione > 1 ? `${ev.numero_ordine || ''}/${o.versione}` : (ev.numero_ordine || '');
      const OD = window.MeekonOffertaDoc;
      const giorniEvento = ev.data_inizio
        ? Math.max(1, Math.round((parseDate(giorno(ev.data_fine) || giorno(ev.data_inizio)) - parseDate(giorno(ev.data_inizio))) / 86400000) + 1)
        : 1;
      const righe = (data.righe || []).map((r) => ({
        articolo_id: r.articolo_id, titolo: r.titolo || '', descrizione: r.descrizione, quantita: Number(r.quantita), giorni: Number(r.giorni),
        prezzo_unitario: Number(r.prezzo_unitario), sconto_percento: Number(r.sconto_percento), opzionale: !!r.opzionale,
      }));

      // campi dell'offerta
      const lingua = select('lingua', Object.entries(LINGUE_OFFERTA), o.lingua || 'de');
      lingua.disabled = !bozza;
      const anrede = h('input', { type: 'text', maxlength: '200', disabled: !bozza, placeholder: 'es. Liebe Anna, lieber Marco · Sehr geehrter Herr Muster' });
      anrede.value = o.anrede || cli.anrede || '';
      const valida = h('input', { type: 'date', value: o.valida_fino || '', disabled: !bozza });
      const iva = h('input', { inputmode: 'decimal', value: String(o.iva_percento ?? 8.1), disabled: !bozza });
      const ivaInclusa = check('prezzi_iva_inclusa', 'Prezzi IVA inclusa (come nelle vostre offerte)', o.prezzi_iva_inclusa !== false);
      ivaInclusa.querySelector('input').disabled = !bozza;
      const scontoPct = h('input', { inputmode: 'decimal', value: String(o.sconto_percento ?? 0), disabled: !bozza });
      const sconto = h('input', { inputmode: 'decimal', value: String(o.sconto_chf ?? 0), disabled: !bozza });
      const intro = h('textarea', { rows: '4', maxlength: '4000', disabled: !bozza });
      const cond = h('textarea', { rows: '4', maxlength: '4000', disabled: !bozza, placeholder: 'es. modalità di pagamento, acconto, validità' });
      // testi predefiniti dalle impostazioni, nella lingua scelta (solo se l'offerta non ne ha già)
      const riempiTesti = (forza) => {
        const tx = testiDi(lingua.value);
        const std = OD.L[lingua.value] || OD.L.de;
        if (forza || !intro.value.trim()) intro.value = testoCliente(tx.introduzione || std.intro, cli);
        if (forza || !cond.value.trim()) cond.value = testoCliente(tx.condizioni, cli);
        if (forza || !anrede.value.trim()) anrede.value = cli.anrede || std.anrede(cli.nome || '').trim();
      };
      intro.value = o.introduzione || '';
      cond.value = o.condizioni || '';
      if (bozza) riempiTesti(false);
      lingua.addEventListener('change', () => {
        if (window.confirm('Sostituire saluto, testo iniziale e condizioni con quelli predefiniti nella nuova lingua?')) riempiTesti(true);
      });

      const tbody = h('tbody');
      const totBox = h('div', { class: 'offerta__totali' });
      const totali = () => calcolaTotali(righe, {
        scontoPct: numero(scontoPct.value) || 0, scontoChf: numero(sconto.value) || 0,
        ivaPct: numero(iva.value) || 0, inclusa: ivaInclusa.querySelector('input').checked,
      });
      const disegnaTotali = () => {
        const t = totali();
        clear(totBox);
        totBox.append(dl([
          ['Subtotale', chf(t.subtotale)],
          t.sconto_percento_chf ? [`Sconto ${t.sconto_percento}%`, `– ${chf(t.sconto_percento_chf)}`] : undefined,
          t.sconto_chf ? ['Sconto', `– ${chf(t.sconto_chf)}`] : undefined,
          t.prezzi_iva_inclusa ? undefined : ['Totale IVA esclusa', chf(t.imponibile)],
          [t.prezzi_iva_inclusa ? `di cui IVA ${t.iva_percento}%` : `IVA ${t.iva_percento}%`, chf(t.iva)],
          [t.prezzi_iva_inclusa ? 'Totale IVA inclusa' : 'Totale', h('strong', null, chf(t.totale))],
        ].filter(Boolean)));
      };
      const disegnaRighe = () => {
        clear(tbody);
        righe.forEach((r, i) => {
          const importo = h('span', null, fmtMoney(importoRiga(r)));
          const num = (k, label) => {
            const el = h('input', { inputmode: 'decimal', value: String(r[k]), class: 'input--num', disabled: !bozza, 'aria-label': `${label} riga ${i + 1}` });
            el.addEventListener('input', () => {
              const n = numero(el.value);
              if (Number.isFinite(n)) { r[k] = n; el.removeAttribute('aria-invalid'); } else el.setAttribute('aria-invalid', 'true');
              importo.textContent = fmtMoney(importoRiga(r));
              disegnaTotali();
            });
            return el;
          };
          const tit = h('input', { type: 'text', maxlength: '120', value: r.titolo, disabled: !bozza, placeholder: 'Articolo (es. LED Screen)', 'aria-label': `Articolo riga ${i + 1}` });
          tit.addEventListener('input', () => { r.titolo = tit.value; });
          const desc = h('textarea', { rows: '1', maxlength: '500', disabled: !bozza, placeholder: 'Descrizione (es. 2× Public Screen 3.5×2m)', 'aria-label': `Descrizione riga ${i + 1}` });
          desc.value = r.descrizione;
          desc.addEventListener('input', () => { r.descrizione = desc.value; });
          const azioni = bozza ? h('td', { 'data-label': '' },
            h('button', { class: 'btn btn--ghost btn--sm', type: 'button', 'aria-label': `Sposta su riga ${i + 1}`, disabled: i === 0, onclick: () => { righe.splice(i - 1, 0, righe.splice(i, 1)[0]); disegnaRighe(); } }, '↑'),
            h('button', { class: 'btn btn--ghost btn--sm', type: 'button', 'aria-label': `Togli riga ${i + 1}`, onclick: () => { righe.splice(i, 1); disegnaRighe(); disegnaTotali(); } }, '×')) : null;
          tbody.append(h('tr', null,
            h('td', { 'data-label': 'Articolo e descrizione', class: 'table__primary offerta__testo' }, tit, desc, (() => {
              const op = h('input', { type: 'checkbox', checked: r.opzionale, disabled: !bozza, 'aria-label': `Opzionale riga ${i + 1}` });
              op.addEventListener('change', () => { r.opzionale = op.checked; disegnaTotali(); });
              return h('label', { class: 'check' }, op, h('span', null, 'Opzionale (nel PDF, non sommata)'));
            })()),
            h('td', { 'data-label': 'Q.tà', class: 'num' }, num('quantita', 'Quantità')),
            h('td', { 'data-label': 'Giorni', class: 'num' }, num('giorni', 'Giorni')),
            h('td', { 'data-label': 'Prezzo CHF', class: 'num' }, num('prezzo_unitario', 'Prezzo')),
            h('td', { 'data-label': 'Sconto %', class: 'num' }, num('sconto_percento', 'Sconto')),
            h('td', { 'data-label': 'Importo CHF', class: 'num' }, importo),
            azioni));
        });
        if (!righe.length) tbody.append(h('tr', null, h('td', { colspan: '7' }, h('span', { class: 'muted' }, 'Nessuna riga: aggiungete articoli dal magazzino o righe libere.'))));
      };
      [iva, sconto, scontoPct].forEach((el) => el.addEventListener('input', disegnaTotali));
      ivaInclusa.querySelector('input').addEventListener('change', disegnaTotali);

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
            titolo: a.descrizione.slice(0, 120),
            descrizione: (a.accessori || [a.marca, a.descrizione].filter(Boolean).join(' ')).replace(/\s+/g, ' ').slice(0, 500),
            quantita: 1,
            giorni: vendita ? 1 : giorniEvento,
            prezzo_unitario: Number(vendita ? a.prezzo_vendita : a.prezzo_noleggio_giorno) || 0,
            sconto_percento: 0,
          });
          scelta.value = '';
          disegnaRighe(); disegnaTotali();
        });
        const addFree = h('button', { class: 'btn', type: 'button', onclick: () => { righe.push({ articolo_id: null, titolo: '', descrizione: '', quantita: 1, giorni: 1, prezzo_unitario: 0, sconto_percento: 0 }); disegnaRighe(); disegnaTotali(); tbody.querySelector('tr:last-child input')?.focus(); } }, 'Riga libera (es. montaggio, trasporto)');
        aggiungi = h('div', { class: 'toolbar' }, scelta, comeVendita, addArt, addFree);
      }

      // azioni
      const alert = h('div');
      const salva = async () => {
        clear(alert);
        const errata = righe.findIndex((r) => !r.descrizione.trim() || !(r.quantita > 0) || !(r.giorni > 0) || !(r.prezzo_unitario >= 0) || !(r.sconto_percento >= 0 && r.sconto_percento <= 100));
        if (errata >= 0) { alert.append(alertBox(`Controllate la riga ${errata + 1}: descrizione obbligatoria, quantità e giorni maggiori di zero.`)); return false; }
        const ivaN = numero(iva.value);
        const scN = numero(sconto.value) || 0;
        const scP = numero(scontoPct.value) || 0;
        if (!Number.isFinite(ivaN) || !Number.isFinite(scN) || !Number.isFinite(scP) || scP > 100) { alert.append(alertBox('Controllate IVA e sconti: solo numeri, sconto in % al massimo 100.')); return false; }
        await api(`offerte/${encodeURIComponent(o.id)}`, { method: 'PATCH', body: {
          lingua: lingua.value, anrede: anrede.value.trim() || null, valida_fino: valida.value || null, iva_percento: ivaN,
          prezzi_iva_inclusa: ivaInclusa.querySelector('input').checked, sconto_percento: scP, sconto_chf: scN,
          introduzione: intro.value.trim() || null, condizioni: cond.value.trim() || null,
        } });
        await api(`offerte/${encodeURIComponent(o.id)}/righe`, { method: 'PUT', body: { righe: righe.map((r) => ({ ...r, titolo: r.titolo.trim() || null, descrizione: r.descrizione.trim() })) } });
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
            } catch (err) {
              const conflitto = err instanceof ApiError && err.status === 409;
              alert.append(alertBox(conflitto && err.field === 'indirizzo_cliente'
                ? "Prima dell'invio serve l'indirizzo completo del cliente: aggiungetelo nella scheda del cliente."
                : conflitto && stato === 'accettata' ? "Per confermare serve la location dell'evento (località o indirizzo): aggiungetela nell'evento."
                  : errorMessage(err)));
            }
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

      // documento da stampare (nascosto a schermo, visibile solo in stampa): offerta-doc.js
      const doc = h('section', { class: 'stampa', 'aria-hidden': 'true' });
      const linkCliente = o.token ? `${window.location.origin}/offerta/?t=${o.token}` : null;
      function stampa(tipo = 'offerta') {
        const res = OD.build({ h, add }, {
          tipo, lingua: lingua.value, numero: numeroOfferta, numeroOrdine: ev.numero_ordine, oggi: oggi(), valida: valida.value || null,
          offerta: o, evento: ev, cliente: cli, impostazioni: imp, righe, totali: totali(),
          anrede: anrede.value.trim(), intro: intro.value.trim(), condizioni: cond.value.trim(), link: linkCliente,
        });
        clear(doc);
        doc.append(res.doc);
        // footer di ogni pagina: testi passati alle margin box di @page (CSS) come variabili
        const root = document.documentElement.style;
        root.setProperty('--mk-piede-1', JSON.stringify(res.piede[0]));
        root.setProperty('--mk-piede-2', JSON.stringify(res.piede[1]));
        root.setProperty('--mk-pagina', JSON.stringify(res.pagina.replace(/X\/Y$/, '')));
        const titolo = document.title;
        document.title = `${res.titolo} ${cli.azienda || cli.nome || ''}`.trim();
        window.print();
        document.title = titolo;
      }
      if (o.stato === 'accettata') {
        const conf = h('button', { class: 'btn btn--primary', type: 'button' }, 'Conferma d\'ordine (PDF)');
        conf.addEventListener('click', () => {
          if (!ev.localita && !ev.indirizzo) { alert.append(alertBox("Per la conferma d'ordine serve la location dell'evento.")); return; }
          stampa('conferma');
        });
        actions.unshift(conf);
      }

      // avvisi
      const avvisi = [];
      if (!cli.indirizzo && (bozza || o.stato === 'inviata')) avvisi.push(alertBox("Manca l'indirizzo completo del cliente: serve prima di inviare l'offerta. Aggiungetelo nella scheda del cliente."));
      const mwstOk = ditta.mwst_pflichtig === false || !!ditta.mwst_nr;
      if (!mwstOk) avvisi.push(alertBox('IVA non ancora impostata: in "Impostazioni" inserite il numero IVA (CHE-…) oppure segnate "non assoggettato all\'IVA". Fino ad allora il PDF scrive solo "Total" senza IVA.', 'info'));
      if (linkCliente && o.stato === 'inviata') {
        const copia = h('button', { class: 'btn btn--sm', type: 'button' }, 'Copia link');
        copia.addEventListener('click', async () => { try { await navigator.clipboard.writeText(linkCliente); toast('Link copiato.'); } catch (err) { toast('Copiate il link a mano.', 'error'); } });
        avvisi.push(h('section', { class: 'panel' }, h('div', { class: 'panel__head' }, h('h2', null, 'Link per il cliente'), copia),
          h('p', null, 'Il cliente conferma l\'offerta online da qui (è anche nel PDF):'), h('p', null, h('a', { href: linkCliente, target: '_blank', rel: 'noopener' }, linkCliente))));
      }
      if (o.accettata_il) {
        avvisi.push(h('section', { class: 'panel' }, h('div', { class: 'panel__head' }, h('h2', null, 'Accettazione')),
          dl([
            ['Quando', `${fmtDate(giorno(o.accettata_il))} ${new Date(o.accettata_il).toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit' })}`],
            ['Come', o.accettata_online ? 'Online dal cliente' : "Dall'ufficio"],
            o.accettata_online ? ['Nome', dash(o.accettata_nome)] : undefined,
            o.accettata_online ? ['IP', dash(o.accettata_ip)] : undefined,
            o.accettata_online ? ['Versione AGB', dash(o.accettata_agb)] : undefined,
            o.accettata_online ? ['Foto con persone come referenza', o.foto_consenso ? 'Sì, consentito' : 'No'] : undefined,
          ].filter(Boolean))));
      }

      disegnaRighe();
      disegnaTotali();
      const senzaImpostazioni = !imp.ditta && isAdmin()
        ? alertBox('Intestazione, IBAN e AGB non sono ancora compilati: inseriteli una volta in "Impostazioni" e compariranno in tutti i PDF.', 'info')
        : null;
      page({
        title: `Offerta N. ${numeroOfferta}`,
        sub: h('span', null, badgeOfferta(o.stato), ` · ${ev.titolo || ''}${o.inviata_il ? ` · inviata il ${fmtDate(giorno(o.inviata_il))}` : ''}`),
        actions,
        back: [`#/evento/${encodeURIComponent(o.evento_id)}`, 'Evento'],
      },
      alert,
      senzaImpostazioni,
      avvisi,
      bozza ? null : alertBox(o.stato === 'accettata' ? "Offerta accettata: l'evento è confermato." : 'Questa offerta non si modifica più. Per cambiarla create una nuova versione.', 'info'),
      panels(
        h('section', { class: 'panel' }, h('div', { class: 'panel__head' }, h('h2', null, 'Cliente')),
          dl([['Nome', dash(cli.nome)], ['Azienda', dash(cli.azienda)], ['E-mail', mailLink(cli.email)], ['Telefono', telLink(cli.telefono)]])),
        h('section', { class: 'panel' }, h('div', { class: 'panel__head' }, h('h2', null, 'Evento')),
          dl([['Quando', fmtRange(ev.data_inizio, ev.data_fine)], ['Dove', [ev.sala, ev.localita].filter(Boolean).join(', ') || '—'], ['Ospiti', dash(ev.ospiti)]])),
        wide(h('section', { class: 'panel' },
          h('div', { class: 'panel__head' }, h('h2', null, 'Righe')),
          h('div', { class: 'table-wrap' }, h('table', { class: 'table offerta__righe' },
            h('thead', null, h('tr', null, ['Articolo e descrizione', 'Q.tà', 'Giorni', 'Prezzo CHF', 'Sconto %', 'Importo CHF', ''].map((x, i) => h('th', { scope: 'col', class: i && i < 6 ? 'num' : null }, x)))),
            tbody)),
          aggiungi,
          totBox)),
        wide(h('section', { class: 'panel' },
          h('div', { class: 'fields' },
            field('Lingua del PDF', lingua, { hint: 'Di norma quella del cliente.' }),
            field('Saluto (Anrede)', anrede, { hint: 'Privati: "Liebe Anna, lieber Marco". Aziende: "Sehr geehrte Frau Muster".' }),
            field('Valida fino al', valida),
            h('div', { class: 'field' }, ivaInclusa),
            field('IVA %', iva, { hint: '8,1 % per tutti i clienti.' }),
            field('Sconto sul totale (%)', scontoPct),
            field('Sconto sul totale (CHF)', sconto),
            field('Testo iniziale', intro, { full: true, hint: 'Sotto il saluto, prima della tabella. {cliente} diventa il nome del cliente.' }),
            field('Note aggiuntive', cond, { full: true, hint: 'Facoltative: pagamento e annullamento sono già nei riquadri del PDF.' }))))),
      doc);
    }

    // ---------------------------------------------------------------- impostazioni delle offerte (admin)
    async function viewImpostazioni(_, alive) {
      loading();
      let dati;
      try { dati = (await api('impostazioni')).impostazioni || {}; } catch (err) { if (alive()) failure('Impostazioni', err); return; }
      if (!alive()) return;
      const OD = window.MeekonOffertaDoc;
      const d = dati.ditta || {};
      const inp = (v, attrs = {}) => h('input', { type: 'text', value: v ?? '', ...attrs });
      const area = (v, rows, max, ph) => { const t = h('textarea', { rows: String(rows), maxlength: String(max), placeholder: ph || null }); t.value = v || ''; return t; };
      const f = {
        nome: inp(d.nome, { maxlength: '120', placeholder: 'Meekon Display' }),
        persona: inp(d.persona, { maxlength: '120', placeholder: 'Nome e cognome di chi firma' }),
        titolo_firma: inp(d.titolo_firma, { maxlength: '80', placeholder: 'Inhaber' }),
        slogan: inp(d.slogan, { maxlength: '160', placeholder: 'LED, Licht- & Tontechnik' }),
        indirizzo: area(d.indirizzo, 3, 300),
        telefono: inp(d.telefono, { type: 'tel', maxlength: '40' }),
        email: inp(d.email, { type: 'email', maxlength: '254', placeholder: 'info@meekondisplay.ch' }),
        iban: inp(d.iban, { maxlength: '42', placeholder: 'CH00 0000 0000 0000 0000 0' }),
        twint: inp(d.twint, { type: 'tel', maxlength: '40' }),
        whatsapp: inp(d.whatsapp, { type: 'tel', maxlength: '40' }),
        mwst_nr: inp(d.mwst_nr, { maxlength: '40', placeholder: 'CHE-123.456.789 MWST' }),
        piede: area(d.piede, 2, 1000),
      };
      // IVA: con numero IVA, oppure "non assoggettato" (scelta del titolare)
      const mwst = select('mwst', [['', '— da decidere —'], ['si', 'Assoggettato all\'IVA (serve il numero IVA)'], ['no', 'Non assoggettato all\'IVA ("nicht mehrwertsteuerpflichtig")']],
        d.mwst_pflichtig === true ? 'si' : d.mwst_pflichtig === false ? 'no' : '');
      const reg = { ...OD.REGOLE, ...(dati.regole || {}) };
      const num = (k, max) => h('input', { type: 'number', min: '0', max: String(max), inputmode: 'numeric', value: String(reg[k]), 'aria-label': k });
      const g = {
        validita_giorni: num('validita_giorni', 365), acconto_percento: num('acconto_percento', 100), acconto_giorni: num('acconto_giorni', 90),
        saldo_giorni_prima: num('saldo_giorni_prima', 90), sofort_sotto_giorni: num('sofort_sotto_giorni', 365), indennita_percento: num('indennita_percento', 100),
        bedenkfrist_giorni: num('bedenkfrist_giorni', 60), km_inclusi: num('km_inclusi', 1000),
        agb_versione: inp(reg.agb_versione, { maxlength: '20' }), agb_stand: inp(reg.agb_stand, { maxlength: '40' }),
      };
      const scaglioni = (dati.scaglioni && dati.scaglioni.length ? dati.scaglioni : OD.SCAGLIONI).map((x) => ({ ...x }));
      const tbSc = h('tbody');
      const disegnaSc = () => {
        clear(tbSc);
        scaglioni.forEach((x, i) => {
          const gm = h('input', { type: 'number', min: '0', max: '3650', class: 'input--num', value: String(x.giorni_min), 'aria-label': `Giorni minimi scaglione ${i + 1}` });
          const pc = h('input', { type: 'number', min: '0', max: '100', class: 'input--num', value: String(x.percento), 'aria-label': `Percentuale scaglione ${i + 1}` });
          gm.addEventListener('input', () => { x.giorni_min = Number(gm.value); });
          pc.addEventListener('input', () => { x.percento = Number(pc.value); });
          tbSc.append(h('tr', null, h('td', { 'data-label': 'Da quanti giorni prima', class: 'num' }, gm), h('td', { 'data-label': '% dovuta', class: 'num' }, pc),
            h('td', { 'data-label': '' }, h('button', { class: 'btn btn--ghost btn--sm', type: 'button', onclick: () => { scaglioni.splice(i, 1); disegnaSc(); } }, '×'))));
        });
      };
      disegnaSc();

      const testi = {};
      const schede = Object.entries(LINGUE_OFFERTA).map(([l, nome]) => {
        const tx = (dati.testi && dati.testi[l]) || {};
        const std = OD.L[l];
        testi[l] = {
          introduzione: area(tx.introduzione, 3, 2000, std.intro),
          inbegriffen: area(tx.inbegriffen, 2, 500, std.inbegriffen),
          condizioni: area(tx.condizioni, 2, 4000),
          chiusura: area(tx.chiusura, 2, 500, std.chiusura),
          saluti: area(tx.saluti, 1, 300, std.saluti),
          agb: area(tx.agb, 14, 30000),
        };
        return h('details', { class: 'panel', open: l === 'de' ? true : null },
          h('summary', null, h('strong', null, `Testi in ${nome.toLowerCase()}`), l === 'de' ? ' (vincolanti per le AGB)' : ''),
          h('p', { class: 'muted' }, 'Lasciate vuoto per usare il testo grigio proposto.'),
          h('div', { class: 'fields' },
            field('Testo iniziale (dopo il saluto)', testi[l].introduzione, { full: true }),
            field('Riga "Inbegriffen"', testi[l].inbegriffen, { full: true, hint: '{km} = km inclusi, {von} e {bis} = orari di servizio dell\'evento.' }),
            field('Note aggiuntive predefinite', testi[l].condizioni, { full: true, hint: 'Facoltative: pagamento e annullamento sono già nei riquadri.' }),
            field('Chiusura', testi[l].chiusura, { full: true }),
            field('Saluti', testi[l].saluti, { full: true }),
            field('AGB (ultima pagina del PDF, su due colonne)', testi[l].agb, { full: true, hint: l === 'de' ? 'Versione tedesca: è quella che fa fede.' : 'Senza testo qui si stampa la versione tedesca.' })));
      });

      // tariffe proposte per la paga della squadra
      const tariffe = (dati.tariffe || []).map((t) => ({ ...t }));
      const tbTar = h('tbody');
      const disegnaTariffe = () => {
        clear(tbTar);
        tariffe.forEach((t, i) => {
          const ru = h('input', { type: 'text', maxlength: '80', value: t.ruolo || '', 'aria-label': `Ruolo ${i + 1}`, placeholder: 'es. Autista + Installatore' });
          const ta = h('input', { inputmode: 'decimal', class: 'input--num', value: t.tariffa ?? '', 'aria-label': `Tariffa ${i + 1}` });
          const pg = h('input', { type: 'checkbox', checked: !!t.per_giorno, 'aria-label': `Al giorno ${i + 1}` });
          ru.addEventListener('input', () => { t.ruolo = ru.value; });
          ta.addEventListener('input', () => { t.tariffa = numero(ta.value); });
          pg.addEventListener('change', () => { t.per_giorno = pg.checked; });
          tbTar.append(h('tr', null, h('td', { 'data-label': 'Ruolo' }, ru), h('td', { 'data-label': 'CHF', class: 'num' }, ta),
            h('td', { 'data-label': 'Al giorno' }, h('label', { class: 'check' }, pg, h('span', null, 'al giorno'))),
            h('td', { 'data-label': '' }, h('button', { class: 'btn btn--ghost btn--sm', type: 'button', onclick: () => { tariffe.splice(i, 1); disegnaTariffe(); } }, '×'))));
        });
      };
      disegnaTariffe();

      const alert = h('div');
      const save = h('button', { class: 'btn btn--primary', type: 'submit' }, 'Salva impostazioni');
      const form = h('form', { novalidate: true },
        alert,
        h('section', { class: 'panel' }, h('div', { class: 'panel__head' }, h('h2', null, 'Ditta (intestazione e firma del PDF)')),
          h('p', { class: 'muted' }, 'Questi dati stanno solo nel database e compaiono solo nei PDF: mai sul sito pubblico, mai nel codice.'),
          h('div', { class: 'fields' },
            field('Ragione sociale', f.nome), field('Slogan', f.slogan),
            field('Chi firma', f.persona), field('Titolo di chi firma', f.titolo_firma),
            field('Indirizzo', f.indirizzo), field('Telefono', f.telefono), field('E-mail', f.email),
            field('IBAN', f.iban, { hint: 'Nel footer a gruppi di 4.' }), field('TWINT', f.twint), field('WhatsApp', f.whatsapp),
            field('Riga libera nel footer', f.piede, { full: true }))),
        h('section', { class: 'panel' }, h('div', { class: 'panel__head' }, h('h2', null, 'IVA')),
          h('p', { class: 'muted' }, '"Total inkl. 8,1 % MWST" si può scrivere solo con un numero IVA. Senza numero: "nicht mehrwertsteuerpflichtig". Finché non si sceglie, il PDF scrive solo "Total".'),
          h('div', { class: 'fields' }, field('Situazione IVA', mwst), field('Numero IVA', f.mwst_nr))),
        h('section', { class: 'panel' }, h('div', { class: 'panel__head' }, h('h2', null, 'Regole dell\'offerta')),
          h('div', { class: 'fields' },
            field('Validità (giorni)', g.validita_giorni), field('Acconto (%)', g.acconto_percento), field('Acconto entro (giorni dalla conferma)', g.acconto_giorni),
            field('Saldo (giorni prima dell\'evento)', g.saldo_giorni_prima), field('Tutto subito se l\'evento è entro (giorni)', g.sofort_sotto_giorni),
            field('Indennità di riservazione (%)', g.indennita_percento), field('Periodo di riflessione (giorni)', g.bedenkfrist_giorni), field('Km inclusi (solo andata)', g.km_inclusi),
            field('Versione AGB', g.agb_versione), field('Stato AGB', g.agb_stand, { hint: 'es. Dezember 2026' })),
          h('h3', null, 'Scaglioni di annullamento'),
          tabella(['Da quanti giorni prima', '% dovuta', ''], tbSc),
          h('div', { class: 'panel__foot' }, h('button', { class: 'btn btn--sm', type: 'button', onclick: () => { scaglioni.push({ giorni_min: 0, percento: 0 }); disegnaSc(); } }, 'Aggiungi scaglione'))),
        schede,
        h('section', { class: 'panel' },
          h('div', { class: 'panel__head' }, h('h2', null, 'Tariffe della squadra'),
            h('button', { class: 'btn btn--sm', type: 'button', onclick: () => { tariffe.push({ ruolo: '', tariffa: 0, per_giorno: false }); disegnaTariffe(); } }, 'Aggiungi tariffa')),
          h('p', { class: 'muted' }, 'Proposte quando si assegna la paga sull\'evento; si possono sempre cambiare caso per caso.'),
          tabella(['Ruolo', 'CHF', 'Al giorno', ''], tbTar)),
        h('div', { class: 'panel__foot' }, save));
      form.addEventListener('submit', (ev) => {
        ev.preventDefault();
        clear(alert);
        const val = (x) => x.value.trim() || null;
        const errTar = tariffe.findIndex((t) => !String(t.ruolo || '').trim() || !(Number.isFinite(t.tariffa) && t.tariffa >= 0));
        if (errTar >= 0) { alert.append(alertBox(`Controllate la tariffa ${errTar + 1}: ruolo e importo sono obbligatori.`)); return; }
        if (mwst.value === 'si' && !f.mwst_nr.value.trim()) { alert.append(alertBox('Con "assoggettato all\'IVA" serve il numero IVA (CHE-…).')); return; }
        const body = {
          ditta: {}, testi: {}, regole: {},
          scaglioni: scaglioni.map((x) => ({ giorni_min: x.giorni_min, percento: x.percento })),
          tariffe: tariffe.map((t) => ({ ruolo: t.ruolo.trim(), tariffa: t.tariffa, per_giorno: !!t.per_giorno })),
        };
        Object.entries(f).forEach(([k, el]) => { body.ditta[k] = val(el); });
        if (body.ditta.iban) body.ditta.iban = body.ditta.iban.replace(/\s+/g, '').toUpperCase();
        if (mwst.value) body.ditta.mwst_pflichtig = mwst.value === 'si';
        Object.entries(g).forEach(([k, el]) => { const v = el.value.trim(); if (v !== '') body.regole[k] = el.type === 'number' ? Number(v) : v; });
        Object.entries(testi).forEach(([l, campi]) => {
          const o = {};
          Object.entries(campi).forEach(([k, el]) => { o[k] = val(el); });
          if (Object.values(o).some(Boolean)) body.testi[l] = o;
        });
        busy(save, async () => {
          try { await api('impostazioni', { method: 'PUT', body }); toast('Impostazioni salvate: valgono per tutte le offerte e i PDF.'); } catch (err) { markInvalid(form, err); alert.append(alertBox(errorMessage(err))); }
        });
      });
      page({ title: 'Impostazioni', sub: 'Ditta, IVA, regole e testi delle offerte; tariffe della squadra' }, form);
    }

    // ---------------------------------------------------------------- Google Calendar
    /** Link "Aggiungi a Google Calendar" (nessun prezzo nei dettagli). */
    function calendarUrl(e) {
      if (!e || !e.data_inizio) return null;
      const compatto = (v) => String(v).slice(0, 19).replace(/[-:]/g, '');
      const senzaOra = (v) => String(v).length <= 10 || String(v).slice(11, 16) === '00:00';
      let dates;
      if (senzaOra(e.data_inizio) && (!e.data_fine || senzaOra(e.data_fine))) {
        const fine = isoDate(addDays(parseDate(giorno(e.data_fine) || giorno(e.data_inizio)), 1));
        dates = `${giorno(e.data_inizio).replace(/-/g, '')}/${fine.replace(/-/g, '')}`;
      } else {
        const fine = e.data_fine || `${giorno(e.data_inizio)}T${String(Math.min(23, Number(String(e.data_inizio).slice(11, 13)) + 3)).padStart(2, '0')}${String(e.data_inizio).slice(13, 19) || ':00:00'}`;
        dates = `${compatto(e.data_inizio)}/${compatto(fine)}`;
      }
      const q = new URLSearchParams({
        action: 'TEMPLATE',
        text: `${e.titolo || 'Evento'}${e.numero_ordine ? ` (N. ${e.numero_ordine})` : ''}`,
        dates,
        ctz: 'Europe/Zurich',
        location: [e.sala, e.indirizzo || e.localita].filter(Boolean).join(', '),
        details: `Meekon Displays — ${window.location.origin}/area-riservata/app.html#/evento/${e.id}`,
      });
      return `https://calendar.google.com/calendar/render?${q}`;
    }
    function calendarLink(e, cls = 'btn btn--sm') {
      const url = calendarUrl(e);
      return url ? h('a', { class: cls, href: url, target: '_blank', rel: 'noopener noreferrer' }, 'Aggiungi a Google Calendar') : null;
    }

    // ---------------------------------------------------------------- paga della squadra (sull'evento)
    function compensiPanel(e, staff) {
      const panel = h('section', { class: 'panel' }, h('div', { class: 'panel__head' }, h('h2', null, 'Paga della squadra')), h('p', { class: 'muted' }, 'Caricamento…'));
      Promise.all([api(`eventi/${encodeURIComponent(e.id)}/compensi`), api('impostazioni')]).then(([c, imp]) => {
        const tariffe = (imp.impostazioni && imp.impostazioni.tariffe) || [];
        const righe = (c.compensi || []).map((x) => ({ staff_id: x.staff_id, ruolo: x.ruolo, quantita: Number(x.quantita), tariffa_chf: Number(x.tariffa_chf) }));
        // proposta iniziale: una riga per ogni persona assegnata, con il suo ruolo nell'evento
        if (!righe.length) staff.forEach((s) => righe.push({ staff_id: s.staff_id, ruolo: s.ruolo_evento || '', quantita: 1, tariffa_chf: 0 }));
        const tbody = h('tbody');
        const totale = h('strong');
        const ricalcola = () => { totale.textContent = chf(righe.reduce((t, r) => t + round2((r.quantita || 0) * (r.tariffa_chf || 0)), 0)); };
        const persone = staff.map((s) => [s.staff_id, s.nome || '—']);
        const disegna = () => {
          clear(tbody);
          righe.forEach((r, i) => {
            const chi = select('staff_id', persone.length ? persone : [['', '— nessuno assegnato —']], r.staff_id);
            chi.addEventListener('change', () => { r.staff_id = chi.value; });
            const ruolo = h('input', { type: 'text', maxlength: '80', value: r.ruolo, list: 'mk-tariffe', 'aria-label': `Ruolo riga ${i + 1}`, placeholder: 'es. Autista + Installatore' });
            const qta = h('input', { inputmode: 'decimal', class: 'input--num', value: String(r.quantita), 'aria-label': `Quantità o giorni riga ${i + 1}` });
            const tar = h('input', { inputmode: 'decimal', class: 'input--num', value: String(r.tariffa_chf), 'aria-label': `Tariffa riga ${i + 1}` });
            const imp2 = h('span', null, fmtMoney(round2(r.quantita * r.tariffa_chf)));
            const agg = () => { imp2.textContent = fmtMoney(round2((r.quantita || 0) * (r.tariffa_chf || 0))); ricalcola(); };
            ruolo.addEventListener('input', () => {
              r.ruolo = ruolo.value;
              const t = tariffe.find((x) => x.ruolo === ruolo.value);
              if (t) { r.tariffa_chf = Number(t.tariffa); tar.value = String(t.tariffa); agg(); }
            });
            qta.addEventListener('input', () => { const n = numero(qta.value); if (Number.isFinite(n)) { r.quantita = n; agg(); } });
            tar.addEventListener('input', () => { const n = numero(tar.value); if (Number.isFinite(n)) { r.tariffa_chf = n; agg(); } });
            tbody.append(h('tr', null,
              h('td', { 'data-label': 'Persona' }, chi),
              h('td', { 'data-label': 'Ruolo' }, ruolo),
              h('td', { 'data-label': 'Q.tà / giorni', class: 'num' }, qta),
              h('td', { 'data-label': 'Tariffa CHF', class: 'num' }, tar),
              h('td', { 'data-label': 'Importo CHF', class: 'num' }, imp2),
              h('td', { 'data-label': '' }, h('button', { class: 'btn btn--ghost btn--sm', type: 'button', 'aria-label': `Togli riga ${i + 1}`, onclick: () => { righe.splice(i, 1); disegna(); ricalcola(); } }, '×'))));
          });
        };
        const lista = h('datalist', { id: 'mk-tariffe' }, tariffe.map((t) => h('option', { value: t.ruolo }, `${fmtMoney(t.tariffa)} CHF${t.per_giorno ? ' al giorno' : ''}`)));
        const add1 = h('button', { class: 'btn btn--sm', type: 'button', onclick: () => { righe.push({ staff_id: persone[0] ? persone[0][0] : '', ruolo: '', quantita: 1, tariffa_chf: 0 }); disegna(); } }, 'Aggiungi riga');
        const save = h('button', { class: 'btn btn--primary btn--sm', type: 'button' }, 'Salva paga');
        save.addEventListener('click', () => busy(save, async () => {
          const valide = righe.filter((r) => r.staff_id && r.ruolo.trim());
          try {
            await api(`eventi/${encodeURIComponent(e.id)}/compensi`, { method: 'PUT', body: { compensi: valide.map((r) => ({ ...r, ruolo: r.ruolo.trim() })) } });
            toast('Paga salvata: ognuno la vede in "Paga e spese".');
          } catch (err) { toast(errorMessage(err), 'error'); }
        }));
        clear(panel);
        put(panel,
          h('div', { class: 'panel__head' }, h('h2', null, 'Paga della squadra'), h('span', null, 'Totale ', totale)),
          lista,
          tabella(['Persona', 'Ruolo', 'Q.tà / giorni', 'Tariffa CHF', 'Importo CHF', ''], tbody),
          tariffe.length ? null : h('p', { class: 'muted' }, 'Le tariffe proposte (es. Autista 150 CHF) si impostano in "Impostazioni offerte".'),
          h('div', { class: 'panel__foot' }, add1, save));
        disegna();
        ricalcola();
      }).catch((err) => { panel.lastChild.textContent = errorMessage(err); });
      return panel;
    }

    // ---------------------------------------------------------------- paga e spese
    const TIPI_SPESA = { cibo: 'Cibo', diesel: 'Diesel', materiale: 'Materiale', altro: 'Altro' };
    const STATI_SPESA = { inviata: 'In attesa', approvata: 'Approvata', rifiutata: 'Rifiutata' };
    const BADGE_SPESA = { inviata: 'richiesta', approvata: 'confermato', rifiutata: 'annullato' };
    const badgeSpesa = (s) => h('span', { class: `badge badge--${BADGE_SPESA[s]}` }, STATI_SPESA[s] || s);
    let mesePaga = null;

    async function viewPaga(_, alive) {
      loading();
      const gestione = isGestione();
      if (!mesePaga) mesePaga = oggi().slice(0, 7);
      const [y, m] = mesePaga.split('-').map(Number);
      const da = `${mesePaga}-01`;
      const a = isoDate(new Date(y, m, 0));
      let comp;
      let mie;
      let tutte = [];
      let eventi = [];
      try {
        [comp, mie, eventi] = await Promise.all([
          api(`compensi?da=${da}&a=${a}`),
          api(`spese?da=${da}&a=${a}`),
          api(`eventi?da=${isoDate(addDays(new Date(), -60))}&a=${isoDate(addDays(new Date(), 30))}`).then((r) => r.eventi || []).catch(() => []),
        ]);
        if (gestione) tutte = (await api(`spese?tutte=1&da=${da}&a=${a}`)).spese || [];
      } catch (err) { if (alive()) failure('Paga e spese', err); return; }
      if (!alive()) return;
      const compensi = comp.compensi || [];
      const spese = mie.spese || [];
      const nomeEvento = new Map(eventi.map((e) => [e.id, e.titolo]));

      const mese = h('input', { type: 'month', value: mesePaga, 'aria-label': 'Mese' });
      mese.addEventListener('change', () => { if (mese.value) { mesePaga = mese.value; viewPaga([], alive); } });

      const totPaga = compensi.reduce((t, c) => t + round2(Number(c.quantita) * Number(c.tariffa_chf)), 0);
      const totSpese = spese.filter((s) => s.stato === 'approvata').reduce((t, s) => t + Number(s.importo_chf), 0);
      const riepilogo = h('section', { class: 'panel' }, h('div', { class: 'panel__head' }, h('h2', null, 'Il mio mese')),
        dl([['Paga per gli eventi', chf(totPaga)], ['Spese approvate da rimborsare', chf(totSpese)], ['Totale', h('strong', null, chf(totPaga + totSpese))]]));

      const tabPaga = compensi.length
        ? tabella(['Data', 'Evento', 'Ruolo', 'Q.tà', 'Tariffa CHF', 'Importo CHF'], compensi.map((c) => h('tr', null,
          td('Data', fmtDate(giorno(c.data_inizio))), td('Evento', c.titolo || '—'), td('Ruolo', c.ruolo),
          h('td', { class: 'num', 'data-label': 'Q.tà' }, h('span', null, Number(c.quantita))),
          h('td', { class: 'num', 'data-label': 'Tariffa CHF' }, h('span', null, fmtMoney(c.tariffa_chf))),
          h('td', { class: 'num', 'data-label': 'Importo CHF' }, h('span', null, fmtMoney(round2(c.quantita * c.tariffa_chf)))))))
        : h('p', { class: 'muted' }, 'Nessuna paga registrata in questo mese.');

      // le mie spese + modulo
      const tbody = h('tbody');
      const rigaSpesa = (s) => {
        const tr = h('tr', null, td('Data', fmtDate(s.data)), td('Tipo', TIPI_SPESA[s.tipo] || s.tipo), td('Evento', s.evento_id ? (nomeEvento.get(s.evento_id) || '—') : '—'),
          td('Descrizione', dash(s.descrizione)), h('td', { class: 'num', 'data-label': 'CHF' }, h('span', null, fmtMoney(s.importo_chf))), td('Stato', badgeSpesa(s.stato)));
        const azione = h('td', { 'data-label': '' });
        if (s.stato === 'inviata') {
          const del = h('button', { class: 'btn btn--ghost btn--sm', type: 'button' }, 'Ritira');
          del.addEventListener('click', () => busy(del, async () => {
            try { await api(`spese/${encodeURIComponent(s.id)}`, { method: 'DELETE' }); tr.remove(); toast('Spesa ritirata.'); } catch (err) { toast(errorMessage(err), 'error'); }
          }));
          azione.append(del);
        }
        tr.append(azione);
        return tr;
      };
      spese.forEach((s) => tbody.append(rigaSpesa(s)));
      const fData = h('input', { type: 'date', value: oggi(), required: true });
      const fTipo = select('tipo', Object.entries(TIPI_SPESA), 'diesel');
      const fImporto = h('input', { inputmode: 'decimal', required: true, placeholder: '0.00' });
      const fEvento = select('evento_id', [['', '— nessun evento —'], ...eventi.filter((e) => e.stato !== 'annullato').map((e) => [e.id, `${fmtDate(giorno(e.data_inizio))} · ${e.titolo}`])], '');
      const fDesc = h('input', { type: 'text', maxlength: '300', placeholder: 'es. pieno furgone, pranzo squadra' });
      const invia = h('button', { class: 'btn btn--primary', type: 'submit' }, 'Invia spesa');
      const form = h('form', { class: 'panel', novalidate: true },
        h('div', { class: 'panel__head' }, h('h2', null, 'Nuova spesa')),
        h('div', { class: 'fields' }, field('Data', fData), field('Tipo', fTipo), field('Importo CHF', fImporto), field('Evento', fEvento), field('Descrizione', fDesc, { full: true })),
        h('p', { class: 'muted' }, 'Tenete lo scontrino: l\'ufficio approva la spesa e la rimborsa.'),
        h('div', { class: 'panel__foot' }, invia));
      form.addEventListener('submit', (ev) => {
        ev.preventDefault();
        const imp = numero(fImporto.value);
        if (!(imp > 0)) { fImporto.setAttribute('aria-invalid', 'true'); fImporto.focus(); return; }
        fImporto.removeAttribute('aria-invalid');
        busy(invia, async () => {
          try {
            const r = await api('spese', { method: 'POST', body: { data: fData.value || null, tipo: fTipo.value, importo_chf: imp, evento_id: fEvento.value || null, descrizione: fDesc.value.trim() || null } });
            if (r.spesa && r.spesa.data >= da && r.spesa.data <= a) tbody.prepend(rigaSpesa(r.spesa));
            fImporto.value = ''; fDesc.value = '';
            toast('Spesa inviata all\'ufficio.');
          } catch (err) { markInvalid(form, err); toast(errorMessage(err), 'error'); }
        });
      });

      // gestione: tutte le spese del mese da approvare
      let approvazioni = null;
      if (gestione) {
        const righe = tutte.map((s) => {
          const stato = h('span', null, badgeSpesa(s.stato));
          const bott = (nuovo, label) => {
            const b = h('button', { class: 'btn btn--sm', type: 'button' }, label);
            b.addEventListener('click', () => busy(b, async () => {
              try { const r = await api(`spese/${encodeURIComponent(s.id)}`, { method: 'PATCH', body: { stato: nuovo } }); s.stato = r.spesa.stato; clear(stato); stato.append(badgeSpesa(s.stato)); } catch (err) { toast(errorMessage(err), 'error'); }
            }));
            return b;
          };
          return h('tr', null, td('Persona', dash(s.nome)), td('Data', fmtDate(s.data)), td('Tipo', TIPI_SPESA[s.tipo] || s.tipo),
            td('Descrizione', dash(s.descrizione)), h('td', { class: 'num', 'data-label': 'CHF' }, h('span', null, fmtMoney(s.importo_chf))),
            h('td', { 'data-label': 'Stato' }, stato), h('td', { 'data-label': '' }, bott('approvata', 'Approva'), ' ', bott('rifiutata', 'Rifiuta')));
        });
        const perPersona = new Map();
        tutte.filter((s) => s.stato === 'approvata').forEach((s) => perPersona.set(s.nome || '—', (perPersona.get(s.nome || '—') || 0) + Number(s.importo_chf)));
        approvazioni = h('section', { class: 'panel' }, h('div', { class: 'panel__head' }, h('h2', null, 'Spese della squadra')),
          righe.length ? tabella(['Persona', 'Data', 'Tipo', 'Descrizione', 'CHF', 'Stato', ''], righe) : h('p', { class: 'muted' }, 'Nessuna spesa in questo mese.'),
          perPersona.size ? dl([...perPersona].map(([n, v]) => [`Da rimborsare a ${n}`, chf(v)])) : null);
      }

      page({ title: 'Paga e spese', sub: 'Paga per evento e spese da rimborsare, mese per mese', actions: [mese] },
        riepilogo,
        h('section', { class: 'panel' }, h('div', { class: 'panel__head' }, h('h2', null, 'La mia paga')), tabPaga),
        form,
        h('section', { class: 'panel' }, h('div', { class: 'panel__head' }, h('h2', null, 'Le mie spese')),
          tabella(['Data', 'Tipo', 'Evento', 'Descrizione', 'CHF', 'Stato', ''], tbody)),
        approvazioni);
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

    return { viewAgenda, viewAssenze, viewMagazzino, viewImporta, viewOfferta, viewUtenti, viewImpostazioni, viewPaga, offertePanel, compensiPanel, calendarLink };
  }

  window.MeekonGestionale = { create };
})();
