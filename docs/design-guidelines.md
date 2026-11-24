# Linee guida di design — Meekon Displays

Documento di riferimento per chiunque tocchi l'aspetto del sito pubblico e dell'area riservata.
Owner: agente **design**. Implementazione: `assets/css/style.css` (sito pubblico) e `assets/css/admin.css` (area riservata).
Regola d'oro: **nessun colore, carattere, spaziatura o raggio fuori dai token** definiti in `:root`.

---

## 1. Essenza del brand e tono

**Meekon Displays porta la luce giusta nel momento giusto.** Tecnica impeccabile e invisibile, al servizio di emozioni: matrimoni, feste private e tradizionali, eventi aziendali, WEF di Davos.

- **Personalità:** sobria, precisa, calorosa, internazionale. Mai "da discoteca", mai "da catalogo tecnico".
- **Metafora visiva:** una sala buia un attimo prima che si accendano le luci. Fondo quasi nero, testo avorio come una luce calda, il ciano del logo come un singolo LED acceso.
- **Tono dei testi** (per chi scrive in `src/i18n/`): frasi brevi, concrete, al "voi"; niente superlativi urlati né punti esclamativi; nomi tecnici solo dove servono (ledwall, teste mobili, streaming).
- **Lusso = misura.** Molto spazio vuoto, pochi elementi per schermata, un solo accento colorato alla volta.

## 2. Logo

- File ufficiale: `assets/img/logo.png` (brand kit Canva "MeekonDisplay"). "M" ciano `#4DC0DE`, "D" antracite `#6A6969`, scritta *MEEKON DISPLAYS* in lettere a matrice di punti LED **bianche**.
- Poiché la scritta è bianca, **il logo va sempre su fondo scuro** (`--c-ink-0`…`--c-ink-2`). Nell'area riservata (tema chiaro) il logo sta nella barra laterale scura o nella fascia scura del login (`.login > img:first-child` / `.login__brand`).
- Altezze: nav 36 px, footer 48 px, login 40 px, barra laterale 34 px (26 px su mobile). Area di rispetto minima: metà dell'altezza della "M" su ogni lato.
- Mai ricolorare, deformare, aggiungere ombre o contorni.

## 3. Colori

I valori di contrasto qui sotto sono stati **calcolati con la formula WCAG 2.1** (luminanza relativa) tramite script; AA richiede 4.5:1 per il testo normale, 3:1 per testo grande (≥ 24 px, o ≥ 19 px in grassetto) e per bordi/indicatori di componenti.

### 3.1 Sito pubblico (tema scuro)

| Token | Hex | Ruolo |
|---|---|---|
| `--c-ink-0` | `#08090B` | Fondo pagina (`--color-bg`) |
| `--c-ink-1` | `#0E1013` | Fondo sezioni alternate (`--color-bg-alt`) |
| `--c-ink-2` | `#15181C` | Superfici: modulo, feature Davos, card (`--color-surface`) |
| `--c-ink-3` | `#1D2126` | Superfici in hover, segnaposto (`--color-surface-2`) |
| `--c-ivory` | `#F2ECE1` | Testo principale, bottone primario (`--color-text`) |
| `--c-ivory-2` | `#CDC6BA` | Testo secondario, lead, paragrafi lunghi (`--color-text-2`) |
| `--c-ivory-3` | `#A29B90` | Meta, etichette, didascalie (`--color-text-3`) |
| `--c-cyan` | `#4DC0DE` | Accento del logo (`--color-accent`, `--color-focus`) |
| `--c-anthracite` | `#6A6969` | Grigio del logo: bordo inferiore dei campi (`--color-field`), punti LED |
| `--color-line` | avorio 10 % | Filetti decorativi |
| `--color-line-2` | avorio 22 % | Bordi di chip, filtri, bottoni "line" |
| `--color-accent-soft` | ciano 12 % | Fondo di chip/filtri attivi |
| `--c-danger` | `#F0948A` | Errori nel modulo |
| `--c-success` | `#86D3A5` | Conferme nel modulo |

