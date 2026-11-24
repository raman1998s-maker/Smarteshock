#!/usr/bin/env python3
"""Genera le pagine statiche del sito nelle 4 lingue.

Uso:  python3 build.py

Legge  src/template.html  e  src/i18n/<lingua>.json  e scrive:
  index.html, grazie.html            (italiano, lingua principale)
  de/index.html, de/grazie.html      (tedesco)
  fr/..., en/...                     (francese, inglese)

I testi si modificano SOLO nei file JSON; poi si rilancia questo script.
"""
import html
import json
import re
from pathlib import Path

ROOT = Path(__file__).parent
LANGS = ["it", "de", "fr", "en"]  # il primo è la lingua principale (alla radice del sito)
DEFAULT = LANGS[0]


def base(lang):
    return "/" if lang == DEFAULT else f"/{lang}/"


def lookup(data, key):
    cur = data
    for part in key.split("."):
        cur = cur[part]
    return cur


def items(values):
    return "".join(f"<li>{v}</li>" for v in values)


def build_context(lang, t, all_t):
    path = base(lang)
    ctx = {
        "lang": lang,
        "path": path,
        "thanks": f"{path}grazie.html",
        "hreflang": "\n".join(
            [f'  <link rel="alternate" hreflang="{l}" href="https://meekondisplay.ch{base(l)}">' for l in LANGS]
            + [f'  <link rel="alternate" hreflang="x-default" href="https://meekondisplay.ch/">']
        ),
        "langlinks": "".join(
            f'<a href="{base(l)}" hreflang="{l}" lang="{l}" title="{all_t[l]["label"]}"'
            + (' aria-current="true"' if l == lang else "")
            + f">{l.upper()}</a>"
            for l in LANGS
        ),
        "langhints": json.dumps(
            {l: {"text": all_t[l]["hint"], "link": all_t[l]["hint_link"], "href": base(l)} for l in LANGS},
            ensure_ascii=False,
        ),
        "faq.items": "".join(
            f"<details><summary>{q}</summary><p>{a}</p></details>" for q, a in t["faq"]["items"]
        ),
        "form.types": "".join(f"<option>{o}</option>" for o in t["form"]["types"]),
        "form.chips": "".join(
            f'<label><input type="checkbox" name="servizi" value="{html.escape(c)}"><span>{c}</span></label>'
            for c in t["form"]["chips"]
        ),
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
    return out


THANKS = """<!doctype html>
<html lang="{lang}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{title} — Meekon Displays</title>
  <meta name="robots" content="noindex">
  <link rel="icon" type="image/png" sizes="32x32" href="/assets/img/favicon-32.png">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;1,400;1,500&family=Manrope:wght@300;400;500;600&display=swap" rel="stylesheet">
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


def main():
    template = (ROOT / "src" / "template.html").read_text(encoding="utf-8")
    all_t = {l: json.loads((ROOT / "src" / "i18n" / f"{l}.json").read_text(encoding="utf-8")) for l in LANGS}
    for lang in LANGS:
        t = all_t[lang]
        out_dir = ROOT if lang == DEFAULT else ROOT / lang
        out_dir.mkdir(exist_ok=True)
        page = render(template, build_context(lang, t, all_t), t)
        leftover = re.findall(r"\{\{.*?\}\}", page)
        if leftover:
            raise SystemExit(f"[{lang}] segnaposto non risolti: {leftover}")
        (out_dir / "index.html").write_text(page, encoding="utf-8")
        (out_dir / "grazie.html").write_text(
            THANKS.format(lang=lang, home=base(lang), **t["thanks"]), encoding="utf-8"
        )
        print(f"ok  {lang}  ->  {out_dir.relative_to(ROOT) / 'index.html'}")


if __name__ == "__main__":
    main()
