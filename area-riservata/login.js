// Area riservata — pagina di accesso. Parla solo con /api/* (stessa origine).
(() => {
  'use strict';
  const HEADERS = { 'X-Requested-With': 'meekon' };
  const APP = '/area-riservata/app.html';

  const form = document.getElementById('login-form');
  const email = document.getElementById('email');
  const password = document.getElementById('password');
  const errorBox = document.getElementById('login-error');
  const submit = form.querySelector('button[type="submit"]');
  const label = submit.textContent;

  const MESSAGES = {
    invalid_credentials: 'E-mail o password non corretti.',
    forbidden: "Questo account non ha accesso all'area riservata. Contattate l'amministratore.",
    too_many_requests: 'Troppi tentativi di accesso. Attendete qualche minuto e riprovate.',
    invalid_input: 'Inserite un indirizzo e-mail valido e la password.',
    network: 'Connessione non riuscita. Controllate la connessione a internet e riprovate.',
    generic: 'Accesso non riuscito per un problema temporaneo. Riprovate tra qualche istante.',
  };

  // Già connessi? Si va direttamente al gestionale.
  fetch('/api/me', { credentials: 'same-origin', headers: HEADERS })
    .then((res) => { if (res.ok) window.location.replace(APP); })
    .catch(() => {});

  const showError = (msg, field) => {
    errorBox.textContent = msg;
    errorBox.hidden = false;
    [email, password].forEach((el) => el.removeAttribute('aria-invalid'));
    if (field) { field.setAttribute('aria-invalid', 'true'); field.focus(); }
  };

  const setBusy = (on) => {
    submit.disabled = on;
    submit.setAttribute('aria-busy', String(on));
    submit.textContent = on ? 'Accesso in corso…' : label;
  };

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorBox.hidden = true;
    const mail = email.value.trim();
    if (!mail || !email.checkValidity()) return showError(MESSAGES.invalid_input, email);
    if (!password.value) return showError(MESSAGES.invalid_input, password);

    setBusy(true);
    let res;
    try {
      res = await fetch('/api/auth/login', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { ...HEADERS, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: mail, password: password.value }),
      });
    } catch (err) {
      setBusy(false);
      return showError(MESSAGES.network);
    }
    if (res.ok) {
      window.location.replace(APP);
      return;
    }
    let code = '';
    try { code = (await res.json()).error || ''; } catch (err) { code = ''; }
    setBusy(false);
    password.value = '';
    if (res.status === 401) return showError(MESSAGES.invalid_credentials, password);
    if (res.status === 403 && code === 'forbidden') return showError(MESSAGES.forbidden);
    if (res.status === 429) return showError(MESSAGES.too_many_requests);
    if (res.status === 400) return showError(MESSAGES.invalid_input, email);
    return showError(MESSAGES.generic);
  });
})();
