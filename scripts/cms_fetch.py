"""Lettura dei contenuti pubblicati dal CMS (Supabase) durante la build.

Solo libreria standard. Usato da build.py:

    from scripts.cms_fetch import load_cms, CmsError
    cms = load_cms(ROOT / "assets" / "media")   # None se Supabase non è configurato

Se nell'ambiente ci sono SUPABASE_URL e SUPABASE_ANON_KEY:
  * legge via REST (ruolo anon) le righe PUBBLICATE di media_galleria, sale, dj,
    partner (la RLS restituisce solo quelle; in più si filtra pubblicato=eq.true)
    e tutte le righe di testi;
  * scarica i file referenziati dal bucket privato "media": anon può leggere
    SOLO i file collegati a righe pubblicate (policy storage "media_anon_pubblicati",
    migrazione 0003). Nessun URL firmato, nessuna chiave in più;
  * salva i file in dest_media_dir con nome = sha256 del contenuto + estensione;
  * restituisce i dati nello stesso formato di data/*.json (con "approvato": True)
    più "testi": {chiave: {lingua: testo}} (solo lingue non vuote, solo chiavi
    di testo esistenti in src/i18n/it.json e non escluse).

Altrimenti restituisce None (sviluppo locale: build.py usa data/*.json).
Qualsiasi errore di rete o risposta inattesa solleva CmsError (la build fallisce
e Netlify continua a servire la versione precedente). I messaggi d'errore non
contengono mai la chiave.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import sys
import tempfile
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

__all__ = ["load_cms", "CmsError"]

LANGS = ("it", "de", "fr", "en")
COUNTRIES = ("CH", "IT", "DE", "FR")
CATEGORIES = ("matrimoni", "aziende", "feste", "palco")
FORMATS = ("wide", "tall", "reel")
BUCKET = "media"

_UUID = r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"
MEDIA_PATH_RE = re.compile(rf"(?:galleria|dj|partner)/{_UUID}\.(?:jpg|png|webp|mp4)")
IMAGE_PATH_RE = re.compile(rf"(?:galleria|dj|partner)/{_UUID}\.(?:jpg|png|webp)")
LINK_RE = re.compile(r"https://[^\s\"'<>\\]+")
KEY_RE = re.compile(r"[a-z0-9_]+(?:\.[a-z0-9_]+)*")

# Uguale a CHIAVI_ESCLUSE in netlify/functions/_lib/cms.js
EXCLUDED_KEYS = ("locale", "label", "hint", "hint_link", "privacy", "privacy_page", "form.note", "contact.phone", "whatsapp")

MAX_BYTES = {"jpg": 10 * 1024 * 1024, "png": 10 * 1024 * 1024, "webp": 10 * 1024 * 1024, "mp4": 200 * 1024 * 1024}
MAX_JSON_BYTES = 5 * 1024 * 1024
MAX_ROWS = 1000
TIMEOUT_S = 20

ROOT = Path(__file__).resolve().parent.parent


class CmsError(RuntimeError):
    """Errore nella lettura dal CMS (messaggio senza dati sensibili)."""


class _HttpStatusError(CmsError):
    def __init__(self, code):
        super().__init__(f"risposta HTTP {code} da Supabase")
        self.code = code


class _TooLargeError(CmsError):
    def __init__(self):
        super().__init__("risposta troppo grande")


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    # Nessun redirect: la chiave non deve mai essere inviata a un altro host.
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise CmsError(f"redirect inatteso ({code})")


_OPENER = urllib.request.build_opener(_NoRedirect)


def _warn(msg):
    print(f"[cms] attenzione: {msg}", file=sys.stderr)


def _config():
    url = (os.environ.get("SUPABASE_URL") or "").strip()
    key = (os.environ.get("SUPABASE_ANON_KEY") or "").strip()
    if not url or not key:
        return None
    p = urllib.parse.urlsplit(url)
    local = p.hostname in ("localhost", "127.0.0.1")
    if p.scheme != "https" and not (local and p.scheme == "http"):
        raise CmsError("SUPABASE_URL deve essere https")
    if not p.hostname or p.username or p.password:
        raise CmsError("SUPABASE_URL non valida")
    if any(c in key for c in "\r\n"):
        raise CmsError("SUPABASE_ANON_KEY non valida")
    return f"{p.scheme}://{p.netloc}", key


def _headers(key, accept="application/json"):
    h = {"apikey": key, "Accept": accept, "User-Agent": "meekon-build"}
    # Chiave anon "legacy" (JWT): va anche in Authorization. Le nuove chiavi
    # publishable (sb_publishable_...) si inviano solo come apikey.
    if key.startswith("eyJ"):
        h["Authorization"] = f"Bearer {key}"
    return h


def _get(url, key, max_bytes, accept="application/json"):
    req = urllib.request.Request(url, headers=_headers(key, accept), method="GET")
    try:
        with _OPENER.open(req, timeout=TIMEOUT_S) as res:
            declared = res.headers.get("Content-Length")
            if declared and declared.isdigit() and int(declared) > max_bytes:
                raise _TooLargeError()
            data = res.read(max_bytes + 1)
            if len(data) > max_bytes:
                raise _TooLargeError()
            return data
    except urllib.error.HTTPError as err:
        raise _HttpStatusError(err.code) from None
    except (urllib.error.URLError, TimeoutError, OSError):
        raise CmsError("Supabase non raggiungibile") from None


def _rest(base, key, table, columns, published=True, order="ordine.asc"):
    q = {"select": ",".join(columns), "limit": str(MAX_ROWS)}
    if published:
        q["pubblicato"] = "eq.true"
    if order:
        q["order"] = order
    url = f"{base}/rest/v1/{table}?{urllib.parse.urlencode(q, safe=',.')}"
    try:
        rows = json.loads(_get(url, key, MAX_JSON_BYTES).decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        raise CmsError(f"risposta non valida per {table}") from None
    if not isinstance(rows, list):
        raise CmsError(f"risposta non valida per {table}")
    return [r for r in rows if isinstance(r, dict) and (not published or r.get("pubblicato") is True)]


def _text(v, maxlen):
    if not isinstance(v, str):
        return None
    s = v.strip()
    if not s or len(s) > maxlen or re.search(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", s):
        return None
    return s


def _langs(row, prefix, maxlen):
    """{it,de,fr,en} da colonne <prefix>_it ...; lingue vuote → testo italiano."""
    it = _text(row.get(f"{prefix}_it"), maxlen)
    out = {}
    for lang in LANGS:
        out[lang] = _text(row.get(f"{prefix}_{lang}"), maxlen) or it or ""
    return out


def _link(v):
    if v is None:
        return None
    if not isinstance(v, str) or len(v) > 500 or not LINK_RE.fullmatch(v):
        raise ValueError("link non valido")
    p = urllib.parse.urlsplit(v)
    if p.scheme != "https" or not p.hostname or p.username or p.password:
        raise ValueError("link non valido")
    return v


def _check_magic(data, ext):
    if ext == "jpg":
        return data[:3] == b"\xff\xd8\xff"
    if ext == "png":
        return data[:8] == b"\x89PNG\r\n\x1a\n"
    if ext == "webp":
        return data[:4] == b"RIFF" and data[8:12] == b"WEBP"
    if ext == "mp4":
        return data[4:8] == b"ftyp"
    return False


class _Downloader:
    def __init__(self, base, key, dest, public_prefix):
        self.base, self.key = base, key
        self.dest = Path(dest).resolve()
        self.prefix = public_prefix.strip("/")
        self.cache = {}

    def get(self, path, pattern):
        """Scarica un file del bucket e restituisce il percorso pubblico (es. assets/media/<sha>.jpg)."""
        if not isinstance(path, str) or not pattern.fullmatch(path):
            raise ValueError("percorso media non valido")
        if path in self.cache:
            return self.cache[path]
        ext = path.rsplit(".", 1)[1]
        url = f"{self.base}/storage/v1/object/authenticated/{BUCKET}/{urllib.parse.quote(path, safe='/')}"
        try:
            data = _get(url, self.key, MAX_BYTES[ext], accept="*/*")
        except _TooLargeError:
            raise ValueError("file troppo grande") from None
        except _HttpStatusError as err:
            if 400 <= err.code < 500:  # file mancante o non leggibile: si salta la voce
                raise ValueError(f"file non disponibile (HTTP {err.code})") from None
            raise
        if not data or not _check_magic(data, ext):
            raise ValueError("contenuto del file non corrispondente al tipo")
        name = f"{hashlib.sha256(data).hexdigest()}.{ext}"
        target = (self.dest / name).resolve()
        if target.parent != self.dest:  # difesa in profondità: nessun percorso fuori cartella
            raise CmsError("percorso di destinazione non valido")
        if not target.is_file():
            fd, tmp = tempfile.mkstemp(dir=self.dest, prefix=".cms-", suffix=".tmp")
            try:
                with os.fdopen(fd, "wb") as fh:
                    fh.write(data)
                os.replace(tmp, target)
            except BaseException:
                try:
                    os.unlink(tmp)
                except OSError:
                    pass
                raise
        public = f"{self.prefix}/{name}" if self.prefix else name
        self.cache[path] = public
        return public


def _i18n_keys(i18n_path):
    try:
        data = json.loads(Path(i18n_path).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        raise CmsError("impossibile leggere src/i18n/it.json") from None
    out = set()

    def walk(o, prefix=""):
        for k, v in o.items():
            key = f"{prefix}.{k}" if prefix else k
            if isinstance(v, str):
                out.add(key)
            elif isinstance(v, dict):
                walk(v, key)

    if isinstance(data, dict):
        walk(data)
    return out


def _excluded(key):
    return any(key == x or key.startswith(x + ".") for x in EXCLUDED_KEYS)


def load_cms(dest_media_dir, public_prefix="assets/media", i18n_path=None):
    """Legge i contenuti pubblicati. Restituisce None se Supabase non è configurato.

    dest_media_dir: cartella in cui salvare i media (creata se manca).
    public_prefix:  prefisso dei percorsi restituiti (relativo alla radice del sito).
    Restituisce {"galleria": [...], "sale": [...], "dj": [...], "partner": [...], "testi": {...}}.
    """
    cfg = _config()
    if cfg is None:
        return None
    base, key = cfg
    dest = Path(dest_media_dir)
    dest.mkdir(parents=True, exist_ok=True)
    dl = _Downloader(base, key, dest, public_prefix)

    def each(rows, label, convert):
        out = []
        for i, row in enumerate(rows):
            try:
                out.append(convert(row))
            except ValueError as err:
                _warn(f"{label} #{i + 1} ignorato: {err}")
        return out

    # --- galleria
    def galleria(r):
        tipo, cat, fmt = r.get("tipo"), r.get("categoria"), r.get("formato")
        if tipo not in ("foto", "video") or cat not in CATEGORIES or fmt not in FORMATS:
            raise ValueError("tipo, categoria o formato non validi")
        if (tipo == "video") != str(r.get("file_path", "")).endswith(".mp4"):
            raise ValueError("tipo e file non coerenti")
        alt = _langs(r, "alt", 300)
        if not alt["it"]:
            raise ValueError("testo alternativo mancante")
        item = {"file": dl.get(r.get("file_path"), MEDIA_PATH_RE), "tipo": tipo, "categoria": cat, "formato": fmt, "alt": alt}
        if tipo == "video" and r.get("poster_path"):
            item["poster"] = dl.get(r.get("poster_path"), IMAGE_PATH_RE)
        item["approvato"] = True
        return item

    # --- sale
    def sala(r):
        nome = _text(r.get("nome"), 160)
        if not nome or r.get("paese") not in COUNTRIES:
            raise ValueError("nome o paese non validi")
        return {"nome": nome, "luogo": _text(r.get("luogo"), 160) or "", "paese": r["paese"],
                "tipo": _langs(r, "tipo", 120), "approvato": True}

    # --- dj
    def dj(r):
        nome = _text(r.get("nome"), 120)
        if not nome:
            raise ValueError("nome mancante")
        foto = dl.get(r["foto_path"], IMAGE_PATH_RE) if r.get("foto_path") else None
        return {"nome": nome, "genere": _langs(r, "genere", 120), "foto": foto, "link": _link(r.get("link")), "approvato": True}

    # --- partner
    def partner(r):
        nome = _text(r.get("nome"), 120)
        if not nome:
            raise ValueError("nome mancante")
        logo = dl.get(r["logo_path"], IMAGE_PATH_RE) if r.get("logo_path") else None
        return {"nome": nome, "logo": logo, "link": _link(r.get("link")), "approvato": True}

    result = {
        "galleria": each(_rest(base, key, "media_galleria",
                               ["file_path", "poster_path", "tipo", "categoria", "formato",
                                "alt_it", "alt_de", "alt_fr", "alt_en", "ordine", "pubblicato"]), "galleria", galleria),
        "sale": each(_rest(base, key, "sale",
                           ["nome", "luogo", "paese", "tipo_it", "tipo_de", "tipo_fr", "tipo_en", "ordine", "pubblicato"]), "sala", sala),
        "dj": each(_rest(base, key, "dj",
                         ["nome", "genere_it", "genere_de", "genere_fr", "genere_en", "foto_path", "link", "ordine", "pubblicato"]), "dj", dj),
        "partner": each(_rest(base, key, "partner", ["nome", "logo_path", "link", "ordine", "pubblicato"]), "partner", partner),
    }

    # --- testi
    allowed = _i18n_keys(i18n_path or ROOT / "src" / "i18n" / "it.json")
    testi = {}
    for r in _rest(base, key, "testi", ["chiave", "it", "de", "fr", "en"], published=False, order="chiave.asc"):
        k = r.get("chiave")
        if not isinstance(k, str) or len(k) > 120 or not KEY_RE.fullmatch(k) or k not in allowed or _excluded(k):
            _warn("testo con chiave non ammessa ignorato")
            continue
        vals = {lang: v for lang in LANGS if (v := _text(r.get(lang), 2000))}
        if vals:
            testi[k] = vals
    result["testi"] = testi
    return result


if __name__ == "__main__":  # prova manuale: python3 scripts/cms_fetch.py <cartella>
    out = load_cms(sys.argv[1] if len(sys.argv) > 1 else "assets/media")
    if out is None:
        print("SUPABASE_URL / SUPABASE_ANON_KEY non impostate: nessun dato dal CMS")
    else:
        print({k: len(v) for k, v in out.items()})
