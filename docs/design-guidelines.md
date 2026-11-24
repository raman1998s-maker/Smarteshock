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

### 3.1 Sito pubblico (tema scuro "grafite")

Fondi **grafite caldi**, neutri, derivati dall'antracite del logo (scelta del referente, 24.11.2026: proposta "C — Grafite e scena" con il titolo del hero della proposta "B").

| Token | Hex | Ruolo |
|---|---|---|
| `--c-ink-0` | `#161616` | Fondo pagina (`--color-bg`) |
| `--c-ink-1` | `#1F1F1F` | Fondo sezioni alternate (`--color-bg-alt`) |
| `--c-ink-2` | `#2A2A2A` | Superfici: card di intro/servizi/eventi, modulo, riquadro Davos (`--color-surface`) |
| `--c-ink-3` | `#343434` | Superfici in hover, segnaposto (`--color-surface-2`) |
| `--c-ivory` | `#F2ECE1` | Testo principale, bottone primario (`--color-text`) |
| `--c-ivory-2` | `#CDC6BA` | Testo secondario, lead, paragrafi lunghi (`--color-text-2`) |
| `--c-ivory-3` | `#A29B90` | Meta, etichette, didascalie (`--color-text-3`) |
| `--c-cyan` | `#4DC0DE` | Accento del logo (`--color-accent`, `--color-focus`) |
| `--c-anthracite` | `#6A6969` | Grigio del logo (riferimento; sul grafite non basta per i bordi) |
| `--c-anthracite-2` | `#8A8888` | Antracite schiarito: bordo inferiore dei campi (`--color-field`) |
| `--color-line` | avorio 10 % | Filetti decorativi |
| `--color-line-2` | avorio 22 % | Bordi di chip, filtri, bottoni "line" |
| `--color-accent-soft` | ciano 12 % | Fondo di chip/filtri attivi, pillola del numero dei servizi |
| `--color-dot-page` | avorio 5 % | Trama LED leggera sul fondo pagina (`--dots-page`) |
| `--color-glass` / `--color-glass-2` | ink-0 55 % / 78 % | Vetro fumé (con `backdrop-filter: blur`): etichetta del hero / riquadro "Chi siamo" |
| `--color-glass-line` | avorio 14 % | Bordo dell'etichetta su vetro |
| `--c-danger` | `#F0948A` | Errori nel modulo |
| `--c-success` | `#86D3A5` | Conferme nel modulo |

Contrasti misurati (testo su fondo):

| Testo | ink-0 | ink-1 | ink-2 | ink-3 |
|---|---|---|---|---|
| ivory `#F2ECE1` | 15.39 | 14.02 | 12.21 | 10.59 |
| ivory-2 `#CDC6BA` | 10.67 | 9.72 | 8.46 | 7.34 |
| ivory-3 `#A29B90` | 6.57 | 5.99 | 5.21 | 4.52 |
| cyan `#4DC0DE` | 8.54 | 7.78 | 6.77 | 5.88 |
| anthracite `#6A6969` | 3.31 | 3.01 | 2.62 | 2.27 |
| anthracite-2 `#8A8888` | 5.13 | 4.68 | 4.07 | 3.53 |
| danger `#F0948A` | 8.02 | 7.31 | 6.36 | 5.52 |
| success `#86D3A5` | 10.23 | 9.32 | 8.12 | 7.04 |

