// Area riservata Meekon Displays — area partner (DJ) e richieste dei partner viste dall'ufficio.
// Il partner redige offerte a nome proprio (suoi dati, logo, banca, AGB proprie o di Meekon) e sceglie
// il materiale Meekon dal catalogo; la richiesta di materiale arriva all'ufficio "in attesa" e, quando il
// cliente accetta, "da confermare". Regole come app.js: solo /api/*, mai innerHTML, nessun style=.
(() => {
  'use strict';

  const STATI = { bozza: 'Bozza', inviata: 'Inviata al cliente', accettata: 'Accettata', rifiutata: 'Rifiutata', scaduta: 'Scaduta' };
  const BADGE = { bozza: 'richiesta', inviata: 'offerta', accettata: 'confermato', rifiutata: 'annullato', scaduta: 'completato' };
  const MATERIALE = { nessuno: 'Nessun materiale', in_attesa: 'Materiale in attesa', da_confermare: 'Materiale da confermare', confermato: 'Materiale confermato', rifiutato: 'Materiale rifiutato' };
  const BADGE_MAT = { nessuno: 'completato', in_attesa: 'richiesta', da_confermare: 'offerta', confermato: 'confermato', rifiutato: 'annullato' };
  const LINGUE = { de: 'Tedesco', it: 'Italiano', fr: 'Francese', en: 'Inglese' };
  // prese di corrente in location: tipo → quante (serve a Meekon per cavi e distribuzione)
  const PRESE = { '230v': 'Normali 230 V', cee16: 'CEE 16 A', cee32: 'CEE 32 A', cee63: 'CEE 63 A', cee125: 'CEE 125 A' };
  const testoPrese = (p) => (p && Object.keys(p).length ? Object.entries(p).map(([k, n]) => `${PRESE[k] || k} × ${n}`).join(', ') : '—');

  function create(ctx) {
    const { h, add, clear, api, ApiError, errorMessage, page, toast, field, busy, select, check, loading, failure, empty,
      td, dl, fmtDate, fmtRange, fmtMoney, isoDate, telLink, mailLink, panels, wide, state } = ctx;
    const put = (el, ...kids) => add(el, kids);
    const r2 = (n) => Math.round(n * 100) / 100;
    const chf = (n) => `CHF ${fmtMoney(n)}`;
    const giorno = (v) => (v ? String(v).slice(0, 10) : null);
    const oggi = () => isoDate(new Date());
    const numero = (raw) => { const s = String(raw ?? '').replace(/['’\s]/g, '').replace(',', '.'); if (!s) return null; const n = Number(s); return Number.isFinite(n) ? n : NaN; };
    const badge = (stato, labels, cls) => h('span', { class: `badge badge--${cls[stato] || 'richiesta'}` }, labels[stato] || stato);
    const alertBox = (text, kind = 'error') => h('p', { class: `alert alert--${kind}`, role: kind === 'error' ? 'alert' : 'status' }, text);
    const numeroOfferta = (o) => `${String(o.created_at || oggi()).slice(0, 4)}-P${String(o.numero).padStart(3, '0')}`;
    const importo = (r) => r2(r.quantita * r.giorni * r.prezzo_unitario * (1 - r.sconto_percento / 100));
    function tabella(head, rows) {
      return h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
        h('thead', null, h('tr', null, head.map((t) => h('th', { scope: 'col', class: /CHF|Q\.tà|Liberi|Giorni|Sconto/.test(t) ? 'num' : null }, t)))),
        rows instanceof HTMLTableSectionElement ? rows : h('tbody', null, rows)));
    }
    function totaliDi(righe, o) {
      const sub = r2(righe.filter((r) => !r.opzionale).reduce((s, r) => s + importo(r), 0));
      const scP = r2(sub * (o.sconto_percento || 0) / 100);
      const imp = Math.max(r2(sub - scP - (o.sconto_chf || 0)), 0);
      const inclusa = o.prezzi_iva_inclusa !== false;
      const iva0 = Number(o.iva_percento) || 0;
      const totale = inclusa ? Math.round(imp * 20) / 20 : Math.round((imp + r2(imp * iva0 / 100)) * 20) / 20;
      const iva = inclusa ? Math.round(totale * iva0 / (100 + iva0) * 20) / 20 : r2(imp * iva0 / 100);
      return { subtotale: sub, sconto_percento: o.sconto_percento || 0, sconto_percento_chf: scP, sconto_chf: o.sconto_chf || 0, imponibile: imp, iva_percento: iva0, prezzi_iva_inclusa: inclusa, iva, totale };
    }

    // ---------------------------------------------------------------- partner: elenco offerte
    async function viewOfferte(_, alive) {
      loading();
      let data;
      let prof;
      try { [data, prof] = await Promise.all([api('partner-offerte'), api('partner/profilo')]); } catch (err) { if (alive()) failure('Le mie offerte', err); return; }
      if (!alive()) return;
      const lista = data.offerte || [];
      const nuova = h('button', { class: 'btn btn--primary', type: 'button' }, 'Nuova offerta');
      nuova.addEventListener('click', () => busy(nuova, async () => {
        try {
          const r = await api('partner-offerte', { method: 'POST', body: { lingua: 'de', valida_fino: isoDate(new Date(Date.now() + 14 * 86400000)) } });
          window.location.hash = `#/partner/offerta/${encodeURIComponent(r.offerta.id)}`;
        } catch (err) { toast(errorMessage(err), 'error'); }
      }));
      const righe = lista.map((o) => {
        const href = `#/partner/offerta/${encodeURIComponent(o.id)}`;
        const tr = h('tr', { class: 'is-link' },
          td('N.', numeroOfferta(o)),
          h('td', { 'data-label': 'Cliente e evento', class: 'table__primary' }, h('span', null, h('a', { href }, o.cliente_azienda || o.cliente_nome || 'Senza cliente'),
            h('span', { class: 'table__sub' }, [o.evento_titolo, fmtDate(giorno(o.data_inizio)), o.luogo].filter((x) => x && x !== '—').join(' · ')))),
          td('Stato', badge(o.stato, STATI, BADGE)),
          td('Materiale Meekon', badge(o.materiale_stato, MATERIALE, BADGE_MAT)),
          h('td', { class: 'num', 'data-label': 'Totale CHF' }, h('span', null, fmtMoney(o.totali.totale))));
        tr.addEventListener('click', (ev) => { if (!ev.target.closest('a')) window.location.hash = href; });
        return tr;
      });
      page({ title: 'Le mie offerte', sub: 'Offerte ai vostri clienti, a vostro nome, con il materiale di Meekon', actions: [nuova] },
        prof.profilo && prof.profilo.ragione_sociale ? null : alertBox('Prima di stampare la prima offerta completate il vostro profilo: ragione sociale, logo, indirizzo e IBAN.', 'info'),
        lista.length ? h('section', { class: 'panel' }, tabella(['N.', 'Cliente e evento', 'Stato', 'Materiale Meekon', 'Totale CHF'], righe))
          : empty('Ancora nessuna offerta', 'Create la prima: inserite le vostre prestazioni e scegliete il materiale di Meekon dal catalogo.'));
    }

    // ---------------------------------------------------------------- partner: editor offerta
    async function viewOfferta([id], alive) {
      loading();
      let data;
      try { data = await api(`partner-offerte/${encodeURIComponent(id)}`); } catch (err) { if (alive()) failure('Offerta', err); return; }
      if (!alive()) return;
      const o = data.offerta;
      const prof = data.profilo || {};
      const isPartner = state.me.ruolo === 'partner';
      const bozza = o.stato === 'bozza' && isPartner;
      const righe = (data.righe || []).map((r) => ({ ...r, titolo: r.titolo || '', quantita: Number(r.quantita), giorni: Number(r.giorni), prezzo_unitario: Number(r.prezzo_unitario), sconto_percento: Number(r.sconto_percento) }));

      const inp = (k, attrs = {}) => { const el = h('input', { type: 'text', value: o[k] ?? '', disabled: !bozza, ...attrs }); return el; };
      const dt = (k) => h('input', { type: 'datetime-local', value: o[k] ? String(o[k]).slice(0, 16) : '', disabled: !bozza });
      const f = {
        cliente_nome: inp('cliente_nome', { maxlength: '120' }), cliente_azienda: inp('cliente_azienda', { maxlength: '160' }),
        cliente_indirizzo: h('textarea', { rows: '2', maxlength: '300', disabled: !bozza, placeholder: 'Via e numero\nCAP Località' }),
        cliente_email: inp('cliente_email', { type: 'email', maxlength: '254' }), cliente_telefono: inp('cliente_telefono', { type: 'tel', maxlength: '40' }),
        anrede: inp('anrede', { maxlength: '200', placeholder: 'es. Liebe Anna, lieber Marco' }),
        evento_titolo: inp('evento_titolo', { maxlength: '200' }), luogo: inp('luogo', { maxlength: '300' }),
        data_inizio: dt('data_inizio'), data_fine: dt('data_fine'), montaggio_da: dt('montaggio_da'),
        prese: Object.fromEntries(Object.keys(PRESE).map((k) => [k, h('input', { type: 'number', min: '0', max: '50', step: '1', inputmode: 'numeric', class: 'input--num', value: (o.prese && o.prese[k]) || '', disabled: !bozza, 'aria-label': `${PRESE[k]}: quante prese` })])),
        valida_fino: h('input', { type: 'date', value: o.valida_fino || '', disabled: !bozza }),
        lingua: select('lingua', Object.entries(LINGUE), o.lingua || 'de'),
        sconto_percento: inp('sconto_percento', { inputmode: 'decimal' }),
        introduzione: h('textarea', { rows: '3', maxlength: '4000', disabled: !bozza }),
        condizioni: h('textarea', { rows: '2', maxlength: '4000', disabled: !bozza }),
      };
      f.cliente_indirizzo.value = o.cliente_indirizzo || '';
      f.introduzione.value = o.introduzione || ((window.MeekonOffertaDoc.L[o.lingua || 'de'] || {}).intro || '');
      f.condizioni.value = o.condizioni || '';
      f.lingua.disabled = !bozza;
      const ivaInclusa = check('iva', 'Prezzi IVA inclusa', o.prezzi_iva_inclusa !== false);
      ivaInclusa.querySelector('input').disabled = !bozza;

      // catalogo Meekon (prezzo partner e pezzi liberi nelle date dell'evento)
      let catalogo = [];
      const caricaCatalogo = async () => {
        const da = f.data_inizio.value ? f.data_inizio.value.slice(0, 10) : null;
        const a = f.data_fine.value ? f.data_fine.value.slice(0, 10) : da;
        try { catalogo = (await api(`partner/catalogo${da ? `?da=${da}&a=${a}` : ''}`)).catalogo || []; } catch (err) { catalogo = []; }
      };
      await caricaCatalogo();
      let modelli = [];
      try { modelli = (await api('modelli')).modelli || []; } catch (err) { modelli = []; }
      const scontoP = Number(prof.sconto_partner_percento || 0);
      const prezzoModello = (m) => r2((Number(m.prezzo_giorno) || 0) * (1 - scontoP / 100));
      const nomeCat = (id) => (catalogo.find((c) => c.id === id) || {}).descrizione || '?';
      const contenuto = (comp) => (comp || []).map((c) => `${c.quantita}× ${nomeCat(c.articolo_id)}`).join(', ');
      const categoriaDi = (r) => (r.tipo === 'pacchetto' ? ((modelli.find((m) => m.id === r.modello_id) || {}).categoria || 'Altro')
        : r.tipo === 'materiale' ? ((catalogo.find((c) => c.id === r.articolo_id) || {}).categoria || '') : '');
      if (!alive()) return;
      const prezzoPartner = (id2) => (catalogo.find((c) => c.id === id2) || {}).prezzo_partner;

      const tbody = h('tbody');
      const totBox = h('div', { class: 'offerta__totali' });
      const costoBox = h('p', { class: 'alert alert--info' });
      const header = () => ({
        sconto_percento: numero(f.sconto_percento.value) || 0, sconto_chf: 0, iva_percento: 8.1,
        prezzi_iva_inclusa: ivaInclusa.querySelector('input').checked,
      });
      const ridisegnaTotali = () => {
        const t = totaliDi(righe, header());
        clear(totBox);
        totBox.append(dl([
          ['Subtotale', chf(t.subtotale)],
          t.sconto_percento_chf ? [`Sconto ${t.sconto_percento}%`, `– ${chf(t.sconto_percento_chf)}`] : null,
          [t.prezzi_iva_inclusa ? 'Totale IVA inclusa' : 'Totale', h('strong', null, chf(t.totale))],
        ].filter(Boolean)));
        const costo = righe.filter((r) => !r.opzionale && (r.tipo === 'materiale' || r.tipo === 'pacchetto')).reduce((s, r) => s + r2(r.quantita * r.giorni
          * (r.tipo === 'pacchetto' ? prezzoModello(modelli.find((m) => m.id === r.modello_id) || {}) : (Number(prezzoPartner(r.articolo_id)) || 0))), 0);
        costoBox.textContent = costo ? `Costo del materiale Meekon per voi: ${chf(costo)} (prezzo partner). Il prezzo che vede il cliente lo decidete voi nelle righe.` : 'Nessun materiale Meekon in questa offerta.';
      };
      const disegna = () => {
        clear(tbody);
        righe.forEach((r, i) => {
          const imp = h('span', null, fmtMoney(importo(r)));
          const numIn = (k, label) => {
            const el = h('input', { inputmode: 'decimal', class: 'input--num', value: String(r[k]), disabled: !bozza, 'aria-label': `${label} riga ${i + 1}` });
            el.addEventListener('input', () => { const n = numero(el.value); if (Number.isFinite(n)) { r[k] = n; imp.textContent = fmtMoney(importo(r)); ridisegnaTotali(); } });
            return el;
          };
          const tit = h('input', { type: 'text', maxlength: '120', value: r.titolo, disabled: !bozza, placeholder: 'Prestazione', 'aria-label': `Titolo riga ${i + 1}` });
          tit.addEventListener('input', () => { r.titolo = tit.value; });
          const desc = h('textarea', { rows: '1', maxlength: '500', disabled: !bozza, 'aria-label': `Descrizione riga ${i + 1}` });
          desc.value = r.descrizione;
          desc.addEventListener('input', () => { r.descrizione = desc.value; });
          const art = r.tipo === 'materiale' ? catalogo.find((c) => c.id === r.articolo_id) : null;
          const mod = r.tipo === 'pacchetto' ? modelli.find((m) => m.id === r.modello_id) : null;
          const info = r.tipo === 'materiale'
            ? h('span', { class: 'table__sub' }, `Materiale Meekon · prezzo partner ${art ? fmtMoney(art.prezzo_partner) : '—'}${art && art.disponibili != null ? ` · liberi ${art.disponibili}` : ''}`)
            : r.tipo === 'pacchetto'
              ? h('span', { class: 'table__sub' }, `Pacchetto Meekon · prezzo partner ${mod ? fmtMoney(prezzoModello(mod)) : '—'}/giorno · ${contenuto(r.componenti)}`)
              : h('span', { class: 'table__sub' }, 'Vostra prestazione');
          tbody.append(h('tr', null,
            h('td', { 'data-label': 'Riga', class: 'table__primary offerta__testo' }, tit, desc, info),
            h('td', { class: 'num', 'data-label': 'Q.tà' }, numIn('quantita', 'Quantità')),
            h('td', { class: 'num', 'data-label': 'Giorni' }, numIn('giorni', 'Giorni')),
            h('td', { class: 'num', 'data-label': 'Prezzo cliente CHF' }, numIn('prezzo_unitario', 'Prezzo')),
            h('td', { class: 'num', 'data-label': 'Importo CHF' }, imp),
            bozza ? h('td', { 'data-label': '' }, h('button', { class: 'btn btn--ghost btn--sm', type: 'button', 'aria-label': `Togli riga ${i + 1}`, onclick: () => { righe.splice(i, 1); disegna(); ridisegnaTotali(); } }, '×')) : null));
        });
        if (!righe.length) tbody.append(h('tr', null, h('td', { colspan: '6' }, h('span', { class: 'muted' }, 'Aggiungete le vostre prestazioni e il materiale Meekon.'))));
      };
      f.sconto_percento.addEventListener('input', ridisegnaTotali);
      ivaInclusa.querySelector('input').addEventListener('change', ridisegnaTotali);

      let aggiungi = null;
      if (bozza) {
        const scelta = h('select', { 'aria-label': 'Materiale Meekon' }, h('option', { value: '' }, '— Materiale Meekon —'),
          catalogo.map((c) => h('option', { value: c.id }, `${c.categoria} · ${c.descrizione} — ${fmtMoney(c.prezzo_partner)}/giorno${c.disponibili != null ? ` · liberi ${c.disponibili}` : ''}`)));
        const addMat = h('button', { class: 'btn', type: 'button' }, 'Aggiungi materiale');
        addMat.addEventListener('click', () => {
          const c = catalogo.find((x) => x.id === scelta.value);
          if (!c) { scelta.focus(); return; }
          righe.push({ tipo: 'materiale', articolo_id: c.id, titolo: c.descrizione.slice(0, 120), descrizione: (c.accessori || [c.marca, c.descrizione].filter(Boolean).join(' ')).slice(0, 500), quantita: 1, giorni: 1, prezzo_unitario: Number(c.prezzo_partner) || 0, sconto_percento: 0, opzionale: false });
          scelta.value = '';
          disegna(); ridisegnaTotali();
        });
        const addServ = h('button', { class: 'btn', type: 'button', onclick: () => { righe.push({ tipo: 'servizio', articolo_id: null, titolo: '', descrizione: '', quantita: 1, giorni: 1, prezzo_unitario: 0, sconto_percento: 0, opzionale: false }); disegna(); ridisegnaTotali(); } }, 'Aggiungi prestazione (es. DJ 6 ore)');
        const giorniEv = () => {
          if (!f.data_inizio.value) return 1;
          const a0 = new Date(f.data_inizio.value.slice(0, 10));
          const b0 = new Date((f.data_fine.value || f.data_inizio.value).slice(0, 10));
          return Math.max(1, Math.round((b0 - a0) / 86400000) + 1);
        };
        // modello di allestimento (es. schermo dietro con luci sopra): aggiunge tutto il materiale
        let daModello = null;
        let visivo = null;
        let configuratore = null;
        let selM = null;
        let addM = null;
        if (modelli.length) {
          selM = h('select', { 'aria-label': 'Modello di allestimento' }, h('option', { value: '' }, '— Modello di allestimento —'),
            modelli.map((m) => h('option', { value: m.id }, `${m.nome}${m.prezzo_giorno != null ? ` — ${fmtMoney(prezzoModello(m))}/giorno` : ''}`)));
          addM = h('button', { class: 'btn', type: 'button' }, 'Aggiungi modello');
          addM.addEventListener('click', () => {
            const m = modelli.find((x) => x.id === selM.value);
            if (!m) { selM.focus(); return; }
            aggiungiPacchetto(m);
            selM.value = '';
            disegna(); ridisegnaTotali();
            toast(`Modello "${m.nome}" aggiunto: decidete i prezzi per il cliente.`);
          });
          const aggiungiPacchetto = (m, scelta) => {
            // un pacchetto = una riga con prezzo unico; gli articoli restano come componenti per Meekon
            const comp = m.voci.map((v) => ({ articolo_id: v.articolo_id, quantita: v.quantita }));
            const desc = [scelta && scelta.misura, m.descrizione || contenuto(comp)].filter(Boolean).join(' · ');
            righe.push({ tipo: 'pacchetto', articolo_id: null, modello_id: m.id, componenti: comp, configurazione: scelta ? scelta.configurazione : null, titolo: m.nome.slice(0, 120),
              descrizione: desc.slice(0, 500), quantita: scelta ? scelta.quantita : 1, giorni: giorniEv(), prezzo_unitario: prezzoModello(m), sconto_percento: 0, opzionale: false });
          };
          // configuratore visivo dal disegno di Meekon: le parti collegate a un pacchetto si cliccano
          if (window.MeekonConfiguratore && modelli.some((m) => m.parte)) {
            configuratore = window.MeekonConfiguratore.crea({
              modelli, prezzo: prezzoModello, fmt: fmtMoney,
              onAggiungi: (lista) => { lista.forEach((s) => aggiungiPacchetto(s.modello, s)); disegna(); ridisegnaTotali(); toast(`${lista.length} pacchetti aggiunti: decidete i prezzi per il cliente.`); },
            });
          }
          daModello = [selM, addM];
        }
        // configuratore visivo: schede con il disegno dell'allestimento, un clic aggiunge il pacchetto
        const conDisegno = modelli.filter((m) => m.immagine && !m.parte);
        if (conDisegno.length) {
          visivo = h('div', { class: 'modelli-visivi' }, conDisegno.map((m) => {
            const b = h('button', { class: 'modello-visivo', type: 'button', title: m.descrizione || m.nome },
              h('img', { src: m.immagine, alt: '' }), h('strong', null, m.nome),
              h('span', null, m.prezzo_giorno != null ? `${fmtMoney(prezzoModello(m))} CHF / giorno` : ''));
            b.addEventListener('click', () => { selM.value = m.id; addM.click(); });
            return b;
          }));
        }
        aggiungi = h('div', null,
          configuratore ? [h('p', { class: 'muted' }, 'Cliccate sul disegno le parti che vi servono:'), configuratore] : null,
          visivo ? h('p', { class: 'muted' }, 'Installazioni particolari:') : null, visivo,
          h('div', { class: 'toolbar' }, daModello, scelta, addMat, addServ));
        [f.data_inizio, f.data_fine].forEach((el) => el.addEventListener('change', async () => { await caricaCatalogo(); disegna(); ridisegnaTotali(); }));
      }

      const alert = h('div');
      const salva = async () => {
        clear(alert);
        const err = righe.findIndex((r) => !r.descrizione.trim());
        if (err >= 0) { alert.append(alertBox(`Riga ${err + 1}: la descrizione è obbligatoria.`)); return false; }
        const body = {
          lingua: f.lingua.value, cliente_nome: f.cliente_nome.value.trim() || null, cliente_azienda: f.cliente_azienda.value.trim() || null,
          cliente_indirizzo: f.cliente_indirizzo.value.trim() || null, cliente_email: f.cliente_email.value.trim() || null, cliente_telefono: f.cliente_telefono.value.trim() || null,
          anrede: f.anrede.value.trim() || null, evento_titolo: f.evento_titolo.value.trim() || null, luogo: f.luogo.value.trim() || null,
          data_inizio: f.data_inizio.value || null, data_fine: f.data_fine.value || null, montaggio_da: f.montaggio_da.value || null,
          prese: Object.fromEntries(Object.entries(f.prese).map(([k, el]) => [k, Math.max(0, Math.min(50, Math.round(numero(el.value) || 0)))])),
          valida_fino: f.valida_fino.value || null, sconto_percento: numero(f.sconto_percento.value) || 0,
          prezzi_iva_inclusa: ivaInclusa.querySelector('input').checked,
          introduzione: f.introduzione.value.trim() || null, condizioni: f.condizioni.value.trim() || null,
        };
        await api(`partner-offerte/${encodeURIComponent(o.id)}`, { method: 'PATCH', body });
        await api(`partner-offerte/${encodeURIComponent(o.id)}/righe`, { method: 'PUT', body: { righe: righe.map((r) => ({ tipo: r.tipo, articolo_id: r.articolo_id || null, modello_id: r.modello_id || null, componenti: r.componenti || null, configurazione: r.configurazione || null, titolo: r.titolo.trim() || null, descrizione: r.descrizione.trim(), quantita: r.quantita, giorni: r.giorni, prezzo_unitario: r.prezzo_unitario, sconto_percento: r.sconto_percento, opzionale: !!r.opzionale })) } });
        return true;
      };

      // PDF: offerta o fattura a nome del partner
      const doc = h('section', { class: 'stampa', 'aria-hidden': 'true' });
      const stampa = (tipo) => {
        const OD = window.MeekonOffertaDoc;
        const agbM = data.agb_meekon || {};
        const l = f.lingua.value;
        const usaMeekon = prof.usa_agb_meekon !== false;
        const imp = {
          ditta: { nome: prof.ragione_sociale || state.me.nome, persona: prof.persona, slogan: prof.slogan, indirizzo: prof.indirizzo, telefono: prof.telefono,
            email: prof.email || null, iban: prof.iban, twint: prof.twint, mwst_pflichtig: prof.mwst_pflichtig, mwst_nr: prof.mwst_nr },
          regole: usaMeekon ? agbM.regole : {},
          scaglioni: usaMeekon ? agbM.scaglioni : [],
          testi: { [l]: { agb: usaMeekon ? ((agbM.testi && (agbM.testi[l] || agbM.testi.de) || {}).agb || '') : (prof.agb || '') } },
        };
        const res = OD.build({ h, add }, {
          tipo, lingua: l, numero: numeroOfferta(o), numeroOrdine: numeroOfferta(o), oggi: oggi(), valida: f.valida_fino.value || null,
          offerta: o, logo: prof.logo || null, senzaAnnullamento: !usaMeekon,
          evento: { titolo: f.evento_titolo.value, data_inizio: f.data_inizio.value || null, data_fine: f.data_fine.value || null, montaggio_da: f.montaggio_da.value || null, localita: f.luogo.value },
          cliente: { nome: f.cliente_nome.value, azienda: f.cliente_azienda.value, indirizzo: f.cliente_indirizzo.value, email: f.cliente_email.value, telefono: f.cliente_telefono.value },
          impostazioni: imp, righe: righe.map((r) => ({ ...r, categoria: categoriaDi(r) })), totali: totaliDi(righe, header()), partner: true,
          parti: window.MeekonConfiguratore ? window.MeekonConfiguratore.partiDisegno(righe.filter((r) => r.tipo === 'pacchetto'), modelli) : [],
          anrede: f.anrede.value.trim(), intro: f.introduzione.value.trim(), condizioni: f.condizioni.value.trim(), link: null,
        });
        clear(doc);
        doc.append(res.doc);
        const root = document.documentElement.style;
        root.setProperty('--mk-piede-1', JSON.stringify(res.piede[0]));
        root.setProperty('--mk-piede-2', JSON.stringify(res.piede[1]));
        root.setProperty('--mk-pagina', JSON.stringify(res.pagina.replace(/X\/Y$/, '')));
        const titolo = document.title;
        document.title = `${res.titolo} ${f.cliente_azienda.value || f.cliente_nome.value}`.trim();
        window.print();
        document.title = titolo;
      };

      const actions = [];
      const pdf = h('button', { class: 'btn', type: 'button' }, 'PDF offerta');
      pdf.addEventListener('click', () => busy(pdf, async () => { try { if (bozza && !(await salva())) return; stampa('offerta'); } catch (err) { alert.append(alertBox(errorMessage(err))); } }));
      actions.push(pdf);
      if (o.stato === 'accettata') {
        const fat = h('button', { class: 'btn btn--primary', type: 'button', onclick: () => stampa('fattura') }, 'Fattura (PDF)');
        actions.push(fat);
      }
      const stato = (nuovo, label, msg, primary = false) => {
        const b = h('button', { class: `btn${primary ? ' btn--primary' : ''}`, type: 'button' }, label);
        b.addEventListener('click', () => busy(b, async () => {
          try {
            if (bozza && !(await salva())) return;
            await api(`partner-offerte/${encodeURIComponent(o.id)}`, { method: 'PATCH', body: { stato: nuovo } });
            toast(msg);
            viewOfferta([id], alive);
          } catch (err) { alert.append(alertBox(errorMessage(err))); }
        }));
        return b;
      };
      if (isPartner) {
        if (bozza) {
          const save = h('button', { class: 'btn btn--primary', type: 'button' }, 'Salva');
          save.addEventListener('click', () => busy(save, async () => { try { if (await salva()) toast('Offerta salvata.'); } catch (err) { alert.append(alertBox(errorMessage(err))); } }));
          actions.push(stato('inviata', 'Segna come inviata al cliente', 'Offerta inviata: Meekon vede la richiesta di materiale.'), save);
          const del = h('button', { class: 'btn btn--danger', type: 'button' }, 'Elimina');
          del.addEventListener('click', () => {
            if (!window.confirm('Eliminare questa bozza?')) return;
            busy(del, async () => { try { await api(`partner-offerte/${encodeURIComponent(o.id)}`, { method: 'DELETE' }); window.location.hash = '#/partner'; } catch (err) { toast(errorMessage(err), 'error'); } });
          });
          actions.unshift(del);
        } else if (o.stato === 'inviata') {
          actions.push(stato('bozza', 'Modifica (torna in bozza)', 'Offerta tornata in bozza.'), stato('rifiutata', 'Rifiutata', 'Offerta segnata come rifiutata.'), stato('accettata', 'Accettata dal cliente', 'Accettata: Meekon conferma il materiale.', true));
        }
      }

      disegna();
      ridisegnaTotali();
      page({
        title: `Offerta ${numeroOfferta(o)}`,
        sub: h('span', null, badge(o.stato, STATI, BADGE), ' ', badge(o.materiale_stato, MATERIALE, BADGE_MAT)),
        actions,
        back: isPartner ? ['#/partner', 'Le mie offerte'] : ['#/richieste-partner', 'Richieste partner'],
      },
      alert,
      o.nota_meekon ? alertBox(`Nota di Meekon: ${o.nota_meekon}`, o.materiale_stato === 'rifiutato' ? 'error' : 'info') : null,
      !bozza && isPartner && o.stato !== 'accettata' ? alertBox('L\'offerta non si modifica più. Per cambiarla rimettetela in bozza (la richiesta di materiale si annulla).', 'info') : null,
      panels(
        h('section', { class: 'panel' }, h('div', { class: 'panel__head' }, h('h2', null, 'Cliente')),
          h('div', { class: 'fields' }, field('Nome e cognome', f.cliente_nome), field('Azienda', f.cliente_azienda), field('Indirizzo', f.cliente_indirizzo, { full: true }),
            field('E-mail', f.cliente_email), field('Telefono', f.cliente_telefono), field('Saluto (Anrede)', f.anrede, { full: true }))),
        h('section', { class: 'panel' }, h('div', { class: 'panel__head' }, h('h2', null, 'Evento')),
          h('div', { class: 'fields' }, field('Evento', f.evento_titolo, { full: true }), field('Luogo', f.luogo, { full: true }),
            field('Inizio', f.data_inizio), field('Fine', f.data_fine), field('Montaggio da', f.montaggio_da),
            h('fieldset', { class: 'field field--full prese' }, h('legend', null, 'Prese di corrente in location (quante per tipo)'),
              h('div', { class: 'prese__lista' }, Object.entries(f.prese).map(([k, el]) => h('label', { class: 'prese__voce' }, h('span', null, PRESE[k]), el)))))),
        wide(h('section', { class: 'panel' }, h('div', { class: 'panel__head' }, h('h2', null, 'Righe')),
          tabella(['Riga', 'Q.tà', 'Giorni', 'Prezzo cliente CHF', 'Importo CHF', ''], tbody), aggiungi, totBox, costoBox)),
        wide(h('section', { class: 'panel' }, h('div', { class: 'fields' },
          field('Lingua del PDF', f.lingua), field('Valida fino al', f.valida_fino), field('Sconto sul totale (%)', f.sconto_percento), h('div', { class: 'field' }, ivaInclusa),
          field('Testo iniziale', f.introduzione, { full: true }), field('Note aggiuntive', f.condizioni, { full: true }))))),
      doc);
    }

    // ---------------------------------------------------------------- partner: profilo
    async function viewProfilo(_, alive) {
      loading();
      let p;
      try { p = (await api('partner/profilo')).profilo || {}; } catch (err) { if (alive()) failure('Profilo', err); return; }
      if (!alive()) return;
      const inp = (k, attrs = {}) => h('input', { type: 'text', value: p[k] ?? '', ...attrs });
      const f = {
        ragione_sociale: inp('ragione_sociale', { maxlength: '160' }), persona: inp('persona', { maxlength: '120' }), slogan: inp('slogan', { maxlength: '160' }),
        indirizzo: h('textarea', { rows: '3', maxlength: '300' }), telefono: inp('telefono', { type: 'tel', maxlength: '40' }), email: inp('email', { type: 'email', maxlength: '254' }),
        iban: inp('iban', { maxlength: '42', placeholder: 'CH00 0000 0000 0000 0000 0' }), twint: inp('twint', { type: 'tel', maxlength: '40' }),
        mwst_nr: inp('mwst_nr', { maxlength: '40', placeholder: 'CHE-123.456.789 MWST' }), agb: h('textarea', { rows: '10', maxlength: '30000' }),
      };
      f.indirizzo.value = p.indirizzo || '';
      f.agb.value = p.agb || '';
      const mwst = select('mwst', [['', '— da decidere —'], ['si', 'Assoggettato all\'IVA (con numero IVA)'], ['no', 'Non assoggettato all\'IVA']], p.mwst_pflichtig === true ? 'si' : p.mwst_pflichtig === false ? 'no' : '');
      const agbScelta = select('agb_scelta', [['meekon', 'Usare le AGB di Meekon'], ['proprie', 'Usare le mie AGB']], p.usa_agb_meekon === false ? 'proprie' : 'meekon');
      let logo = p.logo || null;
      const anteprima = h('div', { class: 'partner-logo' });
      const mostraLogo = () => { clear(anteprima); if (logo) anteprima.append(h('img', { src: logo, alt: 'Logo' })); else anteprima.append(h('span', { class: 'muted' }, 'Nessun logo')); };
      mostraLogo();
      const file = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp' });
      file.addEventListener('change', () => {
        const fl = file.files && file.files[0];
        if (!fl) return;
        if (fl.size > 5 * 1024 * 1024) { toast('Immagine troppo grande (max 5 MB).', 'error'); return; }
        const img = new Image();
        const url = URL.createObjectURL(fl);
        img.onload = () => {
          // ridotto a max 600 px di larghezza, in PNG (sfondo trasparente conservato)
          const k = Math.min(1, 600 / img.width, 300 / img.height);
          const c = document.createElement('canvas');
          c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          URL.revokeObjectURL(url);
          const dataUrl = c.toDataURL('image/png');
          if (dataUrl.length > 400000) { toast('Logo troppo pesante anche dopo la riduzione: usate un file più semplice.', 'error'); return; }
          logo = dataUrl; mostraLogo();
        };
        img.onerror = () => { URL.revokeObjectURL(url); toast('File non leggibile come immagine.', 'error'); };
        img.src = url;
      });
      const togli = h('button', { class: 'btn btn--ghost btn--sm', type: 'button', onclick: () => { logo = null; mostraLogo(); } }, 'Togli logo');
      const alert = h('div');
      const save = h('button', { class: 'btn btn--primary', type: 'submit' }, 'Salva profilo');
      const form = h('form', { novalidate: true }, alert,
        h('section', { class: 'panel' }, h('div', { class: 'panel__head' }, h('h2', null, 'I vostri dati sul PDF')),
          h('div', { class: 'fields' }, field('Ragione sociale', f.ragione_sociale), field('Chi firma', f.persona), field('Slogan', f.slogan),
            field('Indirizzo', f.indirizzo), field('Telefono', f.telefono), field('E-mail', f.email), field('IBAN', f.iban), field('TWINT', f.twint),
            field('IVA', mwst), field('Numero IVA', f.mwst_nr),
            h('div', { class: 'field field--full' }, h('label', null, 'Logo'), anteprima, h('div', { class: 'toolbar' }, file, togli)))),
        h('section', { class: 'panel' }, h('div', { class: 'panel__head' }, h('h2', null, 'Condizioni generali (AGB)')),
          h('div', { class: 'fields' }, field('AGB nelle vostre offerte', agbScelta), field('Le vostre AGB', f.agb, { full: true, hint: 'Usate solo se scegliete "Usare le mie AGB". Con le vostre AGB il riquadro di annullamento di Meekon non viene stampato.' }))),
        h('div', { class: 'panel__foot' }, save));
      form.addEventListener('submit', (ev) => {
        ev.preventDefault();
        clear(alert);
        const val = (el) => el.value.trim() || null;
        const body = {
          ragione_sociale: val(f.ragione_sociale), persona: val(f.persona), slogan: val(f.slogan), indirizzo: val(f.indirizzo), telefono: val(f.telefono), email: val(f.email),
          iban: f.iban.value.replace(/\s+/g, '').toUpperCase() || null, twint: val(f.twint), mwst_nr: val(f.mwst_nr), logo,
          usa_agb_meekon: agbScelta.value === 'meekon', agb: val(f.agb),
          ...(mwst.value ? { mwst_pflichtig: mwst.value === 'si' } : {}),
        };
        if (body.mwst_pflichtig && !body.mwst_nr) { alert.append(alertBox('Con l\'IVA serve il numero IVA.')); return; }
        if (agbScelta.value === 'proprie' && !body.agb) { alert.append(alertBox('Incollate le vostre AGB o scegliete quelle di Meekon.')); return; }
        busy(save, async () => {
          try { await api('partner/profilo', { method: 'PUT', body }); toast('Profilo salvato.'); } catch (err) { alert.append(alertBox(err instanceof ApiError && err.field ? `Controllate il campo "${err.field}".` : errorMessage(err))); }
        });
      });
      page({ title: 'Il vostro profilo', sub: 'Intestazione, logo, banca e AGB delle vostre offerte' }, form);
    }

    // ---------------------------------------------------------------- ufficio: richieste dei partner
    let filtroRich = 'in_attesa,da_confermare';
    async function viewRichieste(_, alive) {
      loading();
      let off;
      let partner;
      try { [off, partner] = await Promise.all([api(`partner-offerte?materiale=${filtroRich}`), api('partner')]); } catch (err) { if (alive()) failure('Richieste partner', err); return; }
      if (!alive()) return;
      const filtro = select('filtro', [['in_attesa,da_confermare', 'Da gestire'], ['da_confermare', 'Da confermare (accettate dal cliente)'], ['in_attesa', 'In attesa (offerta inviata)'], ['confermato', 'Confermate'], ['rifiutato', 'Rifiutate']], filtroRich);
      filtro.addEventListener('change', () => { filtroRich = filtro.value; viewRichieste([], alive); });
      const schede = await Promise.all((off.offerte || []).map(async (o) => {
        let det;
        try { det = await api(`partner-offerte/${encodeURIComponent(o.id)}`); } catch (err) { return null; }
        const da = giorno(o.data_inizio);
        let disp = new Map();
        if (da) { try { disp = new Map(((await api(`partner/catalogo?da=${da}&a=${giorno(o.data_fine) || da}`)).catalogo || []).map((c) => [c.id, c.disponibili])); } catch (err) { /* ok */ } }
        const mat = (det.righe || []).filter((r) => r.tipo === 'materiale' && !r.opzionale);
        const nota = h('input', { type: 'text', maxlength: '2000', placeholder: 'Nota per il partner (obbligatoria per rifiutare)', 'aria-label': 'Nota' });
        const azioni = h('div', { class: 'panel__foot' });
        if (o.materiale_stato === 'da_confermare') {
          const ok = h('button', { class: 'btn btn--primary', type: 'button' }, 'Conferma materiale e crea evento');
          ok.addEventListener('click', () => busy(ok, async () => {
            try { const r = await api(`partner-offerte/${encodeURIComponent(o.id)}/materiale`, { method: 'POST', body: { azione: 'conferma', nota: nota.value.trim() || null } }); toast('Confermato: evento creato.'); window.location.hash = `#/evento/${encodeURIComponent(r.evento_id)}`; } catch (err) { toast(errorMessage(err), 'error'); }
          }));
          azioni.append(ok);
        }
        if (['in_attesa', 'da_confermare'].includes(o.materiale_stato)) {
          const no = h('button', { class: 'btn btn--danger', type: 'button' }, 'Rifiuta');
          no.addEventListener('click', () => {
            if (!nota.value.trim()) { nota.setAttribute('aria-invalid', 'true'); nota.focus(); return; }
            busy(no, async () => { try { await api(`partner-offerte/${encodeURIComponent(o.id)}/materiale`, { method: 'POST', body: { azione: 'rifiuta', nota: nota.value.trim() } }); toast('Richiesta rifiutata.'); viewRichieste([], alive); } catch (err) { toast(errorMessage(err), 'error'); } });
          });
          azioni.prepend(nota, ' ', no);
        }
        return h('section', { class: 'panel' },
          h('div', { class: 'panel__head' }, h('h2', null, `${o.partner_nome || 'Partner'} · ${numeroOfferta(o)}`), badge(o.materiale_stato, MATERIALE, BADGE_MAT)),
          dl([
            ['Cliente finale', o.cliente_azienda || o.cliente_nome || '—'],
            ['Evento', [o.evento_titolo, fmtRange(o.data_inizio, o.data_fine)].filter(Boolean).join(' · ')],
            ['Luogo', o.luogo || '—'],
            ['Prese in location', testoPrese(o.prese)],
            ['Costo materiale (prezzo partner)', chf(det.costo_materiale)],
            o.evento_id ? ['Evento Meekon', h('a', { href: `#/evento/${encodeURIComponent(o.evento_id)}` }, 'Apri evento')] : null,
            o.nota_meekon ? ['Nota', o.nota_meekon] : null,
          ].filter(Boolean)),
          mat.length ? tabella(['Materiale', 'Q.tà', 'Giorni', 'Liberi'], mat.map((r) => h('tr', null, td('Materiale', r.titolo || r.descrizione),
            h('td', { class: 'num', 'data-label': 'Q.tà' }, h('span', { class: disp.has(r.articolo_id) && disp.get(r.articolo_id) < Number(r.quantita) ? 'text-danger' : null }, Number(r.quantita))),
            h('td', { class: 'num', 'data-label': 'Giorni' }, h('span', null, Number(r.giorni))),
            h('td', { class: 'num', 'data-label': 'Liberi' }, h('span', null, disp.has(r.articolo_id) ? disp.get(r.articolo_id) : '—'))))) : null,
          azioni.childNodes.length ? azioni : null);
      }));
      if (!alive()) return;

      // partner e sconti
      const righeP = (partner.partner || []).map((p) => {
        const sc = h('input', { inputmode: 'decimal', class: 'input--num', value: String(p.profilo ? Number(p.profilo.sconto_partner_percento) : 0), 'aria-label': `Sconto ${p.nome}` });
        const save = h('button', { class: 'btn btn--sm', type: 'button' }, 'Salva');
        save.addEventListener('click', () => busy(save, async () => {
          const n = numero(sc.value);
          if (!(n >= 0 && n <= 100)) { sc.setAttribute('aria-invalid', 'true'); return; }
          try { await api(`partner/${encodeURIComponent(p.id)}`, { method: 'PATCH', body: { sconto_partner_percento: n } }); toast(`${p.nome}: sconto salvato.`); } catch (err) { toast(errorMessage(err), 'error'); }
        }));
        return h('tr', null, td('Partner', p.profilo && p.profilo.ragione_sociale ? `${p.profilo.ragione_sociale} (${p.nome})` : p.nome),
          td('Contatto', p.profilo && p.profilo.email ? mailLink(p.profilo.email) : telLink(p.telefono)),
          td('AGB', p.profilo && p.profilo.usa_agb_meekon === false ? 'Proprie' : 'Meekon'),
          h('td', { class: 'num', 'data-label': 'Sconto %' }, sc), h('td', { 'data-label': '' }, save));
      });
      page({ title: 'Richieste partner', sub: 'Materiale richiesto dai DJ partner per le loro offerte', actions: [filtro] },
        schede.filter(Boolean).length ? schede.filter(Boolean) : empty('Nessuna richiesta', 'Le richieste arrivano quando un partner invia un\'offerta con materiale Meekon.'),
        h('section', { class: 'panel' }, h('div', { class: 'panel__head' }, h('h2', null, 'Partner e sconto sul materiale')),
          righeP.length ? tabella(['Partner', 'Contatto', 'AGB', 'Sconto %', ''], righeP) : h('p', { class: 'muted' }, 'Nessun partner. Gli account si creano come gli altri utenti, con ruolo "Partner".')));
    }

    return { viewOfferte, viewOfferta, viewProfilo, viewRichieste };
  }

  window.MeekonPartner = { create };
})();
