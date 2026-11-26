// Area riservata Meekon Displays — editor dei contenuti del sito (CMS, solo admin).
// Specifica: docs/architettura.md § "Contenuti pubblici modificabili", design: docs/design-guidelines.md § 9.1.
// Regole: si parla solo con /api/* (tramite ctx.api di app.js); unica eccezione il caricamento dei file
// sull'URL firmato restituito da /api/media/upload-url (nessuna chiave). Dati inseriti SOLO con
// textContent / creazione di nodi (mai innerHTML), nessun attributo style=.
// Il modulo non fa nulla da solo: app.js chiama MeekonContenuti.create(ctx) e usa la vista restituita.
(() => {
  'use strict';

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const LANGS = ['it', 'de', 'fr', 'en'];
  const LANG_NAMES = { it: 'italiano', de: 'tedesco', fr: 'francese', en: 'inglese' };
  const CATEGORIE = { matrimoni: 'Matrimoni', aziende: 'Aziende', feste: 'Feste', palco: 'Palco' };
  const FORMATI = { wide: 'Largo (orizzontale)', tall: 'Normale (verticale)', reel: 'Reel (verticale 9:16)' };
  const PAESI = { CH: 'Svizzera', IT: 'Italia', DE: 'Germania', FR: 'Francia' };
  const IMG_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
  const VIDEO_TYPE = 'video/mp4';
  const MAX_IMG = 10 * 1024 * 1024;
  const MAX_VIDEO = 200 * 1024 * 1024;
  const MAX_SIDE = 2000;
  const QUALITY = 0.82;
  const TEXT_MAX = 2000;
  const MEDIA_PATH_RE = /^(galleria|dj|partner)\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp|mp4)$/;
  const LINK_RE = /^https:\/\/[^\s"'<>\\]+$/;
  const STORE_KEY = 'mk_cms_modifiche';
  const PUBLISH_COOLDOWN_S = 120;

  const TABS = [
    ['galleria', 'Galleria'],
    ['location', 'Location'],
    ['dj', 'DJ'],
    ['partner', 'Partner'],
    ['testi', 'Testi del sito'],
  ];

  /** Sezioni a elenco: endpoint, nomi e campi. */
  const SEZ = {
    galleria: { api: 'galleria', title: 'Galleria', one: 'file', nuovo: null },
    location: { api: 'sale', title: 'Location', one: 'location', nuovo: 'Aggiungi una location' },
    dj: { api: 'dj', title: 'DJ', one: 'DJ', nuovo: 'Aggiungi un DJ' },
    partner: { api: 'partner', title: 'Partner', one: 'partner', nuovo: 'Aggiungi un partner' },
  };

  // Nomi leggibili delle sezioni dei testi (prima parte della chiave).
  const GRUPPI = {
    meta: 'Titolo e descrizione per Google',
    nav: 'Menu',
    hero: 'Apertura',
    intro: 'Introduzione',
    events: 'Eventi',
    services: 'Servizi',
    s1: 'Servizi', s2: 'Servizi', s3: 'Servizi', s4: 'Servizi', s5: 'Servizi', s6: 'Servizi',
    davos: 'Davos',
    work: 'Lavori (galleria)',
    lavori: 'Lavori (galleria)',
    regions: 'Zone di lavoro',
    venues: 'Location',
    djs: 'DJ',
    partners: 'Partner',
    method: 'Metodo',
    metodo: 'Metodo',
    faq: 'Domande frequenti',
    contact: 'Contatti',
    contatti: 'Contatti',
    form: 'Modulo di richiesta',
    footer: 'Piè di pagina',
    thanks: 'Pagina di ringraziamento',
    notfound: 'Pagina non trovata (404)',
    a11y: 'Accessibilità (lettori di schermo)',
  };
  const ORDINE_GRUPPI = ['Apertura', 'Introduzione', 'Eventi', 'Servizi', 'Davos', 'Lavori (galleria)', 'Zone di lavoro',
    'Location', 'DJ', 'Partner', 'Metodo', 'Domande frequenti', 'Contatti', 'Modulo di richiesta', 'Piè di pagina',
    'Menu', 'Titolo e descrizione per Google', 'Pagina di ringraziamento', 'Pagina non trovata (404)', 'Accessibilità (lettori di schermo)'];
  const PARTI = {
    eyebrow: 'Sopratitolo', title: 'Titolo', lead: 'Sottotitolo', text: 'Testo', sign: 'Firma',
    cta: 'Pulsante', cta1: 'Pulsante principale', cta2: 'Pulsante secondario',
    foot1: 'Nota 1', foot2: 'Nota 2', foot3: 'Nota 3', t: 'Titolo', d: 'Descrizione', description: 'Descrizione',
    empty: 'Testo se l\'elenco è vuoto', listen: 'Link "Ascolta"', video: 'Video', all: 'Filtro "Tutti"',
    claim: 'Motto', privacy: 'Link all\'informativa privacy', back: 'Link per tornare', submit: 'Pulsante di invio',
    sending: 'Messaggio durante l\'invio', error: 'Messaggio d\'errore', name: 'Campo "Nome"', phone: 'Campo "Telefono"',
    email: 'Campo "E-mail"', type: 'Campo "Tipo di evento"', date: 'Campo "Data"', place: 'Campo "Luogo"',
    place_ph: 'Esempio nel campo "Luogo"', guests: 'Campo "Ospiti"', needs: 'Campo "Servizi"', msg: 'Campo "Messaggio"',
    msg_ph: 'Esempio nel campo "Messaggio"', country: 'Campo "Paese"', whatsapp: 'Testo WhatsApp', langs: 'Lingue parlate',
    onrequest: 'Nota "su richiesta"', skip: 'Salta al contenuto', close: 'Chiudi il menu', menu: 'Apri il menu',
    lang: 'Scelta della lingua', events: 'Voce "Eventi"', services: 'Voce "Servizi"', work: 'Voce "Lavori"',
    venues: 'Voce "Location"', djs: 'Voce "DJ"', method: 'Voce "Metodo"', contact: 'Voce "Contatti"', note: 'Nota',
  };
  const NUMERATI = { e: 'Evento', s: 'Servizio', p: 'Passo' };

  const MOVE_UP = 'M12 19V5M5 12l7-7 7 7';
  const MOVE_DOWN = 'M12 5v14M5 12l7 7 7-7';
  const TRASH = 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3';
  const UPLOAD = 'M12 16V4M7 9l5-5 5 5M4 16v4h16v-4';

  function create(ctx) {
    const { h, add, clear, api, ApiError, errorMessage, page, toast, nextId, field, busy } = ctx;

    const S = {
      data: { galleria: null, location: null, dj: null, partner: null },
      testi: null, // Map chiave -> {it,de,fr,en,updated_at}
      chiavi: null,
      predefiniti: null, // {testi: {chiave: {it,de,fr,en}}, con_em: [...]}
      pub: { list: null, listError: false, status: 'idle', error: null, until: 0, doneAt: null, timer: null },
      modifiche: readCounter(),
      lastChange: 0,
      previews: new Map(),
      bar: null,
      history: null,
    };

    // ------------------------------------------------------------ utilità
    function readCounter() {
      try { const n = Number(window.sessionStorage.getItem(STORE_KEY)); return Number.isInteger(n) && n > 0 ? n : 0; } catch (e) { return 0; }
    }
    function writeCounter() {
      try { window.sessionStorage.setItem(STORE_KEY, String(S.modifiche)); } catch (e) { /* non essenziale */ }
    }
    function changed() {
      S.modifiche += 1;
      S.lastChange = Date.now();
      writeCounter();
      if (S.pub.status === 'done') { S.pub.status = 'idle'; clearTimeout(S.pub.timer); }
      renderBar();
    }
    function noteTimes(rows) {
      for (const r of rows || []) {
        const t = r && typeof r.updated_at === 'string' ? Date.parse(r.updated_at) : NaN;
        if (Number.isFinite(t) && t > S.lastChange) S.lastChange = t;
      }
    }
    function svg(d, { viewBox = '0 0 24 24', cls = null } = {}) {
      const s = document.createElementNS(SVG_NS, 'svg');
      s.setAttribute('viewBox', viewBox);
      s.setAttribute('aria-hidden', 'true');
      s.setAttribute('focusable', 'false');
      if (cls) s.setAttribute('class', cls);
      const p = document.createElementNS(SVG_NS, 'path');
      p.setAttribute('d', d);
      s.append(p);
      return s;
    }
    const pad = (n) => String(n).padStart(2, '0');
    function fmtWhen(iso) {
      const t = typeof iso === 'string' ? Date.parse(iso) : (iso instanceof Date ? iso.getTime() : NaN);
      if (!Number.isFinite(t)) return '—';
      const d = new Date(t);
      const today = new Date();
      const yest = new Date(); yest.setDate(today.getDate() - 1);
      const same = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
      const day = same(d, today) ? 'oggi' : same(d, yest) ? 'ieri' : `il ${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
      return `${day} alle ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }
    function fmtDuration(s) {
      if (!Number.isFinite(s) || s <= 0) return '';
      const m = Math.floor(s / 60);
      return `${m}:${pad(Math.round(s % 60) === 60 ? 59 : Math.round(s % 60))}`;
    }
    function fmtSize(b) {
      return b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(b / 1024))} KB`;
    }
    function validLink(v) {
      if (!v) return true;
      if (v.length > 500 || !LINK_RE.test(v)) return false;
      try {
        const u = new URL(v);
        return u.protocol === 'https:' && !!u.hostname && !u.username && !u.password;
      } catch (e) { return false; }
    }
    function oneLine(v) { return String(v || '').replace(/[\r\n]+/g, ' ').trim(); }
    function srStatus() { return h('p', { class: 'sr-only', role: 'status', 'aria-live': 'polite' }); }
    function announce(el, msg) { el.textContent = ''; window.setTimeout(() => { el.textContent = msg; }, 30); }
    function alertBox() { return h('p', { class: 'alert alert--error', role: 'alert', hidden: true }); }
    function showAlert(el, msg) { el.textContent = msg; el.hidden = !msg; }

    function cmsError(err, what) {
      if (err instanceof ApiError) {
        if (err.status === 403) return 'Non avete i permessi per modificare i contenuti del sito (serve un account amministratore).';
        if (err.status === 404) return `${what ? `${what}: ` : ''}elemento non trovato, forse è stato eliminato. Ricaricate la pagina.`;
        if (err.status === 400 && err.field) return `Il campo "${FIELD_NAMES[err.field] || err.field}" non è valido: controllatelo e riprovate.`;
      }
      return errorMessage(err);
    }
    const FIELD_NAMES = {
      nome: 'Nome', luogo: 'Luogo', paese: 'Paese', link: 'Link', categoria: 'Categoria', formato: 'Formato',
      alt_it: 'Descrizione (IT)', alt_de: 'Descrizione (DE)', alt_fr: 'Descrizione (FR)', alt_en: 'Descrizione (EN)',
      tipo_it: 'Tipo (IT)', tipo_de: 'Tipo (DE)', tipo_fr: 'Tipo (FR)', tipo_en: 'Tipo (EN)',
      genere_it: 'Genere (IT)', genere_de: 'Genere (DE)', genere_fr: 'Genere (FR)', genere_en: 'Genere (EN)',
      file_path: 'File', poster_path: 'Copertina', foto_path: 'Foto', logo_path: 'Logo', tipo: 'Tipo di file',
      it: 'Italiano', de: 'Tedesco', fr: 'Francese', en: 'Inglese', nome_file: 'Nome del file', tipo_mime: 'Formato del file',
      dimensione: 'Dimensione del file', ids: 'Ordine',
    };

    // ------------------------------------------------------------ anteprime (URL firmati brevi)
    const previewQueue = [];
    let previewActive = 0;
    function preview(path) {
      if (typeof path !== 'string' || !MEDIA_PATH_RE.test(path)) return Promise.resolve(null);
      const hit = S.previews.get(path);
      if (hit && Date.now() - hit.t < 4 * 60 * 1000) return hit.p;
      const p = new Promise((resolve) => { previewQueue.push({ path, resolve }); pumpPreviews(); });
      S.previews.set(path, { t: Date.now(), p });
      return p;
    }
    function pumpPreviews() {
      while (previewActive < 4 && previewQueue.length) {
        const { path, resolve } = previewQueue.shift();
        previewActive += 1;
        api(`media/anteprima/${path}`)
          .then((r) => resolve(r && typeof r.url === 'string' && /^https:\/\//.test(r.url) ? r.url : null))
          .catch(() => { S.previews.delete(path); resolve(null); })
          .finally(() => { previewActive -= 1; pumpPreviews(); });
      }
    }
    function thumbMedia(container, path, { video = false, onDuration = null } = {}) {
      preview(path).then((url) => {
        if (!url || !container.isConnected) return;
        let el;
        if (video) {
          el = h('video', { muted: true, preload: 'metadata', playsinline: true });
          el.muted = true;
          if (onDuration) el.addEventListener('loadedmetadata', () => onDuration(el.duration));
        } else {
          el = h('img', { alt: '', loading: 'lazy', decoding: 'async' });
        }
        el.draggable = false; // si trascina la card, non l'immagine
        el.src = url;
        container.prepend(el);
      });
    }

    // ------------------------------------------------------------ preparazione e caricamento dei file
    class UploadError extends Error {}

    function mimeOf(file) {
      const t = (file.type || '').toLowerCase();
      if (t) return t === 'image/jpg' ? 'image/jpeg' : t;
      const ext = (/\.([a-z0-9]+)$/i.exec(file.name || '') || [])[1];
      return { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', mp4: VIDEO_TYPE }[(ext || '').toLowerCase()] || t;
    }
    const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'video/mp4': 'mp4' };
    function baseName(name) {
      return String(name || 'file').replace(/\.[^.]*$/, '').replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'file';
    }
    function niceName(name) {
      return String(name || '').replace(/\.[^.]*$/, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300);
    }
    function canvasBlob(canvas, type, quality) {
      return new Promise((resolve) => { try { canvas.toBlob((b) => resolve(b), type, quality); } catch (e) { resolve(null); } });
    }
    async function decodeImage(file) {
      if (window.createImageBitmap) {
        try { return await window.createImageBitmap(file, { imageOrientation: 'from-image' }); } catch (e) { /* si prova con <img> */ }
      }
      const url = URL.createObjectURL(file);
      try {
        const img = new Image();
        img.decoding = 'async';
        img.src = url;
        await img.decode();
        return img;
      } finally { URL.revokeObjectURL(url); }
    }
    /** Riduce un'immagine (lato lungo max 2000 px) e la converte in WebP (o JPEG / PNG con trasparenza). */
    async function shrinkImage(file, { keepAlpha = false } = {}) {
      const mime = mimeOf(file);
      let src;
      try { src = await decodeImage(file); } catch (e) { throw new UploadError('Immagine non leggibile: il file è danneggiato o in un formato non supportato.'); }
      const w0 = src.width || src.naturalWidth;
      const h0 = src.height || src.naturalHeight;
      if (!w0 || !h0) throw new UploadError('Immagine non leggibile.');
      const scale = Math.min(1, MAX_SIDE / Math.max(w0, h0));
      const w = Math.max(1, Math.round(w0 * scale));
      const hgt = Math.max(1, Math.round(h0 * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = hgt;
      const c2d = canvas.getContext('2d');
      if (!keepAlpha) { c2d.fillStyle = '#ffffff'; c2d.fillRect(0, 0, w, hgt); }
      c2d.drawImage(src, 0, 0, w, hgt);
      if (src.close) src.close();
      let blob = await canvasBlob(canvas, 'image/webp', QUALITY);
      if (!blob || blob.type !== 'image/webp') blob = await canvasBlob(canvas, keepAlpha ? 'image/png' : 'image/jpeg', QUALITY);
      if (!blob || !IMG_TYPES.includes(blob.type)) throw new UploadError('Non è stato possibile ridurre l\'immagine in questo browser.');
      // immagine già piccola e già leggera: si tiene l'originale
      if (scale === 1 && IMG_TYPES.includes(mime) && file.size <= blob.size) return { blob: file, mime, width: w0, height: h0 };
      return { blob, mime: blob.type, width: w, height: hgt };
    }
    /** Durata, dimensioni e copertina (fotogramma al primo secondo) di un video, se il browser lo sa leggere. */
    function videoInfo(file) {
      return new Promise((resolve) => {
        const url = URL.createObjectURL(file);
        const v = document.createElement('video');
        v.muted = true;
        v.preload = 'auto';
        v.playsInline = true;
        let done = false;
        const finish = (info) => { if (done) return; done = true; URL.revokeObjectURL(url); v.removeAttribute('src'); v.load(); resolve(info); };
        const timer = window.setTimeout(() => finish({ duration: v.duration, width: v.videoWidth, height: v.videoHeight, poster: null }), 15000);
        v.addEventListener('error', () => { window.clearTimeout(timer); finish({ duration: NaN, width: 0, height: 0, poster: null }); });
        v.addEventListener('loadedmetadata', () => {
          const t = Number.isFinite(v.duration) && v.duration > 0 ? Math.min(1, v.duration / 2) : 0;
          try { v.currentTime = t; } catch (e) { /* alcuni browser non permettono il seek */ }
        });
        v.addEventListener('seeked', async () => {
          window.clearTimeout(timer);
          let poster = null;
          try {
            const vw = v.videoWidth;
            const vh = v.videoHeight;
            if (vw && vh) {
              const scale = Math.min(1, MAX_SIDE / Math.max(vw, vh));
              const canvas = document.createElement('canvas');
              canvas.width = Math.round(vw * scale);
              canvas.height = Math.round(vh * scale);
              canvas.getContext('2d').drawImage(v, 0, 0, canvas.width, canvas.height);
              let b = await canvasBlob(canvas, 'image/webp', QUALITY);
              if (!b || b.type !== 'image/webp') b = await canvasBlob(canvas, 'image/jpeg', QUALITY);
              if (b && IMG_TYPES.includes(b.type) && b.size > 0) poster = { blob: b, mime: b.type };
            }
          } catch (e) { poster = null; }
          finish({ duration: v.duration, width: v.videoWidth, height: v.videoHeight, poster });
        }, { once: true });
        v.src = url;
      });
    }

    /** Chiede l'URL firmato e carica il file con PUT (XMLHttpRequest per l'avanzamento). Restituisce il percorso nel bucket. */
    async function uploadBlob(blob, name, mime, cartella, onProgress) {
      let info;
      try {
        info = await api('media/upload-url', { method: 'POST', body: { nome_file: `${baseName(name)}.${EXT[mime]}`, tipo_mime: mime, dimensione: blob.size, cartella } });
      } catch (err) {
        if (err instanceof ApiError && err.status === 400 && err.field === 'dimensione') throw new UploadError('File troppo grande: immagini fino a 10 MB, video fino a 200 MB.');
        if (err instanceof ApiError && err.status === 400) throw new UploadError('Formato del file non ammesso: usate JPEG, PNG, WebP o MP4.');
        throw new UploadError(cmsError(err));
      }
      let target;
      try { target = new URL(info.upload_url); } catch (e) { target = null; }
      if (!info || typeof info.path !== 'string' || !MEDIA_PATH_RE.test(info.path) || !info.path.startsWith(`${cartella}/`) || !target || target.protocol !== 'https:') {
        throw new UploadError('Risposta inattesa dal server: caricamento annullato. Riprovate tra poco.');
      }
      await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('PUT', target.href, true);
        xhr.withCredentials = false;
        xhr.setRequestHeader('Content-Type', mime);
        const upsert = info.headers && info.headers['x-upsert'];
        xhr.setRequestHeader('x-upsert', upsert === 'true' ? 'true' : 'false');
        xhr.upload.addEventListener('progress', (e) => { if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total); });
        xhr.addEventListener('load', () => {
          if (xhr.status >= 200 && xhr.status < 300) resolve();
          else if (xhr.status === 413) reject(new UploadError('Il server dei file ha rifiutato il caricamento: file troppo grande.'));
          else if (xhr.status === 400 || xhr.status === 403 || xhr.status === 401) reject(new UploadError('Il permesso di caricamento è scaduto o non è valido. Riprovate.'));
          else reject(new UploadError(`Il server dei file ha rifiutato il caricamento (codice ${xhr.status}). Riprovate tra poco.`));
        });
        xhr.addEventListener('error', () => reject(new UploadError('Caricamento non riuscito: controllate la connessione a internet e riprovate.')));
        xhr.addEventListener('abort', () => reject(new UploadError('Caricamento annullato.')));
        xhr.addEventListener('timeout', () => reject(new UploadError('Caricamento troppo lento: riprovate con una connessione migliore.')));
        xhr.send(blob);
      });
      return info.path;
    }

    function uploadItem(name) {
      const status = h('span', { class: 'upload__status' }, 'In preparazione…');
      const bar = h('progress', { class: 'progress', max: '100' });
      bar.removeAttribute('value');
      bar.textContent = 'In corso';
      const li = h('li', { class: 'upload' }, h('span', { class: 'upload__name' }, name), status, bar);
      return {
        li,
        step(text) { status.textContent = text; bar.removeAttribute('value'); },
        progress(f) { const v = Math.round(f * 100); bar.value = v; bar.textContent = `${v} %`; status.textContent = `${v} %`; },
        done(text) { li.classList.add('is-done'); bar.value = 100; status.textContent = text; },
        fail(msg) {
          li.classList.add('is-error');
          status.textContent = 'Errore';
          bar.value = 0;
          li.append(h('p', { class: 'upload__error', role: 'alert' }, msg));
        },
      };
    }

    function dropzone({ multiple, accept, title, hint, onFiles }) {
      const hid = nextId('dz-hint');
      const input = h('input', { type: 'file', accept, 'aria-describedby': hid });
      if (multiple) input.multiple = true;
      const zone = h('label', { class: 'dropzone' }, input,
        svg(UPLOAD, { cls: 'dropzone__icon' }),
        h('span', { class: 'dropzone__title' }, title, ' oppure ', h('u', null, multiple ? 'sceglieteli dal computer' : 'sceglietela dal computer')),
        h('span', { class: 'dropzone__hint', id: hid }, hint));
      const hasFiles = (e) => e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');
      zone.addEventListener('dragenter', (e) => { if (hasFiles(e) && !input.disabled) { e.preventDefault(); zone.classList.add('is-dragover'); } });
      zone.addEventListener('dragover', (e) => { if (hasFiles(e) && !input.disabled) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; zone.classList.add('is-dragover'); } });
      zone.addEventListener('dragleave', (e) => { if (!zone.contains(e.relatedTarget)) zone.classList.remove('is-dragover'); });
      zone.addEventListener('drop', (e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        zone.classList.remove('is-dragover');
        if (input.disabled) return;
        const files = Array.from(e.dataTransfer.files || []);
        onFiles(multiple ? files : files.slice(0, 1));
      });
      input.addEventListener('change', () => { const files = Array.from(input.files || []); input.value = ''; if (files.length) onFiles(files); });
      return {
        el: zone,
        input,
        disable(on) { input.disabled = !!on; zone.classList.toggle('is-disabled', !!on); },
        error(on) { zone.classList.toggle('is-error', !!on); },
      };
    }

    /** Controllo prima del caricamento: tipo e dimensione (i limiti veri li controlla il server). */
    function precheck(file, { video }) {
      const mime = mimeOf(file);
      if (mime === VIDEO_TYPE) {
        if (!video) return 'Qui si possono caricare solo immagini (JPEG, PNG o WebP).';
        if (file.size > MAX_VIDEO) return `Video troppo grande (${fmtSize(file.size)}): il massimo è 200 MB.`;
        return null;
      }
      if (!IMG_TYPES.includes(mime)) return video ? 'Formato non ammesso: usate JPEG, PNG, WebP o MP4.' : 'Formato non ammesso: usate JPEG, PNG o WebP.';
      if (file.size > 40 * 1024 * 1024) return `Immagine troppo grande (${fmtSize(file.size)}).`;
      return null;
    }

    /** Immagine singola (foto DJ, logo partner, copertina): riduzione + caricamento. */
    async function uploadImage(file, cartella, item, { keepAlpha = false } = {}) {
      const bad = precheck(file, { video: false });
      if (bad) throw new UploadError(bad);
      item.step('Riduzione dell\'immagine…');
      const img = await shrinkImage(file, { keepAlpha });
      if (img.blob.size > MAX_IMG) throw new UploadError('Immagine troppo grande anche dopo la riduzione (massimo 10 MB).');
      item.progress(0);
      const path = await uploadBlob(img.blob, file.name, img.mime, cartella, (f) => item.progress(f));
      return { path, blob: img.blob, width: img.width, height: img.height };
    }

    // ------------------------------------------------------------ campo in 4 lingue
    /**
     * opts: { legend, prefix (nome del campo API, es. "alt" → alt_it; vuoto → "it"), values, max, multiline,
     *         required: ['it'], fallback: testo quando vuoto, defaults: {lang: testo} (testi del sito), onTab }
     */
    function langField(opts) {
      const base = nextId('lang');
      const tabs = h('div', { class: 'lang-tabs', role: 'tablist', 'aria-label': `Lingua — ${opts.legend}` });
      const fs = h('fieldset', { class: 'lang-field' }, h('legend', { class: 'field__label' }, opts.legend), tabs);
      const parts = {};
      let current = 'it';
      const isReq = (l) => (opts.required || []).includes(l);
      const select = (l, focus) => {
        current = l;
        for (const x of LANGS) {
          const p = parts[x];
          p.tab.setAttribute('aria-selected', x === l ? 'true' : 'false');
          p.tab.tabIndex = x === l ? 0 : -1;
          p.panel.hidden = x !== l;
        }
        if (focus) parts[l].tab.focus();
        if (opts.onTab) opts.onTab(l);
      };
      const refresh = (l) => {
        const p = parts[l];
        const len = p.input.value.length;
        p.count.textContent = `${len} / ${opts.max}`;
        p.count.classList.toggle('is-over', len >= opts.max);
        const empty = !p.input.value.trim();
        const missing = empty && !isReq(l);
        p.tab.classList.toggle('is-missing', missing);
        if (!empty) { p.tab.classList.remove('is-invalid'); p.input.removeAttribute('aria-invalid'); }
        p.sr.textContent = p.tab.classList.contains('is-invalid') ? ' (obbligatorio, mancante)' : missing ? ' (vuoto)' : '';
        p.fallback.hidden = !missing;
      };
      for (const l of LANGS) {
        const tid = `${base}-t-${l}`;
        const pid = `${base}-p-${l}`;
        const iid = `${base}-i-${l}`;
        const sr = h('span', { class: 'sr-only' });
        const tab = h('button', { type: 'button', role: 'tab', id: tid, 'aria-controls': pid, 'aria-selected': 'false', tabindex: '-1' }, l.toUpperCase(), sr);
        const name = opts.prefix ? `${opts.prefix}_${l}` : l;
        const val = opts.values && typeof opts.values[l] === 'string' ? opts.values[l] : '';
        const input = opts.multiline
          ? h('textarea', { id: iid, name, rows: '4', maxlength: String(opts.max), value: val })
          : h('input', { id: iid, name, type: 'text', maxlength: String(opts.max), value: val, autocomplete: 'off' });
        if (opts.defaults && opts.defaults[l]) input.placeholder = opts.defaults[l];
        if (isReq(l)) input.required = true;
        const count = h('span', { class: 'lang-panel__count', 'aria-live': 'off' });
        const fallback = h('span', { class: 'lang-panel__fallback', hidden: true }, opts.fallback || 'Vuoto: si userà il testo italiano.');
        const panel = h('div', { class: 'lang-panel', role: 'tabpanel', id: pid, 'aria-labelledby': tid, hidden: true },
          h('div', { class: 'field' }, h('label', { class: 'sr-only', for: iid }, `${opts.legend} in ${LANG_NAMES[l]}${isReq(l) ? ' (obbligatorio)' : ''}`), input),
          opts.hint ? h('p', { class: 'field__hint' }, opts.hint) : null,
          h('div', { class: 'lang-panel__foot' }, fallback, count));
        parts[l] = { tab, panel, input, count, fallback, sr };
        tab.addEventListener('click', () => select(l, false));
        tab.addEventListener('keydown', (e) => {
          const i = LANGS.indexOf(l);
          let n = null;
          if (e.key === 'ArrowRight') n = LANGS[(i + 1) % LANGS.length];
          else if (e.key === 'ArrowLeft') n = LANGS[(i + LANGS.length - 1) % LANGS.length];
          else if (e.key === 'Home') n = LANGS[0];
          else if (e.key === 'End') n = LANGS[LANGS.length - 1];
          if (n) { e.preventDefault(); select(n, true); }
        });
        input.addEventListener('input', () => refresh(l));
        // testi su una sola riga (es. descrizioni delle foto): Invio non va a capo
        if (opts.noBreaks) input.addEventListener('keydown', (e) => { if (e.key === 'Enter') e.preventDefault(); });
        tabs.append(tab);
        fs.append(panel);
      }
      LANGS.forEach(refresh);
      select('it', false);
      return {
        el: fs,
        values() { const o = {}; for (const l of LANGS) o[l] = opts.multiline && !opts.noBreaks ? parts[l].input.value.trim() : oneLine(parts[l].input.value); return o; },
        current: () => current,
        /** Segna una lingua come non valida e la mostra. */
        invalid(l) {
          const p = parts[l];
          if (!p) return;
          p.tab.classList.add('is-invalid');
          p.input.setAttribute('aria-invalid', 'true');
          refresh(l);
          select(l, false);
          p.input.focus();
        },
        validate() {
          for (const l of LANGS) {
            if (isReq(l) && !parts[l].input.value.trim()) { this.invalid(l); return false; }
          }
          return true;
        },
        focus() { parts[current].input.focus(); },
        hasName: (name) => LANGS.some((l) => (opts.prefix ? `${opts.prefix}_${l}` : l) === name),
        langOf: (name) => LANGS.find((l) => (opts.prefix ? `${opts.prefix}_${l}` : l) === name),
      };
    }

    function switchEl(checked, label) {
      const input = h('input', { type: 'checkbox', role: 'switch', checked: !!checked, 'aria-label': label });
      const el = h('label', { class: 'switch' }, input, h('span', { class: 'switch__track', 'aria-hidden': 'true' }),
        h('span', { class: 'switch__on' }, 'Pubblicato'), h('span', { class: 'switch__off' }, 'Bozza'));
      return { el, input };
    }
    function stateBadge(pub) { return h('span', { class: `badge ${pub ? 'badge--pubblicato' : 'badge--bozza'}` }, pub ? 'Pubblicato' : 'Bozza'); }
    function langStatus(values, label) {
      return h('ul', { class: 'lang-status', 'aria-label': label },
        LANGS.map((l) => (values[l] ? h('li', null, l.toUpperCase()) : h('li', { class: 'is-missing' }, l.toUpperCase(), h('span', { class: 'sr-only' }, ' mancante')))));
    }
    const langVals = (v, prefix) => Object.fromEntries(LANGS.map((l) => [l, v[`${prefix}_${l}`] || '']));

    /** Conferma in pagina: focus su "Annulla", Esc chiude, al termine il focus torna all'origine. */
    function confirmBox({ question, text, action, opener, mount, onConfirm }) {
      const tid = nextId('c');
      const cancel = h('button', { class: 'btn', type: 'button' }, 'Annulla');
      const ok = h('button', { class: 'btn btn--danger', type: 'button' }, action);
      const err = h('p', { class: 'upload__error', role: 'alert', hidden: true });
      const box = h('div', { class: 'confirm', role: 'group', 'aria-labelledby': tid },
        h('p', { class: 'confirm__text', id: tid }, h('strong', null, question), text ? ` ${text}` : ''),
        err,
        h('div', { class: 'confirm__actions' }, ok, cancel));
      const close = (refocus = true) => { box.remove(); if (refocus && opener && opener.isConnected) opener.focus(); };
      cancel.addEventListener('click', () => close());
      box.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); close(); } });
      ok.addEventListener('click', () => busy(ok, async () => {
        try { await onConfirm(); box.remove(); } catch (e) { err.textContent = cmsError(e); err.hidden = false; }
      }));
      mount(box);
      cancel.focus();
      return box;
    }

    // ------------------------------------------------------------ barra "Pubblica sul sito"
    function lastPublication() {
      return (S.pub.list || []).find((p) => p && p.esito !== 'errore') || null;
    }
    function buildBar() {
      const strong = h('strong');
      const sub = h('span', { class: 'publish-bar__sub' });
      const btn = h('button', { class: 'btn btn--primary', type: 'button' }, 'Pubblica sul sito');
      const el = h('div', { class: 'publish-bar', role: 'region', 'aria-label': 'Pubblicazione' },
        h('div', { class: 'publish-bar__status', role: 'status' },
          h('span', { class: 'publish-bar__icon', 'aria-hidden': 'true' }),
          h('p', { class: 'publish-bar__text' }, strong, sub)),
        h('div', { class: 'publish-bar__actions' }, btn));
      btn.addEventListener('click', publish);
      S.bar = { el, strong, sub, btn };
      renderBar();
      return el;
    }
    function lastText() {
      if (S.pub.listError) return 'Elenco delle pubblicazioni non disponibile.';
      if (!S.pub.list) return 'Caricamento delle pubblicazioni…';
      const last = lastPublication();
      if (!last) return 'Il sito non è ancora stato pubblicato da qui.';
      return `Ultima pubblicazione: ${fmtWhen(last.created_at)}${last.richiesta_da ? ` · ${last.richiesta_da}` : ''}`;
    }
    function isPending() {
      if (S.modifiche > 0) return true;
      if (!S.pub.list || !S.lastChange) return false;
      const last = lastPublication();
      return !last || S.lastChange > Date.parse(last.created_at || '');
    }
    function renderBar() {
      const b = S.bar;
      if (!b) return;
      const st = S.pub.status;
      let mod = '';
      let strong = '';
      let sub = lastText();
      let label = 'Pubblica sul sito';
      let disabled = false;
      b.btn.removeAttribute('aria-busy');
      if (st === 'busy') {
        mod = 'busy'; strong = 'Pubblicazione in corso…'; sub = 'Avvio dell\'aggiornamento del sito.'; disabled = true;
        b.btn.setAttribute('aria-busy', 'true');
      } else if (st === 'done') {
        mod = 'done'; strong = `Pubblicazione avviata ${fmtWhen(S.pub.doneAt)}`; sub = 'Il sito si aggiorna entro qualche minuto.'; disabled = true;
      } else if (st === 'error') {
        mod = 'error'; label = 'Riprova';
        const e = S.pub.error || {};
        strong = e.title || 'La pubblicazione non è riuscita';
        if (e.wait) {
          const left = Math.max(0, Math.ceil((S.pub.until - Date.now()) / 1000));
          sub = left > 0 ? `Potrete pubblicare di nuovo tra ${left} ${left === 1 ? 'secondo' : 'secondi'}.` : 'Ora potete riprovare.';
          disabled = left > 0;
        } else sub = e.text || 'Riprovate tra qualche istante.';
      } else if (isPending()) {
        mod = 'pending';
        strong = S.modifiche > 0 ? `${S.modifiche} ${S.modifiche === 1 ? 'modifica non pubblicata' : 'modifiche non pubblicate'}` : 'Ci sono modifiche non pubblicate';
      } else {
        strong = 'Nessuna modifica da pubblicare';
      }
      b.el.className = `publish-bar${mod ? ` publish-bar--${mod}` : ''}`;
      if (b.strong.textContent !== strong) b.strong.textContent = strong;
      if (b.sub.textContent !== sub) b.sub.textContent = sub;
      b.btn.textContent = label;
      b.btn.disabled = disabled;
    }
    async function loadPublications() {
      try {
        const r = await api('pubblicazioni');
        S.pub.list = Array.isArray(r.pubblicazioni) ? r.pubblicazioni : [];
        S.pub.listError = false;
      } catch (err) {
        S.pub.listError = true;
      }
      renderBar();
      renderHistory();
    }
    async function publish() {
      if (S.pub.status === 'busy') return;
      clearTimeout(S.pub.timer);
      S.pub.status = 'busy';
      S.pub.error = null;
      renderBar();
      try {
        const r = await api('pubblica', { method: 'POST' });
        S.pub.status = 'done';
        S.pub.doneAt = (r && r.pubblicazione && r.pubblicazione.created_at) || new Date().toISOString();
        S.modifiche = 0;
        writeCounter();
        S.lastChange = 0;
        S.pub.timer = window.setTimeout(() => { if (S.pub.status === 'done') { S.pub.status = 'idle'; renderBar(); } }, PUBLISH_COOLDOWN_S * 1000);
        loadPublications();
      } catch (err) {
        S.pub.status = 'error';
        if (err instanceof ApiError && err.status === 429) {
          const n = err.data && Number.isInteger(err.data.attesa_secondi) ? Math.min(Math.max(err.data.attesa_secondi, 1), 600) : PUBLISH_COOLDOWN_S;
          S.pub.until = Date.now() + n * 1000;
          S.pub.error = { title: 'Avete pubblicato da poco', wait: true };
          const tick = () => {
            if (S.pub.status !== 'error' || !S.pub.error || !S.pub.error.wait) return;
            renderBar();
            if (Date.now() < S.pub.until) S.pub.timer = window.setTimeout(tick, 1000);
          };
          S.pub.timer = window.setTimeout(tick, 1000);
        } else if (err instanceof ApiError && err.status === 403) {
          S.pub.error = { title: 'Non avete i permessi per pubblicare', text: 'Serve un account amministratore.' };
        } else if (err instanceof ApiError && err.status === 500 && err.data && err.data.error === 'server_misconfigured') {
          S.pub.error = { title: 'La pubblicazione non è configurata', text: 'Su Netlify manca il collegamento per ricostruire il sito (variabile NETLIFY_BUILD_HOOK). Va impostato una volta da chi gestisce Netlify.' };
        } else if (err instanceof ApiError && err.status >= 500) {
          S.pub.error = { title: 'La pubblicazione non è partita', text: 'Il servizio che ricostruisce il sito non ha risposto. Riprovate tra qualche minuto.' };
        } else {
          S.pub.error = { title: 'La pubblicazione non è riuscita', text: errorMessage(err) };
        }
        loadPublications();
      }
      renderBar();
    }
    const ESITI = { in_corso: ['In corso', 'nuova'], avviata: ['Avviata', 'gestita'], errore: ['Errore', 'scartata'] };
    function buildHistory() {
      const count = h('span', { class: 'text-group__count' });
      const body = h('div');
      const el = h('details', { class: 'text-group' }, h('summary', null, 'Ultime pubblicazioni ', count), body);
      S.history = { el, count, body };
      renderHistory();
      return el;
    }
    function renderHistory() {
      const hs = S.history;
      if (!hs) return;
      clear(hs.body);
      if (S.pub.listError) { hs.count.textContent = 'non disponibili'; hs.body.append(h('p', { class: 'alert alert--error' }, 'Non è stato possibile caricare l\'elenco delle pubblicazioni.')); return; }
      if (!S.pub.list) { hs.count.textContent = ''; hs.body.append(h('p', { class: 'muted' }, 'Caricamento…')); return; }
      const list = S.pub.list.slice(0, 10);
      hs.count.textContent = list.length ? `${list.length} ${list.length === 1 ? 'pubblicazione' : 'pubblicazioni'}` : 'nessuna';
      if (!list.length) { hs.body.append(h('div', { class: 'empty' }, h('strong', null, 'Nessuna pubblicazione'), h('p', null, 'Quando premerete "Pubblica sul sito" le pubblicazioni compariranno qui.'))); return; }
      hs.body.append(h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
        h('thead', null, h('tr', null, h('th', { scope: 'col' }, 'Quando'), h('th', { scope: 'col' }, 'Esito'), h('th', { scope: 'col' }, 'Richiesta da'))),
        h('tbody', null, list.map((p) => {
          const [txt, cls] = ESITI[p.esito] || [String(p.esito || '—'), null];
          return h('tr', null,
            h('td', { 'data-label': 'Quando' }, h('span', null, fmtWhen(p.created_at))),
            h('td', { 'data-label': 'Esito' }, h('span', null, h('span', { class: cls ? `badge badge--${cls}` : 'badge' }, txt))),
            h('td', { 'data-label': 'Richiesta da' }, h('span', null, p.richiesta_da || '—')));
        })))));
    }

    // ------------------------------------------------------------ vista principale
    async function view([sub], alive) {
      const tab = TABS.some(([k]) => k === sub) ? sub : 'galleria';
      const body = h('div');
      const tabs = h('nav', { class: 'tabs', 'aria-label': 'Sezioni dei contenuti' },
        TABS.map(([k, label]) => h('a', { href: `#/contenuti/${k}`, 'aria-current': k === tab ? 'page' : null }, label)));
      page({ title: 'Contenuti del sito', sub: 'Le modifiche restano in bozza qui e diventano visibili sul sito solo dopo "Pubblica sul sito".' },
        tabs, body, buildHistory(), buildBar());
      loadPublications();
      if (tab === 'testi') await viewTesti(body, alive);
      else await viewList(tab, body, alive);
    }

    function loadError(body, err, retry) {
      clear(body);
      add(body, [h('p', { class: 'alert alert--error', role: 'alert' }, cmsError(err)),
        h('p', null, h('button', { class: 'btn', type: 'button', onclick: retry }, 'Riprova'))]);
    }

    // ------------------------------------------------------------ elenchi (galleria, location, DJ, partner)
    async function viewList(key, body, alive) {
      clear(body);
      body.append(h('p', { class: 'muted', role: 'status' }, 'Caricamento…'));
      let voci;
      try {
        const r = await api(`contenuti/${SEZ[key].api}`);
        voci = Array.isArray(r.voci) ? r.voci : [];
      } catch (err) {
        if (alive()) loadError(body, err, () => viewList(key, body, alive));
        return;
      }
      if (!alive()) return;
      S.data[key] = voci;
      noteTimes(voci);
      renderBar();
      renderList(key, body);
    }

    function renderList(key, body, focusId = null) {
      const conf = SEZ[key];
      clear(body);
      const live = srStatus();
      const gridWrap = h('div');
      const ctxL = { key, body, live, gridWrap, grid: null, cards: new Map(), saveTimer: null };
      const intro = {
        galleria: 'Foto e video della sezione "Lavori". I file nuovi arrivano come bozza: aggiungete una descrizione e attivate "Pubblicato".',
        location: 'Sale e location in cui avete lavorato. Pubblicate solo quelle approvate dal titolare.',
        dj: 'DJ con cui collaborate. Pubblicate solo quelli approvati dal titolare.',
        partner: 'Partner e fornitori. Pubblicate solo quelli approvati dal titolare.',
      }[key];
      body.append(h('h2', { class: 'sr-only' }, conf.title), h('p', { class: 'muted' }, intro), live);
      // spaziatura solo con il gap di .panels (come i pannelli larghi di app.js)
      const stack = h('div', { class: 'panels' });
      if (key === 'galleria') stack.append(h('div', { class: 'field--full' }, galleryUploader(ctxL)));
      else {
        const addBtn = h('button', { class: 'btn', type: 'button' }, `+ ${conf.nuovo}`);
        addBtn.addEventListener('click', () => openEditor(key, null, body, addBtn));
        stack.append(h('div', { class: 'field--full' }, addBtn));
      }
      gridWrap.className = 'field--full';
      stack.append(gridWrap);
      body.append(stack);
      drawGrid(ctxL);
      if (focusId) {
        const card = ctxL.cards.get(focusId);
        const btn = card && card.querySelector('[data-edit]');
        if (btn) btn.focus();
      }
      return ctxL;
    }

    function drawGrid(L) {
      clear(L.gridWrap);
      L.cards.clear();
      const voci = S.data[L.key] || [];
      if (!voci.length) {
        const txt = {
          galleria: ['Nessuna foto o video', 'Caricate i primi file con la zona qui sopra.'],
          location: ['Nessuna location', 'Aggiungete la prima con il pulsante qui sopra.'],
          dj: ['Nessun DJ', 'Aggiungete il primo con il pulsante qui sopra.'],
          partner: ['Nessun partner', 'Aggiungete il primo con il pulsante qui sopra.'],
        }[L.key];
        L.gridWrap.append(h('div', { class: 'empty' }, h('strong', null, txt[0]), h('p', null, txt[1])));
        L.grid = null;
        return;
      }
      const grid = h('ul', { class: 'media-grid', 'aria-label': `${SEZ[L.key].title}: ${voci.length} ${voci.length === 1 ? 'voce' : 'voci'}` });
      L.grid = grid;
      voci.forEach((v, i) => { const li = card(L, v, i, voci.length); L.cards.set(v.id, li); grid.append(li); });
      L.gridWrap.append(grid);
    }

    function titleOf(key, v) {
      if (key === 'galleria') return v.alt_it || '';
      return v.nome || '';
    }

    function card(L, v, index, total) {
      const key = L.key;
      const li = h('li', { class: `media-card${v.pubblicato ? '' : ' is-draft'}`, draggable: 'true', 'data-id': v.id });
      // anteprima
      const typeLabel = h('span', { class: 'media-card__type' });
      const pos = h('span', { class: 'media-card__pos' }, String(index + 1));
      const thumb = h('div', { class: 'media-card__thumb' }, typeLabel, pos);
      if (key === 'galleria') {
        const isVideo = v.tipo === 'video';
        if (isVideo) typeLabel.append(svg('M3 2l7 4-7 4z', { viewBox: '0 0 12 12' }));
        typeLabel.append(document.createTextNode(isVideo ? 'Video' : 'Foto'));
        const setDur = (d) => { const t = fmtDuration(d); if (t) typeLabel.lastChild.textContent = `Video ${t}`; };
        if (isVideo && v.poster_path) thumbMedia(thumb, v.poster_path);
        else thumbMedia(thumb, v.file_path, { video: isVideo, onDuration: setDur });
      } else if (key === 'dj') {
        if (v.foto_path) { thumbMedia(thumb, v.foto_path); typeLabel.textContent = v.foto_e_logo === false ? 'Foto' : 'Logo'; } else typeLabel.textContent = 'Senza immagine';
      } else if (key === 'partner') {
        if (v.logo_path) { thumbMedia(thumb, v.logo_path); typeLabel.textContent = 'Logo'; } else typeLabel.textContent = 'Senza logo';
      } else {
        typeLabel.textContent = PAESI[v.paese] || v.paese || 'Location';
      }

      // testo
      const title = titleOf(key, v);
      const meta = h('div', { class: 'media-card__meta' });
      if (key === 'galleria') meta.append(h('span', { class: 'tag' }, CATEGORIE[v.categoria] || v.categoria || '—'));
      if (key === 'location' && v.luogo) meta.append(h('span', { class: 'tag' }, v.luogo));
      const badgeEl = stateBadge(v.pubblicato);
      meta.append(badgeEl);
      const bodyEl = h('div', { class: 'media-card__body' }, meta,
        h('p', { class: `media-card__title${title ? '' : ' is-empty'}` }, title || 'Manca la descrizione'));
      if (key === 'galleria') bodyEl.append(langStatus(langVals(v, 'alt'), 'Descrizione nelle lingue'));
      if (key === 'location') bodyEl.append(langStatus(langVals(v, 'tipo'), 'Tipo di location nelle lingue'));
      if (key === 'dj') bodyEl.append(langStatus(langVals(v, 'genere'), 'Genere musicale nelle lingue'));
      if (key === 'partner' || key === 'dj') {
        let host = '';
        try { host = v.link ? new URL(v.link).hostname : ''; } catch (e) { host = ''; }
        bodyEl.append(h('p', { class: 'muted' }, host ? `Link: ${host}` : 'Nessun link'));
      }
      const sw = switchEl(v.pubblicato, `Pubblicato sul sito: ${title || SEZ[key].one}`);
      bodyEl.append(sw.el);
      sw.input.addEventListener('change', async () => {
        const want = sw.input.checked;
        sw.input.disabled = true;
        try {
          const r = await api(`contenuti/${SEZ[key].api}/${encodeURIComponent(v.id)}`, { method: 'PATCH', body: { pubblicato: want } });
          Object.assign(v, r.voce || { pubblicato: want });
          li.classList.toggle('is-draft', !v.pubblicato);
          badgeEl.className = `badge ${v.pubblicato ? 'badge--pubblicato' : 'badge--bozza'}`;
          badgeEl.textContent = v.pubblicato ? 'Pubblicato' : 'Bozza';
          announce(L.live, v.pubblicato ? 'Segnato come pubblicato: sarà visibile dopo "Pubblica sul sito".' : 'Segnato come bozza: sparirà dal sito alla prossima pubblicazione.');
          changed();
        } catch (err) {
          sw.input.checked = !want;
          toast(cmsError(err), 'error');
        } finally {
          sw.input.disabled = false;
        }
      });

      // barra azioni
      const up = h('button', { class: 'btn-icon', type: 'button', 'aria-label': 'Sposta prima', 'data-move': 'up' }, svg(MOVE_UP));
      const down = h('button', { class: 'btn-icon', type: 'button', 'aria-label': 'Sposta dopo', 'data-move': 'down' }, svg(MOVE_DOWN));
      up.disabled = index === 0;
      down.disabled = index === total - 1;
      up.addEventListener('click', () => moveBy(L, v.id, -1, up));
      down.addEventListener('click', () => moveBy(L, v.id, +1, down));
      const edit = h('button', { class: 'btn btn--sm', type: 'button', 'data-edit': '' }, 'Modifica');
      edit.addEventListener('click', () => openEditor(key, v, L.body, edit));
      const del = h('button', { class: 'btn-icon btn-icon--danger', type: 'button', 'aria-label': `Elimina: ${title || SEZ[key].one}` }, svg(TRASH));
      const bar = h('div', { class: 'media-card__bar' },
        h('div', { class: 'media-card__order' }, h('span', { class: 'drag-handle', 'aria-hidden': 'true' }), up, down),
        h('div', { class: 'media-card__actions' }, edit, del));
      del.addEventListener('click', () => {
        if (bar.querySelector('.confirm')) return;
        const what = key === 'galleria' ? (v.tipo === 'video' ? 'questo video' : 'questa foto') : `"${title}"`;
        confirmBox({
          question: `Eliminare ${what}?`,
          text: 'Sparirà dal sito alla prossima pubblicazione.',
          action: 'Elimina',
          opener: del,
          mount: (box) => bar.append(box),
          onConfirm: async () => {
            await api(`contenuti/${SEZ[key].api}/${encodeURIComponent(v.id)}`, { method: 'DELETE' });
            const arr = S.data[key];
            const i = arr.findIndex((x) => x.id === v.id);
            if (i >= 0) arr.splice(i, 1);
            changed();
            drawGrid(L);
            announce(L.live, 'Eliminato.');
            const next = arr[Math.min(i, arr.length - 1)];
            const target = next && L.cards.get(next.id);
            const btn = target ? target.querySelector('[data-edit]') : L.body.querySelector('.dropzone input, .panels > .field--full > .btn');
            if (btn) btn.focus();
          },
        });
      });

      li.append(thumb, bodyEl, bar);

      // trascinamento (mouse / tocco); da tastiera si usano i pulsanti su/giù
      li.addEventListener('dragstart', (e) => {
        if (e.target !== li) { if (!(e.target instanceof Element) || e.target.closest('.media-card') !== li) return; }
        L.dragId = v.id;
        li.classList.add('is-dragging');
        e.dataTransfer.effectAllowed = 'move';
        try { e.dataTransfer.setData('text/plain', v.id); } catch (err) { /* ok */ }
      });
      li.addEventListener('dragend', () => {
        li.classList.remove('is-dragging');
        L.dragId = null;
        L.gridWrap.querySelectorAll('.is-drop-target').forEach((x) => x.classList.remove('is-drop-target'));
      });
      li.addEventListener('dragover', (e) => {
        if (!L.dragId || L.dragId === v.id) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        li.classList.add('is-drop-target');
      });
      li.addEventListener('dragleave', (e) => { if (!li.contains(e.relatedTarget)) li.classList.remove('is-drop-target'); });
      li.addEventListener('drop', (e) => {
        if (!L.dragId || L.dragId === v.id) return;
        e.preventDefault();
        li.classList.remove('is-drop-target');
        const arr = S.data[key];
        moveTo(L, L.dragId, arr.findIndex((x) => x.id === v.id), null);
      });
      return li;
    }

    function moveBy(L, id, delta, btn) {
      const arr = S.data[L.key];
      const i = arr.findIndex((x) => x.id === id);
      if (i < 0) return;
      moveTo(L, id, Math.max(0, Math.min(arr.length - 1, i + delta)), btn ? btn.dataset.move : null);
    }

    function moveTo(L, id, to, focusMove) {
      const arr = S.data[L.key];
      const from = arr.findIndex((x) => x.id === id);
      if (from < 0 || to < 0 || from === to) return;
      const [item] = arr.splice(from, 1);
      arr.splice(to, 0, item);
      // riordino dei nodi esistenti (anteprime già caricate restano)
      arr.forEach((v, i) => {
        const li = L.cards.get(v.id);
        if (!li) return;
        L.grid.append(li);
        li.querySelector('.media-card__pos').textContent = String(i + 1);
        li.querySelector('[data-move="up"]').disabled = i === 0;
        li.querySelector('[data-move="down"]').disabled = i === arr.length - 1;
      });
      const li = L.cards.get(id);
      L.gridWrap.querySelectorAll('.is-moved').forEach((x) => x.classList.remove('is-moved'));
      li.classList.add('is-moved');
      window.setTimeout(() => li.classList.remove('is-moved'), 1300);
      if (focusMove) {
        let b = li.querySelector(`[data-move="${focusMove}"]`);
        if (b.disabled) b = li.querySelector(`[data-move="${focusMove === 'up' ? 'down' : 'up'}"]`);
        if (b && !b.disabled) b.focus();
      }
      announce(L.live, `Spostata in posizione ${to + 1} di ${arr.length}.`);
      clearTimeout(L.saveTimer);
      L.saveTimer = window.setTimeout(() => saveOrder(L), 600);
    }

    async function saveOrder(L) {
      const ids = S.data[L.key].map((v) => v.id);
      try {
        await api(`contenuti/ordine/${SEZ[L.key].api}`, { method: 'PUT', body: { ids } });
        S.data[L.key].forEach((v, i) => { v.ordine = (i + 1) * 10; });
        changed();
      } catch (err) {
        toast(`Nuovo ordine non salvato: ${cmsError(err)}`, 'error');
        if (L.body.isConnected) viewList(L.key, L.body, () => L.body.isConnected);
      }
    }

    // ------------------------------------------------------------ caricamento in galleria
    function galleryUploader(L) {
      const catSel = h('select', { name: 'categoria_nuovi' }, Object.entries(CATEGORIE).map(([v, l]) => h('option', { value: v }, l)));
      catSel.value = 'feste';
      const uploads = h('ul', { class: 'uploads', 'aria-label': 'File in caricamento' });
      const dz = dropzone({
        multiple: true,
        accept: [...IMG_TYPES, VIDEO_TYPE].join(','),
        title: 'Trascinate qui foto o video,',
        hint: 'JPEG, PNG, WebP fino a 10 MB (ridotte automaticamente) · MP4 fino a 200 MB',
        onFiles: (files) => queueFiles(files),
      });
      let running = Promise.resolve();
      const queueFiles = (files) => {
        dz.error(false);
        for (const f of files) {
          const item = uploadItem(f.name || 'file');
          uploads.append(item.li);
          running = running.then(() => uploadGalleryFile(f, item, catSel.value, L)).catch(() => {});
        }
      };
      return h('section', { class: 'panel', 'aria-label': 'Carica foto e video' },
        h('div', { class: 'panel__head' }, h('h2', null, 'Carica foto e video')),
        h('div', { class: 'fields' }, field('Categoria dei nuovi file', catSel, { hint: 'Potete cambiarla dopo con "Modifica".' })),
        dz.el, uploads);
    }

    async function uploadGalleryFile(file, item, categoria, L) {
      try {
        const bad = precheck(file, { video: true });
        if (bad) throw new UploadError(bad);
        const isVideo = mimeOf(file) === VIDEO_TYPE;
        let filePath;
        let posterPath = null;
        let formato = 'wide';
        if (isVideo) {
          item.step('Lettura del video…');
          const info = await videoInfo(file);
          if (info.width && info.height) formato = info.height > info.width ? 'reel' : 'wide';
          item.progress(0);
          filePath = await uploadBlob(file, file.name, VIDEO_TYPE, 'galleria', (f) => item.progress(f));
          if (info.poster) {
            item.step('Caricamento della copertina…');
            try { posterPath = await uploadBlob(info.poster.blob, `${baseName(file.name)}-copertina`, info.poster.mime, 'galleria', null); } catch (e) { posterPath = null; }
          }
        } else {
          const img = await uploadImage(file, 'galleria', item);
          filePath = img.path;
          formato = img.width > img.height * 1.2 ? 'wide' : 'tall';
        }
        item.step('Creazione della bozza…');
        const arr = S.data.galleria || [];
        const ordine = Math.min(100000, arr.reduce((m, v) => Math.max(m, Number(v.ordine) || 0), 0) + 10);
        const body = {
          file_path: filePath, tipo: isVideo ? 'video' : 'foto', categoria, formato,
          alt_it: niceName(file.name) || (isVideo ? 'Video' : 'Foto'), pubblicato: false, ordine,
        };
        if (posterPath) body.poster_path = posterPath;
        let r;
        try { r = await api('contenuti/galleria', { method: 'POST', body }); } catch (err) { throw new UploadError(`File caricato, ma la voce non è stata creata: ${cmsError(err)}`); }
        if (r.voce) arr.push(r.voce);
        S.data.galleria = arr;
        changed();
        item.done(isVideo && !posterPath ? 'Bozza creata · senza copertina (sceglietela con "Modifica")' : 'Bozza creata');
        if (L.body.isConnected) {
          drawGrid(L);
          announce(L.live, `${file.name}: caricato come bozza. Aggiungete una descrizione con "Modifica".`);
        }
      } catch (err) {
        item.fail(err instanceof UploadError ? err.message : cmsError(err));
      }
    }

    // ------------------------------------------------------------ editor di una voce
    function openEditor(key, voce, body, opener) {
      const conf = SEZ[key];
      const isNew = !voce;
      const v = voce || {};
      const objectUrls = [];
      clear(body);
      const err = alertBox();
      const headTitle = isNew ? conf.nuovo : key === 'galleria' ? (v.tipo === 'video' ? 'Modifica video' : 'Modifica foto') : `Modifica: ${v.nome || conf.one}`;
      const h2 = h('h2', { tabindex: '-1' }, headTitle);
      const fieldsBox = h('div', { class: 'item-editor__fields' });
      const preview = h('div', { class: 'item-editor__preview' });
      const hasPreview = key !== 'location';
      const editor = h('div', { class: `item-editor${hasPreview ? ' item-editor--media' : ''}` }, hasPreview ? preview : null, fieldsBox);
      const cancel = h('button', { class: 'btn', type: 'button' }, 'Annulla');
      const save = h('button', { class: 'btn btn--primary', type: 'submit' }, isNew ? 'Aggiungi' : 'Salva');
      const form = h('form', { novalidate: true }, err, editor, h('div', { class: 'panel__foot' }, cancel, save));
      body.append(h('section', { class: 'panel' }, h('div', { class: 'panel__head' }, h2), form));

      const setPreview = (path, { video = false, blob = null, label = '' } = {}) => {
        clear(preview);
        if (blob) {
          const u = URL.createObjectURL(blob);
          objectUrls.push(u);
          preview.append(h('img', { alt: '', src: u }));
        } else if (path) {
          thumbMedia(preview, path, { video });
        }
        if (label) preview.append(h('span', { class: 'media-card__type' }, label));
      };
      const leave = (focusId) => {
        objectUrls.forEach((u) => URL.revokeObjectURL(u));
        const L2 = renderList(key, body, focusId);
        if (!focusId) { const b = body.querySelector('.panels > .field--full > .btn, .dropzone input'); if (b) b.focus(); }
        return L2;
      };
      cancel.addEventListener('click', () => leave(isNew ? null : v.id));
      form.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !e.target.closest('.confirm')) { e.preventDefault(); leave(isNew ? null : v.id); } });

      const inputs = {};
      const langs = {};
      let logoSw = null; // DJ: interruttore "l'immagine è un logo"
      const gridF = h('div', { class: 'fields' });
      let paths = {};
      let pending = 0; // caricamenti in corso

      if (key === 'galleria') {
        inputs.categoria = h('select', { name: 'categoria' }, Object.entries(CATEGORIE).map(([val, l]) => h('option', { value: val }, l)));
        inputs.categoria.value = v.categoria || 'feste';
        inputs.formato = h('select', { name: 'formato' }, Object.entries(FORMATI).map(([val, l]) => h('option', { value: val }, l)));
        inputs.formato.value = v.formato || 'wide';
        add(gridF, [field('Categoria', inputs.categoria), field('Formato nella galleria', inputs.formato, { hint: 'Largo occupa due colonne; Reel è per i video verticali.' })]);
        fieldsBox.append(gridF);
        langs.alt = langField({
          legend: v.tipo === 'video' ? 'Descrizione del video' : 'Descrizione della foto', prefix: 'alt', values: langVals(v, 'alt'), max: 300,
          required: ['it'], multiline: true, noBreaks: true, hint: 'Descrivete cosa si vede (serve a chi non vede le immagini e a Google). Senza "a capo".',
        });
        fieldsBox.append(langs.alt.el);
        if (v.tipo === 'video') {
          paths.poster_path = v.poster_path || null;
          setPreview(v.poster_path || v.file_path, { video: !v.poster_path, label: 'Video' });
          fieldsBox.append(imageSlot({
            label: 'Copertina del video', cartella: 'galleria', current: () => paths.poster_path,
            help: 'Immagine mostrata prima che il video parta. Se manca, il sito mostra il primo fotogramma.',
            onSet: (p, blob) => { paths.poster_path = p; if (p) setPreview(null, { blob, label: 'Copertina' }); else setPreview(v.file_path, { video: true, label: 'Video' }); },
            removeLabel: 'Rimuovi la copertina',
          }));
        } else setPreview(v.file_path, { label: 'Foto' });
      } else if (key === 'location') {
        inputs.nome = h('input', { name: 'nome', type: 'text', maxlength: '160', value: v.nome || '', required: true, autocomplete: 'off' });
        inputs.luogo = h('input', { name: 'luogo', type: 'text', maxlength: '160', value: v.luogo || '', autocomplete: 'off' });
        inputs.paese = h('select', { name: 'paese' }, Object.entries(PAESI).map(([val, l]) => h('option', { value: val }, l)));
        inputs.paese.value = v.paese || 'CH';
        add(gridF, [field('Nome della location (obbligatorio)', inputs.nome), field('Luogo', inputs.luogo, { hint: 'Città o regione, es. Lugano.' }), field('Paese', inputs.paese)]);
        fieldsBox.append(gridF);
        langs.tipo = langField({ legend: 'Tipo di location', prefix: 'tipo', values: langVals(v, 'tipo'), max: 120, required: [], hint: 'Es. Hotel, Villa, Sala congressi.' });
        fieldsBox.append(langs.tipo.el);
      } else {
        const isDj = key === 'dj';
        inputs.nome = h('input', { name: 'nome', type: 'text', maxlength: '120', value: v.nome || '', required: true, autocomplete: 'off' });
        inputs.link = h('input', { name: 'link', type: 'url', maxlength: '500', value: v.link || '', placeholder: 'https://…', autocomplete: 'off', inputmode: 'url' });
        add(gridF, [field(isDj ? 'Nome del DJ (obbligatorio)' : 'Nome del partner (obbligatorio)', inputs.nome),
          field(isDj ? 'Link (SoundCloud, Instagram, sito…)' : 'Sito del partner', inputs.link, { hint: 'Facoltativo. Solo indirizzi che iniziano con https://' })]);
        fieldsBox.append(gridF);
        if (isDj) {
          langs.genere = langField({ legend: 'Genere musicale', prefix: 'genere', values: langVals(v, 'genere'), max: 120, required: [], hint: 'Es. House, Commerciale, Anni 80.' });
          fieldsBox.append(langs.genere.el);
          // logo (centrato, sfondo trasparente) o foto (ritagliata): predefinito logo, come sul sito
          logoSw = switchEl(v.foto_e_logo !== false, "L'immagine è un logo (non una foto)");
          fieldsBox.append(h('div', { class: 'field' }, logoSw.el,
            h('p', { class: 'field__hint' }, 'Acceso: il logo è mostrato intero al centro del riquadro. Spento: la foto riempie il riquadro.')));
        } else {
          langs.ruolo = langField({ legend: 'Ruolo (facoltativo)', prefix: 'ruolo', values: langVals(v, 'ruolo'), max: 60, required: [], hint: 'Scritto sotto il logo, es. Video team.' });
          fieldsBox.append(langs.ruolo.el);
        }
        const pk = isDj ? 'foto_path' : 'logo_path';
        paths[pk] = v[pk] || null;
        setPreview(paths[pk], { label: paths[pk] ? '' : (isDj ? 'Senza foto' : 'Senza logo') });
        fieldsBox.append(imageSlot({
          label: isDj ? 'Logo o foto del DJ' : 'Logo del partner', cartella: key, current: () => paths[pk], keepAlpha: true,
          help: isDj ? 'Logo PNG o WebP con sfondo trasparente, oppure una foto verticale. Senza immagine il sito mostra le iniziali.' : 'Meglio un logo PNG o WebP con sfondo trasparente.',
          onSet: (p, blob) => { paths[pk] = p; if (p) setPreview(null, { blob }); else setPreview(null, { label: isDj ? 'Senza foto' : 'Senza logo' }); },
          removeLabel: isDj ? 'Rimuovi la foto' : 'Rimuovi il logo',
        }));
      }
      const sw = switchEl(isNew ? false : v.pubblicato, 'Pubblicato sul sito');
      fieldsBox.append(h('div', { class: 'field' }, sw.el,
        h('p', { class: 'field__hint' }, 'Le voci in bozza non compaiono sul sito. In ogni caso il sito cambia solo dopo "Pubblica sul sito".')));

      function imageSlot({ label, cartella, current, onSet, help, removeLabel, keepAlpha = false }) {
        const uploads = h('ul', { class: 'uploads' });
        const remove = h('button', { class: 'btn btn--sm btn--ghost', type: 'button', hidden: !current() }, removeLabel);
        const dz = dropzone({
          multiple: false,
          accept: IMG_TYPES.join(','),
          title: `${label}: trascinatela qui`,
          hint: `${help} JPEG, PNG o WebP (ridotta automaticamente).`,
          onFiles: async ([file]) => {
            clear(uploads);
            const item = uploadItem(file.name || 'immagine');
            uploads.append(item.li);
            dz.disable(true);
            pending += 1;
            save.disabled = true;
            try {
              const r = await uploadImage(file, cartella, item, { keepAlpha });
              item.done('Caricata · ricordate di salvare');
              onSet(r.path, r.blob);
              remove.hidden = false;
            } catch (e) {
              item.fail(e instanceof UploadError ? e.message : cmsError(e));
              dz.error(true);
            } finally {
              pending -= 1;
              save.disabled = pending > 0;
              dz.disable(false);
            }
          },
        });
        remove.addEventListener('click', () => { onSet(null, null); remove.hidden = true; clear(uploads); dz.input.focus(); });
        return h('div', { class: 'field' }, h('span', { class: 'field__label' }, label), dz.el, uploads, h('p', null, remove));
      }

      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        showAlert(err, '');
        form.querySelectorAll('[aria-invalid="true"]').forEach((x) => x.removeAttribute('aria-invalid'));
        if (pending > 0) { showAlert(err, 'Attendete la fine del caricamento dell\'immagine.'); return; }
        const data = {};
        // validazione nel browser (il server ricontrolla tutto)
        if (inputs.nome) {
          data.nome = oneLine(inputs.nome.value);
          if (!data.nome) { inputs.nome.setAttribute('aria-invalid', 'true'); inputs.nome.focus(); showAlert(err, 'Il nome è obbligatorio.'); return; }
        }
        if (inputs.link) {
          const link = inputs.link.value.trim();
          if (!validLink(link)) {
            inputs.link.setAttribute('aria-invalid', 'true'); inputs.link.focus();
            showAlert(err, 'Il link non è valido: deve iniziare con https:// (per esempio https://www.instagram.com/nome) e non contenere spazi.');
            return;
          }
          data.link = link || null;
        }
        for (const [prefix, lf] of Object.entries(langs)) {
          if (!lf.validate()) { showAlert(err, 'Manca la descrizione in italiano (obbligatoria).'); return; }
          const vals = lf.values();
          for (const l of LANGS) data[`${prefix}_${l}`] = vals[l] || null;
        }
        if (inputs.luogo) data.luogo = oneLine(inputs.luogo.value) || null;
        if (inputs.paese) data.paese = inputs.paese.value;
        if (inputs.categoria) data.categoria = inputs.categoria.value;
        if (inputs.formato) data.formato = inputs.formato.value;
        for (const [k, p] of Object.entries(paths)) data[k] = p || null;
        if (logoSw) data.foto_e_logo = logoSw.input.checked;
        data.pubblicato = sw.input.checked;
        if (isNew) {
          const arr = S.data[key] || [];
          data.ordine = Math.min(100000, arr.reduce((m, x) => Math.max(m, Number(x.ordine) || 0), 0) + 10);
        }
        await busy(save, async () => {
          try {
            const r = isNew
              ? await api(`contenuti/${conf.api}`, { method: 'POST', body: data })
              : await api(`contenuti/${conf.api}/${encodeURIComponent(v.id)}`, { method: 'PATCH', body: data });
            const saved = r.voce;
            const arr = S.data[key] || (S.data[key] = []);
            if (saved) {
              const i = arr.findIndex((x) => x.id === saved.id);
              if (i >= 0) arr[i] = saved; else arr.push(saved);
            }
            changed();
            // conferma nella regione di stato (un toast coprirebbe la barra "Pubblica sul sito")
            const L2 = leave(saved ? saved.id : null);
            announce(L2.live, isNew ? 'Aggiunto. Sarà sul sito dopo "Pubblica sul sito".' : 'Modifiche salvate. Saranno sul sito dopo "Pubblica sul sito".');
          } catch (e2) {
            showAlert(err, cmsError(e2));
            if (e2 instanceof ApiError && e2.field) {
              const lf = Object.values(langs).find((x) => x.hasName(e2.field));
              if (lf) lf.invalid(lf.langOf(e2.field));
              else {
                const inp = form.querySelector(`[name="${CSS.escape(e2.field)}"]`);
                if (inp) { inp.setAttribute('aria-invalid', 'true'); inp.focus(); }
              }
            } else err.scrollIntoView({ block: 'nearest' });
          }
        });
      });
      h2.focus();
    }

    // ------------------------------------------------------------ testi del sito
    function groupOf(key) {
      const first = key.split('.')[0];
      return GRUPPI[first] || first;
    }
    function nameOf(key) {
      const parts = key.split('.');
      const out = [];
      for (let i = 1; i < parts.length; i++) {
        const p = parts[i];
        const m = /^([esp])(\d)$/.exec(p);
        if (m && NUMERATI[m[1]]) { out.push(`${NUMERATI[m[1]]} ${m[2]}`); continue; }
        if (parts[0] === 'regions' && parts[i - 1] === 'countries') { out.push(`Nome del paese (${p.toUpperCase()})`); continue; }
        if (parts[0] === 'work' && parts[i - 1] === 'filters' && CATEGORIE[p]) { out.push(`Filtro "${CATEGORIE[p]}"`); continue; }
        if (p === 'countries' || p === 'filters') continue;
        if (parts[0] === 'regions' && p === 'main') { out.push('Area principale'); continue; }
        out.push(PARTI[p] || p);
      }
      // s1.t → "Servizio 1 · Titolo"
      const m0 = /^s(\d)$/.exec(parts[0]);
      if (m0) out.unshift(`Servizio ${m0[1]}`);
      if (parts[0] === 'meta' && parts[1] === 'title') return 'Titolo della pagina (scheda del browser e Google)';
      if (parts[0] === 'meta' && parts[1] === 'description') return 'Descrizione per Google';
      return out.length ? out.join(' · ') : key;
    }

    async function viewTesti(body, alive) {
      clear(body);
      body.append(h('p', { class: 'muted', role: 'status' }, 'Caricamento…'));
      let r;
      let def = S.predefiniti;
      try {
        const reqs = [api('testi')];
        if (!def) {
          reqs.push(fetch('/area-riservata/testi-predefiniti.json', { credentials: 'same-origin', headers: { 'X-Requested-With': 'meekon' } })
            .then((res) => (res.ok ? res.json() : null)).catch(() => null));
        }
        const out = await Promise.all(reqs);
        r = out[0];
        if (!def) def = out[1] && typeof out[1] === 'object' && out[1].testi && typeof out[1].testi === 'object' ? out[1] : null;
      } catch (err) {
        if (alive()) loadError(body, err, () => viewTesti(body, alive));
        return;
      }
      if (!alive()) return;
      S.predefiniti = def;
      S.testi = new Map((Array.isArray(r.testi) ? r.testi : []).filter((x) => x && typeof x.chiave === 'string').map((x) => [x.chiave, x]));
      S.chiavi = (Array.isArray(r.chiavi) ? r.chiavi : []).filter((k) => typeof k === 'string');
      noteTimes(r.testi);
      renderBar();
      renderTesti(body);
    }

    function defaultsOf(key) {
      const d = S.predefiniti && S.predefiniti.testi && S.predefiniti.testi[key];
      return d && typeof d === 'object' ? d : null;
    }
    const emKeys = () => new Set((S.predefiniti && Array.isArray(S.predefiniti.con_em) && S.predefiniti.con_em) || []);
    function overrideOf(key) {
      const o = S.testi.get(key);
      if (!o) return null;
      return LANGS.some((l) => typeof o[l] === 'string' && o[l].trim()) ? o : null;
    }

    function renderTesti(body) {
      clear(body);
      const live = srStatus();
      const search = h('input', { type: 'search', id: nextId('q'), placeholder: 'Parola del testo o nome…', autocomplete: 'off' });
      const count = h('span', { class: 'toolbar__count', role: 'status' });
      const toolbar = h('form', { class: 'toolbar', role: 'search', 'aria-label': 'Cerca nei testi', onsubmit: (e) => e.preventDefault() },
        h('div', { class: 'field field--search' }, h('label', { for: search.id }, 'Cerca un testo'), search), count);
      const list = h('div');
      if (!S.predefiniti) body.append(h('p', { class: 'alert alert--error', role: 'alert' }, 'I testi predefiniti non sono disponibili: potete comunque modificare i testi, ma non vedrete il testo originale.'));
      body.append(h('h2', { class: 'sr-only' }, 'Testi del sito'),
        h('p', { class: 'muted' }, 'Ogni testo ha un valore predefinito. Se lo modificate, il nuovo testo sostituisce quello predefinito nella lingua scelta; "Ripristina" torna al testo originale.'),
        toolbar, live, list);

      const groups = new Map();
      for (const k of S.chiavi) {
        const g = groupOf(k);
        if (!groups.has(g)) groups.set(g, []);
        groups.get(g).push(k);
      }
      const order = [...groups.keys()].sort((a, b) => {
        const ia = ORDINE_GRUPPI.indexOf(a);
        const ib = ORDINE_GRUPPI.indexOf(b);
        return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib) || a.localeCompare(b);
      });
      const T = { live, rows: new Map(), groups: [], openKey: null };
      order.forEach((g, gi) => {
        const keys = groups.get(g);
        const gcount = h('span', { class: 'text-group__count' });
        const ul = h('ul', { class: 'text-group__list' });
        const det = h('details', { class: 'text-group' }, h('summary', null, `${g} `, gcount), ul);
        if (gi === 0) det.open = true;
        const grp = { det, ul, gcount, keys };
        T.groups.push(grp);
        keys.forEach((k) => { const li = textRow(T, k, grp); T.rows.set(k, li); ul.append(li); });
        updateGroupCount(grp);
        list.append(det);
      });
      if (!S.chiavi.length) list.append(h('div', { class: 'empty' }, h('strong', null, 'Nessun testo modificabile'), h('p', null, 'Il server non ha restituito nessun testo.')));

      const filter = () => {
        const q = search.value.trim().toLowerCase();
        let n = 0;
        for (const grp of T.groups) {
          let visible = 0;
          for (const k of grp.keys) {
            const li = T.rows.get(k);
            const d = defaultsOf(k) || {};
            const o = S.testi.get(k) || {};
            const hay = [k, nameOf(k), ...LANGS.map((l) => d[l] || ''), ...LANGS.map((l) => o[l] || '')].join(' ').toLowerCase();
            const show = !q || hay.includes(q);
            li.hidden = !show;
            if (show) visible += 1;
          }
          grp.det.hidden = visible === 0;
          if (q && visible) grp.det.open = true;
          n += visible;
        }
        count.textContent = q ? `${n} ${n === 1 ? 'testo trovato' : 'testi trovati'}` : `${S.chiavi.length} testi`;
      };
      search.addEventListener('input', filter);
      filter();
    }

    function updateGroupCount(grp) {
      const mod = grp.keys.filter((k) => overrideOf(k)).length;
      grp.gcount.textContent = `${grp.keys.length} ${grp.keys.length === 1 ? 'testo' : 'testi'}${mod ? ` · ${mod} ${mod === 1 ? 'modificato' : 'modificati'}` : ''}`;
    }

    function textRow(T, key, grp) {
      const o = overrideOf(key);
      const d = defaultsOf(key);
      const li = h('li', { class: `text-row${o ? ' is-overridden' : ''}`, 'data-key': key });
      const shown = (o && o.it) || (d && d.it) || '';
      const modLangs = o ? LANGS.filter((l) => typeof o[l] === 'string' && o[l].trim()) : [];
      const edit = h('button', { class: 'btn btn--sm', type: 'button', 'aria-expanded': 'false' }, 'Modifica', h('span', { class: 'sr-only' }, `: ${nameOf(key)}`));
      const reset = h('button', { class: 'btn btn--sm btn--ghost text-row__reset', type: 'button' }, 'Ripristina', h('span', { class: 'sr-only' }, `: ${nameOf(key)}`));
      li.append(
        h('div', { class: 'text-row__label' }, h('span', { class: 'text-row__name' }, nameOf(key)), h('span', { class: 'text-row__key' }, key)),
        h('div', { class: 'text-row__value' },
          h('p', { class: 'text-row__text' }, shown || (d ? '(vuoto)' : 'Testo predefinito non disponibile')),
          h('div', { class: 'text-row__state' }, h('span', { class: 'badge badge--modificato' }, 'Modificato'),
            modLangs.length ? h('ul', { class: 'lang-status', 'aria-label': 'Lingue modificate' }, modLangs.map((l) => h('li', null, l.toUpperCase()))) : null)),
        h('div', { class: 'text-row__actions' }, edit, reset));

      edit.addEventListener('click', () => {
        if (li.classList.contains('is-open')) { closeRow(T, key, true); return; }
        if (T.openKey && T.openKey !== key) closeRow(T, T.openKey, false);
        openRow(T, key, grp, edit);
      });
      reset.addEventListener('click', () => {
        if (li.querySelector('.confirm')) return;
        const wrap = h('div', { class: 'text-row__editor' });
        li.append(wrap);
        const box = confirmBox({
          question: 'Ripristinare il testo predefinito?',
          text: 'Le modifiche a questo testo in tutte e quattro le lingue verranno eliminate.',
          action: 'Ripristina',
          opener: reset,
          mount: (b) => wrap.append(b),
          onConfirm: async () => {
            await api(`testi/${encodeURIComponent(key)}`, { method: 'PUT', body: { it: '', de: '', fr: '', en: '' } });
            S.testi.delete(key);
            changed();
            const fresh = replaceRow(T, key, grp);
            announce(T.live, `${nameOf(key)}: ripristinato il testo predefinito.`);
            const b = fresh.querySelector('.text-row__actions .btn');
            if (b) b.focus();
          },
        });
        const obs = new MutationObserver(() => { if (!box.isConnected) { wrap.remove(); obs.disconnect(); } });
        obs.observe(wrap, { childList: true });
      });
      return li;
    }

    function replaceRow(T, key, grp) {
      const old = T.rows.get(key);
      const fresh = textRow(T, key, grp);
      fresh.hidden = old.hidden;
      old.replaceWith(fresh);
      T.rows.set(key, fresh);
      if (T.openKey === key) T.openKey = null;
      updateGroupCount(grp);
      return fresh;
    }

    function closeRow(T, key, refocus) {
      const li = T.rows.get(key);
      if (!li) return;
      const ed = li.querySelector('.text-row__editor[data-editor]');
      if (ed) ed.remove();
      li.classList.remove('is-open');
      const btn = li.querySelector('.text-row__actions .btn');
      if (btn) { btn.setAttribute('aria-expanded', 'false'); if (refocus) btn.focus(); }
      if (T.openKey === key) T.openKey = null;
    }

    function openRow(T, key, grp, opener) {
      const li = T.rows.get(key);
      const d = defaultsOf(key) || {};
      const o = S.testi.get(key) || {};
      const allowEm = emKeys().has(key);
      const defLine = h('p', { class: 'text-row__default' });
      const showDefault = (l) => {
        clear(defLine);
        if (d[l]) add(defLine, [`Testo predefinito (${l.toUpperCase()}): `, h('q', null, d[l])]);
        else defLine.textContent = `Testo predefinito (${l.toUpperCase()}): non disponibile.`;
      };
      const lf = langField({
        legend: nameOf(key), prefix: '', values: o, max: TEXT_MAX, multiline: true, required: [],
        defaults: d, fallback: 'Vuoto: si userà il testo predefinito.', onTab: showDefault,
        hint: allowEm ? 'Per evidenziare una parola scrivete <em>parola</em>. Altri codici HTML vengono mostrati come testo.' : 'Solo testo: eventuali codici HTML vengono mostrati come testo.',
      });
      const err = alertBox();
      const cancel = h('button', { class: 'btn', type: 'button' }, 'Annulla');
      const save = h('button', { class: 'btn btn--primary', type: 'button' }, 'Salva');
      const ed = h('div', { class: 'text-row__editor', 'data-editor': '' }, err, lf.el, defLine, h('div', { class: 'text-row__editor-foot' }, cancel, save));
      li.append(ed);
      li.classList.add('is-open');
      opener.setAttribute('aria-expanded', 'true');
      T.openKey = key;
      showDefault(lf.current());
      cancel.addEventListener('click', () => closeRow(T, key, true));
      ed.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !e.target.closest('.confirm')) { e.preventDefault(); closeRow(T, key, true); } });
      save.addEventListener('click', () => busy(save, async () => {
        showAlert(err, '');
        const vals = lf.values();
        for (const l of LANGS) {
          if (vals[l] === (d[l] || '').trim()) vals[l] = ''; // uguale al predefinito: non serve sovrascrivere
          if (vals[l].length > TEXT_MAX) { lf.invalid(l); showAlert(err, `Il testo in ${LANG_NAMES[l]} è troppo lungo (massimo ${TEXT_MAX} caratteri).`); return; }
        }
        try {
          const r = await api(`testi/${encodeURIComponent(key)}`, { method: 'PUT', body: vals });
          if (r && r.testo) S.testi.set(key, r.testo); else S.testi.delete(key);
          changed();
          const fresh = replaceRow(T, key, grp);
          announce(T.live, `${nameOf(key)}: salvato. Sarà sul sito dopo "Pubblica sul sito".`);
          const b = fresh.querySelector('.text-row__actions .btn');
          if (b) b.focus();
        } catch (e) {
          showAlert(err, cmsError(e));
          if (e instanceof ApiError && e.field && LANGS.includes(e.field)) lf.invalid(e.field);
        }
      }));
      lf.focus();
    }

    // i file trascinati fuori dalla zona di caricamento non devono far aprire il file nel browser
    const isFileDrag = (e) => e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');
    document.addEventListener('dragover', (e) => { if (isFileDrag(e) && !e.target.closest('.dropzone')) { e.preventDefault(); e.dataTransfer.dropEffect = 'none'; } });
    document.addEventListener('drop', (e) => { if (isFileDrag(e) && !e.target.closest('.dropzone')) e.preventDefault(); });

    return { view };
  }

  window.MeekonContenuti = Object.freeze({ create });
})();
