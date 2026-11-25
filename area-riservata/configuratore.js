// Area riservata Meekon Displays — configuratore visivo dell'allestimento (dal disegno a mano di Meekon).
// Vista frontale stilizzata, in scala: schermi a moduli da 0,5 m (larghezza) × 1 m (altezza), casse top ai lati
// degli schermi, sub, monitor DJ, LED dance floor a pannelli da 1 × 1 m, truss con luci, effetti.
// Ogni parte è collegata a un pacchetto (modelli.parte); per schermi, casse e pista si sceglie misura o numero
// e il prezzo del pacchetto vale per modulo / pezzo / pannello. Lo stesso disegno, con le misure scelte,
// va nel PDF dell'offerta ("Ihr Setup"). SVG creato con createElementNS (mai innerHTML).
(() => {
  'use strict';

  const NS = 'http://www.w3.org/2000/svg';
  const M = 44; // pixel per metro nel disegno

  /** Parti: nome nelle lingue, tipo di opzione e valori predefiniti. */
  const PARTI_DEF = {
    luci_truss: { nomi: { it: 'Struttura truss con luci', de: 'Traverse mit Licht', fr: 'Structure truss avec lumières', en: 'Truss with lights' } },
    schermo_dietro: { nomi: { it: 'Schermo dietro', de: 'LED-Screen hinten', fr: 'Écran arrière', en: 'Back screen' }, tipo: 'moduli', w: 8, h: 3, maxW: 24, maxH: 6 },
    schermo_davanti: { nomi: { it: 'Schermo davanti (DJ booth)', de: 'Front-Display (DJ-Pult)', fr: 'Écran frontal (DJ booth)', en: 'Front display (DJ booth)' }, tipo: 'moduli', w: 4, h: 1, maxW: 12, maxH: 2 },
    regia: { nomi: { it: 'Mixer audio e console', de: 'Mischpult und Konsole', fr: 'Table de mixage et console', en: 'Audio mixer and console' } },
    live_stream: { nomi: { it: 'Live stream', de: 'Livestream', fr: 'Live stream', en: 'Live stream' } },
    microfono: { nomi: { it: 'Microfono', de: 'Mikrofon', fr: 'Micro', en: 'Microphone' }, tipo: 'numero', n: 1, max: 6 },
    casse_top: { nomi: { it: 'Casse top', de: 'Lautsprecher (Tops)', fr: 'Enceintes (tops)', en: 'Top speakers' }, tipo: 'numero', n: 4, max: 8 },
    sub: { nomi: { it: 'Subwoofer', de: 'Subwoofer', fr: 'Caissons de basses', en: 'Subwoofers' }, tipo: 'numero', n: 2, max: 6 },
    monitor_dj: { nomi: { it: 'Monitor per il DJ', de: 'DJ-Monitor', fr: 'Retour DJ', en: 'DJ monitor' }, tipo: 'numero', n: 1, max: 2 },
    luci_stativo: { nomi: { it: 'Luci su stativo', de: 'Licht auf Stativ', fr: 'Lumières sur pied', en: 'Lights on stands' }, tipo: 'numero', n: 2, max: 6 },
    nebbia: { nomi: { it: 'Macchina della nebbia / fumo', de: 'Nebel- / Rauchmaschine', fr: 'Machine à brouillard / fumée', en: 'Fog / smoke machine' } },
    effetti: { nomi: { it: 'Effetti speciali (spark, CO2, coriandoli)', de: 'Spezialeffekte (Spark, CO2, Konfetti)', fr: 'Effets spéciaux (spark, CO2, confettis)', en: 'Special effects (spark, CO2, confetti)' }, tipo: 'numero', n: 2, max: 8 },
    dance_floor: { nomi: { it: 'LED dance floor', de: 'LED-Tanzfläche', fr: 'Piste de danse LED', en: 'LED dance floor' }, tipo: 'pannelli', w: 4, h: 4, maxW: 10, maxH: 10 },
  };
  const NOMI = Object.fromEntries(Object.entries(PARTI_DEF).map(([k, v]) => [k, v.nomi]));
  const PARTI = Object.keys(PARTI_DEF).map((k) => [k, PARTI_DEF[k].nomi.it]);
  const ETICHETTE = {
    it: { dj: 'DJ', setup: 'Il vostro allestimento', moduli: 'moduli', pannelli: 'pannelli', pz: 'pz.', giorno: 'giorno', unita: 'per unità' },
    de: { dj: 'DJ', setup: 'Ihr Setup', moduli: 'Module', pannelli: 'Panels', pz: 'Stk.', giorno: 'Tag', unita: 'pro Einheit' },
    fr: { dj: 'DJ', setup: 'Votre installation', moduli: 'modules', pannelli: 'panneaux', pz: 'pces', giorno: 'jour', unita: 'par unité' },
    en: { dj: 'DJ', setup: 'Your setup', moduli: 'modules', pannelli: 'panels', pz: 'pcs', giorno: 'day', unita: 'per unit' },
  };
  const metri = (n, l) => (l === 'en' ? n.toFixed(1) : n.toFixed(1).replace('.', ','));

  /** Configurazione predefinita di una parte. */
  function base(k) {
    const d = PARTI_DEF[k] || {};
    if (d.tipo === 'moduli' || d.tipo === 'pannelli') return { parte: k, w: d.w, h: d.h };
    if (d.tipo === 'numero') return { parte: k, n: d.n };
    return { parte: k };
  }
  /** Unità (moduli, pezzi, pannelli) per il prezzo e la quantità della riga. */
  function unita(c) {
    const d = PARTI_DEF[c.parte] || {};
    if (d.tipo === 'moduli' || d.tipo === 'pannelli') return Math.max(1, c.w * c.h);
    if (d.tipo === 'numero') return Math.max(1, c.n);
    return 1;
  }
  /** Testo della misura per la riga dell'offerta (es. "4,0 × 3,0 m · 24 Module à 0,5 × 1 m"). */
  function misura(c, l = 'de') {
    const d = PARTI_DEF[c.parte] || {};
    const e = ETICHETTE[l] || ETICHETTE.de;
    if (d.tipo === 'moduli') return `${metri(c.w * 0.5, l)} × ${metri(c.h * 1, l)} m · ${c.w * c.h} ${e.moduli} à 0,5 × 1 m`;
    if (d.tipo === 'pannelli') return `${metri(c.w, l)} × ${metri(c.h, l)} m · ${c.w * c.h} ${e.pannelli} à 1 × 1 m`;
    if (d.tipo === 'numero') return `${c.n} ${e.pz}`;
    return '';
  }

  // ---------------------------------------------------------------- disegno
  function el(tag, attrs, ...kids) {
    const n = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs || {})) if (v != null) n.setAttribute(k, String(v));
    kids.flat(Infinity).forEach((k) => { if (k != null) n.append(k instanceof Node ? k : document.createTextNode(String(k))); });
    return n;
  }
  const txt = (x, y, s, cls = 'cfg__testo', extra = {}) => el('text', { x, y, 'text-anchor': 'middle', class: cls, ...extra }, s);

  let nSvg = 0; // id unici per svg: nel PDF il disegno del configuratore è nascosto e i riferimenti url(#…) si romperebbero
  function defs(id) {
    return el('defs', null,
      el('linearGradient', { id: `${id}s`, x1: 0, y1: 0, x2: 0, y2: 1 },
        el('stop', { offset: '0', 'stop-color': '#2a3a4a' }), el('stop', { offset: '1', 'stop-color': '#0f1418' })),
      el('linearGradient', { id: `${id}b`, x1: 0, y1: 0, x2: 0, y2: 1 },
        el('stop', { offset: '0', 'stop-color': '#4DC0DE', 'stop-opacity': '.45' }), el('stop', { offset: '1', 'stop-color': '#4DC0DE', 'stop-opacity': '0' })),
    );
  }

  // truss a traliccio orizzontale/verticale
  function truss(x, y, w, h, vertical) {
    const parts = [el('rect', { x, y, width: w, height: h, class: 'cfg__truss' })];
    const passo = 9;
    if (vertical) { for (let yy = y; yy < y + h - passo; yy += passo) parts.push(el('line', { x1: x, y1: yy, x2: x + w, y2: yy + passo, class: 'cfg__traliccio' })); }
    else { for (let xx = x; xx < x + w - passo; xx += passo) parts.push(el('line', { x1: xx, y1: y + h, x2: xx + passo, y2: y, class: 'cfg__traliccio' })); }
    return parts;
  }
  const movingHead = (x, y, fascio) => [
    fascio ? el('polygon', { points: `${x - 4},${y + 16} ${x + 4},${y + 16} ${x + 24},${y + 120} ${x - 24},${y + 120}`, fill: fascio, class: 'cfg__fascio' }) : null,
    el('rect', { x: x - 7, y, width: 14, height: 4, rx: 1, class: 'cfg__metallo' }),
    el('path', { d: `M${x - 8} ${y + 4} v8 a8 8 0 0 0 16 0 v-8`, class: 'cfg__forcella' }),
    el('rect', { x: x - 6, y: y + 6, width: 12, height: 12, rx: 3, class: 'cfg__testa' }),
    el('circle', { cx: x, cy: y + 15, r: 3, class: 'cfg__lente' })];
  const top = (x, y) => [ // cassa top trapezoidale
    el('path', { d: `M${x - 13} ${y} h26 l-3 40 h-20 z`, class: 'cfg__cassa' }),
    el('circle', { cx: x, cy: y + 10, r: 4, class: 'cfg__driver' }), el('circle', { cx: x, cy: y + 26, r: 8, class: 'cfg__driver' })];
  const subw = (x, y) => [el('rect', { x: x - 20, y, width: 40, height: 38, rx: 3, class: 'cfg__cassa' }), el('circle', { cx: x, cy: y + 19, r: 13, class: 'cfg__driver' }), el('circle', { cx: x, cy: y + 19, r: 4, class: 'cfg__metallo' })];
  const asta = (x, y1, y2) => el('line', { x1: x, y1, x2: x, y2, class: 'cfg__asta' });
  const stativo = (x, yTop, yBase) => [asta(x, yTop, yBase - 16), el('path', { d: `M${x} ${yBase - 16} l-14 16 M${x} ${yBase - 16} l14 16`, class: 'cfg__asta' })];

  /** Disegna l'allestimento: conf = Map(parte → configurazione) delle parti da mostrare evidenziate. */
  function disegna(svg, { conf, attive, lingua, interattivo }) {
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    const l = ETICHETTE[lingua] ? lingua : 'it';
    const nome = (k) => PARTI_DEF[k].nomi[l] || PARTI_DEF[k].nomi.it;
    const c = (k) => conf.get(k) || base(k);
    const mostra = (k) => interattivo || conf.has(k);
    // schermo dietro (in scala, base a 1 m da terra); la larghezza del disegno segue lo schermo
    const sd = c('schermo_dietro');
    const sdW = Math.max(sd.w * 0.5 * M, 60);
    const W = Math.max(900, sdW + 520);
    const CX = W / 2;
    const SUOLO = 500;
    const gid = `cfg${++nSvg}`;
    svg.append(defs(gid));
    svg.append(el('line', { x1: 20, y1: SUOLO, x2: W - 20, y2: SUOLO, class: 'cfg__suolo' }));
    const sdH = sd.h * M;
    const sdY = SUOLO - M - sdH;
    const sdX = CX - sdW / 2;
    // truss a portale intorno allo schermo
    const tX1 = sdX - 26;
    const tX2 = sdX + sdW + 12;
    const tY = sdY - 58;
    const gruppi = {};
    const nTeste = Math.max(4, Math.min(10, Math.round((tX2 - tX1) / 60)));
    gruppi.luci_truss = [
      ...truss(tX1, tY, tX2 - tX1 + 14, 12, false), ...truss(tX1, tY, 14, SUOLO - tY, true), ...truss(tX2, tY, 14, SUOLO - tY, true),
      Array.from({ length: nTeste }, (_, i) => movingHead(tX1 + 30 + i * ((tX2 - tX1 - 30) / Math.max(1, nTeste - 1)), tY + 12, `url(#${gid}b)`)),
      txt(CX, tY - 10, nome('luci_truss'))];
    const moduli = [];
    for (let i = 1; i < sd.w; i++) moduli.push(el('line', { x1: sdX + i * 0.5 * M, y1: sdY, x2: sdX + i * 0.5 * M, y2: sdY + sdH, class: 'cfg__modulo' }));
    for (let j = 1; j < sd.h; j++) moduli.push(el('line', { x1: sdX, y1: sdY + j * M, x2: sdX + sdW, y2: sdY + j * M, class: 'cfg__modulo' }));
    gruppi.schermo_dietro = [
      el('rect', { x: sdX, y: sdY, width: sdW, height: sdH, rx: 2, fill: `url(#${gid}s)`, class: 'cfg__schermo' }), moduli,
      asta(sdX + 10, sdY + sdH, SUOLO), asta(sdX + sdW - 10, sdY + sdH, SUOLO),
      txt(CX, sdY + 20, nome('schermo_dietro'), 'cfg__testo cfg__chiaro'),
      txt(CX, sdY + 35, `${metri(sd.w * 0.5, l)} × ${metri(sd.h, l)} m`, 'cfg__testo cfg__chiaro cfg__piccolo')];

    // DJ booth con schermo frontale (in scala, altezza in moduli da 1 m)
    const fd = c('schermo_davanti');
    const fdW = Math.max(fd.w * 0.5 * M, 70);
    const fdH = Math.max(fd.h, 1) * M * 0.9;
    const fdX = CX - fdW / 2;
    const fdY = SUOLO - fdH;
    const mod2 = [];
    for (let i = 1; i < fd.w; i++) mod2.push(el('line', { x1: fdX + i * 0.5 * M, y1: fdY, x2: fdX + i * 0.5 * M, y2: SUOLO, class: 'cfg__modulo' }));
    // il DJ dietro il banco (sempre disegnato)
    const dj = el('g', { class: 'cfg__dj', 'aria-hidden': 'true' },
      el('circle', { cx: CX, cy: fdY - 30, r: 9 }), el('path', { d: `M${CX - 17} ${fdY - 6} q17 -22 34 0 z` }),
      el('path', { d: `M${CX - 10} ${fdY - 33} q10 -14 20 0`, class: 'cfg__cuffie' }));
    gruppi.schermo_davanti = [
      el('rect', { x: fdX - 6, y: fdY - 6, width: fdW + 12, height: 6, rx: 1, class: 'cfg__piano' }),
      el('rect', { x: fdX, y: fdY, width: fdW, height: fdH, rx: 2, fill: `url(#${gid}s)`, class: 'cfg__schermo' }), mod2,
      txt(CX, fdY + fdH / 2 + 4, `${metri(fd.w * 0.5, l)} × ${metri(fd.h, l)} m`, 'cfg__testo cfg__chiaro cfg__piccolo')];
    gruppi.regia = [el('rect', { x: CX - 40, y: fdY - 14, width: 36, height: 8, rx: 2, class: 'cfg__apparecchio' }), el('rect', { x: CX + 4, y: fdY - 14, width: 36, height: 8, rx: 2, class: 'cfg__apparecchio' })];
    gruppi.live_stream = [el('rect', { x: fdX + fdW - 30, y: fdY - 22, width: 18, height: 12, rx: 2, class: 'cfg__apparecchio' }), el('circle', { cx: fdX + fdW - 21, cy: fdY - 16, r: 3.5, class: 'cfg__lente' }),
      el('line', { x1: fdX + fdW - 21, y1: fdY - 10, x2: fdX + fdW - 21, y2: fdY - 6, class: 'cfg__asta' })];
    const mic = c('microfono');
    gruppi.microfono = Array.from({ length: mic.n || 1 }, (_, i) => { const x = fdX + 12 + i * 12; return [el('line', { x1: x, y1: fdY - 6, x2: x + 4, y2: fdY - 24, class: 'cfg__asta' }), el('ellipse', { cx: x + 5, cy: fdY - 27, rx: 3, ry: 4.5, class: 'cfg__metallo' })]; });

    // casse top ai lati dello schermo: metà a sinistra, metà a destra, impilate sull'asta del sub
    const nTop = Math.max(0, c('casse_top').n || 0);
    const xSx = Math.min(tX1 - 46, CX - 230);
    const xDx = Math.max(tX2 + 60, CX + 230);
    const lati = [[xSx, Math.ceil(nTop / 2)], [xDx, Math.floor(nTop / 2)]];
    gruppi.casse_top = [lati.map(([x, n]) => Array.from({ length: n }, (_, i) => top(x, SUOLO - 128 - i * 44))),
      lati.map(([x, n]) => (n ? asta(x, SUOLO - 128 + 40, SUOLO - 40) : null)), txt(xSx, SUOLO - 128 - Math.ceil(nTop / 2) * 44 + 30, nome('casse_top'), 'cfg__testo cfg__piccolo')];
    const nSub = Math.max(0, c('sub').n || 0);
    gruppi.sub = Array.from({ length: nSub }, (_, i) => { const lato = i % 2 === 0 ? xSx : xDx; const fila = Math.floor(i / 2); return subw(lato + (fila ? (lato < CX ? -44 : 44) * fila : 0), SUOLO - 38); });
    const nMon = Math.max(0, c('monitor_dj').n || 0);
    gruppi.monitor_dj = Array.from({ length: nMon }, (_, i) => { const x = fdX + fdW + 22 + i * 34; return [el('path', { d: `M${x - 14} ${SUOLO} l6 -20 h22 l-2 20 z`, class: 'cfg__cassa' }), el('circle', { cx: x + 3, cy: SUOLO - 10, r: 5, class: 'cfg__driver' })]; });
    const nSt = Math.max(0, c('luci_stativo').n || 0);
    gruppi.luci_stativo = Array.from({ length: nSt }, (_, i) => { const x = i % 2 === 0 ? 40 + Math.floor(i / 2) * 30 : W - 40 - Math.floor(i / 2) * 30; return [...stativo(x, SUOLO - 120, SUOLO), ...movingHead(x, SUOLO - 140, false)]; });

    // LED dance floor davanti, in prospettiva, a pannelli da 1 × 1 m
    const df = c('dance_floor');
    const dfW = df.w * M * 0.95;
    const yA = SUOLO + 14;
    const yB = SUOLO + 14 + Math.min(110, df.h * 14);
    const xA1 = CX - dfW / 2;
    const xA2 = CX + dfW / 2;
    const xB1 = CX - dfW / 2 - 40;
    const xB2 = CX + dfW / 2 + 40;
    const piastrelle = [];
    const COLORI = ['#4DC0DE', '#7b5cd6', '#e0539a', '#2fb39a'];
    for (let r = 0; r < df.h; r++) {
      for (let q = 0; q < df.w; q++) {
        const t0 = r / df.h; const t1 = (r + 1) / df.h;
        const L0 = xA1 + (xB1 - xA1) * t0; const R0 = xA2 + (xB2 - xA2) * t0;
        const L1 = xA1 + (xB1 - xA1) * t1; const R1 = xA2 + (xB2 - xA2) * t1;
        const y0 = yA + (yB - yA) * t0; const y1 = yA + (yB - yA) * t1;
        const a0 = L0 + (R0 - L0) * (q / df.w); const b0 = L0 + (R0 - L0) * ((q + 1) / df.w);
        const a1 = L1 + (R1 - L1) * (q / df.w); const b1 = L1 + (R1 - L1) * ((q + 1) / df.w);
        piastrelle.push(el('polygon', { points: `${a0},${y0} ${b0},${y0} ${b1},${y1} ${a1},${y1}`, class: 'cfg__piastrella', fill: COLORI[(r * 3 + q * 7 + r * q) % COLORI.length] }));
      }
    }
    gruppi.dance_floor = [piastrelle, txt(CX, yB + 18, `${nome('dance_floor')} · ${metri(df.w, l)} × ${metri(df.h, l)} m`, 'cfg__testo cfg__piccolo')];
    // nebbia ed effetti ai lati della pista
    const xN = xB1 - 150;
    gruppi.nebbia = [el('rect', { x: xN, y: yB - 22, width: 40, height: 20, rx: 4, class: 'cfg__apparecchio' }),
      el('path', { d: `M${xN + 42} ${yB - 14} q14 -16 30 -4 q12 -12 26 0 q14 -4 16 10 q-36 10 -72 -6 z`, class: 'cfg__nuvola' }),
      txt(xN, yB + 18, nome('nebbia'), 'cfg__testo cfg__piccolo', { 'text-anchor': 'start' })];
    const nEff = Math.max(0, c('effetti').n || 0);
    gruppi.effetti = [Array.from({ length: nEff }, (_, i) => {
      const x = i % 2 === 0 ? xB1 - 22 - Math.floor(i / 2) * 24 : xB2 + 22 + Math.floor(i / 2) * 24;
      const y = yB - 12;
      return [el('rect', { x: x - 7, y, width: 14, height: 12, rx: 2, class: 'cfg__apparecchio' }),
        [-10, -5, 0, 5, 10].map((dx) => el('line', { x1: x, y1: y - 2, x2: x + dx, y2: y - 38 + Math.abs(dx), class: 'cfg__scintilla' }))];
    }), nEff ? txt(xB2 + 150, yB + 18, nome('effetti'), 'cfg__testo cfg__piccolo', { 'text-anchor': 'end' }) : null];

    const yMin = Math.min(tY - 40, SUOLO - 128 - Math.max(0, Math.ceil(nTop / 2) - 1) * 44 - 30);
    svg.setAttribute('viewBox', `0 ${yMin} ${W} ${yB + 34 - yMin}`);
    // ordine di disegno: dietro → davanti
    const ordine = ['luci_truss', 'schermo_dietro', 'luci_stativo', 'casse_top', 'sub', 'dance_floor', 'nebbia', 'effetti'];
    const gEls = {};
    const crea = (k) => {
      if (!mostra(k)) return null;
      const g = el('g', { class: `cfg__parte${conf.has(k) ? ' cfg__parte--scelta' : ''}${attive && !attive.has(k) ? ' cfg__parte--off' : ''}`, 'data-parte': k }, el('title', null, nome(k)), gruppi[k]);
      gEls[k] = g;
      return g;
    };
    ordine.forEach((k) => { const g = crea(k); if (g) svg.append(g); });
    svg.append(dj);
    ['schermo_davanti', 'regia', 'live_stream', 'microfono', 'monitor_dj'].forEach((k) => { const g = crea(k); if (g) svg.append(g); });
    return gEls;
  }

  // ---------------------------------------------------------------- interattivo
  /**
   * @param {object} o  { modelli: [...con .parte], prezzo: (modello) => prezzo per unità, fmt, onAggiungi: ([{ modello, configurazione, quantita, misura }]) => void }
   */
  function crea({ modelli, prezzo, fmt, onAggiungi }) {
    const perParte = new Map();
    modelli.forEach((m) => { if (m.parte && PARTI_DEF[m.parte] && !perParte.has(m.parte)) perParte.set(m.parte, m); });
    const attive = new Set(perParte.keys());
    const conf = new Map();
    const box = document.createElement('div');
    box.className = 'cfg';
    const svg = el('svg', { class: 'cfg__svg', role: 'group', 'aria-label': "Configuratore dell'allestimento" });
    const opzioni = document.createElement('div');
    opzioni.className = 'cfg__opzioni';
    const riepilogo = document.createElement('p');
    riepilogo.className = 'cfg__riepilogo';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn--primary';
    btn.textContent = 'Aggiungi le parti scelte';

    const totale = () => [...conf.values()].reduce((t, c) => t + (prezzo(perParte.get(c.parte)) || 0) * unita(c), 0);
    const numIn = (val, min, max, onv, label) => {
      const i = document.createElement('input');
      i.type = 'number'; i.min = String(min); i.max = String(max); i.value = String(val); i.className = 'input--num'; i.setAttribute('aria-label', label);
      i.addEventListener('input', () => { const n = Math.max(min, Math.min(max, Math.round(Number(i.value) || min))); onv(n); ridisegna(false); });
      return i;
    };
    const etichetta = (s, ...kids) => { const lb = document.createElement('label'); lb.className = 'cfg__opzione'; const sp = document.createElement('span'); sp.textContent = s; lb.append(sp, ...kids); return lb; };

    // gruppi della lista accanto al disegno: l'allestimento di base e gli extra che il cliente può chiedere
    const GRUPPI = [
      ['Allestimento', ['luci_truss', 'schermo_dietro', 'schermo_davanti', 'regia', 'casse_top', 'sub', 'monitor_dj']],
      ['Extra su richiesta del cliente', ['dance_floor', 'effetti', 'nebbia', 'luci_stativo', 'microfono', 'live_stream']],
    ];
    const TIPICO = ['luci_truss', 'schermo_dietro', 'schermo_davanti', 'regia', 'casse_top', 'sub', 'monitor_dj'];

    function opzioniParte(c, aggiornaInfo) {
      const d = PARTI_DEF[c.parte];
      if (d.tipo === 'moduli') {
        return [etichetta('Larghezza (moduli da 0,5 m)', numIn(c.w, 1, d.maxW, (n) => { c.w = n; aggiornaInfo(); }, 'Larghezza in moduli')),
          etichetta('Altezza (moduli da 1 m)', numIn(c.h, 1, d.maxH, (n) => { c.h = n; aggiornaInfo(); }, 'Altezza in moduli'))];
      }
      if (d.tipo === 'pannelli') {
        return [etichetta('Larghezza (m)', numIn(c.w, 1, d.maxW, (n) => { c.w = n; aggiornaInfo(); }, 'Larghezza in metri')),
          etichetta('Profondità (m)', numIn(c.h, 1, d.maxH, (n) => { c.h = n; aggiornaInfo(); }, 'Profondità in metri'))];
      }
      if (d.tipo === 'numero') return [etichetta('Quantità', numIn(c.n, 1, d.max, (n) => { c.n = n; aggiornaInfo(); }, 'Quantità'))];
      return [];
    }

    function pannelloOpzioni() {
      while (opzioni.firstChild) opzioni.removeChild(opzioni.firstChild);
      const tipico = document.createElement('button');
      tipico.type = 'button';
      tipico.className = 'btn btn--small';
      tipico.textContent = 'Allestimento tipico (4 top, 2 sub, 1 monitor, schermi)';
      tipico.addEventListener('click', () => { TIPICO.filter((k) => attive.has(k)).forEach((k) => { if (!conf.has(k)) conf.set(k, base(k)); }); ridisegna(true); });
      opzioni.append(tipico);
      GRUPPI.forEach(([titoloGruppo, chiavi]) => {
        const disp = chiavi.filter((k) => attive.has(k));
        if (!disp.length) return;
        const fs = document.createElement('fieldset');
        fs.className = 'cfg__gruppo';
        const lg = document.createElement('legend');
        lg.textContent = titoloGruppo;
        fs.append(lg);
        disp.forEach((k) => {
          const riga = document.createElement('div');
          riga.className = `cfg__riga${conf.has(k) ? ' cfg__riga--on' : ''}`;
          const cb = document.createElement('input');
          cb.type = 'checkbox';
          cb.checked = conf.has(k);
          cb.addEventListener('change', () => { if (cb.checked) conf.set(k, base(k)); else conf.delete(k); ridisegna(true); });
          const info = document.createElement('span');
          info.className = 'cfg__info';
          const lb = etichetta(PARTI_DEF[k].nomi.it, cb);
          lb.classList.add('cfg__scelta');
          riga.append(lb);
          const c = conf.get(k);
          const aggiornaInfo = () => {
            const pz = prezzo(perParte.get(k)) || 0;
            const ui = (window.MeekonI18n && window.MeekonI18n.lingua) || 'it';
            const e = ETICHETTE[ui] || ETICHETTE.it;
            const mis = c ? misura(c, ui) : '';
            info.textContent = c ? `${mis ? `${mis} · ` : ''}${fmt(pz * unita(c))} CHF / ${e.giorno}` : `${fmt(pz)} CHF${PARTI_DEF[k].tipo ? ` ${e.unita}` : ''}`;
          };
          if (c) riga.append(...opzioniParte(c, aggiornaInfo));
          aggiornaInfo();
          riga.append(info);
          fs.append(riga);
        });
        opzioni.append(fs);
      });
    }

    function ridisegna(conOpzioni = true) {
      const gEls = disegna(svg, { conf, attive, lingua: 'it', interattivo: true });
      Object.entries(gEls).forEach(([k, g]) => {
        if (!attive.has(k)) { g.setAttribute('aria-label', `${PARTI_DEF[k].nomi.it}: non disponibile`); return; }
        g.setAttribute('tabindex', '0');
        g.setAttribute('role', 'button');
        g.setAttribute('aria-label', PARTI_DEF[k].nomi.it);
        g.setAttribute('aria-pressed', String(conf.has(k)));
        const toggle = () => { if (conf.has(k)) conf.delete(k); else conf.set(k, base(k)); ridisegna(true); };
        g.addEventListener('click', toggle);
        g.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
      });
      if (conOpzioni) pannelloOpzioni();
      riepilogo.textContent = conf.size ? `${[...conf.values()].map((c) => perParte.get(c.parte).nome).join(' + ')} — ${fmt(totale())} CHF / giorno` : 'Cliccate sulle parti del disegno richieste dal cliente.';
      btn.disabled = !conf.size;
    }

    btn.addEventListener('click', () => {
      const lista = PARTI.map(([k]) => k).filter((k) => conf.has(k)).map((k) => {
        const c = { ...conf.get(k) };
        return { modello: perParte.get(k), configurazione: c, quantita: unita(c), misura: misura(c, 'de') };
      });
      onAggiungi(lista);
      conf.clear();
      ridisegna(true);
    });
    ridisegna(true);
    const foot = document.createElement('div');
    foot.className = 'cfg__foot';
    foot.append(riepilogo, btn);
    box.append(svg, opzioni, foot);
    return box;
  }

  /** Disegno per il PDF: solo le parti scelte, con le loro misure. configurazioni: [{ parte, w, h, n }] */
  function statico(configurazioni, lingua) {
    const conf = new Map();
    configurazioni.forEach((c) => { if (c && PARTI_DEF[c.parte]) conf.set(c.parte, { ...base(c.parte), ...c }); });
    const svg = el('svg', { class: 'cfg__svg cfg__svg--pdf', role: 'img', 'aria-label': (ETICHETTE[lingua] || ETICHETTE.de).setup });
    disegna(svg, { conf, attive: null, lingua, interattivo: false });
    return svg;
  }

  /** Parti da disegnare nel PDF dalle righe dell'offerta (non opzionali): configurazione salvata o quella base del pacchetto. */
  function partiDisegno(righe, modelli) {
    const out = new Map();
    righe.filter((r) => !r.opzionale).forEach((r) => {
      const parte = (r.configurazione && r.configurazione.parte) || (modelli.find((m) => m.id === r.modello_id) || {}).parte;
      if (parte && PARTI_DEF[parte] && !out.has(parte)) out.set(parte, { ...base(parte), ...(r.configurazione || {}), parte });
    });
    return [...out.values()];
  }

  window.MeekonConfiguratore = { crea, statico, misura, unita, base, partiDisegno, PARTI, NOMI, ETICHETTE, PARTI_DEF };
})();
