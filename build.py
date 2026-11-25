#!/usr/bin/env python3
"""Genera le pagine statiche del sito nelle 4 lingue.

Uso:  python3 build.py

Legge  src/template.html,  src/i18n/<lingua>.json  e  data/*.json  e scrive:
  index.html, grazie.html, privacy.html          (italiano, lingua principale)
  de/index.html, de/grazie.html, de/privacy.html (tedesco)
  fr/..., en/...                     (francese, inglese)
  404.html                           (pagina "non trovata", noindex)
  sitemap.xml                        (home e privacy nelle 4 lingue, con hreflang)

I testi si modificano SOLO nei file JSON; poi si rilancia questo script.
Dei file in data/ si pubblicano solo le voci con "approvato": true.

Se nell'ambiente ci sono SUPABASE_URL e SUPABASE_ANON_KEY (build su Netlify), galleria,
sale, DJ, partner e i testi modificati arrivano dal CMS (solo contenuti pubblicati,
vedi scripts/cms_fetch.py); altrimenti si usano data/*.json come sopra.
Genera anche area-riservata/testi-predefiniti.json (testi modificabili dal CMS
con i valori dei file i18n, materiale già pubblico).
"""
import datetime
import html
import json
import re
import struct
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
# scripts/ si importa dalla radice del progetto anche se build.py è lanciato da un'altra cartella
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
from scripts.cms_fetch import EXCLUDED_KEYS, CmsError, load_cms  # noqa: E402
SITE = "https://meekondisplay.ch"
LANGS = ["it", "de", "fr", "en"]  # il primo è la lingua principale (alla radice del sito)
DEFAULT = LANGS[0]
COUNTRIES = ["CH", "IT", "DE", "FR"]
CATEGORIES = ["matrimoni", "aziende", "feste", "palco"]
FORMATS = {"wide", "tall", "reel"}

# Font ospitati in locale (assets/fonts/, @font-face nei CSS dell'agente design):
# nessuna richiesta a Google Fonts per la privacy dei visitatori.

# Testi di riserva per chiavi che non esistono (ancora) nei file i18n.
# Vanno spostati in src/i18n/*.json dall'agente contenuti.
FALLBACK = {
    "regions.main.note": {"it": "Area principale", "de": "Hauptgebiet", "fr": "Zone principale", "en": "Main area"},
    "work.filters.label": {"it": "Filtra per categoria", "de": "Nach Kategorie filtern",
                           "fr": "Filtrer par catégorie", "en": "Filter by category"},
}

def E(value):
    """Escape di testi e attributi (quote=True). Anche { } e = diventano entità: un testo
    (es. dal CMS) con "{{...}}", "style=" o "onclick=" non deve sembrare un segnaposto
    non risolto o un attributo vietato a check_page()."""
    return html.escape(value).replace("{", "&#123;").replace("}", "&#125;").replace("=", "&#61;")


# ---------------------------------------------------------------- testi dal CMS
# Testi che nei file i18n contengono <em>: solo per queste chiavi un testo del CMS
# può usare <em> e </em> (esatti); tutto il resto viene escapato.
EM_KEYS = frozenset({"hero.title", "intro.text", "team.title"})
# Chiavi sovrascritte dal CMS per ogni lingua (il loro valore in `t` è testo NON escapato).
CMS_KEYS = {}


def excluded_key(key):
    return any(key == x or key.startswith(x + ".") for x in EXCLUDED_KEYS)


def string_keys(obj, prefix=""):
    """Chiavi (a.b.c) dei valori di testo di un file i18n (gli elenchi non contano)."""
    out = []
    for k, v in obj.items():
        key = f"{prefix}.{k}" if prefix else k
        if isinstance(v, str):
            out.append(key)
        elif isinstance(v, dict):
            out.extend(string_keys(v, key))
    return out


def cms_html(key, value):
    """Testo del CMS pronto per l'HTML: escape completo; <em>/</em> solo per EM_KEYS."""
    out = E(value)
    if key in EM_KEYS:
        tags = re.findall(r"&lt;(/?)em&gt;", out)
        # solo coppie <em>…</em> ben formate e non annidate, altrimenti restano testo
        if all(t == ("/" if i % 2 else "") for i, t in enumerate(tags)) and len(tags) % 2 == 0:
            out = out.replace("&lt;em&gt;", "<em>").replace("&lt;/em&gt;", "</em>")
        else:
            print(f"!!  CMS: {key}: tag <em> non bilanciati, mostrati come testo")
    return out