- Bottone primario: ink-0 su avorio **15.39**; in hover ink-0 su ciano **8.54**.
- Numero dei servizi: ciano su `--color-accent-soft` sopra ink-2 **5.40**.
- Bordo dei campi (`anthracite-2`) sulla superficie del modulo (ink-2) **4.07** (≥ 3:1).
- Lead del hero (`ivory-2`) sulla sfumatura dal basso (ink-0 all'86 % a metà altezza), anche sopra una zona bianca del video: **7.02**.
- Riquadro "Chi siamo" (vetro ink-0 al 78 %), caso peggiore teorico sopra un muro bianco puro: ivory **7.66**, ivory-2 **5.31**, ciano **4.25**. Misurato nel browser a 1440 px sul pixel più chiaro della foto dietro l'eyebrow: ciano **4.50**, ivory-2 **5.63** (il `blur` del vetro media lo sfondo, quindi in pratica è più alto). Sotto 1280 px il testo esce dalla foto e sta su ink-2.

**Regole d'uso**
- Il ciano è un accento **raro**: eyebrow, parola in `<em>` nei titoli, numero dei servizi e dei passi, filetti attivi, focus. Mai fondi ciano estesi, mai paragrafi in ciano.
- L'antracite **non si usa per il testo** sul tema scuro. Sul grafite anche come bordo si usa solo `anthracite-2` (≥ 3:1 fino a ink-3).
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
| `--c-cyan-ink-2` | `#0F5468` | Hover del bottone primario | bianco su di esso 8.44 |
| `--c-cyan-wash` | `#E6F4F8` | Fondo tenue (selezione, evidenza) | cyan-ink su di esso 5.47 |
| `--c-red-ink` | `#A12C2C` | Errori, bottone elimina | 7.21 · 6.56 |
| `--c-green-ink` | `#1D6638` | Successo | 6.98 · 6.35 |
| `--c-stone-1` / `-2` | `#E3DFD6` / `#CBC5B9` | Filetti | decorativi |
| `--c-stone-3` | `#8F8A80` | Bordo dei campi | 3.43 su bianco (≥ 3:1) |
| barra laterale | ink-1 + ivory / ivory-3 | Navigazione | ivory-3 su ink-1: 6.92 |

**Nota.** L'area riservata **non** passa al grafite: `admin.css` tiene i suoi primitivi scuri originali (`--c-ink-0` `#08090B`, `--c-ink-1` `#0E1013`, …) per barra laterale e login. I contrasti di questa tabella si riferiscono a quei valori.

Il ciano puro `#4DC0DE` sul chiaro si usa **solo** come indicatore (filetto nav attiva, bordo superiore, punto di stato), mai come testo.

### 3.3 Stati degli eventi (badge)

| Stato | Testo | Fondo | Contrasto | Forma del punto |
|---|---|---|---|---|
| `richiesta` | `#7A4A00` | `#FCEFD3` | 6.56 | anello vuoto (da gestire) |
| `offerta` | `#0F5C72` | `#DDF1F8` | 6.45 | mezzo pieno |
| `confermato` | `#1B6236` | `#DDF0E3` | 6.20 | pieno |
| `completato` | `#45474A` | `#ECEAE5` | 7.75 | quadrato |
| `annullato` | `#962A2A` | `#F7E2DF` | 6.35 | trattino |

Colori dei punti di stato (solo indicatori, lo stato è sempre scritto anche nel testo del badge): richiesta `#C98A12`, offerta `#4DC0DE`, confermato `#2E9A57`, completato `#6A6969`, annullato `#C9473F`.

Lo stato non è mai comunicato solo dal colore: c'è sempre l'etichetta testuale e una **forma** diversa del punto. Stati delle richieste web: `.badge--nuova` (come richiesta), `--gestita` (come confermato), `--scartata` (come completato).

## 4. Tipografia

### 4.1 Coppia scelta

| Ruolo | Carattere | Pesi caricati |
|---|---|---|
| Display (titoli, citazioni, nomi) | **Cormorant Garamond** | 400, 500, corsivo 400 |
| Testo e interfaccia | **Jost** | 400, 500 |

**Perché.** Cormorant Garamond resta: è un Garamond da titolazione, raffinato, con un corsivo splendido per la parola-chiave in ciano; parla ai matrimoni senza diventare romantico-kitsch e regge il registro istituzionale di Davos. Manrope viene **sostituito da Jost**: è un geometrico di eredità Futura, con le stesse curve piene e regolari della "M" del logo; in maiuscolo spaziato (eyebrow, bottoni) è più elegante ed "europeo" di un grotesk da startup, e ha le cifre tabellari (`tnum`) per le tabelle del gestionale. Entrambi coprono italiano, tedesco e francese.

**Caricamento: ospitati in locale.** Per la protezione dei dati (LPD/GDPR) i caratteri **non** si caricano da Google Fonts né da altri servizi esterni: nessun `<link>` a `fonts.googleapis.com` / `fonts.gstatic.com`, nessun `preconnect` verso terzi. I file stanno in `assets/fonts/` e le regole `@font-face` sono in cima a `assets/css/style.css` e `assets/css/admin.css` (tenerle identiche).

- Fonte: pacchetti npm `@fontsource/cormorant-garamond@5.3.0` e `@fontsource/jost@5.3.0` (versione fissata), solo WOFF2, sottoinsiemi **latin** e **latin-ext** (bastano per IT, DE, FR, EN).
- 10 file, ~160 kB in totale; il browser scarica solo i pesi e i sottoinsiemi effettivamente usati nella pagina (`unicode-range`): una pagina in italiano tipica carica 3–5 file latin (~10–23 kB l'uno).
- `font-display: swap`: il testo appare subito con il carattere di riserva definito nei token `--font-display` / `--font-text`.
- Licenza SIL Open Font License 1.1: `assets/fonts/OFL-CormorantGaramond.txt`, `assets/fonts/OFL-Jost.txt` (da distribuire insieme ai file).
- I nomi di famiglia nelle `@font-face` (`"Cormorant Garamond"`, `"Jost"`) devono restare identici a quelli dei token.
- Per aggiornare: `npm pack` della nuova versione fissata in una cartella temporanea, copiare solo i `.woff2` elencati sopra, aggiornare versione e licenze qui.

Nessun altro peso: il corpo 300 su fondo scuro è troppo sottile; il 600 non serve.

### 4.2 Scala (sito pubblico)

| Token | Valore | Uso |
|---|---|---|
| `--fs-3xl` | clamp(28 px, 4.2vw + 18 px, 84 px) | H1 del hero, **Jost 500 maiuscolo** (31 px a 320, 34 px a 390, ~78 px a 1440) |
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
- **Eccezione: il titolo del hero** è in Jost 500 maiuscolo (stile "matrice LED"), interlinea 1, spaziatura −0.01 em, `max-width: 17ch`, centrato. La parola in `<em>` è ciano **diritta** (non corsiva) con un bagliore leggero (`text-shadow` ciano al 45 %). È l'unico titolo in maiuscolo e l'unico bagliore del sito; gli altri titoli restano in Cormorant.
- Maiuscolo spaziato **solo** con Jost 500: eyebrow `.28em`, bottoni/etichette `.16em`. Nessun'altra frase intera in maiuscolo oltre al titolo del hero.
- Corsivo Cormorant + ciano: una sola parola o espressione per titolo (`<em>`).
- Lunghezza di riga del testo corrente: 45–70 caratteri (`max-width` in `ch`).

Area riservata: corpo Jost 15.5 px / 1.55, tabelle 14 px con cifre tabellari, H1 di pagina in Cormorant 30 px (unico tocco "display"), tutto il resto in Jost.

### 4.3 Motivo LED a matrice di punti

La scritta del logo è composta da punti LED. Lo riprendiamo come **trama decorativa discretissima**, mai come carattere:
- `--dots`: griglia di punti avorio al 9 % (passo 7 px). Usata in: fascia "Area di lavoro" (sfumata da sinistra), segnaposto con iniziali dei DJ, fondo della pagina di login.
- `--dots-page`: punti avorio al 5 % (passo 9 px) sul fondo di tutta la pagina (`body`); le sezioni con fondo proprio la coprono.
- Eyebrow: il filetto iniziale è una riga di 4–5 punti invece di una linea.
- **Vietato**: font dot-matrix per titoli o testo, punti animati/lampeggianti, trama sopra il testo corrente.

## 5. Spaziature, griglia, forme

- **Scala** (base 4/8): `--sp-1` 4 · `--sp-2` 8 · `--sp-3` 12 · `--sp-4` 16 · `--sp-5` 24 · `--sp-6` 32 · `--sp-7` 48 · `--sp-8` 64 · `--sp-9` 96 · `--sp-10` 128.
- Ritmo verticale delle sezioni: `--section-y` = clamp(88 → 160 px); distanza intestazione-contenuto `--head-gap` = clamp(56 → 88 px).
- **Griglia**: contenitore `.wrap` max 1240 px, `.wrap--narrow` 900 px; margine laterale minimo `--gutter` 16 px (da 320 px in su). Griglie interne con CSS Grid e `minmax(min(100%, X), 1fr)` così nulla deborda.
- Breakpoint di riferimento: 1080 (menu mobile), 960, 900, 860, 720/760, 600, 560, 520 px.
- **Raggi (sito pubblico)**: forme morbide.
  - `--radius-field` 12 px: campi del modulo, chip, foto della galleria.
  - `--radius-card` 20 px: card degli eventi e dei servizi, riquadro di testo "Chi siamo", foto della squadra sotto 860 px.
  - `--radius-panel` 28 px: card dell'intro, riquadro Davos, foto della squadra.
  - `--radius-round` (pillola): bottoni, filtri della galleria, pulsante WhatsApp, etichetta del hero, numero dei servizi, punti LED.
- Area riservata: invariata, `--radius-1` 2 px / `--radius-2` 4 px (definiti in `admin.css`).
- **Linee**: filetti di 1 px (`--border` 10 %, `--border-2` 22 %). Niente ombre sul sito pubblico, salvo il pulsante WhatsApp e il suggerimento lingua (elementi flottanti).
- Area di tocco minima: 44 px (`--tap`).

## 6. Movimento

- Curve: `--ease: cubic-bezier(.2,.7,.2,1)` (filetti, menu, apparizioni), `--ease-out: cubic-bezier(.23,1,.32,1)` (entrate e pressioni), `--ease-soft: cubic-bezier(.32,.72,0,1)` (movimenti lenti: foto del hero, bagliore). Durate `--dur-1` .2 s (colori), `--dur-2` .4 s (filetti, menu), `--dur-3` .9 s (apparizioni), `--dur-zoom` 1.4 s (zoom lento delle foto, max scala 1.04).
- Si animano solo `opacity`, `transform`, `clip-path`, `text-shadow` e colori. Nessun parallax, nessun rimbalzo, nessun lampeggio ripetuto.
- **Entrata del hero** (una sola volta al caricamento): la foto si posa da scala 1.06 a 1 in 2.2 s (`settle`, `--ease-soft`); eyebrow, titolo, testo, bottoni e piede salgono insieme (`rise`, `--ease-out`) a 0 / 60 / 180 / 260 / 400 ms. Il titolo si accende **a scatti** come un ledwall (`led-scan`: `clip-path` in 10 scatti, 520 ms), poi il ciano della parola in `<em>` si posa sul bagliore di riposo (`led-glow`, 900 ms). Lo scatto riguarda solo la scansione: non è un lampeggio.
- **Pressione**: `.btn:active` scala .97 in 160 ms. **Hover** solo con mouse (`@media (hover: hover) and (pointer: fine)`): card evento −4 px con foto a 1.03; card servizio con bordo ciano al 35 %.
- `.reveal`: dissolvenza + 24 px verso l'alto, una sola volta.
- `prefers-reduced-motion: reduce`: tutte le animazioni e transizioni spente, video hero nascosto e sostituito dal poster.

## 7. Fotografia e video

- Soggetti reali dei nostri allestimenti: luce che disegna lo spazio, ospiti (non riconoscibili senza consenso), dettagli tecnici puliti. Niente foto stock riconoscibili.
- Tono: scuro, contrastato, con fasci di luce; saturazione leggermente ridotta via CSS (`saturate(.8–.85)`), piena al passaggio del mouse.
- Testo sopra le immagini sempre con sfumatura scura (`rgb(var(--c-ink-0-rgb) / .86+)` sul lato del testo) oppure su vetro fumé (`--color-glass`, `--color-glass-2`). Nel hero la sfumatura sale dal basso e il testo è centrato in basso.
- Foto della squadra ("Chi siamo"): `assets/img/team.jpg`, 2000 × 1126; il riquadro di testo sta in alto a sinistra, sopra il muro e non sulle persone.
- Video hero: muto, in loop, max ~6 MB, con `poster`; nessun testo bruciato nel video.
- Formati: orizzontali 16:9, verticali 9:16, ritratti DJ 4:5; `object-fit: cover`; sempre `width`/`height` o `aspect-ratio` per evitare salti di layout; `loading="lazy"` sotto la piega.
- Testo `alt` descrittivo per le foto della galleria; `alt=""` per quelle decorative.
- Loghi partner: preferibilmente PNG/SVG trasparenti **chiari o monocromi** (sul fondo scuro un logo nero non si vede).

## 8. Componenti (sito pubblico)

| Componente | Classi | Note |
|---|---|---|
| Eyebrow | `.eyebrow` | Jost 500 12.5 px maiuscolo, ciano, filetto a punti; in `.head` centrata con punti su entrambi i lati |
| Bottone primario | `.btn` | Pillola, avorio pieno, testo ink; hover ciano; pressione scala .97. Uno solo per schermata |
| Bottone secondario | `.btn.btn--line` | Bordo 22 %; hover pieno avorio |
| Varianti | `.btn--sm`, `.btn--block` | |
| Link con freccia | `.link-arrow` | Maiuscolo spaziato + filetto che si allunga |
| Intestazione sezione | `.head`, `.head--left`, `.head--split`, `.head__lead` | |
| Hero | `.hero`, `.hero__shade`, `.hero__content`, `.hero__foot` | Foto piena, sfumatura dal basso, testo centrato in basso; eyebrow a pillola su vetro fumé |
| Intro | `.intro` | Testo dentro una card `--color-surface` con `--radius-panel` |
| Card evento | `.events` › `.event`, `.event__body`, `.event__n` | Fascia orizzontale scorrevole con aggancio (`scroll-snap`), schede alte 520 px (460 sotto 960, 440 sotto 600), bordo destro sfumato; numero in `ivory-3`. `.event--lg` resta nel markup ma non cambia più la misura |
| Servizi | `.services` › `.service`, `.service__n`, `.service__list` | Griglia di card (3 / 2 / 1 colonne), numero in pillola ciano, elenco sotto un filetto, punti ciano |
| Chi siamo | `.team` › `.team__inner`, `.team__text` (con `.head.head--left`), `.team__photo` | Foto grande arrotondata; testo su vetro fumé in alto a sinistra (da 1280 px, quando la foto ha la sua misura piena e il riquadro resta sopra il muro); sotto 1280 px il testo va sotto la foto, su ink-2 |
| Riquadro Davos | `.feature` | Larghezza del `.wrap`, `--radius-panel`, margine sotto `--section-y`; foto senza desaturazione |
| Liste | `.ticks` (spunte), `.service__list` (punti) | |
| Passi | `.steps`, `.step`, `.step__n` | Numeri romani in corsivo ciano |
| FAQ | `.faq details/summary` | + / − in ciano |
| Modulo | `.form`, `.form__row`, `.form__chips`, `.form__note`, `.form__error`, `.form__ok` | Campi con solo bordo inferiore antracite, focus ciano |
| Selettore lingua | `.lang`, `.lang a[aria-current]` | Lingua attiva avorio con filetto ciano |
| Navigazione | `.nav`, `.nav__menu`, `.nav__toggle` | Sul hero velo sfumato dall'alto (ink-0 72 % → trasparente), velo scuro pieno dopo lo scorrimento; menu a tutta larghezza sotto 1080 px. "Chi siamo" non è nel menu (un'ottava voce non sta in riga poco sopra 1080 px) |
| Stato vuoto | `.empty` | Riquadro tratteggiato, testo corsivo meta |
| Link nel testo | `.form__note a`, `.prose__section a` | Ciano (`--color-accent`, AA su fondo e superfici), sottolineatura 1 px con offset .22em; hover avorio; focus 1 px ciano offset 2 px |

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

### 8.2 Testo lungo / pagine legali (privacy)

```html
<body class="privacy-page"> … <main id="main" class="section"><div class="wrap wrap--narrow">
  <article class="prose">
    <p class="prose__back"><a class="link-arrow" href="/">…</a></p>
    <header class="head head--left"><p class="eyebrow">…</p><h1>…</h1><p class="head__lead">data</p></header>
    <p class="prose__intro">…</p>
    <nav class="prose__toc" aria-label="…"><ul><li><a href="#s1">1. …</a></li>…</ul></nav>
    <section class="prose__section" id="s1" aria-labelledby="s1-h"><h2 id="s1-h">1. …</h2><p>…</p></section>
  </article>
</div></main>
```

- `body.privacy-page main`: padding superiore = `--nav-h` + `--sp-8` (il titolo non finisce sotto l'header fisso, che usa `.nav.is-scrolled`).
- `.prose`: colonna di 44rem centrata; paragrafi (`.prose__intro`, `.prose__section p`) limitati a `36em` = circa 65–70 caratteri per riga. `h1` in `--fs-2xl` peso 400.
- `.prose__intro`: Jost `--fs-md`, avorio, `--lh-body`.
- `.prose__toc`: tra due filetti `--border`, senza pallini (la numerazione è nel testo); due colonne da 760 px; link Jost `--fs-sm` in `--color-text-2`, senza sottolineatura, altezza minima 44 px; hover ciano, focus avorio + contorno ciano.
- `.prose__section`: filetto superiore e `--sp-7` di spazio tra le sezioni; `h2` in Cormorant `--fs-lg` peso 500 (contenuto, non display); paragrafi `--color-text-2`, `--lh-body`, `--sp-4` tra l'uno e l'altro. `scroll-margin-top: --sp-4`, che si somma a `scroll-padding-top` di `html` (header fisso) per le ancore dell'indice.
- `.prose__back`: `.link-arrow` in ciano con il filetto **prima** del testo (freccia "indietro"); hover avorio, il filetto si allunga.

## 9. Area riservata (`admin.css`)

| Componente | Classi |
|---|---|
| Pagina di login | `<body class="login-page">` › `<main class="login">` con il logo come primo figlio (`<img>` o `.login__brand`): il logo finisce in una fascia scura in testa alla card |
| Layout | `.app` › `.app__side` (logo, `<nav>` con `a[aria-current="page"]`, `.app__user`) + `.app__main` (`.app__head` con `h1` e azioni) |
| Barra filtri | `.toolbar` con `.field` / `.field--search`, `.toolbar__count` |
| Tabella | `.table-wrap` › `table.table`; `th[aria-sort]`; celle `.num` (importi), `.table__primary`, `.table__sub`, `.table__actions`. **Ogni `<td>` deve avere `data-label="…"`**: sotto 720 px ogni riga diventa una scheda con etichetta a sinistra |
| Badge | `.badge.badge--richiesta|offerta|confermato|completato|annullato` (+ `nuova|gestita|scartata`) |
| Pannelli | `.panels` (griglia, spaziatura solo con `gap`), `.panel`, `.panel--full` (occupa tutta la riga di `.panels`, per tabelle o moduli larghi), `.panel__head`, `.panel__foot`, `.dl` (coppie dato/valore) |
| Campi | `.fields` (griglia), `.field`, `.field--full`, `.field--invalid`, `.field__hint`, `.field__error`, `.check`; `aria-invalid="true"` colora il bordo |
| Bottoni | `.btn` (secondario), `.btn--primary`, `.btn--dark`, `.btn--ghost`, `.btn--danger`, `.btn--sm`, `.btn--block`; `disabled` / `aria-busy="true"` |
| Schede | `.tabs` con `button[role="tab"][aria-selected]` (o `a[aria-current]`), contatore `.count` |
| Stato vuoto | `.empty` con `<strong>` e `<p>` |
| Notifica | `.toast`, `.toast--ok`, `.toast--error` (`role="status"`) — fissa in basso a destra; se in pagina c'è una `.publish-bar` sale sopra la barra (`body:has(.publish-bar)` + `--publish-bar-h`, composto solo da token) per non coprire "Pubblica sul sito" |
| Messaggio in linea | `.alert`, `.alert--error`, `.alert--ok` |
| Utility | `.muted`, `.num`, `.sr-only` |

Regole: densità media (righe 48–56 px), importi allineati a destra con cifre tabellari e apostrofo svizzero (`24'750.00`), date `gg.mm.aaaa`, un solo bottone primario per vista, azioni distruttive sempre `.btn--danger` con conferma. Sotto 900 px la barra laterale diventa una barra superiore con navigazione scorrevole. Stampa: barra laterale, filtri e bottoni nascosti.

### 9.1 Editor dei contenuti (CMS, solo admin)

Pagina "Contenuti" dell'area riservata (vedi `docs/architettura.md` § Contenuti pubblici modificabili). Principi: **chi la usa non è tecnico** → etichette in italiano semplice, chiavi tecniche (`hero.title`) solo come dettaglio piccolo, ogni stato scritto a parole (mai solo colore), azioni distruttive sempre con conferma in pagina, un solo bottone primario per vista (la barra "Pubblica sul sito" ha il suo).

**Token aggiunti** (alias di primitivi esistenti, nessun nuovo colore):

| Token | Valore | Uso | Contrasto |
|---|---|---|---|
| `--color-warn` | `--st-richiesta-fg` `#7A4A00` | Traduzione mancante, modifiche non pubblicate | 7.48 su bianco · 7.05 su paper-2 · 6.56 su warn-wash |
| `--color-warn-wash` | `--st-richiesta-bg` `#FCEFD3` | Fondo dei chip di lingua mancante | — |
| `--color-overlay` / `--color-overlay-text` | `--c-ink-text` / bianco | Etichetta "Video 0:24" sopra le anteprime | 17.79 |
| `--tap` | 44 px | Pulsanti icona, schede lingua, bottoni del CMS | — |
| `--thumb-w` | 112 px | Anteprima in vista elenco (< 560 px) | — |

Altri contrasti verificati: rosso su `--color-danger-wash` 5.80, verde su `--color-success-wash` 5.86, ciano scuro su `--color-primary-wash` 5.47, bordo interruttore spento (`--c-stone-3`) 3.43 su bianco. Il punto ambra `#C98A12` (2.95:1) **non** si usa nel CMS: gli indicatori usano `--color-warn`.

| Componente | Classi | Note |
|---|---|---|
| Pulsante icona | `.btn-icon`, `.btn-icon--danger` | 44 × 44, sempre con `aria-label`; `disabled` per il primo/ultimo (su/giù) |
| Etichetta neutra | `.tag` | Categoria (Matrimoni, Aziende, Feste, Palco); maiuscolo spaziato |
| Badge stato voce | `.badge.badge--pubblicato` (punto pieno), `.badge--bozza` (anello), `.badge--modificato` (rombo) | Testo sempre presente |
| Lingue in miniatura | `ul.lang-status > li` (`.is-missing` = tratteggio ambra) | Aggiungere `<span class="sr-only"> mancante</span>` nei `li.is-missing` |
| Griglia media | `ul.media-grid > li.media-card` | Colonne da 264 px; sotto 560 px elenco con anteprima a sinistra |
| Card media | `.media-card__thumb` (img/video + `.media-card__type` + `.media-card__pos`), `.media-card__body`, `.media-card__meta`, `.media-card__title` (`.is-empty` se manca l'alt), `.media-card__bar` › `.media-card__order` + `.media-card__actions` | Stati: `.is-draft` (anteprima attenuata), `.is-dragging`, `.is-drop-target`, `.is-moved` (dopo uno spostamento da tastiera) |
| Maniglia | `<span class="drag-handle" aria-hidden="true">` | Trama LED 2×3; solo mouse/tocco. **Da tastiera si riordina con i pulsanti su/giù**; dopo lo spostamento il focus resta sul pulsante e un `role="status"` annuncia "Spostata in posizione 3 di 12" |
| Zona di caricamento | `label.dropzone` con `<input type="file">` dentro, `.dropzone__icon`, `.dropzone__title`, `.dropzone__hint` | Stati `.is-dragover`, `.is-error`, `.is-disabled`; il focus dell'input disegna il contorno sulla zona |
| File in caricamento | `ul.uploads > li.upload` con `.upload__name`, `.upload__status`, `progress.progress`, `.upload__error` | Stati `.is-done`, `.is-error`; errore con `role="alert"` |
| Barra di avanzamento | `<progress class="progress" max="100" value="…">` | Nessun `style=` (CSP): si aggiorna `progress.value`. Senza `value` = indeterminata |
| Editor di una voce | `.item-editor` (+ `.item-editor--media` = anteprima a sinistra da 900 px), `.item-editor__preview`, `.item-editor__fields` | Dentro un `.panel` con `.panel__foot` (Annulla / Salva) |
| Campo in 4 lingue | `fieldset.lang-field` › `legend.field__label`, `.lang-tabs[role=tablist]` › `button[role=tab][aria-selected]`, `.lang-panel[role=tabpanel]`, `.lang-panel__foot` (`.lang-panel__fallback`, `.lang-panel__count`, `.is-over`) | Scheda `.is-missing` = anello ambra (vuoto: vale il testo predefinito/italiano); `.is-invalid` = "!" rosso. Più `<span class="sr-only">` con lo stato. Frecce ←/→ tra le schede (pattern ARIA tabs) |
| Testi del sito | `details.text-group[open]` › `summary` (+ `.text-group__count`), `ul.text-group__list > li.text-row` | Un gruppo per sezione della pagina (Apertura, Servizi, FAQ…) |
| Riga di testo | `.text-row__label` (`.text-row__name` leggibile + `.text-row__key` tecnica), `.text-row__value` (`.text-row__text` max 2 righe, `.text-row__state`), `.text-row__actions` (Modifica, `.text-row__reset` "Ripristina") | `.is-overridden` = filetto ciano + badge "Modificato" + Ripristina visibile (senza la classe sono nascosti); `.is-open` con `.text-row__editor`, `.text-row__default`, `.text-row__editor-foot`. Sotto 720 px in colonna |
| Interruttore | `label.switch` › `input[type=checkbox][role=switch]` + `span.switch__track[aria-hidden]` + `.switch__on` / `.switch__off` | Il testo cambia da solo con lo stato (Pubblicato / Bozza): non solo colore |
| Barra pubblicazione | `.publish-bar` › `.publish-bar__status` (`.publish-bar__icon`, `p.publish-bar__text` con `strong` + `.publish-bar__sub`), `.publish-bar__actions` | Ultimo figlio di `.app__main`, sempre visibile in basso (sticky). Stati: `--pending` (anello ambra, "3 modifiche non pubblicate"), `--busy` (anello che ruota, bottone `aria-busy="true"`), `--done` (spunta verde, "Pubblicato oggi alle 14:32", bottone `disabled`), `--error` (quadrato "!" rosso, bottone "Riprova"). `__status` con `role="status"` |
| Conferma in pagina | `.confirm[role=group][aria-labelledby]` › `p.confirm__text` (`strong` = domanda) + `.confirm__actions` (`.btn--danger` pieno, `.btn` Annulla) | Compare al posto/sotto le azioni (anche dentro `.media-card__bar`); focus su "Annulla" all'apertura, Esc chiude, al termine il focus torna al pulsante d'origine |

Esempio (card della galleria):
```html
<ul class="media-grid">
  <li class="media-card is-draft" draggable="true" data-id="…">
    <div class="media-card__thumb">
      <img src="…anteprima firmata…" alt="">
      <span class="media-card__type"><svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 2l7 4-7 4z"/></svg>Video 0:24</span>
      <span class="media-card__pos">2</span>
    </div>
    <div class="media-card__body">
      <div class="media-card__meta"><span class="tag">Palco</span><span class="badge badge--bozza">Bozza</span></div>
      <p class="media-card__title is-empty">Manca la descrizione</p>
      <ul class="lang-status" aria-label="Descrizione nelle lingue">
        <li>IT</li><li class="is-missing">DE<span class="sr-only"> mancante</span></li><li>FR</li><li>EN</li>
      </ul>
    </div>
    <div class="media-card__bar">
      <div class="media-card__order">
        <span class="drag-handle" aria-hidden="true"></span>
        <button class="btn-icon" type="button" aria-label="Sposta prima">…svg…</button>
        <button class="btn-icon" type="button" aria-label="Sposta dopo">…svg…</button>
      </div>
      <div class="media-card__actions">
        <button class="btn btn--sm" type="button">Modifica</button>
        <button class="btn-icon btn-icon--danger" type="button" aria-label="Elimina">…svg…</button>
      </div>
      <!-- dopo "Elimina": -->
      <div class="confirm" role="group" aria-labelledby="c-12">
        <p class="confirm__text" id="c-12"><strong>Eliminare questo video?</strong> Sparirà dal sito alla prossima pubblicazione.</p>
        <div class="confirm__actions"><button class="btn btn--danger" type="button">Elimina</button><button class="btn" type="button">Annulla</button></div>
      </div>
    </div>
  </li>
</ul>
```

Esempio (zona di caricamento, campo in 4 lingue, interruttore, riga di testo, barra):
```html
<label class="dropzone">
  <input type="file" multiple accept="image/jpeg,image/png,image/webp,video/mp4" aria-describedby="dz-hint">
  <svg class="dropzone__icon" viewBox="0 0 24 24" aria-hidden="true">…</svg>
  <span class="dropzone__title">Trascinate qui foto o video, oppure <u>sceglieteli dal computer</u></span>
  <span class="dropzone__hint" id="dz-hint">JPEG, PNG, WebP fino a 10 MB · MP4 fino a 200 MB</span>
</label>
<ul class="uploads"><li class="upload"><span class="upload__name">sala.jpg</span><span class="upload__status">64 %</span><progress class="progress" max="100" value="64">64 %</progress></li></ul>

<fieldset class="lang-field">
  <legend class="field__label">Descrizione della foto</legend>
  <div class="lang-tabs" role="tablist" aria-label="Lingua">
    <button type="button" role="tab" id="t-it" aria-controls="p-it" aria-selected="true">IT</button>
    <button type="button" role="tab" id="t-de" aria-controls="p-de" aria-selected="false" tabindex="-1" class="is-missing">DE<span class="sr-only"> (vuoto)</span></button>
    …FR, EN
  </div>
  <div class="lang-panel" role="tabpanel" id="p-it" aria-labelledby="t-it">
    <div class="field"><label class="sr-only" for="alt-it">Descrizione in italiano</label><textarea id="alt-it" maxlength="2000"></textarea></div>
    <div class="lang-panel__foot"><span class="lang-panel__fallback" hidden>Vuoto: si userà il testo italiano.</span><span class="lang-panel__count">0 / 2000</span></div>
  </div>
</fieldset>

<label class="switch"><input type="checkbox" role="switch" checked><span class="switch__track" aria-hidden="true"></span><span class="switch__on">Pubblicato</span><span class="switch__off">Bozza</span></label>

<details class="text-group" open>
  <summary>Apertura <span class="text-group__count">3 testi · 1 modificato</span></summary>
  <ul class="text-group__list">
    <li class="text-row is-overridden">
      <div class="text-row__label"><span class="text-row__name">Titolo principale</span><span class="text-row__key">hero.title</span></div>
      <div class="text-row__value"><p class="text-row__text">…</p>
        <div class="text-row__state"><span class="badge badge--modificato">Modificato</span><ul class="lang-status">…</ul></div></div>
      <div class="text-row__actions"><button class="btn btn--sm" type="button">Modifica</button><button class="btn btn--sm btn--ghost text-row__reset" type="button">Ripristina</button></div>
    </li>
  </ul>
</details>

<div class="publish-bar publish-bar--pending" role="region" aria-label="Pubblicazione">
  <div class="publish-bar__status" role="status">
    <span class="publish-bar__icon" aria-hidden="true"></span>
    <p class="publish-bar__text"><strong>3 modifiche non pubblicate</strong><span class="publish-bar__sub">Ultima pubblicazione: ieri alle 18:05</span></p>
  </div>
  <div class="publish-bar__actions"><button class="btn btn--primary" type="button">Pubblica sul sito</button></div>
</div>
```

Movimento: rotazione della barra "in corso", barra indeterminata, comparsa della conferma ed evidenza `.is-moved` si spengono con `prefers-reduced-motion` (lo stato resta scritto). In modalità colori forzati l'interruttore usa i colori di sistema. In stampa maniglie, pulsanti icona, zona di caricamento, conferme e barra di pubblicazione sono nascosti.

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
- Titoli in Cormorant (tranne il titolo del hero, in Jost maiuscolo), tutto il resto in Jost.

**No**
- Colori "a mano", gradienti colorati, neon, ombre pesanti; bagliori (glow) fuori dalla parola in ciano del titolo del hero.
- Ciano su grandi superfici o per paragrafi; antracite come colore del testo sul fondo scuro.
- Raggi fuori dai quattro token (`--radius-field`, `--radius-card`, `--radius-panel`, `--radius-round`).
- Font a matrice di punti, animazioni lampeggianti, effetti "discoteca".
- Più di due famiglie di caratteri o pesi non elencati.
- Il logo su fondo chiaro (la scritta bianca sparisce).