Contrasti misurati (testo su fondo):

| Testo | ink-0 | ink-1 | ink-2 | ink-3 |
|---|---|---|---|---|
| ivory `#F2ECE1` | 16.94 | 16.20 | 15.15 | 13.76 |
| ivory-2 `#CDC6BA` | 11.75 | 11.23 | 10.50 | 9.54 |
| ivory-3 `#A29B90` | 7.24 | 6.92 | 6.47 | 5.88 |
| cyan `#4DC0DE` | 9.40 | 8.99 | 8.40 | 7.64 |
| anthracite `#6A6969` | 3.64 | 3.48 | 3.25 | 2.96 |
| danger `#F0948A` | 8.83 | 8.44 | 7.89 | 7.17 |
| success `#86D3A5` | 11.26 | 10.77 | 10.07 | 9.15 |

- Bottone primario: ink-0 su avorio **16.94**; in hover ink-0 su ciano **9.40**.
- Lead del hero (`ivory-2`) sopra la sfumatura del video, caso peggiore stimato: **8.45**.

**Regole d'uso**
- Il ciano è un accento **raro**: eyebrow, parola in corsivo nei titoli (`<em>`), numeri degli eventi e dei passi, filetti attivi, focus. Mai fondi ciano estesi, mai paragrafi in ciano.
- L'antracite **non si usa per il testo** sul tema scuro (3.6:1 al massimo): solo bordi dei campi (≥ 3:1 su ink-0/1/2), punti LED, decorazioni. Sotto ink-3 non usarlo nemmeno come bordo.
- Gerarchia del testo: titoli `ivory`, testo corrente `ivory-2`, etichette e meta `ivory-3`.
- Nessun altro colore (niente oro, niente viola, niente verde WhatsApp): la vivacità la danno le foto.
- Trasparenze sui fondi scuri: sempre tramite `rgb(var(--c-ink-0-rgb) / α)` o `rgb(var(--c-ivory-rgb) / α)`.

### 3.2 Area riservata (tema chiaro "carta")

Scelta: **tema chiaro** per il contenuto (tabelle e moduli si leggono meglio per ore, anche stampati), con **barra laterale scura** del brand.

| Token | Hex | Ruolo | Contrasto |
|---|---|---|---|
| `--c-paper` | `#F6F4EF` | Fondo applicazione | — |
| `--c-white` | `#FFFFFF` | Pannelli, tabelle, campi | — |
| `--c-paper-2` | `#FAF8F4` | Intestazioni di tabella, piede pannelli, hover riga | — |
| `--c-ink-text` | `#16181B` | Testo principale | 17.79 su bianco · 16.18 su paper |
| `--c-ink-text-2` | `#45474A` | Testo secondario, etichette dei campi | 9.32 · 8.48 |
| `--c-anthracite` | `#6A6969` | Testo meta, intestazioni tabella | 5.47 · 4.98 |
| `--c-cyan-ink` | `#146A82` | Link, bottone primario, focus | 6.15 · 5.60; bianco su di esso 6.15 |
| `--c-red-ink` | `#A12C2C` | Errori, bottone elimina | 7.21 · 6.56 |
| `--c-green-ink` | `#1D6638` | Successo | 6.98 · 6.35 |
| `--c-stone-1` / `-2` | `#E3DFD6` / `#CBC5B9` | Filetti | decorativi |
| `--c-stone-3` | `#8F8A80` | Bordo dei campi | 3.43 su bianco (≥ 3:1) |
| barra laterale | ink-1 + ivory / ivory-3 | Navigazione | ivory-3 su ink-1: 6.92 |

Il ciano puro `#4DC0DE` sul chiaro si usa **solo** come indicatore (filetto nav attiva, bordo superiore, punto di stato), mai come testo.