def apply_cms_texts(all_t, testi, allowed):
    """Sovrascrive i testi i18n con quelli del CMS (solo chiavi ammesse e lingue presenti)."""
    for lang in LANGS:
        CMS_KEYS[lang] = set()
    for key, vals in (testi or {}).items():
        if key not in allowed or not isinstance(vals, dict):
            print(f"!!  CMS: testo {key!r} ignorato (chiave non modificabile)")
            continue
        for lang in LANGS:
            v = vals.get(lang)
            if not isinstance(v, str) or not v.strip():
                continue
            parts = key.split(".")
            cur = all_t[lang]
            ok = True
            for part in parts[:-1]:
                nxt = cur.get(part)
                if nxt is None:
                    nxt = cur[part] = {}
                if not isinstance(nxt, dict):
                    ok = False
                    break
                cur = nxt
            if not ok or isinstance(cur.get(parts[-1]), (dict, list)):
                print(f"!!  CMS: testo {key!r} ignorato in {lang} (struttura diversa)")
                continue
            cur[parts[-1]] = v
            CMS_KEYS[lang].add(key)


def raw_text(t, lang, key):
    """Testo da inserire così com'è nel template: i file i18n sono fidati (contengono <em>),
    i testi del CMS vengono escapati."""
    value = lookup(t, key)
    if key in CMS_KEYS.get(lang, ()):
        return cms_html(key, value)
    return value


def base(lang):
    return "/" if lang == DEFAULT else f"/{lang}/"


def lookup(data, key):
    cur = data
    for part in key.split("."):
        cur = cur[part]
    return cur


def text(t, lang, key):
    """Testo i18n con riserva da FALLBACK (segnalato a console)."""
    try:
        return lookup(t, key)
    except (KeyError, TypeError):
        if key in FALLBACK:
            WARN.add(key)
            return FALLBACK[key][lang]
        raise


WARN = set()


def items(values):
    return "".join(f"<li>{v}</li>" for v in values)


# ---------------------------------------------------------------- modulo: dettagli tecnici
# Blocco facoltativo "Dettagli tecnici sul luogo". I nomi dei campi (dt_*) e i
# valori sono quelli validati da netlify/functions/_lib/schemas.js
# (dettagliTecniciSchema); i testi arrivano da src/i18n/*.json -> "tech".
# Senza JavaScript tutto il blocco e' visibile; main.js mostra solo i gruppi
# dei servizi scelti (data-for) e le domande che dipendono da una risposta (data-if).

# servizio tecnico di ogni casella "servizi" del modulo, nello stesso ordine di form.chips
CHIP_TECH = ["screens", "screens", "screens", "lights", "lights", "audio", "dj", "", "", "fx", ""]
TECH_ALL = "screens lights audio dj fx"
YNN = ["si", "no", "non_so"]
TECH_GROUPS = [
    ("luogo", TECH_ALL, [
        ("radio", "spazio", ["sala", "tendone", "capannone", "aperto"], None),
        ("radio", "copertura", YNN, "spazio=aperto"),
        ("radio", "grandezza", ["piccola", "media", "grande", "non_so"], None),
        ("row", [("num", "superficie_m2", 1, 10000, "1"), ("num", "altezza_m", 1, 40, "0.1")], None),
        ("radio", "accesso", ["piano_terra", "ascensore", "scale", "non_so"], None),
        ("radio", "scarico", YNN, None),
    ]),
    ("corrente", TECH_ALL, [
        ("check", "prese", ["230v", "cee400", "non_so"], None),
        ("radio", "prese_vicine", YNN, None),
    ]),
    ("orari", TECH_ALL, [
        ("radio", "montaggio_giorno_prima", ["possibile", "richiesto", "non_possibile", "non_so"], None),
        ("row", [("text", "montaggio_dalle", 80), ("text", "smontaggio_entro", 80)], None),
    ]),
    ("audio", "audio dj", [
        ("radio", "volume_limiti", YNN, None),
        ("text", "volume_quali", 120, "volume_limiti=si"),
        ("row", [("time", "musica_fino"), ("num", "decibel_max", 60, 120, "1")], "volume_limiti=si"),
        ("radio", "discorsi", ["si", "no"], None),
        ("radio", "oratori", ["1_2", "3_5", "oltre_5"], "discorsi=si"),
    ]),
    ("fumo", "lights fx", [
        ("radio", "rilevatori_fumo", YNN, None),
        ("radio", "nebbia_permessa", ["si", "no", "da_chiedere"], "rilevatori_fumo=si"),
        ("note", "note_fumo"),
    ]),
    ("schermi", "screens", [
        ("radio", "uscite_libere", ["si", "verifichiamo", "non_so"], None),
        ("radio", "contenuti_da", ["cliente", "agenzia", "meekon"], None),
        ("note", "note_mp4"),
    ]),
]
FORNITORI = ["decorazioni", "foto", "musica", "planner", "location"]


