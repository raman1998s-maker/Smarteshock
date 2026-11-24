# Contenuti pubblici: sale, DJ, partner, galleria

In questa cartella ci sono i file che decidono **che cosa compare sul sito** nelle sezioni Location, DJ, Partner e Lavori (galleria).
Si modificano con un normale editor di testo (salvando in UTF-8), poi si rigenera il sito con:

```
python3 build.py
```

## La regola più importante: `"approvato"`

Ogni voce ha il campo `"approvato"`:

- `"approvato": false` → la voce **non** viene pubblicata (bozza, esempio, in attesa di conferma).
- `"approvato": true` → la voce compare sul sito.

Mettete `true` **solo** dopo aver verificato che:

1. il nome (sala, DJ, partner) è scritto correttamente;
2. la sala, il DJ o il partner è d'accordo a comparire sul sito;
3. foto e video non mostrano persone riconoscibili senza il loro consenso;
4. nessun testo rivela l'indirizzo o la città della nostra sede, dati bancari o nomi di clienti.

Le voci "— da inserire (esempio …)" sono solo modelli: sostituitele con dati veri oppure cancellatele.

## I file

### `sale.json` — sale e location dove abbiamo lavorato
```json
{
  "nome": "Nome della sala",
  "luogo": "Località della sala (non della nostra sede)",
  "paese": "CH",
  "tipo": { "it": "Sala per banchetti", "de": "Bankettsaal", "fr": "Salle de banquet", "en": "Banqueting hall" },
  "approvato": false
}
```
`paese` può essere `CH`, `IT`, `DE` oppure `FR`.

### `dj.json` — DJ con cui collaboriamo
```json
{
  "nome": "Nome d'arte del DJ",
  "genere": { "it": "House e dance", "de": "House und Dance", "fr": "House et dance", "en": "House and dance" },
  "foto": "assets/img/dj/nome.jpg",
  "link": "https://www.instagram.com/...",
  "approvato": false
}
```
`foto` e `link` possono restare `null` se non disponibili.

### `partner.json` — partner
```json
{ "nome": "Nome del partner", "logo": "assets/img/partner/nome.png", "link": "https://...", "approvato": false }
```

### `galleria.json` — foto e video degli eventi
```json
{
  "file": "assets/img/event-nome.jpg",
  "tipo": "foto",
  "categoria": "matrimoni",
  "formato": "wide",
  "alt": { "it": "…", "de": "…", "fr": "…", "en": "…" },
  "approvato": true
}
```
- `tipo`: `foto` oppure `video` (per i video aggiungete `"poster": "assets/img/…jpg"`, l'immagine mostrata prima della riproduzione).
- `categoria`: `matrimoni`, `aziende`, `feste` oppure `palco` (serve ai filtri della galleria).
- `formato`: `wide` (orizzontale), `tall` (verticale), `reel` (video verticale).
- `alt`: breve descrizione dell'immagine nelle 4 lingue, per chi usa un lettore di schermo e per i motori di ricerca. Descrivete ciò che si vede, senza nomi di persone o clienti.

## Consigli

- Copiate una voce esistente e modificatela: è il modo più sicuro per non dimenticare virgole o parentesi.
- Tra una voce e l'altra serve una virgola; dopo l'ultima voce no.
- Se `python3 build.py` segnala un errore, quasi sempre manca una virgola o una virgoletta.
- Nel tedesco non si usa la `ß`: scrivete `ss`.