### 3.3 Stati degli eventi (badge)

| Stato | Testo | Fondo | Contrasto | Forma del punto |
|---|---|---|---|---|
| `richiesta` | `#7A4A00` | `#FCEFD3` | 6.56 | anello vuoto (da gestire) |
| `offerta` | `#0F5C72` | `#DDF1F8` | 6.45 | mezzo pieno |
| `confermato` | `#1B6236` | `#DDF0E3` | 6.20 | pieno |
| `completato` | `#45474A` | `#ECEAE5` | 7.75 | quadrato |
| `annullato` | `#962A2A` | `#F7E2DF` | 6.35 | trattino |

Lo stato non è mai comunicato solo dal colore: c'è sempre l'etichetta testuale e una **forma** diversa del punto. Stati delle richieste web: `.badge--nuova` (come richiesta), `--gestita` (come confermato), `--scartata` (come completato).

## 4. Tipografia

### 4.1 Coppia scelta

| Ruolo | Carattere | Pesi caricati |
|---|---|---|
| Display (titoli, citazioni, nomi) | **Cormorant Garamond** | 400, 500, corsivo 400 |
| Testo e interfaccia | **Jost** | 400, 500 |

**Perché.** Cormorant Garamond resta: è un Garamond da titolazione, raffinato, con un corsivo splendido per la parola-chiave in ciano; parla ai matrimoni senza diventare romantico-kitsch e regge il registro istituzionale di Davos. Manrope viene **sostituito da Jost**: è un geometrico di eredità Futura, con le stesse curve piene e regolari della "M" del logo; in maiuscolo spaziato (eyebrow, bottoni) è più elegante ed "europeo" di un grotesk da startup, e ha le cifre tabellari (`tnum`) per le tabelle del gestionale. Entrambi coprono italiano, tedesco e francese.

