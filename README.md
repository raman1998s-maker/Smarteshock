# Meekon Displays — sito web

Nuovo sito di [meekondisplay.ch](https://meekondisplay.ch): installazioni tecniche per eventi (schermi LED, TV e beamer, luci e strutture, audio, impianti DJ, riprese live, streaming, effetti spark e fumo) per matrimoni, compleanni, feste tradizionali, aziende, WEF di Davos ed eventi da palco.

Il sito è statico, in **4 lingue**:

| Lingua | Indirizzo |
|---|---|
| Italiano (principale) | `/` |
| Deutsch | `/de/` |
| Français | `/fr/` |
| English | `/en/` |

Ogni pagina ha i tag `hreflang` per Google. Se il browser del visitatore è in un'altra lingua, compare in basso un piccolo avviso con il link alla sua lingua (senza reindirizzamenti forzati).

## Modificare i testi

I testi stanno **solo** in `src/i18n/it.json`, `de.json`, `fr.json`, `en.json`. La struttura della pagina è in `src/template.html`.
Dopo ogni modifica:

```bash
python3 build.py
```

Lo script rigenera `index.html`, `grazie.html` e le cartelle `de/`, `fr/`, `en/`. Anche le pagine generate vanno nel repository, così il sito si pubblica senza bisogno di compilarlo.

## Vedere il sito in locale

```bash
python3 -m http.server 8000
# poi apri http://localhost:8000
```

## Struttura

```
src/template.html        Struttura della pagina (con segnaposto {{...}})
src/i18n/*.json          Testi nelle 4 lingue
build.py                 Genera le pagine
index.html, grazie.html  Italiano (generati)
de/ fr/ en/              Altre lingue (generate)
assets/css/style.css     Stile
assets/js/main.js        Menu, animazioni, video, avviso lingua
assets/img/, assets/video/
```

## Da completare prima della pubblicazione

- [ ] **Contatti reali** in `src/template.html` (sezione `#contatti`): telefono, WhatsApp, e-mail. Ora ci sono valori segnaposto.
- [ ] **Modulo**: predisposto per **Netlify Forms** (riceve anche la lingua del visitatore). Su un altro hosting serve un servizio come Formspree.
- [ ] **Foto**: servono foto di eventi aziendali/WEF, spark, nebbia, truss e streaming. Ora la sezione Davos usa una foto di una festa.
- [ ] Link social (Instagram, Facebook, TikTok) e indirizzo della sede.
