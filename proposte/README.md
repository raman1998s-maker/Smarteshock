# Proposte grafiche (anteprime, non applicate al sito)

Tre direzioni alternative applicate alla home reale come foglio di stile aggiuntivo.
Nessun file del sito è stato modificato: ogni anteprima è una copia di `index.html` che carica anche `proposte/<nome>.css`
e, solo nelle anteprime, una sezione "Chi siamo" con la foto della squadra (`proposte/img/squadra-ufficio.jpg`).

- `a-luce-del-giorno` — chiaro editoriale (palette "carta"), hero diviso con foto in cornice a doppio filetto, intestazioni con filetto da rivista. Movimento lento: l'immagine si scopre dal basso.
- `b-matrice-led` — scuro tecnico, titoli in Jost maiuscolo, ciano forte, trama LED, sezioni numerate come canali. Movimento a scatti: il titolo si "accende" colonna per colonna.
- `c-grafite` — grafite caldo, forme arrotondate, eventi in fascia scorrevole, servizi a card, etichette su vetro fumé. Movimento morbido: la foto del hero si posa lentamente.

Tutte le animazioni d'entrata partono una sola volta e si spengono con `prefers-reduced-motion` (regola già presente in `assets/css/style.css`).

Vedere: `python3 -m http.server 8000` (oppure qualsiasi server statico) → http://localhost:8000/proposte/a-luce-del-giorno/ (e le altre).