def tech_html(tt):
    def cond(c):
        return f' data-if="{c}"' if c else ""

    def opt(key, val):
        o = tt["o"].get(key, {})
        if val in o:
            return o[val]
        return {"si": tt["yes"], "no": tt["no"], "non_so": tt["dunno"]}[val]

    def field(item, c=None):
        kind, key = item[0], item[1]
        ph = tt["ph"].get(key)
        ph = f' placeholder="{E(ph)}"' if ph else ""
        if kind == "num":
            _, _, lo, hi, step = item
            inp = f'<input name="dt_{key}" type="number" min="{lo}" max="{hi}" step="{step}" inputmode="decimal"{ph}>'
        elif kind == "time":
            inp = f'<input name="dt_{key}" type="time">'
        else:
            inp = f'<input name="dt_{key}" maxlength="{item[2]}"{ph}>'
        return f'<label{cond(c)}>{E(tt["q"][key])}{inp}</label>'

    def node(item):
        kind = item[0]
        if kind in ("radio", "check"):
            _, key, values, c = item
            typ = "radio" if kind == "radio" else "checkbox"
            opts = "".join(
                f'<label><input type="{typ}" name="dt_{key}" value="{v}"><span>{E(opt(key, v))}</span></label>'
                for v in values
            )
            return f'<fieldset class="form__chips tech__q"{cond(c)}><legend>{E(tt["q"][key])}</legend>{opts}</fieldset>'
        if kind == "row":
            pair = " tech__pair" if all(f[0] in ("num", "time") for f in item[1]) else ""
            return f'<div class="form__row{pair}"{cond(item[2])}>' + "".join(field(f) for f in item[1]) + "</div>"
        if kind == "note":
            return f'<p class="tech__note">{E(tt[item[1]])}</p>'
        return field(item, item[3] if len(item) > 3 else None)

    groups = "".join(
        f'<fieldset class="tech__group" data-for="{tags}"><legend>{E(tt["groups"][g])}</legend>'
        f'<div class="tech__body">{"".join(node(i) for i in items)}</div></fieldset>'
        for g, tags, items in TECH_GROUPS
    )
    rows = "".join(
        f'<div class="tech__supplier"><p class="tech__role">{E(tt["roles"][r])}</p><div class="form__row">'
        f'<label>{E(tt["q"]["forn_nome"])}<input name="dt_forn_{r}_nome" maxlength="80" autocomplete="off"></label>'
        f'<label>{E(tt["q"]["forn_contatto"])}<input name="dt_forn_{r}_contatto" maxlength="80" autocomplete="off"></label>'
        f"</div></div>"
        for r in FORNITORI
    )
    more = (
        f'<details class="tech__more" data-for="{TECH_ALL}"><summary>{E(tt["groups"]["fornitori"])}</summary>'
        f'<div class="tech__body"><p class="tech__note">{E(tt["fornitori_intro"])}</p>{rows}</div></details>'
    )
    return (
        f'<fieldset class="tech" id="tech"><legend>{E(tt["title"])}</legend>'
        f'<p class="tech__intro">{E(tt["intro"])}</p>{groups}{more}</fieldset>'
    )


# ---------------------------------------------------------------- dati

def load_data(name):
    path = ROOT / "data" / f"{name}.json"
    if not path.exists():
        return []
    try:
        rows = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as err:
        raise SystemExit(f"data/{name}.json non è JSON valido (riga {err.lineno}, colonna {err.colno}): {err.msg}")
    if not isinstance(rows, list):
        raise SystemExit(f"data/{name}.json deve contenere un elenco [ ... ]")
    return [r for r in rows if isinstance(r, dict) and r.get("approvato") is True]


def local_path(p, field):
    """Percorso di un file del sito (senza slash iniziale, senza '..'), restituito con '/' davanti."""
    if not p:
        return None
    if not isinstance(p, str) or not re.fullmatch(r"assets/[A-Za-z0-9._/-]+", p) or ".." in p:
        raise SystemExit(f"percorso non valido in {field}: {p!r} (atteso es. assets/img/nome.jpg)")
    if not (ROOT / p).is_file():
        raise SystemExit(f"file mancante per {field}: {p}")
    return "/" + p


def safe_url(u, field):
    if not u:
        return None
    if not isinstance(u, str) or not re.fullmatch(r"https://[^\s\"'<>]+", u):
        raise SystemExit(f"link non valido in {field}: {u!r} (deve iniziare con https://)")
    return u


def tr(value, lang):
    """Valore tradotto: oggetto {it,de,fr,en} oppure testo semplice."""
    if isinstance(value, dict):
        return value.get(lang) or value.get(DEFAULT) or ""
    return value or ""


def jpeg_size(path):
    """Larghezza e altezza di un JPEG (legge solo l'intestazione)."""
    try:
        with open(path, "rb") as f:
            if f.read(2) != b"\xff\xd8":
                return None
            while True:
                b = f.read(1)
                while b and b != b"\xff":
                    b = f.read(1)
                while b == b"\xff":
                    b = f.read(1)
                if not b:
                    return None
                marker = b[0]
                if marker in (0xD8, 0x01) or 0xD0 <= marker <= 0xD7:
                    continue
                seg_len = struct.unpack(">H", f.read(2))[0]
                if marker in (0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF):
                    f.read(1)
                    h, w = struct.unpack(">HH", f.read(4))
                    return w, h
                f.seek(seg_len - 2, 1)
    except OSError:
        return None


