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

  // Language: remember choice, suggest the visitor's browser language (no forced redirect)
  const store = {
    get: (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} },
  };
  document.querySelectorAll('.lang a').forEach((a) => {
    a.addEventListener('click', () => store.set('meekon-lang', a.getAttribute('hreflang')));
  });

  const hints = window.MEEKON_LANGHINTS || {};
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
