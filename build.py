#!/usr/bin/env python3
"""Genera le pagine statiche del sito nelle 4 lingue.

Uso:  python3 build.py

Legge  src/template.html,  src/i18n/<lingua>.json  e  data/*.json  e scrive:
  index.html, grazie.html            (italiano, lingua principale)
  de/index.html, de/grazie.html      (tedesco)
  fr/..., en/...                     (francese, inglese)
  404.html                           (pagina "non trovata", noindex)
  sitemap.xml                        (4 lingue con hreflang)

I testi si modificano SOLO nei file JSON; poi si rilancia questo script.
Dei file in data/ si pubblicano solo le voci con "approvato": true.
"""
import datetime
import html
import json
import re
import struct
from pathlib import Path

ROOT = Path(__file__).parent
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

E = html.escape  # escape di testi e attributi (quote=True di default)


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
        media = (
            f'<img class="dj__photo" src="{foto}" alt="" loading="lazy" width="800" height="1000">'
            if foto else f'<div class="dj__initials" aria-hidden="true">{E(initials(name))}</div>'
        )
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
        "email": "meekon.display@gmail.com",
        "sameAs": ["https://www.instagram.com/meekon_display/"],
        "areaServed": [{"@type": "Country", "name": n} for n in ["Switzerland", "Italy", "Germany", "France"]],
        "knowsLanguage": LANGS,
    }
    # "</" non deve mai comparire dentro <script>
    return json.dumps(data, ensure_ascii=False, indent=2).replace("<", "\\u003c")


# ---------------------------------------------------------------- pagine

def build_context(lang, t, all_t, data):
    path = base(lang)
    ctx = {
        "lang": lang,
        "path": path,
        "thanks": f"{path}grazie.html",
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
            f'<label><input type="checkbox" name="servizi" value="{E(c)}"><span>{E(c)}</span></label>'
            for c in t["form"]["chips"]
        ),
        "regions.list": regions_html(lang, t),
        "gallery": gallery_html(data["galleria"], lang, t),
        "venues.list": venues_html(data["sale"], lang, t),
        "djs.list": djs_html(data["dj"], lang, t),
        "partners.list": partners_html(data["partner"], lang, t),
        "whatsapp.label": E(t["whatsapp"]["label"]),
    }
    for k in ["s1", "s2", "s3", "s4", "s5", "s6"]:
        ctx[f"{k}.list"] = items(t[k]["list"])
    ctx["davos.list"] = items(t["davos"]["list"])
    return ctx


def render(template, ctx, t):
    def sub(m):
        key = m.group(1).strip()
        if key in ctx:
            return str(ctx[key])
        return str(lookup(t, key))

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


def sitemap(today):
    alts = "".join(
        f'\n    <xhtml:link rel="alternate" hreflang="{l}" href="{SITE}{base(l)}"/>' for l in LANGS
    ) + f'\n    <xhtml:link rel="alternate" hreflang="x-default" href="{SITE}/"/>'
    urls = "".join(
        f"\n  <url>\n    <loc>{SITE}{base(l)}</loc>\n    <lastmod>{today}</lastmod>{alts}\n  </url>" for l in LANGS
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


def main():
    template = (ROOT / "src" / "template.html").read_text(encoding="utf-8")
    all_t = {l: json.loads((ROOT / "src" / "i18n" / f"{l}.json").read_text(encoding="utf-8")) for l in LANGS}
    data = {n: load_data(n) for n in ["galleria", "sale", "dj", "partner"]}
    for lang in LANGS:
        t = all_t[lang]
        out_dir = ROOT if lang == DEFAULT else ROOT / lang
        out_dir.mkdir(exist_ok=True)
        page = render(template, build_context(lang, t, all_t, data), t)
        check_page(lang, page)
        (out_dir / "index.html").write_text(page, encoding="utf-8")
        thanks = THANKS.format(lang=lang, home=base(lang), **t["thanks"])
        check_page(f"{lang}/grazie", thanks)
        (out_dir / "grazie.html").write_text(thanks, encoding="utf-8")
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
    print(f"    pubblicati: galleria {len(data['galleria'])}, sale {len(data['sale'])}, "
          f"dj {len(data['dj'])}, partner {len(data['partner'])}")
    for key in sorted(WARN):
        print(f"!!  testo mancante in src/i18n: {key} (usato il testo di riserva di build.py)")


if __name__ == "__main__":
    main()