def size_attrs(path, formato):
    size = jpeg_size(ROOT / path.lstrip("/")) if path and path.lower().endswith((".jpg", ".jpeg")) else None
    if not size:
        size = (1280, 720) if formato == "wide" else (720, 1280)
    return f'width="{size[0]}" height="{size[1]}"'


def gallery_html(rows, lang, t):
    figures, cats = [], []
    for i, r in enumerate(rows):
        cat = r.get("categoria")
        if cat not in CATEGORIES:
            raise SystemExit(f"galleria.json: categoria non valida {cat!r} (usare {', '.join(CATEGORIES)})")
        formato = r.get("formato", "wide")
        if formato not in FORMATS:
            raise SystemExit(f"galleria.json: formato non valido {formato!r} (usare wide, tall, reel)")
        if cat not in cats:
            cats.append(cat)
        alt = E(tr(r.get("alt"), lang))
        src = local_path(r.get("file"), "galleria.file")
        mod = {"wide": " gallery__item--wide", "reel": " gallery__item--reel", "tall": ""}[formato]
        if r.get("tipo") == "video":
            poster = local_path(r.get("poster"), "galleria.poster")
            poster_attr = f' poster="{poster}"' if poster else ""
            media = (
                f'<video muted loop playsinline preload="none"{poster_attr} data-autoplay aria-label="{alt}">'
                f'<source src="{src}" type="video/mp4"></video>'
            )
        else:
            media = f'<img src="{src}" alt="{alt}" loading="lazy" {size_attrs(src, formato)}>'
        figures.append(f'<figure class="gallery__item{mod} reveal" data-cat="{cat}">{media}</figure>')

    filters = ""
    if len(cats) > 1:
        btns = [f'<button class="filter" type="button" data-filter="all" aria-pressed="true">{E(t["work"]["filters"]["all"])}</button>']
        btns += [
            f'<button class="filter" type="button" data-filter="{c}" aria-pressed="false">{E(t["work"]["filters"][c])}</button>'
            for c in CATEGORIES if c in cats
        ]
        # I filtri servono solo con JavaScript: stanno in un <template> e main.js li inserisce.
        filters = (
            '<template id="gallery-filters"><div class="filters" role="group" aria-label="'
            + E(text(t, lang, "work.filters.label")) + '">' + "".join(btns) + "</div></template>"
        )
    if not figures:
        return f'<p class="empty">{E(t["work"]["lead"])}</p>'
    return filters + '<div class="gallery" id="gallery">' + "".join(figures) + "</div>"


def venues_html(rows, lang, t):
    if not rows:
        return f'<p class="empty">{E(t["venues"]["empty"])}</p>'
    names = t["regions"]["countries"]
    out = []
    for r in rows:
        paese = r.get("paese", "CH")
        if paese not in COUNTRIES:
            raise SystemExit(f"sale.json: paese non valido {paese!r}")
        place = ", ".join(x for x in [r.get("luogo") or "", names[paese.lower()]] if x)
        out.append(
            '<li class="venue">'
            f'<h3 class="venue__name">{E(r.get("nome", ""))}</h3>'
            f'<span class="venue__place">{E(place)}</span>'
            + (f'<span class="venue__type">{E(tr(r.get("tipo"), lang))}</span>' if r.get("tipo") else "")
            + "</li>"
        )
    return '<ul class="venues">' + "".join(out) + "</ul>"


def initials(name):
    words = [w for w in re.split(r"[\s\-_.]+", name) if w and w[0].isalnum()]
    return "".join(w[0] for w in words[:2]).upper() or "DJ"


def djs_html(rows, lang, t):
    if not rows:
        return f'<p class="empty">{E(t["djs"]["empty"])}</p>'
    out = []
    for r in rows:
        name = r.get("nome", "")
        foto = local_path(r.get("foto"), "dj.foto")
        link = safe_url(r.get("link"), "dj.link")
        logo = local_path(r.get("logo"), "dj.logo")
        if logo:
            # logo del DJ (PNG/WebP trasparente) centrato nello stesso riquadro della foto
            media = f'<div class="dj__logo"><img src="{logo}" alt="{E(name)}" loading="lazy" decoding="async"></div>'
        elif foto:
            media = f'<img class="dj__photo" src="{foto}" alt="" loading="lazy" width="800" height="1000">'
        elif r.get("nome_nel_riquadro"):
            # nessun logo disponibile: il nome scritto nel riquadro, stesso stile delle iniziali
            media = f'<div class="dj__initials dj__initials--name" aria-hidden="true">{E(name)}</div>'
        else:
            media = f'<div class="dj__initials" aria-hidden="true">{E(initials(name))}</div>'
        genre = tr(r.get("genere"), lang)
        out.append(
            '<li class="dj">' + media
            + f'<h3 class="dj__name">{E(name)}</h3>'
            + (f'<span class="dj__genre">{E(genre)}</span>' if genre else "")
            + (f'<a class="dj__link" href="{E(link)}" target="_blank" rel="noopener noreferrer">{E(t["djs"]["listen"])}'
               f'<span class="sr-only"> — {E(name)}</span></a>' if link else "")
            + "</li>"
        )
    return '<ul class="djs">' + "".join(out) + "</ul>"


