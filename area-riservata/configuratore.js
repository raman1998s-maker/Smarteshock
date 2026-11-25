// Area riservata Meekon Displays — configuratore visivo dell'allestimento (dal disegno a mano di Meekon).
// Ogni parte del disegno (truss con luci, schermo dietro, schermo davanti, audio, nebbia, effetti…) è
// collegata a un modello di allestimento (pacchetto) tramite modelli.parte. Il DJ clicca le parti che il
// cliente ha richiesto e le aggiunge all'offerta; lo stesso disegno, con solo le parti scelte evidenziate,
// va nel PDF dell'offerta come rappresentazione per il cliente. SVG creato con createElementNS (mai innerHTML).
(() => {
  'use strict';

  const NS = 'http://www.w3.org/2000/svg';

  /** Parti del disegno: chiave (salvata su modelli.parte) e nome nelle lingue. */
  const NOMI = {
    luci_truss: { it: 'Struttura truss con luci', de: 'Traverse mit Licht', fr: 'Structure truss avec lumières', en: 'Truss with lights' },
    schermo_dietro: { it: 'Schermo dietro', de: 'LED-Screen hinten', fr: 'Écran arrière', en: 'Back screen' },
    schermo_davanti: { it: 'Schermo davanti (DJ booth)', de: 'Front-Display (DJ-Pult)', fr: 'Écran frontal (DJ booth)', en: 'Front display (DJ booth)' },
    regia: { it: 'Mixer audio e console', de: 'Mischpult und Konsole', fr: 'Table de mixage et console', en: 'Audio mixer and console' },
    live_stream: { it: 'Live stream', de: 'Livestream', fr: 'Live stream', en: 'Live stream' },
    microfono: { it: 'Microfono', de: 'Mikrofon', fr: 'Micro', en: 'Microphone' },
    audio_sx: { it: 'Audio sinistra', de: 'Ton links', fr: 'Son gauche', en: 'Sound left' },
    audio_dx: { it: 'Audio destra', de: 'Ton rechts', fr: 'Son droite', en: 'Sound right' },
    monitor_dj: { it: 'Monitor per il DJ', de: 'DJ-Monitor', fr: 'Retour DJ', en: 'DJ monitor' },
    luci_stativo: { it: 'Luci su stativo', de: 'Licht auf Stativ', fr: 'Lumières sur pied', en: 'Lights on stands' },
    nebbia: { it: 'Macchina della nebbia / fumo', de: 'Nebel- / Rauchmaschine', fr: 'Machine à brouillard / fumée', en: 'Fog / smoke machine' },
    effetti: { it: 'Effetti speciali (spark, CO2, coriandoli)', de: 'Spezialeffekte (Spark, CO2, Konfetti)', fr: 'Effets spéciaux (spark, CO2, confettis)', en: 'Special effects (spark, CO2, confetti)' },
    dance_floor: { it: 'Dance floor', de: 'Tanzfläche', fr: 'Piste de danse', en: 'Dance floor' },
  };
  const PARTI = Object.keys(NOMI).map((k) => [k, NOMI[k].it]);
  const ETICHETTE = { it: { dj: 'DJ', setup: 'Il vostro allestimento' }, de: { dj: 'DJ', setup: 'Ihr Setup' }, fr: { dj: 'DJ', setup: 'Votre installation' }, en: { dj: 'DJ', setup: 'Your setup' } };

  function el(tag, attrs, ...kids) {
    const n = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs || {})) n.setAttribute(k, String(v));
    kids.flat(Infinity).forEach((k) => { if (k != null) n.append(k instanceof Node ? k : document.createTextNode(String(k))); });
    return n;
  }
  const txt = (x, y, s, extra = {}) => el('text', { x, y, 'text-anchor': 'middle', class: 'cfg__testo', ...extra }, s);
  const cassa = (x, y, w, hgt) => [el('rect', { x, y, width: w, height: hgt, rx: 3 }), el('circle', { cx: x + w / 2, cy: y + hgt * 0.33, r: w * 0.16 }), el('circle', { cx: x + w / 2, cy: y + hgt * 0.68, r: w * 0.26 })];
  const treppiede = (x, yTop, yBase) => [el('line', { x1: x, y1: yTop, x2: x, y2: yBase - 18 }), el('line', { x1: x, y1: yBase - 18, x2: x - 14, y2: yBase }), el('line', { x1: x, y1: yBase - 18, x2: x + 14, y2: yBase })];
  const faro = (x, y) => [el('rect', { x: x - 11, y, width: 22, height: 26, rx: 4 }), el('circle', { cx: x, cy: y + 15, r: 6 })];

  /** Le parti come elementi SVG (disegno di Raman ridisegnato pulito), con le etichette nella lingua scelta. */
  function disegno(l) {
    const n = (k) => (NOMI[k][l] || NOMI[k].it);
    const g = {};
    g.luci_truss = [
      el('rect', { x: 120, y: 40, width: 360, height: 12, class: 'cfg__truss' }),
      el('rect', { x: 120, y: 40, width: 12, height: 330, class: 'cfg__truss' }),
      el('rect', { x: 468, y: 40, width: 12, height: 330, class: 'cfg__truss' }),
      [0, 1, 2, 3, 4, 5].map((i) => { const x = 160 + i * 56; return [el('line', { x1: x, y1: 52, x2: x, y2: 62 }), ...faro(x, 62)]; }),
      txt(300, 30, n('luci_truss')),
    ];
    g.schermo_dietro = [el('rect', { x: 165, y: 104, width: 270, height: 100, rx: 3, class: 'cfg__schermo' }), txt(300, 140, n('schermo_dietro'), { class: 'cfg__testo cfg__chiaro' })];
    g.regia = [el('rect', { x: 196, y: 238, width: 70, height: 18, rx: 2 }), txt(231, 251, 'Audio mix', { class: 'cfg__testo cfg__piccolo' }),
      el('rect', { x: 272, y: 238, width: 70, height: 18, rx: 2 }), txt(307, 251, 'Console', { class: 'cfg__testo cfg__piccolo' })];
    g.live_stream = [el('rect', { x: 348, y: 238, width: 74, height: 18, rx: 2 }), txt(385, 251, 'Live stream', { class: 'cfg__testo cfg__piccolo' })];
    g.microfono = [el('line', { x1: 176, y1: 256, x2: 182, y2: 236 }), el('circle', { cx: 183, cy: 232, r: 6 }), txt(162, 230, 'Mic', { class: 'cfg__testo cfg__piccolo' })];
    g.schermo_davanti = [el('rect', { x: 180, y: 258, width: 250, height: 62, rx: 3, class: 'cfg__schermo' }), txt(305, 294, n('schermo_davanti'), { class: 'cfg__testo cfg__chiaro' })];
    g.dance_floor = [el('polygon', { points: '215,336 405,336 440,450 160,450', class: 'cfg__pista' }), txt(300, 405, n('dance_floor'))];
    g.audio_sx = [...cassa(48, 120, 34, 46), ...treppiede(65, 166, 236), ...cassa(52, 238, 28, 36), el('line', { x1: 66, y1: 274, x2: 66, y2: 300 }), ...cassa(42, 300, 48, 56),
      txt(66, 112, n('audio_sx'))];
    g.audio_dx = [...cassa(522, 240, 28, 36), el('line', { x1: 536, y1: 276, x2: 536, y2: 300 }), ...cassa(512, 300, 48, 56), txt(536, 372, n('audio_dx'))];
    g.monitor_dj = [...cassa(520, 120, 34, 46), ...treppiede(537, 166, 230), txt(537, 112, n('monitor_dj'))];
    g.luci_stativo = [...faro(20, 236), el('line', { x1: 20, y1: 262, x2: 20, y2: 340 }), ...faro(582, 236), el('line', { x1: 582, y1: 262, x2: 582, y2: 340 }),
      txt(30, 356, n('luci_stativo'), { class: 'cfg__testo cfg__piccolo' })];
    // macchina della nebbia a terra, davanti a sinistra, con la nuvola
    g.nebbia = [el('rect', { x: 92, y: 424, width: 46, height: 24, rx: 4 }), el('circle', { cx: 145, cy: 430, r: 4 }),
      el('path', { d: 'M150 432 q12 -14 26 -4 q10 -12 24 -2 q14 -6 18 8 q-30 10 -68 -2 z', class: 'cfg__nuvola' }), txt(115, 466, n('nebbia'), { class: 'cfg__testo cfg__piccolo' })];
    // effetti speciali: fontane spark ai due lati della pista
    const spark = (x) => [el('rect', { x: x - 9, y: 430, width: 18, height: 16, rx: 2 }),
      [-14, -7, 0, 7, 14].map((dx) => el('line', { x1: x, y1: 428, x2: x + dx, y2: 392 + Math.abs(dx), class: 'cfg__scintilla' }))];
    g.effetti = [...spark(470), ...spark(560), txt(515, 466, n('effetti'), { class: 'cfg__testo cfg__piccolo' })];
    return g;
  }

  /** Il DJ dietro la console (solo disegno, non si sceglie). */
  function dj(l) {
    return el('g', { class: 'cfg__dj', 'aria-hidden': 'true' },
      el('circle', { cx: 305, cy: 214, r: 9 }), el('path', { d: 'M289 238 q16 -22 32 0 z' }),
      el('path', { d: 'M296 210 q9 -12 18 0', class: 'cfg__cuffie' }), txt(330, 222, (ETICHETTE[l] || ETICHETTE.it).dj, { class: 'cfg__testo cfg__piccolo' }));
  }

  function svgBase(l, etichetta) {
    return el('svg', { viewBox: '0 0 604 474', class: 'cfg__svg', role: 'group', 'aria-label': etichetta || (ETICHETTE[l] || ETICHETTE.it).setup });
  }

  /**
   * Configuratore interattivo.
   * @param {object} o  { modelli: [...con .parte], prezzo: (modello) => numero, fmt: (n) => testo, onAggiungi: (modelli scelti) => void }
   */
  function crea({ modelli, prezzo, fmt, onAggiungi }) {
    const perParte = new Map();
    modelli.forEach((m) => { if (m.parte && !perParte.has(m.parte)) perParte.set(m.parte, m); });
    const scelte = new Set();
    const svg = svgBase('it', "Configuratore dell'allestimento");
    const g = disegno('it');
    const box = document.createElement('div');
    box.className = 'cfg';
    const riepilogo = document.createElement('p');
    riepilogo.className = 'cfg__riepilogo';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn--primary';
    btn.textContent = 'Aggiungi le parti scelte';
    btn.disabled = true;

    const aggiorna = () => {
      const lista = [...scelte].map((k) => perParte.get(k));
      const tot = lista.reduce((t, m) => t + (prezzo(m) || 0), 0);
      riepilogo.textContent = lista.length ? `${lista.map((m) => m.nome).join(' + ')} — ${fmt(tot)} CHF / giorno` : 'Cliccate sulle parti del disegno richieste dal cliente.';
      btn.disabled = !lista.length;
    };

    PARTI.forEach(([k, nome]) => {
      const m = perParte.get(k);
      const gruppo = el('g', { class: `cfg__parte${m ? '' : ' cfg__parte--off'}`, 'data-parte': k, tabindex: m ? 0 : -1, role: m ? 'button' : 'img', 'aria-label': nome, 'aria-pressed': m ? 'false' : null },
        el('title', null, m ? `${m.nome}${prezzo(m) ? ` — ${fmt(prezzo(m))} CHF / giorno` : ''}` : `${nome}: non disponibile`), g[k]);
      if (m) {
        const toggle = () => {
          if (scelte.has(k)) scelte.delete(k); else scelte.add(k);
          gruppo.classList.toggle('cfg__parte--scelta', scelte.has(k));
          gruppo.setAttribute('aria-pressed', String(scelte.has(k)));
          aggiorna();
        };
        gruppo.addEventListener('click', toggle);
        gruppo.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
      }
      svg.append(gruppo);
    });
    svg.append(dj('it'));
    btn.addEventListener('click', () => {
      const lista = PARTI.map(([k]) => k).filter((k) => scelte.has(k)).map((k) => perParte.get(k));
      onAggiungi(lista);
      scelte.clear();
      svg.querySelectorAll('.cfg__parte--scelta').forEach((n) => { n.classList.remove('cfg__parte--scelta'); n.setAttribute('aria-pressed', 'false'); });
      aggiorna();
    });
    aggiorna();
    const foot = document.createElement('div');
    foot.className = 'cfg__foot';
    foot.append(riepilogo, btn);
    box.append(svg, foot);
    return box;
  }

  /** Disegno per il PDF: solo le parti scelte (le altre non compaiono), con il DJ al centro. */
  function statico(parti, lingua) {
    const l = ETICHETTE[lingua] ? lingua : 'de';
    const svg = svgBase(l);
    svg.setAttribute('class', 'cfg__svg cfg__svg--pdf');
    const g = disegno(l);
    const set = new Set(parti);
    PARTI.forEach(([k]) => { if (set.has(k)) svg.append(el('g', { class: 'cfg__parte cfg__parte--scelta' }, g[k])); });
    svg.append(dj(l));
    return svg;
  }

  window.MeekonConfiguratore = { crea, statico, PARTI, NOMI, ETICHETTE };
})();
