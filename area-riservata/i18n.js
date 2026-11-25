// Area riservata Meekon Displays — lingua dell'interfaccia (italiano, tedesco, inglese).
// I testi del codice restano in italiano; questo file li traduce a schermo con i dizionari
// di i18n-de.js e i18n-en.js (chiave = testo italiano, {0} {1}… = parti variabili).
// Si traducono solo testi uguali a una chiave: nomi, descrizioni e altri dati restano come sono.
// Non si toccano il documento da stampare (.stampa: ha le sue lingue) né i campi compilati.
(() => {
  'use strict';

  const LINGUE = ['it', 'de', 'en'];
  const DIZ = window.MEEKON_I18N || {};
  const ATTR = ['placeholder', 'aria-label', 'title'];
  let lingua = 'it';
  let modelli = [];

  function compila(l) {
    const d = DIZ[l] || {};
    modelli = Object.keys(d).filter((k) => /\{\d+\}/.test(k)).map((k) => {
      const parti = k.split(/(\{\d+\})/);
      const ordine = [];
      const re = parti.map((p) => {
        const m = /^\{(\d+)\}$/.exec(p);
        if (m) { ordine.push(Number(m[1])); return '([\\s\\S]*?)'; }
        return p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      }).join('');
      return { re: new RegExp(`^${re}$`), ordine, tr: d[k] };
    }).sort((a, b) => b.re.source.length - a.re.source.length);
  }

  /** Traduce un testo (già senza spazi ai bordi); se non è una chiave nota lo restituisce com'è. */
  function tr(testo) {
    if (lingua === 'it' || !testo) return testo;
    const d = DIZ[lingua] || {};
    if (Object.prototype.hasOwnProperty.call(d, testo)) return d[testo];
    for (const m of modelli) {
      const x = m.re.exec(testo);
      if (!x) continue;
      const valori = {};
      m.ordine.forEach((n, i) => { valori[n] = x[i + 1]; });
      // le parti variabili possono essere a loro volta testi da tradurre (es. "Tecnico")
      return m.tr.replace(/\{(\d+)\}/g, (_, n) => {
        const v = valori[n];
        if (v === undefined) return '';
        const x = tr(v.trim());
        return x === v.trim() ? v : x;
      });
    }
    return testo;
  }

  const saltare = (el) => !el || el.closest('.stampa, [data-no-tr], textarea, script, style');

  // testi già tradotti: non si traducono una seconda volta (es. "Azienda" → "Firma" non deve diventare "Unterschrift")
  const fattiTesto = new WeakMap();
  const fattiAttr = new WeakMap();
  function traduciTesto(nodo) {
    const v = nodo.nodeValue;
    if (!v || !/[A-Za-zÀ-ú]/.test(v) || fattiTesto.get(nodo) === v) return;
    const t = v.trim();
    const n = tr(t);
    if (n !== t) { const nuovo = v.replace(t, n); fattiTesto.set(nodo, nuovo); nodo.nodeValue = nuovo; }
  }
  function traduciAttr(el) {
    let fatti = fattiAttr.get(el);
    for (const a of ATTR) {
      const v = el.getAttribute(a);
      if (!v || (fatti && fatti[a] === v)) continue;
      const n = tr(v.trim());
      if (n !== v.trim()) { fatti = fatti || {}; fatti[a] = n; fattiAttr.set(el, fatti); el.setAttribute(a, n); }
    }
    if (el.tagName === 'INPUT' && (el.type === 'submit' || el.type === 'button') && el.value) el.value = tr(el.value);
  }
  function traduci(radice) {
    if (lingua === 'it' || !radice) return;
    if (radice.nodeType === Node.TEXT_NODE) { if (!saltare(radice.parentElement)) traduciTesto(radice); return; }
    if (radice.nodeType !== Node.ELEMENT_NODE || saltare(radice)) return;
    traduciAttr(radice);
    const w = document.createTreeWalker(radice, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
      acceptNode: (n) => (n.nodeType === Node.ELEMENT_NODE && saltare(n) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
    });
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      if (n.nodeType === Node.TEXT_NODE) traduciTesto(n); else traduciAttr(n);
    }
  }

  // ogni nodo aggiunto o testo cambiato viene tradotto (le viste costruiscono il DOM in italiano)
  let osservatore = null;
  function osserva() {
    if (osservatore) return;
    osservatore = new MutationObserver((lista) => {
      if (lingua === 'it') return;
      for (const m of lista) {
        if (m.type === 'childList') m.addedNodes.forEach(traduci);
        else if (m.type === 'characterData') traduci(m.target);
        else if (m.type === 'attributes' && !saltare(m.target)) traduciAttr(m.target);
      }
    });
    osservatore.observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTR });
  }

  // finestre di conferma e avvisi
  const conferma = window.confirm.bind(window);
  const avviso = window.alert.bind(window);
  window.confirm = (msg) => conferma(tr(String(msg)));
  window.alert = (msg) => avviso(tr(String(msg)));

  function titolo() {
    const t = document.title;
    const n = tr(t);
    if (n !== t) document.title = n;
  }
  new MutationObserver(titolo).observe(document.querySelector('title') || document.head, { childList: true, characterData: true, subtree: true });

  function imposta(l, { salva = true } = {}) {
    lingua = LINGUE.includes(l) ? l : 'it';
    if (salva) { try { localStorage.setItem('mk_lingua', lingua); } catch (err) { /* privato */ } }
    document.documentElement.lang = lingua;
    compila(lingua);
    osserva();
    traduci(document.body);
    titolo();
  }

  /** Lingua iniziale: quella salvata sul dispositivo, altrimenti quella del browser (de/en), altrimenti italiano. */
  function iniziale() {
    let l = null;
    try { l = localStorage.getItem('mk_lingua'); } catch (err) { /* privato */ }
    if (LINGUE.includes(l)) return l;
    const b = (navigator.language || 'it').slice(0, 2);
    return LINGUE.includes(b) ? b : 'it';
  }

  window.MeekonI18n = { tr, imposta, iniziale, get lingua() { return lingua; }, LINGUE };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => imposta(iniziale(), { salva: false }));
  else imposta(iniziale(), { salva: false });
})();