def partners_html(rows, lang, t):
    if not rows:
        return f'<p class="empty">{E(t["partners"]["empty"])}</p>'
    out = []
    for r in rows:
        name = E(r.get("nome", ""))
        logo = local_path(r.get("logo"), "partner.logo")
        link = safe_url(r.get("link"), "partner.link")
        inner = f'<img src="{logo}" alt="{name}" loading="lazy">' if logo else name
        ruolo = tr(r.get("ruolo"), lang)
        if ruolo:
            # ruolo facoltativo sotto il logo (es. "Video team")
            inner += f'<span class="partner__role">{E(ruolo)}</span>'
        if link:
            out.append(f'<li><a class="partner" href="{E(link)}" target="_blank" rel="noopener noreferrer">{inner}</a></li>')
        else:
            out.append(f'<li><span class="partner">{inner}</span></li>')
    return '<ul class="partners">' + "".join(out) + "</ul>"


def regions_html(lang, t):
    r = t["regions"]
    main = (
        '<li class="region region--main">'
        f'<span class="region__note">{E(text(t, lang, "regions.main.note"))}</span>'
        f'<span class="region__name">{E(r["main"]["label"])}</span>'
        f'<span class="region__text">{E(r["main"]["text"])}</span></li>'
    )
    others = "".join(
        f'<li class="region"><span class="region__name">{E(r["countries"][c])}</span>'
        f'<span class="region__note">{E(r["onrequest"])}</span></li>'
        for c in ["it", "de", "fr"]
    )
    return f'<ul class="regions__list">{main}{others}</ul>'


def jsonld(lang, t):
    data = {
        "@context": "https://schema.org",
        "@type": "LocalBusiness",
        "name": "Meekon Displays",
        "url": SITE + base(lang),
        "image": SITE + "/assets/img/og-image.jpg",
        "logo": SITE + "/assets/img/logo.png",
        "description": t["meta"]["description"],
        "telephone": "+41799450000",
        "email": "info@meekondisplay.ch",
        "address": {
            "@type": "PostalAddress",
            "streetAddress": "Lukasstrasse 18",
            "postalCode": "9000",
            "addressLocality": "St. Gallen",
            "addressRegion": "SG",
            "addressCountry": "CH",
        },
        "sameAs": ["https://www.instagram.com/meekon_display/"],
        "areaServed": [{"@type": "Country", "name": n} for n in ["Switzerland", "Italy", "Germany", "France"]],
        "knowsLanguage": LANGS,
    }
    out = json.dumps(data, ensure_ascii=False, indent=2)
    # "</" non deve mai comparire dentro <script>; dentro le stringhe JSON anche { } = > &
    # diventano \\uXXXX (un testo del CMS con "{{" o "onclick=" non deve far fallire check_page)
    out = out.replace("<", "\\u003c").replace(">", "\\u003e").replace("&", "\\u0026").replace("=", "\\u003d")
    return re.sub(r'"(?:[^"\\]|\\.)*"',
                  lambda m: m.group(0).replace("{", "\\u007b").replace("}", "\\u007d"), out)


# ---------------------------------------------------------------- pagine

