(() => {
  document.documentElement.classList.remove('no-js');
  const nav = document.querySelector('.nav');
  const toggle = document.querySelector('.nav__toggle');
  const menu = document.getElementById('menu');

  // Sticky nav background
  const onScroll = () => nav.classList.toggle('is-scrolled', window.scrollY > 20);
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });

  // Mobile menu
  const setMenu = (open) => {
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? toggle.dataset.close : toggle.dataset.open);
    menu.classList.toggle('is-open', open);
    nav.classList.toggle('menu-open', open);
  };
  toggle.addEventListener('click', () => setMenu(toggle.getAttribute('aria-expanded') !== 'true'));
  menu.addEventListener('click', (e) => { if (e.target.closest('a')) setMenu(false); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setMenu(false); });

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Reveal on scroll
  const items = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window && !reduceMotion) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          io.unobserve(entry.target);
        }
      });
    }, { rootMargin: '0px 0px -8% 0px' });
    items.forEach((el) => io.observe(el));
  } else {
    items.forEach((el) => el.classList.add('is-visible'));
  }

  // Play gallery videos only while visible
  const vids = document.querySelectorAll('video[data-autoplay]');
  if ('IntersectionObserver' in window && !reduceMotion) {
    const vio = new IntersectionObserver((entries) => {
      entries.forEach(({ target, isIntersecting }) => {
        if (isIntersecting) target.play().catch(() => {});
        else target.pause();
      });
    }, { threshold: 0.25 });
    vids.forEach((v) => vio.observe(v));
  }

  const hero = document.querySelector('.hero__video');
  if (hero && reduceMotion) { hero.removeAttribute('autoplay'); hero.pause(); }

  const year = document.getElementById('year');
  if (year) year.textContent = new Date().getFullYear();

  // Gallery filters (inserted only when JS is available; markup comes from build.py)
  const filtersTpl = document.getElementById('gallery-filters');
  const gallery = document.getElementById('gallery');
  if (filtersTpl && gallery && 'content' in filtersTpl) {
    gallery.parentNode.insertBefore(filtersTpl.content.cloneNode(true), gallery);
    const group = gallery.previousElementSibling;
    const figures = gallery.querySelectorAll('.gallery__item');
    group.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-filter]');
      if (!btn) return;
      const cat = btn.dataset.filter;
      group.querySelectorAll('button[data-filter]').forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
      figures.forEach((fig) => {
        const show = cat === 'all' || fig.dataset.cat === cat;
        fig.hidden = !show;
        if (show) fig.classList.add('is-visible');
        if (!show) { const v = fig.querySelector('video'); if (v) v.pause(); }
      });
    });
  }

  // Technical details block: without JS everything is visible and optional; with JS only the
  // groups of the chosen services (data-for) and the follow-up questions (data-if) are shown.
  // Hidden parts are disabled, so their values are not sent.
  const tech = document.getElementById('tech');
  if (tech && tech.form) {
    const techForm = tech.form;
    const show = (el, on) => {
      el.hidden = !on;
      if (el.tagName === 'FIELDSET') el.disabled = !on;
      else el.querySelectorAll('input, select, textarea').forEach((i) => { i.disabled = !on; });
    };
    const updateTech = () => {
      const chosen = new Set();
      techForm.querySelectorAll('input[name="servizi"][data-tech]:checked').forEach((c) => chosen.add(c.dataset.tech));
      let any = false;
      tech.querySelectorAll('[data-for]').forEach((g) => {
        const on = g.dataset.for.split(' ').some((x) => chosen.has(x));
        any = any || on;
        show(g, on);
      });
      tech.querySelectorAll('[data-if]').forEach((el) => {
        const [name, value] = el.dataset.if.split('=');
        const picked = [...techForm.querySelectorAll(`input[name="dt_${name}"]:checked`)];
        show(el, picked.some((p) => p.value === value));
      });
      show(tech, any);
    };
    techForm.addEventListener('change', updateTech);
    updateTech();
  }

  // Quote form: JSON to /api/richiesta; without JS the classic POST works too (303 -> grazie.html)
  const form = document.getElementById('preventivo');
  if (form && window.fetch && window.FormData) {
    const submit = form.querySelector('button[type="submit"]');
    const errorBox = form.querySelector('.form__error');
    const label = submit.textContent;
    let busy = false;
    const setBusy = (on) => {
      busy = on;
      submit.disabled = on;
      submit.setAttribute('aria-busy', String(on));
      submit.textContent = on ? form.dataset.sending : label;
    };
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (busy) return;
      errorBox.hidden = true;
      form.querySelectorAll('[aria-invalid="true"]').forEach((el) => el.removeAttribute('aria-invalid'));
      const body = {};
      new FormData(form).forEach((value, key) => {
        if (typeof value !== 'string') return;
        if (key === 'servizi' || key === 'dt_prese') (body[key] = body[key] || []).push(value);
        else body[key] = value;
      });
      setBusy(true);
      try {
        const res = await fetch(form.action, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'meekon' },
          body: JSON.stringify(body),
        });
        if (res.ok) {
          window.location.assign(form.dataset.thanks);
          return;
        }
        let field = null;
        try { field = (await res.json()).field || null; } catch (err) { field = null; }
        const input = field && /^[a-z_]+$/.test(field) ? form.querySelector(`[name="${field}"]`) : null;
        if (input && input.type !== 'hidden') {
          input.setAttribute('aria-invalid', 'true');
          input.focus();
        }
      } catch (err) {
        /* network error: message below */
      }
      setBusy(false);
      errorBox.hidden = false;
    });
  }

  // Language: remember choice, suggest the visitor's browser language (no forced redirect)
  const store = {
    get: (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} },
  };
  document.querySelectorAll('.lang a').forEach((a) => {
    a.addEventListener('click', () => store.set('meekon-lang', a.getAttribute('hreflang')));
  });

  let hints = {};
  const hintsEl = document.getElementById('langhints');
  if (hintsEl) { try { hints = JSON.parse(hintsEl.textContent) || {}; } catch (e) { hints = {}; } }
  const current = document.body.dataset.lang;
  const preferred = (navigator.languages || [navigator.language || ''])
    .map((l) => (l || '').slice(0, 2).toLowerCase())
    .find((l) => hints[l]);
  const chosen = store.get('meekon-lang');
  const box = document.querySelector('.langhint');
  if (box && preferred && preferred !== current && !chosen && hints[preferred]) {
    const h = hints[preferred];
    box.querySelector('p').textContent = h.text;
    const link = box.querySelector('a');
    link.textContent = h.link;
    link.href = h.href;
    link.lang = preferred;
    link.addEventListener('click', () => store.set('meekon-lang', preferred));
    box.querySelector('button').addEventListener('click', () => {
      store.set('meekon-lang', current);
      box.hidden = true;
    });
    setTimeout(() => { box.hidden = false; }, 1200);
  }
})();
