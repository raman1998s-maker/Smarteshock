"""Test di scripts/cms_fetch.py con un Supabase finto su 127.0.0.1 (nessuna rete esterna).

Esecuzione: python3 -I tests/api/cms_fetch_test.py   (lanciato anche da npm test)
"""
import sys
sys.dont_write_bytecode = True

import hashlib
import importlib.util
import json
import os
import tempfile
import threading
import unittest
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("cms_fetch", ROOT / "scripts" / "cms_fetch.py")
cms = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cms)

KEY = "chiave-finta-di-test"
U1 = "10000000-0000-4000-8000-000000000001"
U2 = "10000000-0000-4000-8000-000000000002"
U3 = "10000000-0000-4000-8000-000000000003"
U4 = "10000000-0000-4000-8000-000000000004"
U5 = "10000000-0000-4000-8000-000000000005"
JPG = b"\xff\xd8\xff\xe0" + b"jpeg-finto" * 10
PNG = b"\x89PNG\r\n\x1a\n" + b"png-finto"
MP4 = b"\x00\x00\x00\x18ftypmp42" + b"video-finto"

TABLES = {
    "media_galleria": [
        {"file_path": f"galleria/{U1}.jpg", "poster_path": None, "tipo": "foto", "categoria": "feste", "formato": "wide",
         "alt_it": "Luci <b>sulla</b> pista", "alt_de": "Licht", "alt_fr": None, "alt_en": "", "ordine": 10, "pubblicato": True},
        {"file_path": f"galleria/{U2}.mp4", "poster_path": f"galleria/{U3}.jpg", "tipo": "video", "categoria": "palco",
         "formato": "reel", "alt_it": "Video", "ordine": 20, "pubblicato": True},
        # bozza restituita per errore: va scartata
        {"file_path": f"galleria/{U4}.jpg", "tipo": "foto", "categoria": "feste", "formato": "wide", "alt_it": "Bozza", "pubblicato": False},
        # percorso fuori dal bucket: scartato
        {"file_path": "../../etc/passwd.jpg", "tipo": "foto", "categoria": "feste", "formato": "wide", "alt_it": "X", "pubblicato": True},
        # contenuto che non è un'immagine: scartato
        {"file_path": f"galleria/{U5}.jpg", "tipo": "foto", "categoria": "feste", "formato": "wide", "alt_it": "HTML", "pubblicato": True},
    ],
    "sale": [
        {"nome": "Sala Uno", "luogo": "Lugano", "paese": "CH", "tipo_it": "Sala", "tipo_de": None, "pubblicato": True},
        {"nome": "Sala US", "luogo": "", "paese": "US", "pubblicato": True},
    ],
    "dj": [
        {"nome": "DJ Uno", "genere_it": "House", "foto_path": f"dj/{U1}.png", "link": "https://example.com/dj", "pubblicato": True},
        {"nome": "DJ Cattivo", "link": "javascript:alert(1)", "pubblicato": True},
    ],
    "partner": [{"nome": "Partner", "logo_path": None, "link": None, "pubblicato": True}],
    "testi": [
        {"chiave": "hero.title", "it": "Nuovo titolo", "de": "", "fr": None, "en": "New title"},
        {"chiave": "privacy.note", "it": "Non ammesso"},
        {"chiave": "chiave.inesistente", "it": "X"},
        {"chiave": "s1.list", "it": "lista: non ammessa"},
    ],
}
FILES = {
    f"galleria/{U1}.jpg": JPG,
    f"galleria/{U2}.mp4": MP4,
    f"galleria/{U3}.jpg": JPG,
    f"galleria/{U5}.jpg": b"<html>non un'immagine</html>",
    f"dj/{U1}.png": PNG,
}


class FakeSupabase(BaseHTTPRequestHandler):
    requests = []

    def log_message(self, *args):
        pass

    def _send(self, status, body, ctype="application/json"):
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        FakeSupabase.requests.append((self.path, {k.lower(): v for k, v in self.headers.items()}))
        if self.headers.get("apikey") != KEY:
            return self._send(401, b'{"message":"no key"}')
        u = urllib.parse.urlsplit(self.path)
        if u.path.startswith("/rest/v1/"):
            table = u.path[len("/rest/v1/"):]
            return self._send(200, json.dumps(TABLES.get(table, [])).encode())
        prefix = "/storage/v1/object/authenticated/media/"
        if u.path.startswith(prefix):
            data = FILES.get(urllib.parse.unquote(u.path[len(prefix):]))
            if data is None:
                return self._send(404, b'{"statusCode":"404"}')
            return self._send(200, data, "application/octet-stream")
        return self._send(404, b"{}")


class LoadCmsTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), FakeSupabase)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.base = f"http://127.0.0.1:{cls.server.server_address[1]}"

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()

    def setUp(self):
        self._env = {k: os.environ.get(k) for k in ("SUPABASE_URL", "SUPABASE_ANON_KEY")}
        os.environ["SUPABASE_URL"] = self.base
        os.environ["SUPABASE_ANON_KEY"] = KEY
        FakeSupabase.requests = []
        self.tmp = tempfile.TemporaryDirectory()
        self.dest = Path(self.tmp.name) / "assets" / "media"

    def tearDown(self):
        for k, v in self._env.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
        self.tmp.cleanup()

    def test_senza_variabili_restituisce_none(self):
        os.environ.pop("SUPABASE_URL")
        self.assertIsNone(cms.load_cms(self.dest))
        os.environ["SUPABASE_URL"] = self.base
        os.environ["SUPABASE_ANON_KEY"] = ""
        self.assertIsNone(cms.load_cms(self.dest))
        self.assertEqual(FakeSupabase.requests, [])

    def test_url_non_https_rifiutato(self):
        os.environ["SUPABASE_URL"] = "http://example.com"
        with self.assertRaises(cms.CmsError):
            cms.load_cms(self.dest)

    def test_dati_normalizzati_e_media_scaricati(self):
        out = cms.load_cms(self.dest)
        self.assertIsNotNone(out)
        jpg_name = hashlib.sha256(JPG).hexdigest() + ".jpg"

        gal = out["galleria"]
        self.assertEqual(len(gal), 2, gal)  # bozza, percorso esterno e falso jpg scartati
        self.assertEqual(gal[0]["file"], f"assets/media/{jpg_name}")
        self.assertEqual(gal[0]["alt"], {"it": "Luci <b>sulla</b> pista", "de": "Licht", "fr": "Luci <b>sulla</b> pista",
                                         "en": "Luci <b>sulla</b> pista"})  # l'escape lo fa build.py
        self.assertTrue(gal[0]["approvato"])
        self.assertEqual(gal[1]["tipo"], "video")
        self.assertEqual(gal[1]["poster"], f"assets/media/{jpg_name}")
        self.assertTrue(gal[1]["file"].endswith(".mp4"))

        files = sorted(p.name for p in self.dest.iterdir())
        self.assertEqual(len(files), 3, files)  # jpg (deduplicato), mp4, png
        self.assertEqual((self.dest / jpg_name).read_bytes(), JPG)
        self.assertFalse(any(n.endswith(".tmp") for n in files))

        self.assertEqual(out["sale"], [{"nome": "Sala Uno", "luogo": "Lugano", "paese": "CH",
                                        "tipo": {"it": "Sala", "de": "Sala", "fr": "Sala", "en": "Sala"}, "approvato": True}])
        self.assertEqual(len(out["dj"]), 1)
        self.assertEqual(out["dj"][0]["link"], "https://example.com/dj")
        self.assertTrue(out["dj"][0]["foto"].endswith(".png"))
        self.assertEqual(out["partner"], [{"nome": "Partner", "logo": None, "link": None, "approvato": True}])
        self.assertEqual(out["testi"], {"hero.title": {"it": "Nuovo titolo", "en": "New title"}})

    def test_richieste_solo_pubblicate_e_chiave_solo_negli_header(self):
        cms.load_cms(self.dest)
        for path, headers in FakeSupabase.requests:
            self.assertNotIn(KEY, path)
            self.assertEqual(headers.get("apikey"), KEY)
            self.assertNotIn("authorization", headers)  # chiave non-JWT: solo apikey
            if path.startswith("/rest/v1/") and not path.startswith("/rest/v1/testi"):
                self.assertIn("pubblicato=eq.true", path)
        storage = [p for p, _ in FakeSupabase.requests if p.startswith("/storage/")]
        self.assertFalse(any(U4 in p for p in storage), "le bozze non vanno scaricate")
        self.assertFalse(any("passwd" in p for p in storage))

    def test_file_troppo_grande_scartato(self):
        old = dict(cms.MAX_BYTES)
        cms.MAX_BYTES["jpg"] = 10
        try:
            out = cms.load_cms(self.dest)
        finally:
            cms.MAX_BYTES.clear()
            cms.MAX_BYTES.update(old)
        self.assertEqual([g["tipo"] for g in out["galleria"]], [])  # foto troppo grande; video senza poster valido

    def test_supabase_irraggiungibile_solleva_errore_senza_chiave(self):
        os.environ["SUPABASE_URL"] = "http://127.0.0.1:9"
        with self.assertRaises(cms.CmsError) as ctx:
            cms.load_cms(self.dest)
        self.assertNotIn(KEY, str(ctx.exception))


if __name__ == "__main__":
    unittest.main(verbosity=1)