def build_context(lang, t, all_t, data):
    path = base(lang)
    ctx = {
        "lang": lang,
        "path": path,
        "thanks": f"{path}grazie.html",
        "privacy_href": f"{path}{PRIVACY}",
        "jsonld": jsonld(lang, t),
        "hreflang": "\n".join(
            [f'  <link rel="alternate" hreflang="{l}" href="{SITE}{base(l)}">' for l in LANGS]
            + [f'  <link rel="alternate" hreflang="x-default" href="{SITE}/">']
        ),
        "langlinks": "".join(
            f'<a href="{base(l)}" hreflang="{l}" lang="{l}" title="{all_t[l]["label"]}"'
            + (' aria-current="true"' if l == lang else "")
            + f">{l.upper()}</a>"
            for l in LANGS
        ),
        # suggerimento lingua: blocco <script type="application/json"> (non eseguito, ammesso dalla CSP)
        "langhints": json.dumps(
            {l: {"text": all_t[l]["hint"], "link": all_t[l]["hint_link"], "href": base(l)} for l in LANGS},
            ensure_ascii=False,
        ).replace("<", "\\u003c"),
        "faq.items": "".join(
            f"<details><summary>{q}</summary><p>{a}</p></details>" for q, a in t["faq"]["items"]
        ),
        "form.types": "".join(f"<option>{E(o)}</option>" for o in t["form"]["types"]),
        "form.countries": "".join(
            f'<option value="{c}"' + (" selected" if c == "CH" else "") + f">{E(n)}</option>"
            for c, n in zip(COUNTRIES, t["form"]["countries"])
        ),
        "form.chips": "".join(
            f'<label><input type="checkbox" name="servizi" value="{E(c)}"'
            + (f' data-tech="{CHIP_TECH[i]}"' if i < len(CHIP_TECH) and CHIP_TECH[i] else "")
            + f'><span>{E(c)}</span></label>'
            for i, c in enumerate(t["form"]["chips"])
        ),
        "form.tech": tech_html(t["tech"]),
        "regions.list": regions_html(lang, t),
        "gallery": gallery_html(data["galleria"], lang, t),
        "venues.list": venues_html(data["sale"], lang, t),
        "djs.list": djs_html(data["dj"], lang, t),
        "partners.list": partners_html(data["partner"], lang, t),
        "whatsapp.label": E(t["whatsapp"]["label"]),
    }
    for k in ["s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8"]:
        ctx[f"{k}.list"] = items(t[k]["list"])
    ctx["davos.list"] = items(t["davos"]["list"])
    return ctx


def render(template, ctx, t, lang):
    def sub(m):
        key = m.group(1).strip()
        if key in ctx:
            return str(ctx[key])
        return str(raw_text(t, lang, key))

    out = re.sub(r"\{\{\s*([\w.]+)\s*\}\}", sub, template)
    # <title> e meta non devono contenere tag
    out = re.sub(r"(<title>.*?</title>)", lambda m: re.sub(r"</?em>", "", m.group(1)), out)
    out = re.sub(r'(<meta [^>]*content=")([^"]*)(")', lambda m: m.group(1) + re.sub(r"</?em>", "", m.group(2)) + m.group(3), out)
    return out


THANKS = """<!doctype html>
<html lang="{lang}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{title} — Meekon Displays</title>
  <meta name="robots" content="noindex">
  <meta name="theme-color" content="#08090B">
  <link rel="icon" type="image/png" sizes="32x32" href="/assets/img/favicon-32.png">
  <link rel="stylesheet" href="/assets/css/style.css">
</head>
<body>
  <main class="thanks">
    <div>
      <img src="/assets/img/logo.png" alt="Meekon Displays" width="595" height="246">
      <p class="eyebrow">{eyebrow}</p>
      <h1>{title}</h1>
      <p>{text}</p>
      <a class="btn" href="{home}">{back}</a>
    </div>
  </main>
</body>
</html>
"""

# Pagina 404 unica (testi principali in italiano da src/i18n, link di ritorno in tutte e 4 le lingue).
NOT_FOUND = """<!doctype html>
<html lang="it">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{title} — Meekon Displays</title>
  <meta name="robots" content="noindex">
  <meta name="theme-color" content="#08090B">
  <link rel="icon" type="image/png" sizes="32x32" href="/assets/img/favicon-32.png">
  <link rel="stylesheet" href="/assets/css/style.css">
</head>
<body>
  <main class="thanks">
    <div>
      <img src="/assets/img/logo.png" alt="Meekon Displays" width="595" height="246">
      <p class="eyebrow">Errore 404</p>
      <h1>{title}</h1>
      <p>{text}</p>
      <a class="btn" href="/">{back}</a>
      <nav class="lang lang--footer" aria-label="Lingua">{langs}</nav>
    </div>
  </main>
</body>
</html>
"""


# ---------------------------------------------------------------- informativa privacy

PRIVACY = "privacy.html"

