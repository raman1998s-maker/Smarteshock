# Meekon Displays — sito web

Nuovo sito di [meekondisplay.ch](https://meekondisplay.ch): noleggio di ledwall, audio, luci ed effetti speciali per eventi.

È un sito statico (HTML + CSS + JS), senza build: si pubblica così com'è su qualsiasi hosting (Netlify, GitHub Pages, hosting classico).

## Struttura

```
index.html          Pagina principale (hero video, servizi, eventi, come lavoriamo, FAQ, preventivo)
grazie.html         Pagina di conferma dopo l'invio del modulo
assets/css/style.css
assets/js/main.js   Menu mobile, animazioni allo scroll, video della galleria
assets/img/         Logo, icone, foto degli eventi, immagine di anteprima social
assets/video/       Video compressi per il web (hero.mp4, reel.mp4)
```

## Vedere il sito in locale

```bash
python3 -m http.server 8000
# poi apri http://localhost:8000
```

## Da completare prima della pubblicazione

- [ ] **Contatti reali** in `index.html` (sezione `#preventivo`): telefono, numero WhatsApp, e-mail. Ora ci sono valori segnaposto.
- [ ] **Modulo preventivo**: è predisposto per **Netlify Forms** (`data-netlify="true"`). Se il sito non va su Netlify, sostituire l'`action` del form con un servizio come Formspree, oppure con un `mailto:`.
- [ ] Indirizzo / zona servita, eventuali link social (Instagram, Facebook, TikTok).
- [ ] Altre foto o video degli eventi, se disponibili (sostituire o aggiungere file in `assets/img/`).