**Link da usare** in tutte le pagine (sostituisce quello attuale con Manrope):

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;1,400&family=Jost:wght@400;500&display=swap" rel="stylesheet">
```

Nessun altro peso: il corpo 300 su fondo scuro è troppo sottile; il 600 non serve.

### 4.2 Scala (sito pubblico)

| Token | Valore | Uso |
|---|---|---|
| `--fs-3xl` | clamp(44 → 104 px) | H1 del hero, Cormorant 400 |
| `--fs-2xl` | clamp(36 → 62 px) | H2 di sezione, Cormorant 400 |
| `--fs-quote` | clamp(27 → 44 px) | Testo d'introduzione |
| `--fs-xl` | clamp(26 → 36 px) | H3 (card eventi, servizi) |
| `--fs-lg` | clamp(22 → 26 px) | Domande FAQ, nomi di sale/DJ/partner |
| `--fs-md` | 19 px | Lead |
| `--fs-base` | 17 px | Corpo, Jost 400, interlinea 1.7 |
| `--fs-sm` | 14.5 px | Liste fitte, note |
| `--fs-xs` | 12.5 px | Eyebrow, bottoni (maiuscolo, 500) |
| `--fs-2xs` | 11.5 px | Etichette maiuscole piccole, meta |

- Titoli: interlinea 1.05, spaziatura −0.012 em, `text-wrap: balance`.
- Maiuscolo spaziato **solo** con Jost 500: eyebrow `.28em`, bottoni/etichette `.16em`. Mai frasi intere in maiuscolo.
- Corsivo Cormorant + ciano: una sola parola o espressione per titolo (`<em>`).
- Lunghezza di riga del testo corrente: 45–70 caratteri (`max-width` in `ch`).

Area riservata: corpo Jost 15.5 px / 1.55, tabelle 14 px con cifre tabellari, H1 di pagina in Cormorant 30 px (unico tocco "display"), tutto il resto in Jost.

### 4.3 Motivo LED a matrice di punti

La scritta del logo è composta da punti LED. Lo riprendiamo come **trama decorativa discretissima**, mai come carattere:
- `--dots`: griglia di punti avorio al 9 % (passo 7 px). Usata in: fascia "Area di lavoro" (sfumata da sinistra), segnaposto con iniziali dei DJ, fondo della pagina di login, velatura del video hero (passo 4 px).
- Eyebrow: il filetto iniziale è una riga di 4–5 punti invece di una linea.
- **Vietato**: font dot-matrix per titoli o testo, punti animati/lampeggianti, trama sopra il testo corrente.

## 5. Spaziature, griglia, forme

- **Scala** (base 4/8): `--sp-1` 4 · `--sp-2` 8 · `--sp-3` 12 · `--sp-4` 16 · `--sp-5` 24 · `--sp-6` 32 · `--sp-7` 48 · `--sp-8` 64 · `--sp-9` 96 · `--sp-10` 128.
- Ritmo verticale delle sezioni: `--section-y` = clamp(88 → 160 px); distanza intestazione-contenuto `--head-gap` = clamp(56 → 88 px).
- **Griglia**: contenitore `.wrap` max 1240 px, `.wrap--narrow` 900 px; margine laterale minimo `--gutter` 16 px (da 320 px in su). Griglie interne con CSS Grid e `minmax(min(100%, X), 1fr)` così nulla deborda.
- Breakpoint di riferimento: 1080 (menu mobile), 960, 900, 860, 720/760, 600, 560, 520 px.
- **Raggi**: quasi tutto **squadrato** (`--radius-0`). `--radius-1` 2 px solo nell'area riservata (campi, badge, pannelli). Tondo (`--radius-round`) solo per il pulsante WhatsApp e i punti LED/stato.
- **Linee**: filetti di 1 px (`--border` 10 %, `--border-2` 22 %). Niente ombre sul sito pubblico, salvo il pulsante WhatsApp e il suggerimento lingua (elementi flottanti).
- Area di tocco minima: 44 px (`--tap`).

## 6. Movimento

- Curva unica `--ease: cubic-bezier(.2,.7,.2,1)`; durate `--dur-1` .2 s (colori), `--dur-2` .4 s (filetti, menu), `--dur-3` .9 s (apparizioni), `--dur-zoom` 1.4 s (zoom lento delle foto, max scala 1.04).
- Si animano solo `opacity`, `transform`, colori. Nessun parallax, nessun rimbalzo, nessun lampeggio.
- `.reveal`: dissolvenza + 24 px verso l'alto, una sola volta.
- `prefers-reduced-motion: reduce`: tutte le animazioni e transizioni spente, video hero nascosto e sostituito dal poster.

## 7. Fotografia e video

- Soggetti reali dei nostri allestimenti: luce che disegna lo spazio, ospiti (non riconoscibili senza consenso), dettagli tecnici puliti. Niente foto stock riconoscibili.
- Tono: scuro, contrastato, con fasci di luce; saturazione leggermente ridotta via CSS (`saturate(.8–.85)`), piena al passaggio del mouse.
- Testo sopra le immagini sempre con sfumatura scura (`rgb(var(--c-ink-0-rgb) / .9+)` sul lato del testo).
- Video hero: muto, in loop, max ~6 MB, con `poster`; nessun testo bruciato nel video.
- Formati: orizzontali 16:9, verticali 9:16, ritratti DJ 4:5; `object-fit: cover`; sempre `width`/`height` o `aspect-ratio` per evitare salti di layout; `loading="lazy"` sotto la piega.
- Testo `alt` descrittivo per le foto della galleria; `alt=""` per quelle decorative.
- Loghi partner: preferibilmente PNG/SVG trasparenti **chiari o monocromi** (sul fondo scuro un logo nero non si vede).

## 8. Componenti (sito pubblico)

| Componente | Classi | Note |
|---|---|---|
| Eyebrow | `.eyebrow` | Jost 500 12.5 px maiuscolo, ciano, filetto a punti; in `.head` centrata con punti su entrambi i lati |
| Bottone primario | `.btn` | Avorio pieno, testo ink; hover ciano. Uno solo per schermata |
| Bottone secondario | `.btn.btn--line` | Bordo 22 %; hover pieno avorio |
| Varianti | `.btn--sm`, `.btn--block` | |
| Link con freccia | `.link-arrow` | Maiuscolo spaziato + filetto che si allunga |
| Intestazione sezione | `.head`, `.head--left`, `.head--split`, `.head__lead` | |
| Card evento | `.event`, `.event--lg`, `.event__body`, `.event__n` | Foto, sfumatura, filetto ciano in basso in hover |
| Servizi | `.service`, `.service__n`, `.service__list` | Righe separate da filetti, punti ciano |
| Liste | `.ticks` (spunte), `.service__list` (punti) | |
| Passi | `.steps`, `.step`, `.step__n` | Numeri romani in corsivo ciano |
| FAQ | `.faq details/summary` | + / − in ciano |
| Modulo | `.form`, `.form__row`, `.form__chips`, `.form__note`, `.form__error`, `.form__ok` | Campi con solo bordo inferiore antracite, focus ciano |
| Selettore lingua | `.lang`, `.lang a[aria-current]` | Lingua attiva avorio con filetto ciano |
| Navigazione | `.nav`, `.nav__menu`, `.nav__toggle` | Trasparente sul hero, velo scuro dopo lo scorrimento; menu a tutta larghezza sotto 1080 px |
| Stato vuoto | `.empty` | Riquadro tratteggiato, testo corsivo meta |

### 8.1 Nuove sezioni (classi da usare esattamente così)

**Area di lavoro**
```html
<section class="regions"><div class="wrap">
  <header class="head head--left">…</header>
  <ul class="regions__list">
    <li class="region region--main">
      <span class="region__note">…area principale…</span>
      <span class="region__name">Svizzera</span>
      <span class="region__text">Tutti i cantoni…</span>
    </li>
    <li class="region"><span class="region__name">Italia</span><span class="region__note">su richiesta</span></li>
    …Germania, Francia
  </ul>