PRIVACY_PAGE = """<!doctype html>
<html lang="{lang}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{meta_title}</title>
  <meta name="description" content="{meta_description}">
  <link rel="canonical" href="{canonical}">
{hreflang}
  <meta name="theme-color" content="#08090B">
  <meta property="og:type" content="website">
  <meta property="og:locale" content="{locale}">
  <meta property="og:title" content="{meta_title}">
  <meta property="og:description" content="{meta_description}">
  <meta property="og:url" content="{canonical}">
  <link rel="icon" type="image/png" sizes="32x32" href="/assets/img/favicon-32.png">
  <link rel="icon" type="image/png" sizes="192x192" href="/assets/img/icon-192.png">
  <link rel="apple-touch-icon" href="/assets/img/apple-touch-icon.png">
  <link rel="stylesheet" href="/assets/css/style.css">
</head>
<body class="privacy-page">
  <a class="skip" href="#main">{skip}</a>

  <header class="nav is-scrolled">
    <div class="nav__inner wrap">
      <a class="nav__brand" href="{home}" aria-label="Meekon Displays">
        <img src="/assets/img/logo.png" alt="Meekon Displays" width="595" height="246">
      </a>
      <nav class="lang" aria-label="{lang_label}">{langlinks}</nav>
    </div>
  </header>

  <main id="main" class="section">
    <div class="wrap wrap--narrow">
      <article class="prose">
        <p class="prose__back"><a class="link-arrow" href="{home}">{back}</a></p>
        <header class="head head--left">
          <p class="eyebrow">{eyebrow}</p>
          <h1>{title}</h1>
          <p class="head__lead">{updated}</p>
        </header>
        <p class="prose__intro">{intro}</p>
        <nav class="prose__toc" aria-label="{title}">
          <ul>{toc}</ul>
        </nav>
{sections}
        <p class="prose__back"><a class="link-arrow" href="{home}">{back}</a></p>
      </article>
    </div>
  </main>

  <footer class="footer">
    <div class="wrap footer__inner">
      <img src="/assets/img/logo.png" alt="Meekon Displays" width="595" height="246" loading="lazy">
      <p class="footer__claim">{claim}</p>
      <nav class="lang lang--footer" aria-label="{lang_label}">{langlinks}</nav>
      <p class="footer__small">© {year} Meekon Displays · Lukasstrasse 18, 9000 St. Gallen · meekondisplay.ch · <a href="{privacy_href}" aria-current="page">{footer_privacy}</a></p>
    </div>
  </footer>
</body>
</html>
"""


def privacy_page(lang, t, all_t, year):
    pp = t["privacy_page"]
    sections = pp["sections"]
    if not isinstance(sections, list) or not sections:
        raise SystemExit(f"[{lang}] privacy_page.sections deve essere un elenco non vuoto")
    toc, body = [], []
    for i, sec in enumerate(sections, 1):
        anchor = f"s{i}"
        toc.append(f'<li><a href="#{anchor}">{E(sec["h"])}</a></li>')
        paras = "".join(
            "\n          <ul>" + "".join(f"<li>{E(li)}</li>" for li in p["ul"]) + "</ul>"
            if isinstance(p, dict) else f"\n          <p>{E(p)}</p>"
            for p in sec["p"]
        )
        body.append(
            f'        <section class="prose__section" id="{anchor}" aria-labelledby="{anchor}-h">\n'
            f'          <h2 id="{anchor}-h">{E(sec["h"])}</h2>{paras}\n        </section>'
        )
    hreflang = "\n".join(
        [f'  <link rel="alternate" hreflang="{l}" href="{SITE}{base(l)}{PRIVACY}">' for l in LANGS]
        + [f'  <link rel="alternate" hreflang="x-default" href="{SITE}/{PRIVACY}">']
    )
    langlinks = "".join(
        f'<a href="{base(l)}{PRIVACY}" hreflang="{l}" lang="{l}" title="{E(all_t[l]["label"])}"'
        + (' aria-current="true"' if l == lang else "")
        + f">{l.upper()}</a>"
        for l in LANGS
    )
    return PRIVACY_PAGE.format(
        lang=lang,
        locale=E(t.get("locale", "")),
        meta_title=E(pp["meta_title"]),
        meta_description=E(pp["meta_description"]),
        canonical=f"{SITE}{base(lang)}{PRIVACY}",
        hreflang=hreflang,
        skip=E(t["a11y"]["skip"]),
        lang_label=E(t["a11y"]["lang"]),
        home=base(lang),
        langlinks=langlinks,
        eyebrow=E(pp["eyebrow"]),
        title=E(pp["title"]),
        updated=E(pp["updated"]),
        intro=E(pp["intro"]),
        toc="".join(toc),
        sections="\n".join(body),
        back=E(pp["back"]),
        claim=E(re.sub(r"</?em>", "", t["footer"]["claim"])),
        year=year,
        privacy_href=f"{base(lang)}{PRIVACY}",
        footer_privacy=E(t["footer"]["privacy"]),
    )


def sitemap(today):
    urls = ""
    for page in ["", PRIVACY]:
        alts = "".join(
            f'\n    <xhtml:link rel="alternate" hreflang="{l}" href="{SITE}{base(l)}{page}"/>' for l in LANGS
        ) + f'\n    <xhtml:link rel="alternate" hreflang="x-default" href="{SITE}/{page}"/>'
        urls += "".join(
            f"\n  <url>\n    <loc>{SITE}{base(l)}{page}</loc>\n    <lastmod>{today}</lastmod>{alts}\n  </url>"
            for l in LANGS
        )
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" '
        'xmlns:xhtml="http://www.w3.org/1999/xhtml">' + urls + "\n</urlset>\n"
    )


