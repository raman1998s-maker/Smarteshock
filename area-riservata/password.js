// Area riservata — scelta della password dal link di invito (o di recupero).
// Il link di Supabase porta qui con #access_token=…&type=invite: il token si legge una volta,
// si toglie subito dall'indirizzo (non resta nella cronologia) e va solo a /api/auth/password.
(() => {
  'use strict';
  const HEADERS = { 'X-Requested-With': 'meekon', 'Content-Type': 'application/json' };
  const form = document.getElementById('pw-form');
  const pw1 = document.getElementById('pw1');
  const pw2 = document.getElementById('pw2');
  const errorBox = document.getElementById('pw-error');
  const okBox = document.getElementById('pw-ok');
  const login = document.getElementById('pw-login');
  const submit = form.querySelector('button[type="submit"]');

  // link nuovi: ?th=<token hash>&t=invite|recovery (il token si consuma solo al salvataggio)
  // link vecchi: #access_token=… (già verificato da Supabase all'apertura)
  const query = new URLSearchParams(window.location.search);
  const frammento = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const tokenHash = query.get('th');
  const tipo = query.get('t') === 'recovery' ? 'recovery' : 'invite';
  const token = frammento.get('access_token');
  const erroreLink = frammento.get('error_description') || frammento.get('error');
  history.replaceState(null, '', window.location.pathname);

  const showError = (msg, field) => {
    errorBox.textContent = msg;
    errorBox.hidden = false;
    if (field) { field.setAttribute('aria-invalid', 'true'); field.focus(); }
  };
  const linkNonValido = () => {
    showError("Il link non è valido o è scaduto. Chiedete all'amministratore un nuovo invito.");
    form.hidden = true;
    login.hidden = false;
  };
  if ((!token && !tokenHash) || erroreLink) { linkNonValido(); return; }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorBox.hidden = true;
    [pw1, pw2].forEach((el) => el.removeAttribute('aria-invalid'));
    if (pw1.value.length < 10) return showError('La password deve avere almeno 10 caratteri.', pw1);
    if (pw1.value !== pw2.value) return showError('Le due password non sono uguali.', pw2);
    submit.disabled = true;
    try {
      const res = await fetch('/api/auth/password', {
        method: 'POST', credentials: 'same-origin', headers: HEADERS,
        body: JSON.stringify(tokenHash ? { token_hash: tokenHash, type: tipo, password: pw1.value } : { access_token: token, password: pw1.value }),
      });
      if (res.ok) {
        pw1.value = ''; pw2.value = '';
        form.hidden = true; okBox.hidden = false; login.hidden = false; login.focus();
        return;
      }
      if (res.status === 401) return linkNonValido();
      if (res.status === 400) return showError('Password non accettata: sceglietene una più lunga o meno semplice.', pw1);
      if (res.status === 429) return showError('Troppi tentativi. Attendete qualche minuto e riprovate.');
      showError('Non è stato possibile salvare la password. Riprovate tra qualche istante.');
    } catch {
      showError('Connessione non riuscita. Controllate la connessione a internet e riprovate.');
    } finally {
      submit.disabled = false;
    }
  });
})();