</div></section>
```
`.region--main` (Svizzera) è grande, avorio, con punto ciano "acceso"; gli altri paesi sono più piccoli con l'etichetta "su richiesta" in meta. Sotto 760 px la Svizzera occupa tutta la riga e gli altri tre stanno su tre colonne.

**Location** — `.venues` (griglia, anche `<ul>`) › `.venue` con `.venue__name` (h3), `.venue__place`, `.venue__type`. Il tipo viene mostrato sopra il nome (`order: -1`) anche se nel markup sta dopo.

**DJ** — `.djs` › `.dj` con `<img class="dj__photo">` **oppure** `<div class="dj__initials" aria-hidden="true">AB</div>`, poi `.dj__name` (h3), `.dj__genre`, `.dj__link` (facoltativo). Le iniziali stanno su trama LED, in corsivo Cormorant.

**Partner** — `.partners` (riga, anche `<ul>`) › `.partner` (link o span) con `<img>` del logo oppure il nome in testo. Logo in scala di grigi al 62 %, a colori al passaggio/focus.

**Filtri galleria** — `<div class="filters" role="group" aria-label="…">` con `<button class="filter" aria-pressed="true|false">`. Attivo = bordo ciano + fondo ciano 12 %. Sotto 520 px scorrono in orizzontale. Gli elementi filtrati della galleria si nascondono con l'attributo `hidden`.

**WhatsApp flottante** — `<a class="fab-whatsapp" href="https://wa.me/…" aria-label="…" target="_blank" rel="noopener"><svg aria-hidden="true">…</svg></a>`, ultimo figlio di `<body>` (fratello di `.nav`, così si nasconde quando il menu mobile è aperto). Cerchio scuro 56 px con icona avorio (`fill: currentColor`), ciano in hover. Niente verde WhatsApp. Su mobile il suggerimento lingua lascia spazio al pulsante.

## 9. Area riservata (`admin.css`)

| Componente | Classi |
|---|---|
| Pagina di login | `<body class="login-page">` › `<main class="login">` con il logo come primo figlio (`<img>` o `.login__brand`): il logo finisce in una fascia scura in testa alla card |
| Layout | `.app` › `.app__side` (logo, `<nav>` con `a[aria-current="page"]`, `.app__user`) + `.app__main` (`.app__head` con `h1` e azioni) |
| Barra filtri | `.toolbar` con `.field` / `.field--search`, `.toolbar__count` |
| Tabella | `.table-wrap` › `table.table`; `th[aria-sort]`; celle `.num` (importi), `.table__primary`, `.table__sub`, `.table__actions`. **Ogni `<td>` deve avere `data-label="…"`**: sotto 720 px ogni riga diventa una scheda con etichetta a sinistra |
| Badge | `.badge.badge--richiesta|offerta|confermato|completato|annullato` (+ `nuova|gestita|scartata`) |
| Pannelli | `.panels` (griglia), `.panel`, `.panel__head`, `.panel__foot`, `.dl` (coppie dato/valore) |
| Campi | `.fields` (griglia), `.field`, `.field--full`, `.field--invalid`, `.field__hint`, `.field__error`, `.check`; `aria-invalid="true"` colora il bordo |
| Bottoni | `.btn` (secondario), `.btn--primary`, `.btn--dark`, `.btn--ghost`, `.btn--danger`, `.btn--sm`, `.btn--block`; `disabled` / `aria-busy="true"` |
| Schede | `.tabs` con `button[role="tab"][aria-selected]` (o `a[aria-current]`), contatore `.count` |
| Stato vuoto | `.empty` con `<strong>` e `<p>` |
| Notifica | `.toast`, `.toast--ok`, `.toast--error` (`role="status"`) |
| Messaggio in linea | `.alert`, `.alert--error`, `.alert--ok` |
| Utility | `.muted`, `.num`, `.sr-only` |

Regole: densità media (righe 48–56 px), importi allineati a destra con cifre tabellari e apostrofo svizzero (`24'750.00`), date `gg.mm.aaaa`, un solo bottone primario per vista, azioni distruttive sempre `.btn--danger` con conferma. Sotto 900 px la barra laterale diventa una barra superiore con navigazione scorrevole. Stampa: barra laterale, filtri e bottoni nascosti.