def check_page(name, page):
    leftover = re.findall(r"\{\{.*?\}\}", page)
    if leftover:
        raise SystemExit(f"[{name}] segnaposto non risolti: {leftover}")
    # CSP: nessuno script inline eseguibile, nessun attributo style=
    for m in re.finditer(r"<script\b([^>]*)>", page):
        attrs = m.group(1)
        if "src=" not in attrs and 'type="application/ld+json"' not in attrs and 'type="application/json"' not in attrs:
            raise SystemExit(f"[{name}] script inline non ammesso dalla CSP")
    if re.search(r"\sstyle=", page) or re.search(r"\son[a-z]+=", page):
        raise SystemExit(f"[{name}] attributi style= / on...= non ammessi dalla CSP")


def default_texts(all_t):
    """Testi modificabili dal CMS con i valori dei file i18n (per l'area riservata)."""
    keys = sorted(k for k in string_keys(all_t[DEFAULT]) if not excluded_key(k))
    out = {}
    for k in keys:
        vals = {}
        for l in LANGS:
            try:
                v = lookup(all_t[l], k)
            except (KeyError, TypeError):
                v = ""
            vals[l] = v if isinstance(v, str) else ""
        out[k] = vals
    return {"testi": out, "con_em": sorted(EM_KEYS)}


def load_content():
    """Contenuti dal CMS (Supabase) se configurato, altrimenti None (si usano data/*.json)."""
    try:
        return load_cms(ROOT / "assets" / "media")
    except CmsError as err:
        raise SystemExit(f"Errore nella lettura dei contenuti dal CMS (Supabase): {err}. "
                         "Build interrotta: il sito pubblicato resta quello precedente.")


def main():
    template = (ROOT / "src" / "template.html").read_text(encoding="utf-8")
    all_t = {l: json.loads((ROOT / "src" / "i18n" / f"{l}.json").read_text(encoding="utf-8")) for l in LANGS}

    # testi predefiniti per l'editor dell'area riservata (prima delle sovrascritture del CMS)
    defaults = default_texts(all_t)
    (ROOT / "area-riservata" / "testi-predefiniti.json").write_text(
        json.dumps(defaults, ensure_ascii=False, indent=1, sort_keys=True) + "\n", encoding="utf-8")

    cms = load_content()
    if cms is None:
        source = "data/*.json"
        data = {n: load_data(n) for n in ["galleria", "sale", "dj", "partner"]}
        apply_cms_texts(all_t, {}, set())
    else:
        source = "CMS (Supabase)"
        data = {}
        for n in ["galleria", "sale", "dj", "partner"]:
            rows = cms.get(n)
            if not isinstance(rows, list):
                raise SystemExit(f"CMS: la sezione {n} non è un elenco")
            data[n] = [r for r in rows if isinstance(r, dict) and r.get("approvato") is True]
        apply_cms_texts(all_t, cms.get("testi"), set(defaults["testi"]))
    for lang in LANGS:
        t = all_t[lang]
        out_dir = ROOT if lang == DEFAULT else ROOT / lang
        out_dir.mkdir(exist_ok=True)
        page = render(template, build_context(lang, t, all_t, data), t, lang)
        check_page(lang, page)
        (out_dir / "index.html").write_text(page, encoding="utf-8")
        thanks = THANKS.format(lang=lang, home=base(lang),
                               **{k: raw_text(t, lang, f"thanks.{k}") for k in t["thanks"]})
        check_page(f"{lang}/grazie", thanks)
        (out_dir / "grazie.html").write_text(thanks, encoding="utf-8")
        privacy = privacy_page(lang, t, all_t, datetime.date.today().year)
        check_page(f"{lang}/privacy", privacy)
        (out_dir / PRIVACY).write_text(privacy, encoding="utf-8")
        print(f"ok  {lang}  ->  {out_dir.relative_to(ROOT) / 'index.html'}")

    langs = "".join(
        f'<a href="{base(l)}" hreflang="{l}" lang="{l}" title="{E(all_t[l]["notfound"]["back"])}">{E(all_t[l]["label"])}</a>'
        for l in LANGS
    )
    nf_it = all_t[DEFAULT]["notfound"]
    nf = NOT_FOUND.format(langs=langs, title=E(nf_it["title"]), text=E(nf_it["text"]), back=E(nf_it["back"]))
    check_page("404", nf)
    (ROOT / "404.html").write_text(nf, encoding="utf-8")
    (ROOT / "sitemap.xml").write_text(sitemap(datetime.date.today().isoformat()), encoding="utf-8")
    print("ok  404.html, sitemap.xml")
    print(f"    contenuti da {source}; testi modificati dal CMS: "
          f"{sum(len(v) for v in CMS_KEYS.values())}")
    print(f"    pubblicati: galleria {len(data['galleria'])}, sale {len(data['sale'])}, "
          f"dj {len(data['dj'])}, partner {len(data['partner'])}")
    for key in sorted(WARN):
        print(f"!!  testo mancante in src/i18n: {key} (usato il testo di riserva di build.py)")


if __name__ == "__main__":
    main()
