#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Faux serveur PharmAgent, pour éprouver un agent réellement installé.

Il parle le même protocole que le vrai serveur, sert le fichier de l'agent et
une copie de l'ERP, puis confie à l'agent un bon de livraison à saisir. Il écrit
le compte rendu reçu dans « resultat.json » : c'est la preuve que la chaîne
complète a fonctionné sur cette machine — appairage, réception de la tâche,
remplissage de l'ERP, compte rendu.

    python tests/fake_server.py --port 8099 --out C:\\chemin\\resultat.json
"""
import argparse
import json
import pathlib
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = pathlib.Path(__file__).resolve().parent.parent
AGENT_FILE = ROOT / "agent" / "pharmagent_agent.py"
ERP_FILE = ROOT / "agent" / "demo-erp.html"

KEY = "cle-de-test-ci"
PHARMACY = "PHARMACIE DE TEST CI"

TASK = {
    "id": "tache-ci-1",
    "documentNumber": "BL-CI-WIN-001",
    "mode": "web",
    "header": {
        "supplier": "UBIPHARM SENEGAL",
        "documentNumber": "BL-CI-WIN-001",
        "documentDate": "2026-11-21",
        "totalAmount": 64500,
    },
    # Produits réellement présents au catalogue de l'ERP : ce test éprouve le
    # chemin qui doit réussir. Le refus d'un produit absent est couvert par
    # tests/product_match.py.
    "lines": [
        {"index": 0, "product": "COTRIMOXAZOLE 480MG CP B/20", "designation": "COTRIMOXAZOLE 480MG CP B/20",
         "quantity": 30, "lotNumber": "LOT-W001", "expiryDate": "2028-08-31", "purchasePrice": 650},
        {"index": 1, "product": "QUININE 500MG CP B/20", "designation": "QUININE 500MG CP B/20",
         "quantity": 25, "lotNumber": "LOT-W002", "expiryDate": "2027-11-30", "purchasePrice": 1800},
    ],
}

state = {"claimed": False, "result": None, "heartbeats": 0, "paired": False}
lock = threading.Lock()


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *a):  # silencieux, sauf l'essentiel
        pass

    def _send(self, code, body, ctype="application/json; charset=utf-8"):
        if isinstance(body, (dict, list)):
            body = json.dumps(body, ensure_ascii=False).encode("utf-8")
        elif isinstance(body, str):
            body = body.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = self.path.split("?", 1)[0]
        if path == "/agent/pharmagent_agent.py":
            return self._send(200, AGENT_FILE.read_bytes(), "text/x-python; charset=utf-8")
        if path in ("/erp", "/erp/", "/erp/index.html", "/demo/erp"):
            return self._send(200, ERP_FILE.read_bytes(), "text/html; charset=utf-8")
        if path == "/api/agent-client/pair/status":
            with lock:
                state["paired"] = True
            return self._send(200, {"status": "paired", "agentKey": KEY,
                                    "pharmacyId": "ph-ci", "pharmacyName": PHARMACY})
        if path == "/ci/state":
            with lock:
                return self._send(200, dict(state))
        return self._send(404, {"error": "inconnu"})

    def do_POST(self):
        path = self.path.split("?", 1)[0]
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length) if length else b"{}"
        try:
            body = json.loads(raw.decode("utf-8") or "{}")
        except ValueError:
            body = {}

        if path == "/api/agent-client/pair/start":
            return self._send(200, {"pairingId": "appairage-ci", "secret": "secret-ci", "code": "123456"})
        if path == "/api/agent-client/heartbeat":
            with lock:
                state["heartbeats"] += 1
            return self._send(200, {"ok": True})
        if path == "/api/agent-client/claim":
            with lock:
                if state["claimed"]:
                    return self._send(200, {"task": None})
                state["claimed"] = True
            print("  -> tache confiee a l'agent", flush=True)
            return self._send(200, {"task": TASK})
        if path.startswith("/api/agent-client/tasks/") and path.endswith("/result"):
            with lock:
                state["result"] = body
            print("  -> compte rendu recu :", body.get("status"), "|", body.get("message"), flush=True)
            if OUT:
                OUT.write_text(json.dumps(body, ensure_ascii=False, indent=2), encoding="utf-8")
            return self._send(200, {"ok": True})
        if path == "/api/agent-client/support":
            return self._send(200, {"code": "CI00-TEST"})
        return self._send(404, {"error": "inconnu"})

    def do_PUT(self):
        length = int(self.headers.get("Content-Length") or 0)
        if length:
            self.rfile.read(length)
        return self._send(200, {"ok": True})


OUT = None

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8099)
    ap.add_argument("--out", default="")
    args = ap.parse_args()
    OUT = pathlib.Path(args.out) if args.out else None
    srv = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    print("Faux serveur PharmAgent sur http://127.0.0.1:%d" % args.port, flush=True)
    print("  ERP servi sur http://127.0.0.1:%d/erp" % args.port, flush=True)
    srv.serve_forever()