## 10. Accessibilità (obbligatoria)

- Contrasti AA come da tabelle; focus sempre visibile (`:focus-visible`, 1 px ciano con offset sul pubblico, 2 px ciano scuro nell'area riservata).
- Aree di tocco ≥ 44 px; link "Vai al contenuto" (`.skip`).
- Stato e selezione mai solo col colore (forme dei badge, `aria-pressed`, `aria-current`, `aria-selected`).
- Layout verificato da 320 a 1920 px, senza scorrimento orizzontale.

## 11. Da fare / da non fare

**Sì**
- Usare sempre i token (`var(--…)`); aggiungere un token qui prima di usarne uno nuovo.
- Tanto spazio, pochi elementi, un accento ciano per vista.
- Foto vere e scure, testo avorio, filetti sottili.
- Titoli in Cormorant, tutto il resto in Jost.

**No**
- Colori "a mano", gradienti colorati, neon, glow, ombre pesanti.
- Ciano su grandi superfici o per paragrafi; antracite come colore del testo sul fondo scuro.
- Angoli arrotondati sul sito pubblico (eccetto il pulsante WhatsApp).
- Font a matrice di punti, animazioni lampeggianti, effetti "discoteca".
- Più di due famiglie di caratteri o pesi non elencati.
- Il logo su fondo chiaro (la scritta bianca sparisce).
