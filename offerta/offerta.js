// Pagina pubblica "Offerte online bestätigen" (link segreto ?t=… inviato al cliente).
// Mostra il riepilogo dell'offerta e registra l'accettazione: due caselle obbligatorie
// (AGB, annullamento) e una facoltativa (foto). Il server registra nome, data/ora, IP e versione AGB.
// Dati inseriti solo con textContent / creazione di nodi (mai innerHTML).
(() => {
  'use strict';

  const T = {
    de: {
      titolo: 'Offerte', per: 'Für', anlass: 'Anlass', datum: 'Datum', location: 'Location', daDefinire: 'wird noch bestimmt',
      leistung: 'Leistung', menge: 'Menge', totale: 'Total CHF', tot: 'Total', opz: 'Optional (nicht im Total enthalten)', valida: 'Gültig bis',
      nome: 'Ihr Vor- und Nachname', agb: (v) => `Ich habe die AGB (Version ${v}) gelesen und akzeptiere sie.`, ann: 'Ich akzeptiere die Reservationsentschädigung von 20 % und die Annullationsregeln gemäss Ziff. 9 AGB.',
      foto: 'Meekon darf Fotos, auf denen Personen erkennbar sind, als Referenz veröffentlichen. (freiwillig)', bottone: 'Offerte verbindlich bestätigen',
      ok: (d) => `Vielen Dank! Die Offerte wurde am ${d} bestätigt. Sie erhalten in Kürze die Auftragsbestätigung.`, gia: (d, n) => `Diese Offerte wurde am ${d}${n ? ` von ${n}` : ''} bestätigt.`,
      scaduta: 'Diese Offerte ist abgelaufen oder nicht mehr gültig. Bitte kontaktieren Sie uns für eine neue Offerte.', nonTrovata: 'Offerte nicht gefunden. Bitte prüfen Sie den Link.',
      errore: 'Die Bestätigung hat nicht geklappt. Bitte versuchen Sie es erneut oder kontaktieren Sie uns.', obbl: 'Bitte füllen Sie Ihren Namen aus und bestätigen Sie die beiden Pflichtfelder.',
      contatto: 'Fragen? info@meekondisplay.ch · WhatsApp 079 945 00 00',
    },
    it: {
      titolo: 'Offerta', per: 'Per', anlass: 'Evento', datum: 'Data', location: 'Location', daDefinire: 'da definire',
      leistung: 'Prestazione', menge: 'Quantità', totale: 'Totale CHF', tot: 'Totale', opz: 'Opzioni (non comprese nel totale)', valida: 'Valida fino al',
      nome: 'Nome e cognome', agb: (v) => `Ho letto e accetto le condizioni generali (versione ${v}).`, ann: 'Accetto l\'indennità di riservazione del 20 % e le regole di annullamento secondo la cifra 9 delle CG.',
      foto: 'Meekon può pubblicare come referenza foto in cui le persone sono riconoscibili. (facoltativo)', bottone: 'Confermare l\'offerta in modo vincolante',
      ok: (d) => `Grazie! L'offerta è stata confermata il ${d}. Riceverete a breve la conferma d'ordine.`, gia: (d, n) => `Questa offerta è stata confermata il ${d}${n ? ` da ${n}` : ''}.`,
      scaduta: 'Questa offerta è scaduta o non è più valida. Contattateci per una nuova offerta.', nonTrovata: 'Offerta non trovata. Controllate il link.',
      errore: 'La conferma non è riuscita. Riprovate o contattateci.', obbl: 'Inserite il vostro nome e spuntate le due caselle obbligatorie.',
      contatto: 'Domande? info@meekondisplay.ch · WhatsApp 079 945 00 00',
    },
    fr: {
      titolo: 'Offre', per: 'Pour', anlass: 'Événement', datum: 'Date', location: 'Lieu', daDefinire: 'à définir',
      leistung: 'Prestation', menge: 'Quantité', totale: 'Total CHF', tot: 'Total', opz: 'Options (non comprises dans le total)', valida: 'Valable jusqu\'au',
      nome: 'Prénom et nom', agb: (v) => `J'ai lu et j'accepte les conditions générales (version ${v}).`, ann: 'J\'accepte l\'indemnité de réservation de 20 % et les règles d\'annulation selon le ch. 9 des CG.',
      foto: 'Meekon peut publier comme référence des photos sur lesquelles des personnes sont reconnaissables. (facultatif)', bottone: 'Confirmer l\'offre de manière ferme',
      ok: (d) => `Merci ! L'offre a été confirmée le ${d}. Vous recevrez sous peu la confirmation de commande.`, gia: (d, n) => `Cette offre a été confirmée le ${d}${n ? ` par ${n}` : ''}.`,
      scaduta: 'Cette offre a expiré ou n\'est plus valable. Contactez-nous pour une nouvelle offre.', nonTrovata: 'Offre introuvable. Veuillez vérifier le lien.',
      errore: 'La confirmation a échoué. Réessayez ou contactez-nous.', obbl: 'Indiquez votre nom et cochez les deux cases obligatoires.',
      contatto: 'Des questions ? info@meekondisplay.ch · WhatsApp 079 945 00 00',
    },
    en: {
      titolo: 'Quotation', per: 'For', anlass: 'Event', datum: 'Date', location: 'Location', daDefinire: 'to be confirmed',
      leistung: 'Service', menge: 'Qty', totale: 'Total CHF', tot: 'Total', opz: 'Options (not included in the total)', valida: 'Valid until',
      nome: 'First and last name', agb: (v) => `I have read and accept the terms and conditions (version ${v}).`, ann: 'I accept the 20 % reservation fee and the cancellation rules under section 9 of the T&C.',
      foto: 'Meekon may publish photos in which people are recognisable as a reference. (optional)', bottone: 'Confirm the quotation (binding)',
      ok: (d) => `Thank you! The quotation was confirmed on ${d}. You will receive the order confirmation shortly.`, gia: (d, n) => `This quotation was confirmed on ${d}${n ? ` by ${n}` : ''}.`,
      scaduta: 'This quotation has expired or is no longer valid. Please contact us for a new one.', nonTrovata: 'Quotation not found. Please check the link.',
      errore: 'The confirmation did not work. Please try again or contact us.', obbl: 'Please enter your name and tick the two required boxes.',
      contatto: 'Questions? info@meekondisplay.ch · WhatsApp 079 945 00 00',
    },
  };

  const main = document.getElementById('main');
  const tok = new URLSearchParams(window.location.search).get('t') || '';

  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'checked' || k === 'disabled') el[k] = v;
      else el.setAttribute(k, v === true ? '' : String(v));
    }
    for (const c of kids.flat(Infinity)) if (c !== null && c !== undefined && c !== false) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
    return el;
  }
  const chf = (n) => { const [i, d] = Math.abs(Number(n) || 0).toFixed(2).split('.'); return `${i.replace(/\B(?=(\d{3})+(?!\d))/g, "'")}.${d}`; };
  const dataCh = (v) => { if (!v) return '—'; const [y, m, d] = String(v).slice(0, 10).split('-').map(Number); return `${d}.${m}.${y}`; };
  const quando = (v) => (v ? new Date(v).toLocaleString('de-CH', { day: 'numeric', month: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
  const importo = (r) => Math.round(r.quantita * r.giorni * r.prezzo_unitario * (1 - r.sconto_percento / 100) * 100) / 100;

  function mostra(...nodi) {
    document.getElementById('loading')?.remove();
    main.querySelectorAll('.offerta-pubblica__corpo').forEach((n) => n.remove());
    main.append(h('div', { class: 'offerta-pubblica__corpo' }, nodi));
  }

  async function avvia() {
    const lingua = (navigator.language || 'de').slice(0, 2);
    let tx = T[lingua] || T.de;
    if (!/^[0-9a-f]{48}$/.test(tok)) { mostra(h('p', { class: 'alert alert--error', role: 'alert' }, tx.nonTrovata)); return; }
    let o;
    try {
      const res = await fetch(`/api/offerta-pubblica?t=${tok}`, { credentials: 'omit' });
      if (!res.ok) throw new Error(String(res.status));
      o = (await res.json()).offerta;
    } catch (err) { mostra(h('p', { class: 'alert alert--error', role: 'alert' }, tx.nonTrovata)); return; }
    tx = T[o.lingua] || T.de;
    document.documentElement.lang = o.lingua || 'de';
    document.title = `${tx.titolo} ${o.numero} — Meekon Displays`;

    const righe = (o.righe || []).map((r) => ({ ...r, quantita: Number(r.quantita), giorni: Number(r.giorni), prezzo_unitario: Number(r.prezzo_unitario), sconto_percento: Number(r.sconto_percento) }));
    const tabella = (list) => h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
      h('thead', null, h('tr', null, h('th', { scope: 'col' }, tx.leistung), h('th', { scope: 'col', class: 'num' }, tx.menge), h('th', { scope: 'col', class: 'num' }, tx.totale))),
      h('tbody', null, list.map((r) => h('tr', null,
        h('td', { 'data-label': tx.leistung, class: 'table__primary' }, h('span', null, h('strong', null, r.titolo || r.descrizione), r.titolo ? h('span', { class: 'table__sub' }, r.descrizione) : null)),
        h('td', { 'data-label': tx.menge, class: 'num' }, h('span', null, r.quantita)), h('td', { 'data-label': tx.totale, class: 'num' }, h('span', null, chf(importo(r)))))))));
    const base = righe.filter((r) => !r.opzionale);
    const opz = righe.filter((r) => r.opzionale);
    const ev = o.evento || {};
    const riepilogo = [
      h('h1', null, `${tx.titolo} ${o.numero}`),
      h('dl', { class: 'dl' },
        h('dt', null, tx.per), h('dd', null, o.cliente || '—'),
        h('dt', null, tx.anlass), h('dd', null, ev.titolo || '—'),
        h('dt', null, tx.datum), h('dd', null, dataCh(ev.data_inizio)),
        h('dt', null, tx.location), h('dd', null, ev.luogo || tx.daDefinire),
        o.valida_fino ? [h('dt', null, tx.valida), h('dd', null, dataCh(o.valida_fino))] : null),
      tabella(base),
      h('p', { class: 'offerta-pubblica__totale' }, h('span', null, tx.tot), h('strong', null, `CHF ${chf(o.totali.totale)}`)),
      opz.length ? [h('p', { class: 'muted' }, tx.opz), tabella(opz)] : null,
    ];

    if (o.stato === 'accettata') { mostra(riepilogo, h('p', { class: 'alert alert--ok', role: 'status' }, tx.gia(quando(o.accettata_il), o.accettata_nome)), h('p', { class: 'muted' }, tx.contatto)); return; }
    if (o.scaduta || o.stato !== 'inviata') { mostra(riepilogo, h('p', { class: 'alert alert--error', role: 'alert' }, tx.scaduta), h('p', { class: 'muted' }, tx.contatto)); return; }

    const nome = h('input', { id: 'nome', type: 'text', maxlength: '120', autocomplete: 'name', required: true });
    const agb = h('input', { type: 'checkbox', required: true });
    const ann = h('input', { type: 'checkbox', required: true });
    const foto = h('input', { type: 'checkbox' });
    const errore = h('p', { class: 'alert alert--error', role: 'alert', hidden: true });
    const bottone = h('button', { class: 'btn btn--primary', type: 'submit' }, tx.bottone);
    const form = h('form', { novalidate: true },
      h('div', { class: 'field' }, h('label', { for: 'nome' }, tx.nome), nome),
      h('label', { class: 'check' }, agb, h('span', null, tx.agb(o.agb_versione || '2.0'))),
      h('label', { class: 'check' }, ann, h('span', null, tx.ann)),
      h('label', { class: 'check' }, foto, h('span', null, tx.foto)),
      errore, bottone);
    form.addEventListener('submit', async (ev2) => {
      ev2.preventDefault();
      errore.hidden = true;
      if (nome.value.trim().length < 2 || !agb.checked || !ann.checked) { errore.textContent = tx.obbl; errore.hidden = false; return; }
      bottone.disabled = true;
      try {
        const res = await fetch('/api/offerta-pubblica', {
          method: 'POST', credentials: 'omit',
          headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'meekon' },
          body: JSON.stringify({ t: tok, nome: nome.value.trim(), agb: true, annullamento: true, foto: foto.checked }),
        });
        if (res.status === 409) { mostra(riepilogo, h('p', { class: 'alert alert--error', role: 'alert' }, tx.scaduta)); return; }
        if (!res.ok) throw new Error(String(res.status));
        const r = await res.json();
        mostra(riepilogo, h('p', { class: 'alert alert--ok', role: 'status' }, tx.ok(quando(r.accettata_il || new Date().toISOString()))), h('p', { class: 'muted' }, tx.contatto));
      } catch (err) {
        errore.textContent = tx.errore; errore.hidden = false; bottone.disabled = false;
      }
    });
    mostra(riepilogo, form, h('p', { class: 'muted' }, tx.contatto));
  }

  avvia();
})();
