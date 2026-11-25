// Area riservata Meekon Displays — documento dell'offerta / conferma d'ordine da stampare in PDF.
// Specifica approvata (dicembre 2026): intestazione, Für/Von, riquadro evento avorio, tabella delle
// prestazioni, totale su fascia grafite, pagamento, annullamento, accettazione online, firma,
// footer con pagine, AGB su due colonne nell'ultima pagina. Etichette in DE/IT/FR/EN.
// Regole come app.js: solo creazione di nodi (mai innerHTML), nessun attributo style=.
// Intestazione, IBAN, AGB e regole arrivano dalle Impostazioni (database), non da questo file.
(() => {
  'use strict';

  /** Valori predefiniti della specifica (sovrascritti da impostazioni.regole / .scaglioni). */
  const REGOLE = {
    validita_giorni: 14, acconto_percento: 50, acconto_giorni: 10, saldo_giorni_prima: 7, sofort_sotto_giorni: 30,
    indennita_percento: 20, bedenkfrist_giorni: 7, km_inclusi: 30, agb_versione: '2.0', agb_stand: 'Dezember 2026',
  };
  const SCAGLIONI = [{ giorni_min: 180, percento: 20 }, { giorni_min: 90, percento: 50 }, { giorni_min: 31, percento: 70 }, { giorni_min: 8, percento: 85 }, { giorni_min: 0, percento: 90 }];

  const L = {
    de: {
      offerta: 'Offerte', conferma: 'Auftragsbestätigung', fattura: 'Rechnung', fatturaNr: 'Rechnungs-Nr.', pagabile: 'Zahlbar an', nr: 'Nr.', valida: 'gültig bis', per: 'Für', da: 'Von',
      anlass: 'Anlass', datum: 'Datum', location: 'Location', daDefinire: 'wird noch bestimmt', aufbau: 'Aufbau ab', betrieb: 'Betrieb', abbau: 'Abbau', kontakt: 'Ansprechperson vor Ort',
      pos: 'Pos', leistung: 'Leistung', menge: 'Menge', prezzo: 'Einzelpreis', totale: 'Total CHF', giorni: (n) => `${n} Tage`,
      sub: 'Zwischentotal', sconto: 'Rabatt', totIva: (p) => `Total inkl. ${p} % MWST`, tot: 'Total', davon: (p) => `davon MWST ${p} %`, nonIva: 'Nicht mehrwertsteuerpflichtig',
      opzionali: 'Optional (nicht im Total enthalten)',
      pagamento: 'Zahlung', acconto: (p) => `Anzahlung ${p} %`, accontoEntro: (g) => `innert ${g} Tagen nach Bestätigung`, entro: 'bis', saldo: 'Restbetrag', sofort: 'Gesamtbetrag sofort fällig', modo: 'per Überweisung (QR-Rechnung) oder TWINT',
      annullamento: 'Annullation', tier: (min, max) => (max == null ? `ab ${min} Tagen vor dem Anlass` : (min === 0 ? `${max} Tage oder weniger / No-Show` : `${max}–${min} Tage vor dem Anlass`)),
      indennita: (p) => `${p} % gelten als Reservationsentschädigung für das blockierte Datum (Ziff. 9.1 AGB).`, bedenk: (g) => `Kostenlose Bedenkfrist ${g} Tage (Ziff. 9.7).`,
      accetta: 'Offerte online bestätigen', accettaTxt: 'Bestätigen Sie die Offerte bequem online:', carta: 'Oder unterschrieben zurücksenden:', firmaCarta: 'Ort, Datum, Unterschrift',
      accettataIl: (d, n) => `Angenommen am ${d}${n ? ` von ${n}` : ''}`, auftrag: 'Auftrags-Nr.',
      pagina: (a, b) => `Seite ${a}/${b}`, agbRef: (v) => `Es gelten die AGB Version ${v}`, agbTitolo: 'Allgemeine Geschäftsbedingungen (AGB)', agbStand: (v, s) => `Version ${v}, Stand ${s}`, massgebend: '',
      saluti: 'Freundliche Grüsse',
      intro: 'Vielen Dank für Ihre Anfrage. Gerne sorgen wir an Ihrem Anlass für Licht, Bild und Stimmung. Hier ist unser Angebot.',
      inbegriffen: 'Inbegriffen: Transport (bis {km} km), Auf- und Abbau, technische Betreuung von {von} bis {bis} Uhr.',
      chiusura: 'Bei Fragen erreichen Sie uns jederzeit per WhatsApp. Wir freuen uns auf Ihren Anlass!',
      anrede: (n) => `Guten Tag ${n}`,
    },
    it: {
      offerta: 'Offerta', conferma: 'Conferma d\'ordine', fattura: 'Fattura', fatturaNr: 'Fattura N.', pagabile: 'Pagabile a', nr: 'N.', valida: 'valida fino al', per: 'Per', da: 'Da',
      anlass: 'Evento', datum: 'Data', location: 'Location', daDefinire: 'da definire', aufbau: 'Montaggio da', betrieb: 'Servizio', abbau: 'Smontaggio', kontakt: 'Referente sul posto',
      pos: 'Pos', leistung: 'Prestazione', menge: 'Quantità', prezzo: 'Prezzo unitario', totale: 'Totale CHF', giorni: (n) => `${n} giorni`,
      sub: 'Subtotale', sconto: 'Sconto', totIva: (p) => `Totale IVA ${p} % inclusa`, tot: 'Totale', davon: (p) => `di cui IVA ${p} %`, nonIva: 'Non assoggettato all\'IVA',
      opzionali: 'Opzioni (non comprese nel totale)',
      pagamento: 'Pagamento', acconto: (p) => `Acconto ${p} %`, accontoEntro: (g) => `entro ${g} giorni dalla conferma`, entro: 'entro il', saldo: 'Saldo', sofort: 'Importo totale dovuto subito', modo: 'tramite bonifico (QR-fattura) o TWINT',
      annullamento: 'Annullamento', tier: (min, max) => (max == null ? `da ${min} giorni prima dell'evento` : (min === 0 ? `${max} giorni o meno / mancata presenza` : `${max}–${min} giorni prima dell'evento`)),
      indennita: (p) => `Il ${p} % vale come indennità di riservazione per la data bloccata (cifra 9.1 CG).`, bedenk: (g) => `Periodo di riflessione gratuito di ${g} giorni (cifra 9.7).`,
      accetta: 'Confermare l\'offerta online', accettaTxt: 'Confermate l\'offerta comodamente online:', carta: 'Oppure rispediteci l\'offerta firmata:', firmaCarta: 'Luogo, data, firma',
      accettataIl: (d, n) => `Accettata il ${d}${n ? ` da ${n}` : ''}`, auftrag: 'N. d\'ordine',
      pagina: (a, b) => `Pagina ${a}/${b}`, agbRef: (v) => `Valgono le CG versione ${v}`, agbTitolo: 'Condizioni generali (CG)', agbStand: (v, s) => `Versione ${v}, stato ${s}`, massgebend: 'Fa fede la versione tedesca delle CG.',
      saluti: 'Cordiali saluti',
      intro: 'Grazie per la vostra richiesta. Saremo felici di portare luce, immagini e atmosfera al vostro evento. Ecco la nostra offerta.',
      inbegriffen: 'Compresi: trasporto (fino a {km} km), montaggio e smontaggio, assistenza tecnica dalle {von} alle {bis}.',
      chiusura: 'Per qualsiasi domanda ci trovate sempre su WhatsApp. Non vediamo l\'ora di accompagnare il vostro evento!',
      anrede: (n) => `Buongiorno ${n}`,
    },
    fr: {
      offerta: 'Offre', conferma: 'Confirmation de commande', fattura: 'Facture', fatturaNr: 'Facture N°', pagabile: 'Payable à', nr: 'N°', valida: 'valable jusqu\'au', per: 'Pour', da: 'De',
      anlass: 'Événement', datum: 'Date', location: 'Lieu', daDefinire: 'à définir', aufbau: 'Montage dès', betrieb: 'Service', abbau: 'Démontage', kontakt: 'Personne de contact sur place',
      pos: 'Pos', leistung: 'Prestation', menge: 'Quantité', prezzo: 'Prix unitaire', totale: 'Total CHF', giorni: (n) => `${n} jours`,
      sub: 'Sous-total', sconto: 'Rabais', totIva: (p) => `Total TVA ${p} % incluse`, tot: 'Total', davon: (p) => `dont TVA ${p} %`, nonIva: 'Non assujetti à la TVA',
      opzionali: 'Options (non comprises dans le total)',
      pagamento: 'Paiement', acconto: (p) => `Acompte ${p} %`, accontoEntro: (g) => `dans les ${g} jours suivant la confirmation`, entro: 'jusqu\'au', saldo: 'Solde', sofort: 'Montant total payable immédiatement', modo: 'par virement (QR-facture) ou TWINT',
      annullamento: 'Annulation', tier: (min, max) => (max == null ? `dès ${min} jours avant l'événement` : (min === 0 ? `${max} jours ou moins / absence` : `${max}–${min} jours avant l'événement`)),
      indennita: (p) => `${p} % valent indemnité de réservation pour la date bloquée (ch. 9.1 CG).`, bedenk: (g) => `Délai de réflexion gratuit de ${g} jours (ch. 9.7).`,
      accetta: 'Confirmer l\'offre en ligne', accettaTxt: 'Confirmez l\'offre facilement en ligne :', carta: 'Ou renvoyez-la signée :', firmaCarta: 'Lieu, date, signature',
      accettataIl: (d, n) => `Acceptée le ${d}${n ? ` par ${n}` : ''}`, auftrag: 'N° de commande',
      pagina: (a, b) => `Page ${a}/${b}`, agbRef: (v) => `Les CG version ${v} s'appliquent`, agbTitolo: 'Conditions générales (CG)', agbStand: (v, s) => `Version ${v}, état ${s}`, massgebend: 'La version allemande des CG fait foi.',
      saluti: 'Meilleures salutations',
      intro: 'Merci pour votre demande. Nous serons ravis d\'apporter lumière, image et ambiance à votre événement. Voici notre offre.',
      inbegriffen: 'Compris : transport (jusqu\'à {km} km), montage et démontage, assistance technique de {von} à {bis} h.',
      chiusura: 'Pour toute question, joignez-nous à tout moment sur WhatsApp. Nous nous réjouissons de votre événement !',
      anrede: (n) => `Bonjour ${n}`,
    },
    en: {
      offerta: 'Quotation', conferma: 'Order confirmation', fattura: 'Invoice', fatturaNr: 'Invoice no.', pagabile: 'Payable to', nr: 'No.', valida: 'valid until', per: 'For', da: 'From',
      anlass: 'Event', datum: 'Date', location: 'Location', daDefinire: 'to be confirmed', aufbau: 'Set-up from', betrieb: 'Service', abbau: 'Dismantling', kontakt: 'Contact on site',
      pos: 'Pos', leistung: 'Service', menge: 'Qty', prezzo: 'Unit price', totale: 'Total CHF', giorni: (n) => `${n} days`,
      sub: 'Subtotal', sconto: 'Discount', totIva: (p) => `Total incl. ${p} % VAT`, tot: 'Total', davon: (p) => `of which VAT ${p} %`, nonIva: 'Not subject to VAT',
      opzionali: 'Options (not included in the total)',
      pagamento: 'Payment', acconto: (p) => `Deposit ${p} %`, accontoEntro: (g) => `within ${g} days of confirmation`, entro: 'by', saldo: 'Balance', sofort: 'Full amount due immediately', modo: 'by bank transfer (QR bill) or TWINT',
      annullamento: 'Cancellation', tier: (min, max) => (max == null ? `${min} days or more before the event` : (min === 0 ? `${max} days or less / no-show` : `${max}–${min} days before the event`)),
      indennita: (p) => `${p} % is retained as a reservation fee for the blocked date (section 9.1 T&C).`, bedenk: (g) => `Free cooling-off period of ${g} days (section 9.7).`,
      accetta: 'Confirm the quotation online', accettaTxt: 'Confirm the quotation easily online:', carta: 'Or return it signed:', firmaCarta: 'Place, date, signature',
      accettataIl: (d, n) => `Accepted on ${d}${n ? ` by ${n}` : ''}`, auftrag: 'Order no.',
      pagina: (a, b) => `Page ${a}/${b}`, agbRef: (v) => `Our T&C version ${v} apply`, agbTitolo: 'General terms and conditions (T&C)', agbStand: (v, s) => `Version ${v}, ${s}`, massgebend: 'The German version of the T&C is binding.',
      saluti: 'Kind regards',
      intro: 'Thank you for your enquiry. We would be delighted to bring light, picture and atmosphere to your event. Here is our quotation.',
      inbegriffen: 'Included: transport (up to {km} km), set-up and dismantling, technical support from {von} to {bis}.',
      chiusura: 'If you have any questions, reach us any time on WhatsApp. We look forward to your event!',
      anrede: (n) => `Hello ${n}`,
    },
  };

  // Gruppi della tabella: le categorie del magazzino diventano titoli (Bild & LED, Licht, Ton…), nell'ordine qui sotto.
  const GRUPPI = [
    { k: 'led', re: /^(led|led ?wand|display|schermo|schermi|screen|bild|video ?wall)/i, de: 'Bild & LED-Screens', it: 'Immagine e schermi LED', fr: 'Image et écrans LED', en: 'Screens & LED' },
    { k: 'luci', re: /^(licht|light|lighting|luci|luce|lumi[eè]re)/i, de: 'Licht', it: 'Luci', fr: 'Lumière', en: 'Lighting' },
    { k: 'audio', re: /^(audio|ton|sound|suono)/i, de: 'Ton', it: 'Audio', fr: 'Son', en: 'Sound' },
    { k: 'video', re: /^(video|kamera|camera)/i, de: 'Video', it: 'Video', fr: 'Vidéo', en: 'Video' },
    { k: 'rigging', re: /^(rigging|regging|truss|traversen|podest|bühne|palco|stage)/i, de: 'Rigging & Bühne', it: 'Strutture e palco', fr: 'Structures et scène', en: 'Rigging & stage' },
    { k: 'strom', re: /^(strom|power|corrente|elettric|kabel|cables?|cavi)/i, de: 'Strom & Kabel', it: 'Corrente e cavi', fr: 'Électricité et câbles', en: 'Power & cables' },
    { k: 'effetti', re: /^(effekt|effect|effett|nebel|fog)/i, de: 'Effekte', it: 'Effetti', fr: 'Effets', en: 'Effects' },
  ];
  const ALTRO = { de: 'Weiteres Material', it: 'Altro materiale', fr: 'Autre matériel', en: 'Other equipment' };
  const SERVIZI = { de: 'Leistungen', it: 'Prestazioni', fr: 'Prestations', en: 'Services' };
  /** Titolo del gruppo di una riga: dalla categoria dell'articolo; righe libere = "Leistungen". */
  function gruppoDi(r, lingua) {
    const cat = (r.categoria || '').trim();
    if (!cat) return { k: 'zz_servizi', titolo: SERVIZI[lingua] || SERVIZI.de, ordine: 99 };
    const i = GRUPPI.findIndex((g) => g.re.test(cat));
    if (i >= 0) return { k: GRUPPI[i].k, titolo: GRUPPI[i][lingua] || GRUPPI[i].de, ordine: i };
    return { k: `cat_${cat.toLowerCase()}`, titolo: /^(altro|andere|other|varie)$/i.test(cat) ? (ALTRO[lingua] || ALTRO.de) : cat, ordine: 50 };
  }

  /** AGB in Markdown semplice → nodi: "## titolo", paragrafi separati da righe vuote, "- " elenchi, **grassetto**. */
  function agbNodi(h, testo) {
    const pulito = String(testo || '').replace(/<!--[\s\S]*?-->/g, '').trim();
    const inline = (riga) => riga.split(/(\*\*[^*]+\*\*)/).filter(Boolean).map((x) => (/^\*\*[^*]+\*\*$/.test(x) ? h('strong', null, x.slice(2, -2)) : x));
    return pulito.split(/\n\s*\n/).map((blocco) => {
      const b = blocco.trim();
      if (/^#\s/.test(b)) return null; // il titolo principale lo stampa già la pagina
      if (/^#{2,6}\s/.test(b)) return h('h3', null, inline(b.replace(/^#{2,6}\s+/, '')));
      if (/^[-*]\s/m.test(b) && b.split('\n').every((l) => /^[-*]\s/.test(l.trim()))) return h('ul', null, b.split('\n').map((l) => h('li', null, inline(l.trim().replace(/^[-*]\s+/, '')))));
      return h('p', null, inline(b.replace(/\s*\n\s*/g, ' ')));
    }).filter(Boolean);
  }

  const r05 = (n) => Math.round(n * 20) / 20;
  const r2 = (n) => Math.round(n * 100) / 100;
  const giorno = (v) => (v ? String(v).slice(0, 10) : null);
  const ora = (v) => (v && String(v).length > 10 && String(v).slice(11, 16) !== '00:00' ? String(v).slice(11, 16) : null);
  const parse = (g) => { const [y, m, d] = g.split('-').map(Number); return new Date(y, m - 1, d); };
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const piuGiorni = (g, n) => { const d = parse(g); d.setDate(d.getDate() + n); return iso(d); };
  const dataCh = (v) => { const g = giorno(v); if (!g) return '—'; const [y, m, d] = g.split('-').map(Number); return `${d}.${m}.${y}`; };
  const quandoCh = (v) => (v ? [dataCh(v), ora(v)].filter(Boolean).join(', ') : null);
  /** 1'600.00 */
  const chf = (n) => { const [i, d] = Math.abs(Number(n) || 0).toFixed(2).split('.'); return `${n < 0 ? '-' : ''}${i.replace(/\B(?=(\d{3})+(?!\d))/g, "'")}.${d}`; };
  /** 1'600.– per gli importi tondi */
  const chfT = (n) => (Math.abs(n - Math.round(n)) < 0.005 ? `${chf(n).slice(0, -3)}.–` : chf(n));
  const iban4 = (s) => String(s || '').replace(/\s+/g, '').replace(/(.{4})/g, '$1 ').trim();
  const importo = (r) => r2(r.quantita * r.giorni * r.prezzo_unitario * (1 - r.sconto_percento / 100));

  /** Righe di annullamento dai scaglioni (ordinati dal più lontano). */
  function righeAnnullamento(tx, scaglioni) {
    const s = [...scaglioni].sort((a, b) => b.giorni_min - a.giorni_min);
    return s.map((x, i) => [tx.tier(x.giorni_min, i === 0 ? null : s[i - 1].giorni_min - 1), `${x.percento} %`]);
  }

  /**
   * @param {object} ctx  { h, add } di app.js
   * @param {object} d    { tipo: 'offerta'|'conferma', lingua, numero, numeroOrdine, oggi, valida, offerta, evento, cliente,
   *                        impostazioni, righe, totali, anrede, intro, condizioni, link }
   */
  function build({ h, add }, d) {
    const put = (el, ...kids) => add(el, kids);
    const tx = L[d.lingua] || L.de;
    const imp = d.impostazioni || {};
    const ditta = imp.ditta || {};
    const reg = { ...REGOLE, ...(imp.regole || {}) };
    const scaglioni = imp.scaglioni && imp.scaglioni.length ? imp.scaglioni : SCAGLIONI;
    const testi = (imp.testi && (imp.testi[d.lingua] || {})) || {};
    const agbTesto = (imp.testi && imp.testi[d.lingua] && imp.testi[d.lingua].agb) || (imp.testi && imp.testi.de && imp.testi.de.agb) || '';
    const ev = d.evento || {};
    const cli = d.cliente || {};
    const t = d.totali;
    // 8,1 % (virgola in DE/IT/FR, punto in EN)
    const pc = (n) => (d.lingua === 'en' ? String(Number(n)) : String(Number(n)).replace('.', ','));
    const fattura = d.tipo === 'fattura';
    const conferma = d.tipo === 'conferma' || fattura; // conferma d'ordine e fattura: niente accettazione né AGB
    const titoloDoc = fattura ? tx.fattura : d.tipo === 'conferma' ? tx.conferma : tx.offerta;
    const numeroDoc = fattura ? `${tx.fatturaNr} ${d.numero}` : `${tx.auftrag} ${d.numeroOrdine}`;
    const mwst = ditta.mwst_pflichtig === false ? 'no' : (ditta.mwst_nr ? 'si' : 'da_configurare');
    const fill = (s) => String(s || '').replace(/\{km\}/g, reg.km_inclusi)
      .replace(/\{von\}/g, ora(ev.data_inizio) || '—').replace(/\{bis\}/g, ora(ev.data_fine) || '—')
      .replace(/\{cliente\}/g, cli.azienda || cli.nome || '');

    const base = d.righe.filter((r) => !r.opzionale);
    const opz = d.righe.filter((r) => r.opzionale);
    const rigaTab = (r, i) => h('tr', null,
      h('td', { class: 'num' }, i + 1),
      h('td', null, h('strong', null, r.titolo || r.descrizione), r.titolo ? h('span', { class: 'doc__det' }, r.descrizione) : null,
        r.giorni !== 1 ? h('span', { class: 'doc__det' }, tx.giorni(r.giorni)) : null,
        r.sconto_percento ? h('span', { class: 'doc__det' }, `${tx.sconto} ${pc(r.sconto_percento)} %`) : null),
      h('td', { class: 'num' }, r.quantita),
      h('td', { class: 'num' }, chfT(r.prezzo_unitario)),
      h('td', { class: 'num' }, chfT(importo(r))));
    // righe raggruppate per categoria (titolo del gruppo + subtotale), numerazione continua
    const tabella = (list) => {
      const gruppi = new Map();
      list.forEach((r) => {
        const g = gruppoDi(r, d.lingua);
        if (!gruppi.has(g.k)) gruppi.set(g.k, { ...g, righe: [] });
        gruppi.get(g.k).righe.push(r);
      });
      const ordinati = [...gruppi.values()].sort((a, b) => a.ordine - b.ordine || a.titolo.localeCompare(b.titolo));
      const piuGruppi = ordinati.length > 1;
      let n = 0;
      return h('table', { class: 'doc__righe' },
        h('thead', null, h('tr', null, h('th', { class: 'num' }, tx.pos), h('th', null, tx.leistung), h('th', { class: 'num' }, tx.menge), h('th', { class: 'num' }, tx.prezzo), h('th', { class: 'num' }, tx.totale))),
        ordinati.map((g) => h('tbody', { class: 'doc__gruppo' },
          piuGruppi ? h('tr', { class: 'doc__gruppo-titolo' }, h('th', { colspan: '4' }, g.titolo),
            h('th', { class: 'num' }, chfT(g.righe.reduce((t2, r) => t2 + importo(r), 0)))) : null,
          g.righe.map((r) => rigaTab(r, n++)))));
    };

    // pagamento
    const giornoEvento = giorno(ev.data_inizio);
    const oggi = d.oggi;
    const accontoChf = r05(t.totale * reg.acconto_percento / 100);
    const giorniAlEvento = giornoEvento ? Math.round((parse(giornoEvento) - parse(oggi)) / 86400000) : null;
    const sofort = giorniAlEvento != null && giorniAlEvento < reg.sofort_sotto_giorni;
    const dataConferma = conferma && d.offerta.accettata_il ? giorno(d.offerta.accettata_il) : null;
    const pagamento = sofort
      ? [[tx.sofort, `CHF ${chfT(t.totale)}`]]
      : [
        [tx.acconto(reg.acconto_percento), `CHF ${chfT(accontoChf)} ${dataConferma ? `${tx.entro} ${dataCh(piuGiorni(dataConferma, reg.acconto_giorni))}` : tx.accontoEntro(reg.acconto_giorni)}`],
        [tx.saldo, `CHF ${chfT(r2(t.totale - accontoChf))}${giornoEvento ? ` ${tx.entro} ${dataCh(piuGiorni(giornoEvento, -reg.saldo_giorni_prima))}` : ''}`],
      ];

    const totaliRighe = [[tx.sub, chfT(t.subtotale)]];
    if (t.sconto_percento_chf) totaliRighe.push([`${tx.sconto} ${pc(t.sconto_percento)} %`, `- ${chfT(t.sconto_percento_chf)}`]);
    if (t.sconto_chf) totaliRighe.push([tx.sconto, `- ${chfT(t.sconto_chf)}`]);
    const ivaInclusa = t.prezzi_iva_inclusa !== false;
    if (mwst === 'si' && !ivaInclusa) totaliRighe.push([`MWST ${pc(t.iva_percento)} %`, chfT(t.iva)]);

    const luogo = [ev.sala, ev.indirizzo || ev.localita].filter(Boolean).join(', ');
    const betrieb = [quandoCh(ev.data_inizio), ora(ev.data_fine) && giorno(ev.data_fine) === giorno(ev.data_inizio) ? ora(ev.data_fine) : quandoCh(ev.data_fine)].filter(Boolean).join(' – ');
    const firma = [ditta.persona, ditta.titolo_firma].filter(Boolean).join(', ');

    const pagina1 = h('div', { class: 'doc__pagina' },
      h('header', { class: 'doc__head' },
        // logo: quello del partner (data URL dal profilo), quello di Meekon, o il nome del partner senza logo
        d.logo
          ? h('img', { src: d.logo, alt: ditta.nome || '', class: 'doc__logo doc__logo--partner' })
          : d.partner
            ? h('p', { class: 'doc__logo-testo' }, ditta.nome || '')
            : h('img', { src: '/assets/img/logo.png', alt: 'Meekon Displays', class: 'doc__logo', width: '595', height: '246' }),
        h('div', { class: 'doc__titolo' },
          h('h1', null, titoloDoc),
          h('dl', { class: 'doc__meta' },
            conferma
              ? [h('div', null, h('dt', null, fattura ? tx.fatturaNr : tx.auftrag), h('dd', null, fattura ? d.numero : d.numeroOrdine)),
                h('div', null, h('dt', null, tx.datum), h('dd', null, dataCh(oggi)))]
              : [h('div', null, h('dt', null, tx.nr), h('dd', null, d.numero)),
                h('div', null, h('dt', null, tx.datum), h('dd', null, dataCh(oggi))),
                d.valida ? h('div', null, h('dt', null, tx.valida), h('dd', null, dataCh(d.valida))) : null]),
          conferma && d.offerta.accettata_il ? h('p', { class: 'doc__accettata' }, tx.accettataIl(`${dataCh(d.offerta.accettata_il)}, ${new Date(d.offerta.accettata_il).toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit' })}`, d.offerta.accettata_nome)) : null)),
      h('div', { class: 'doc__intestazione' },
        h('div', { class: 'doc__parti' },
          h('div', { class: 'doc__parte' }, h('p', { class: 'doc__etichetta' }, tx.per),
            h('p', { class: 'doc__nome' }, cli.azienda || cli.nome || '—'),
            cli.azienda && cli.nome ? h('p', null, cli.nome) : null,
            cli.indirizzo ? h('p', { class: 'doc__multi' }, cli.indirizzo) : null,
            cli.email || cli.telefono ? h('p', { class: 'doc__piccolo' }, [cli.email, cli.telefono].filter(Boolean).join(' · ')) : null),
          h('div', { class: 'doc__parte' }, h('p', { class: 'doc__etichetta' }, tx.da),
            h('p', { class: 'doc__nome' }, ditta.nome || 'Meekon Display'),
            ditta.indirizzo ? h('p', { class: 'doc__multi' }, ditta.indirizzo) : null,
            [ditta.telefono, ditta.email || (d.partner ? null : 'info@meekondisplay.ch')].filter(Boolean).length
              ? h('p', { class: 'doc__piccolo' }, [ditta.telefono, ditta.email || (d.partner ? null : 'info@meekondisplay.ch')].filter(Boolean).join(' · ')) : null)),
        h('section', { class: 'doc__evento' },
          h('p', { class: 'doc__etichetta' }, tx.anlass),
          h('p', { class: 'doc__evento-titolo' }, ev.titolo || '—'),
          h('dl', null,
            h('dt', null, tx.datum), h('dd', null, ev.data_fine && giorno(ev.data_fine) !== giorno(ev.data_inizio) ? `${dataCh(ev.data_inizio)} – ${dataCh(ev.data_fine)}` : dataCh(ev.data_inizio)),
            h('dt', null, tx.location), h('dd', null, luogo || tx.daDefinire),
            ev.montaggio_da ? [h('dt', null, tx.aufbau), h('dd', null, quandoCh(ev.montaggio_da))] : null,
            betrieb ? [h('dt', null, tx.betrieb), h('dd', null, betrieb)] : null,
            ev.smontaggio_da ? [h('dt', null, tx.abbau), h('dd', null, quandoCh(ev.smontaggio_da))] : null,
            ev.contatto_luogo_nome || ev.contatto_luogo_telefono ? [h('dt', null, tx.kontakt), h('dd', null, [ev.contatto_luogo_nome, ev.contatto_luogo_telefono].filter(Boolean).join(', '))] : null))),
      d.anrede ? h('p', { class: 'doc__anrede' }, `${d.anrede},`) : null,
      d.intro && !fattura ? h('p', { class: 'doc__testo' }, fill(d.intro)) : null,
      tabella(base),
      h('p', { class: 'doc__inbegriffen' }, fill(testi.inbegriffen || tx.inbegriffen)),
      h('table', { class: 'doc__totali' }, h('tbody', null,
        totaliRighe.map(([k, v]) => h('tr', null, h('th', null, k), h('td', { class: 'num' }, v))))),
      h('div', { class: 'doc__totale' },
        h('span', null, mwst === 'si' && ivaInclusa ? tx.totIva(pc(t.iva_percento)) : tx.tot),
        h('strong', null, `CHF ${chfT(t.totale)}`)),
      mwst === 'si' && ivaInclusa ? h('p', { class: 'doc__davon' }, `${tx.davon(pc(t.iva_percento))}: CHF ${chfT(t.iva)}`) : null,
      mwst === 'no' ? h('p', { class: 'doc__davon' }, tx.nonIva) : null,
      opz.length ? h('div', { class: 'doc__opzionali' }, h('p', { class: 'doc__etichetta' }, tx.opzionali), tabella(opz)) : null,
      h('div', { class: 'doc__riquadri' },
        h('section', { class: 'doc__riquadro' }, h('p', { class: 'doc__etichetta' }, tx.pagamento),
          h('dl', null, pagamento.map(([k, v]) => [h('dt', null, k), h('dd', null, v)])),
          h('p', null, tx.modo),
          ditta.iban ? h('p', null, `${tx.pagabile}: ${ditta.nome || ''}, IBAN ${iban4(ditta.iban)}`) : null),
        d.senzaAnnullamento || fattura ? null : h('section', { class: 'doc__riquadro' }, h('p', { class: 'doc__etichetta' }, tx.annullamento),
          h('dl', null, righeAnnullamento(tx, scaglioni).map(([k, v]) => [h('dt', null, k), h('dd', null, v)])),
          h('p', null, [tx.indennita(reg.indennita_percento), giorniAlEvento == null || giorniAlEvento > reg.sofort_sotto_giorni ? tx.bedenk(reg.bedenkfrist_giorni) : null].filter(Boolean).join(' ')))),
      d.condizioni ? h('p', { class: 'doc__testo' }, fill(d.condizioni)) : null,
      !conferma ? h('section', { class: 'doc__accetta' },
        d.link ? [h('p', null, tx.accettaTxt), h('p', null, h('a', { href: d.link, class: 'doc__bottone' }, tx.accetta)), h('p', { class: 'doc__link' }, d.link)] : null,
        h('p', null, tx.carta), h('div', { class: 'doc__firma-carta' }, tx.firmaCarta)) : null,
      h('div', { class: 'doc__chiusura' },
        h('p', null, fill(testi.chiusura || tx.chiusura)),
        h('p', { class: 'doc__saluti' }, testi.saluti || tx.saluti),
        firma ? h('p', { class: 'doc__nome' }, firma) : null,
        h('p', { class: 'doc__piccolo' }, [ditta.nome || 'Meekon Display', ditta.slogan].filter(Boolean).join(' – '))));

    const agb = !conferma && agbTesto ? h('div', { class: 'doc__pagina doc__agb' },
      h('h2', null, tx.agbTitolo),
      h('p', { class: 'doc__piccolo' }, [tx.agbStand(reg.agb_versione, reg.agb_stand), tx.massgebend].filter(Boolean).join(' · ')),
      h('div', { class: 'doc__agb-testo' }, agbNodi(h, agbTesto))) : null;

    // footer di tutte le pagine (testo nelle "margin box" di @page tramite variabili CSS)
    const piede = [
      [ditta.nome || 'Meekon Display', (ditta.indirizzo || '').replace(/\s*\n\s*/g, ', '), ditta.telefono, ditta.email || (d.partner ? null : 'info@meekondisplay.ch')].filter(Boolean).join(' · '),
      [ditta.iban ? `IBAN ${iban4(ditta.iban)}` : null, ditta.twint ? `TWINT ${ditta.twint}` : null, ditta.whatsapp ? `WhatsApp ${ditta.whatsapp}` : null,
        mwst === 'si' ? `MWST ${ditta.mwst_nr}` : null, tx.agbRef(reg.agb_versione), ditta.piede || null].filter(Boolean).join(' · '),
    ];
    const doc = h('div', { class: 'doc' });
    put(doc, pagina1, agb);
    return { doc, piede, pagina: tx.pagina('X', 'Y'), titolo: `${titoloDoc} ${d.tipo === 'conferma' ? d.numeroOrdine : d.numero}`, mwst };
  }

  window.MeekonOffertaDoc = { build, REGOLE, SCAGLIONI, L };
})();
