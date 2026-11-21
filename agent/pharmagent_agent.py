#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Agent Floki — saisit dans l'ERP web les bons de livraison approuvés dans PharmAgent.

Un seul métier : Playwright ouvre l'écran de réception de l'ERP, écrit l'en-tête
puis les lignes du bon, et s'arrête.

GARDE-FOU ABSOLU : l'agent ne valide, ne confirme, ne clôture JAMAIS.
Il ne clique ni sur Valider, ni Confirmer, ni Clôturer, ni Soumettre,
ni Enregistrer définitivement, ni Commander, ni Payer. La validation
reste au pharmacien.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import platform
import plistlib
import re
import shlex
import shutil
import socket
import subprocess
import sys
import threading
import time
import unicodedata
import urllib.error
import urllib.request
from collections import deque
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urlparse

AGENT_VERSION = "3.0.0"
DEFAULT_SERVER = "https://pharmagent.onrender.com"
PANEL_PORT = int(os.environ.get("PHARMAGENT_PORT", "8765"))
POLL_SECONDS = float(os.environ.get("PHARMAGENT_POLL", "5"))
HEARTBEAT_SECONDS = 20
UPDATE_CHECK_SECONDS = 1800
SYSTEM = platform.system()  # 'Windows' | 'Darwin' | 'Linux'


def app_home() -> Path:
    env = os.environ.get("PHARMAGENT_HOME")
    if env:
        return Path(env)
    if SYSTEM == "Windows":
        return Path(os.environ.get("APPDATA", Path.home())) / "PharmAgent"
    if SYSTEM == "Darwin":
        return Path.home() / "Library" / "Application Support" / "PharmAgent"
    return Path.home() / ".local" / "share" / "PharmAgent"


HOME = app_home()
HOME.mkdir(parents=True, exist_ok=True)
CONFIG_PATH = HOME / "config.json"

# ─── Journal ────────────────────────────────────────────────────────────────

LOG_LINES: deque = deque(maxlen=200)
log = logging.getLogger("floki")
log.setLevel(logging.INFO)
_h = logging.StreamHandler(sys.stdout)
_h.setFormatter(logging.Formatter("%(asctime)s  %(message)s", "%H:%M:%S"))
log.addHandler(_h)


class _PanelLog(logging.Handler):
    def emit(self, record: logging.LogRecord) -> None:
        LOG_LINES.append({"t": datetime.now().strftime("%H:%M:%S"), "msg": record.getMessage()})


log.addHandler(_PanelLog())


def load_config() -> Dict[str, Any]:
    try:
        return json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    except Exception:
        return {}


def save_config(cfg: Dict[str, Any]) -> None:
    tmp = CONFIG_PATH.with_suffix(".tmp")
    tmp.write_text(json.dumps(cfg, indent=2, ensure_ascii=False), encoding="utf-8")
    tmp.replace(CONFIG_PATH)


# ─── Serveur PharmAgent ─────────────────────────────────────────────────────


class ApiError(Exception):
    def __init__(self, status: int, message: str, code: str = ""):
        super().__init__(message)
        self.status = status
        self.code = code


class Api:
    def __init__(self, server: str):
        self.server = (server or DEFAULT_SERVER).rstrip("/")
        self.key = ""

    def call(self, method: str, path: str, body: Any = None, timeout: float = 30) -> Any:
        data = json.dumps(body).encode("utf-8") if body is not None else None
        req = urllib.request.Request(self.server + path, data=data, method=method)
        req.add_header("Content-Type", "application/json")
        req.add_header("User-Agent", "PharmAgent-Agent/" + AGENT_VERSION)
        if self.key:
            req.add_header("X-Agent-Key", self.key)
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                raw = r.read().decode("utf-8") or "{}"
            return json.loads(raw)
        except urllib.error.HTTPError as e:
            detail = ""
            code = ""
            try:
                payload = json.loads(e.read().decode("utf-8"))
                detail = payload.get("error") or ""
                code = payload.get("code") or ""
            except Exception:
                pass
            raise ApiError(e.code, detail or ("Erreur serveur " + str(e.code)), code)
        except Exception as e:
            raise ApiError(0, str(e))


# ─── Garde-fou ──────────────────────────────────────────────────────────────

# Rien de ce qui ressemble à une validation ne doit être cliqué, jamais.
FORBIDDEN_RE = re.compile(
    r"valid|confirm|clotur|cloîtur|soumett|submit|commander|payer|checkout|"
    r"enregistrer\s*(d[ée]finitiv|final)|terminer\s*la\s*r[ée]ception",
    re.I,
)
# Boutons qui ajoutent une ligne au tableau : eux, on a le droit.
ADD_ROW_RE = re.compile(r"ajouter|nouvelle\s*ligne|add\s*(a\s*)?(line|row|item)|\+|＋", re.I)


def strip_accents(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn")


def norm(s: Any) -> str:
    """Minuscules, sans accents, sans ponctuation : pour comparer des libellés."""
    t = strip_accents(str(s or "")).lower()
    t = re.sub(r"[^a-z0-9]+", " ", t)
    return re.sub(r"\s+", " ", t).strip()


# ─── Vocabulaire : libellé d'ERP → champ du bon de livraison ────────────────

# Chaque champ : (synonymes, mots qui disqualifient)
HEADER_VOCAB: Dict[str, Tuple[List[str], List[str]]] = {
    "supplier": (["fournisseur", "supplier", "grossiste", "laboratoire", "labo",
                  "vendeur", "expediteur", "repartiteur"], []),
    "documentNumber": (["reference bl", "ref bl", "reference bon", "numero bl", "n bl", "no bl",
                        "numero bon", "numero du bon", "bon de livraison", "reference livraison",
                        "reference", "bl", "numero piece", "numero document"], ["interne", "commande"]),
    "documentDate": (["date reception", "date de reception", "date livraison", "date du bon",
                      "date bl", "date document", "date"], ["peremption", "expiration", "commande"]),
}

LINE_VOCAB: Dict[str, Tuple[List[str], List[str]]] = {
    "designation": (["designation produit", "designation", "produit", "article", "libelle",
                     "medicament", "denomination", "description", "nom"], ["code", "cip"]),
    "lotNumber": (["numero de lot", "n lot", "no lot", "numero lot", "lot", "batch"], []),
    "quantity": (["quantite recue", "qte recue", "quantite", "qte", "qty", "quantity",
                  "nombre", "recu"], ["commandee", "gratuit", "restant"]),
    "purchasePrice": (["prix d achat", "prix achat", "px achat", "prix unitaire", "pu ht", "pu",
                       "prix", "tarif", "cout"], ["vente", "public", "total", "ttc"]),
    "salePrice": (["prix de vente", "prix vente", "prix public", "ppc", "pv"], ["achat"]),
    "expiryDate": (["date de peremption", "date peremption", "peremption", "date expiration",
                    "expiration", "dlc", "dluo", "exp", "perime"], []),
    "cip": (["code cip", "cip", "ean", "code barre", "code produit", "reference produit",
             "code article"], []),
}


def score_field(haystack: str, synonyms: List[str], avoid: List[str]) -> int:
    """À quel point ce libellé d'ERP correspond-il à ce champ ? 0 = pas du tout."""
    h = " " + haystack + " "
    for bad in avoid:
        if " " + bad + " " in h:
            return 0
    best = 0
    for syn in synonyms:
        if haystack == syn:
            best = max(best, 100)
        elif " " + syn + " " in h:
            # un synonyme long et précis l'emporte sur un synonyme court et vague
            best = max(best, 60 + min(len(syn), 30))
    return best


def match_field(haystack: str, vocab: Dict[str, Tuple[List[str], List[str]]]) -> Tuple[str, int]:
    best_name, best_score = "", 0
    for name, (syns, avoid) in vocab.items():
        s = score_field(haystack, syns, avoid)
        if s > best_score:
            best_name, best_score = name, s
    return best_name, best_score


def assign(fields: List[Dict[str, Any]], vocab: Dict[str, Tuple[List[str], List[str]]]) -> Dict[str, Dict[str, Any]]:
    """Associe au plus un champ de l'ERP à chaque donnée du bon (le mieux noté gagne)."""
    scored = []
    for f in fields:
        hay = norm(" ".join(str(f.get(k) or "") for k in ("label", "placeholder", "name", "id")))
        if not hay:
            continue
        name, s = match_field(hay, vocab)
        if name and s > 0:
            scored.append((s, name, f))
    scored.sort(key=lambda x: -x[0])
    out: Dict[str, Dict[str, Any]] = {}
    used = set()
    for s, name, f in scored:
        if name in out or f["sel"] in used:
            continue
        out[name] = f
        used.add(f["sel"])
    return out


# ─── Dates ──────────────────────────────────────────────────────────────────


def parse_date(value: str) -> Optional[Tuple[int, int, Optional[int]]]:
    v = str(value or "").strip()
    if not v:
        return None
    m = re.match(r"^(\d{4})-(\d{2})(?:-(\d{2}))?$", v)           # 2026-11-20 / 2026-11
    if m:
        return int(m.group(1)), int(m.group(2)), int(m.group(3)) if m.group(3) else None
    m = re.match(r"^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$", v)       # 20/11/2026
    if m:
        return int(m.group(3)), int(m.group(2)), int(m.group(1))
    m = re.match(r"^(\d{1,2})[/.](\d{4})$", v)                    # 11/2026
    if m:
        return int(m.group(2)), int(m.group(1)), None
    return None


def format_date(value: str, field: Dict[str, Any]) -> str:
    """Écrit la date au format attendu par le champ (lu dans son indice de saisie)."""
    parsed = parse_date(value)
    if not parsed:
        return str(value or "")
    year, month, day = parsed
    itype = str(field.get("type") or "")
    if itype == "date":
        return "%04d-%02d-%02d" % (year, month, day or 1)
    if itype == "month":
        return "%04d-%02d" % (year, month)
    hint = norm(str(field.get("placeholder") or "") + " " + str(field.get("label") or ""))
    wants_day = bool(re.search(r"\bjj\b|\bdd\b", hint))
    only_month = bool(re.search(r"\bmm\b", hint) and re.search(r"\baaaa\b|\byyyy\b", hint) and not wants_day)
    if only_month or (day is None and not wants_day):
        return "%02d/%04d" % (month, year)
    return "%02d/%02d/%04d" % (day or 1, month, year)


# ─── Lecture de la page ERP ─────────────────────────────────────────────────

SURVEY_JS = r"""() => {
  const FORBIDDEN = /valid|confirm|clotur|soumett|submit|commander|payer|checkout|enregistrer\s*(d[ée]finitiv|final)/i;
  const TYPES = new Set(['', 'text', 'search', 'number', 'tel', 'email', 'date', 'month', 'url']);

  const editable = (el) => {
    const tag = el.tagName;
    if (tag === 'SELECT' || tag === 'TEXTAREA') return true;
    if (tag !== 'INPUT') return false;
    return TYPES.has((el.type || '').toLowerCase());
  };
  const visible = (el) => {
    if (el.disabled || el.readOnly) return false;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return false;
    const s = getComputedStyle(el);
    return s.visibility !== 'hidden' && s.display !== 'none';
  };
  const esc = (s) => (window.CSS && CSS.escape ? CSS.escape(s) : String(s).replace(/[^\w-]/g, '\\$&'));
  const sel = (el) => {
    if (el.id) return '#' + esc(el.id);
    if (el.name) return el.tagName.toLowerCase() + '[name="' + esc(el.name) + '"]';
    const parts = [];
    let n = el;
    while (n && n.nodeType === 1 && parts.length < 8) {
      if (n.id) { parts.unshift('#' + esc(n.id)); break; }
      let p = n.tagName.toLowerCase();
      const parent = n.parentElement;
      if (parent) {
        const same = Array.from(parent.children).filter((c) => c.tagName === n.tagName);
        if (same.length > 1) p += ':nth-of-type(' + (same.indexOf(n) + 1) + ')';
      }
      parts.unshift(p);
      n = n.parentElement;
    }
    return parts.join(' > ');
  };
  const labelOf = (el) => {
    if (el.id) {
      const l = document.querySelector('label[for="' + esc(el.id) + '"]');
      if (l && l.textContent.trim()) return l.textContent.trim();
    }
    const wrap = el.closest('label');
    if (wrap && wrap.textContent.trim()) return wrap.textContent.trim();
    const aria = el.getAttribute('aria-label');
    if (aria && aria.trim()) return aria.trim();
    const td = el.closest('td');
    if (td) {
      const tr = td.closest('tr'), table = td.closest('table');
      if (tr && table) {
        const i = Array.from(tr.children).indexOf(td);
        const head = table.querySelector('thead tr');
        if (head && head.children[i]) return head.children[i].textContent.trim();
      }
    }
    return '';
  };
  const describe = (el) => ({
    sel: sel(el),
    tag: el.tagName.toLowerCase(),
    type: (el.type || '').toLowerCase(),
    name: el.name || '',
    id: el.id || '',
    placeholder: el.placeholder || '',
    label: labelOf(el),
    value: el.value || '',
    options: el.tagName === 'SELECT' ? Array.from(el.options).map((o) => o.textContent.trim()) : undefined,
  });

  const all = Array.from(document.querySelectorAll('input, select, textarea')).filter((e) => editable(e) && visible(e));

  // Le tableau des lignes = celui qui contient le plus de champs de saisie
  let lineTable = null, bestCount = 0;
  for (const t of document.querySelectorAll('table')) {
    const n = Array.from(t.querySelectorAll('tbody input, tbody select, tbody textarea')).filter((e) => editable(e) && visible(e)).length;
    const hasHead = t.querySelector('thead th');
    if (n > bestCount || (bestCount === 0 && hasHead && n === 0)) { lineTable = t; bestCount = n; }
  }

  const rows = [];
  if (lineTable) {
    for (const tr of lineTable.querySelectorAll('tbody tr')) {
      const fields = Array.from(tr.querySelectorAll('input, select, textarea')).filter((e) => editable(e) && visible(e)).map(describe);
      if (fields.length) rows.push(fields);
    }
  }

  const inLineTable = (el) => lineTable && lineTable.contains(el);
  const header = all.filter((e) => !inLineTable(e)).map(describe);

  const buttons = [];
  for (const b of document.querySelectorAll('button, input[type=button], input[type=submit], a[role=button], [role=button]')) {
    const text = (b.textContent || b.value || b.getAttribute('aria-label') || '').trim();
    if (!text) continue;
    const r = b.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    buttons.push({ sel: sel(b), text: text, forbidden: FORBIDDEN.test(text), inTable: !!(lineTable && lineTable.contains(b)) });
  }

  return { url: location.href, title: document.title, header: header, rows: rows, buttons: buttons, hasLineTable: !!lineTable };
}"""


# ─── Navigateur ─────────────────────────────────────────────────────────────


class Browser:
    """Fenêtre Chrome dédiée à l'agent (profil séparé : la session ERP y reste ouverte)."""

    def __init__(self) -> None:
        self.pw = None
        self.ctx = None

    @property
    def is_open(self) -> bool:
        return bool(self.ctx and self.ctx.pages)

    def open(self, url: Optional[str] = None):
        if not self.is_open:
            self._launch()
        page = self.ctx.pages[0] if self.ctx.pages else self.ctx.new_page()
        if url:
            here = (page.url or "").split("#")[0]
            if here != url.split("#")[0] and not here.startswith(url.rstrip("/")):
                page.goto(url, wait_until="domcontentloaded", timeout=60000)
                self._settle(page)
        page.bring_to_front()
        return page

    def _launch(self) -> None:
        try:
            from playwright.sync_api import sync_playwright
        except ImportError:
            raise RuntimeError(
                "Playwright n'est pas installé. Relancez l'installateur PharmAgent."
            )
        if self.pw is None:
            self.pw = sync_playwright().start()
        exe = os.environ.get("PHARMAGENT_CHROMIUM_PATH")
        if os.environ.get("PHARMAGENT_BROWSER_CHANNEL"):
            channels: List[Optional[str]] = [os.environ["PHARMAGENT_BROWSER_CHANNEL"]]
        elif SYSTEM == "Windows":
            channels = ["msedge", "chrome", None]
        elif SYSTEM == "Darwin":
            channels = ["chrome", "msedge", None]
        else:
            channels = [None, "chrome"]
        last_err: Optional[Exception] = None
        for ch in ([None] if exe else channels):
            try:
                kw: Dict[str, Any] = dict(
                    user_data_dir=str(HOME / "navigateur"),
                    headless=os.environ.get("PHARMAGENT_HEADLESS") == "1",
                    args=["--start-maximized", "--no-default-browser-check", "--disable-features=Translate"],
                    no_viewport=True,
                )
                if exe:
                    kw["executable_path"] = exe
                elif ch:
                    kw["channel"] = ch
                self.ctx = self.pw.chromium.launch_persistent_context(**kw)
                log.info("Navigateur ouvert (%s).", ch or "Chromium")
                return
            except Exception as e:
                last_err = e
        raise RuntimeError(
            "Impossible d'ouvrir le navigateur (%s). Relancez l'installateur PharmAgent." % last_err
        )

    @staticmethod
    def _settle(page) -> None:
        try:
            page.wait_for_load_state("networkidle", timeout=5000)
        except Exception:
            pass

    def close(self) -> None:
        for obj in (self.ctx, self.pw):
            try:
                if obj:
                    obj.close() if obj is self.ctx else obj.stop()
            except Exception:
                pass
        self.ctx = self.pw = None


# ─── Remplissage ────────────────────────────────────────────────────────────


class Filler:
    """Écrit l'en-tête et les lignes du bon dans le formulaire ouvert."""

    def __init__(self, page, on_progress=None):
        self.page = page
        self.on_progress = on_progress or (lambda *_: None)
        self.filled = 0
        self.skipped: List[str] = []

    def survey(self) -> Dict[str, Any]:
        return self.page.evaluate(SURVEY_JS)

    def write(self, field: Dict[str, Any], value: Any) -> bool:
        """Remplit un champ. Jamais de touche Entrée (elle pourrait valider)."""
        text = "" if value is None else str(value)
        if text == "" or text.strip() == "":
            return False
        loc = self.page.locator(field["sel"]).first
        try:
            if not loc.is_visible(timeout=2000):
                return False
            if field.get("tag") == "select":
                options = field.get("options") or []
                target = norm(text)
                choice = None
                for opt in options:
                    if norm(opt) == target:
                        choice = opt
                        break
                if choice is None:
                    for opt in options:
                        if target and target in norm(opt):
                            choice = opt
                            break
                if choice is None:
                    return False
                loc.select_option(label=choice, timeout=5000)
            else:
                loc.scroll_into_view_if_needed(timeout=3000)
                loc.fill(text, timeout=5000)
            self.filled += 1
            return True
        except Exception as e:
            log.info("Champ « %s » non rempli : %s", field.get("label") or field.get("sel"), str(e)[:90])
            return False

    def value_for(self, name: str, data: Dict[str, Any], field: Dict[str, Any]) -> Any:
        raw = data.get(name)
        if name in ("documentDate", "expiryDate"):
            return format_date(str(raw or ""), field)
        return raw

    def fill_header(self, header: Dict[str, Any], survey: Dict[str, Any]) -> None:
        mapping = assign(survey.get("header") or [], HEADER_VOCAB)
        if not mapping:
            log.info("Aucun champ d'en-tête reconnu sur cette page.")
        for name, field in mapping.items():
            value = self.value_for(name, header, field)
            label = field.get("label") or field.get("name") or name
            if not self.write(field, value):
                if str(value or "").strip():
                    self.skipped.append(label)
            else:
                log.info("En-tête : %s = %s", label, value)

    def add_row_button(self, survey: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        for b in survey.get("buttons") or []:
            if b.get("forbidden"):
                continue
            if ADD_ROW_RE.search(b.get("text") or ""):
                return b
        return None

    def ensure_row(self, index: int) -> Optional[List[Dict[str, Any]]]:
        """Renvoie les champs de la ligne n° index, en cliquant « Ajouter une ligne » si besoin."""
        survey = self.survey()
        rows = survey.get("rows") or []
        guard = 0
        while len(rows) <= index and guard < 60:
            btn = self.add_row_button(survey)
            if not btn:
                return None
            try:
                self.page.locator(btn["sel"]).first.click(timeout=5000)
            except Exception as e:
                log.info("Ajout de ligne impossible : %s", str(e)[:90])
                return None
            self.page.wait_for_timeout(120)
            survey = self.survey()
            rows = survey.get("rows") or []
            guard += 1
        return rows[index] if len(rows) > index else None

    def fill_lines(self, lines: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        results: List[Dict[str, Any]] = []
        for position, line in enumerate(lines):
            idx = line.get("index", position)
            if line.get("skip"):
                results.append({"index": idx, "ok": False, "message": str(line["skip"])[:300]})
                continue
            label = line.get("product") or line.get("designation") or "?"
            self.on_progress(position, len(lines), label)
            fields = self.ensure_row(position)
            if fields is None:
                results.append({"index": idx, "ok": False, "message": "Impossible d'ajouter une ligne dans l'ERP."})
                continue
            mapping = assign(fields, LINE_VOCAB)
            if not mapping:
                results.append({"index": idx, "ok": False, "message": "Aucune colonne de saisie reconnue."})
                continue
            data = dict(line)
            data.setdefault("designation", line.get("product") or "")
            if not data.get("designation"):
                data["designation"] = line.get("product") or ""
            wrote = 0
            missed: List[str] = []
            for name, field in mapping.items():
                value = self.value_for(name, data, field)
                if self.write(field, value):
                    wrote += 1
                elif str(value or "").strip():
                    missed.append(field.get("label") or name)
            results.append({
                "index": idx,
                "ok": wrote > 0,
                "message": ("Non rempli : " + ", ".join(missed))[:300] if missed else None,
            })
            log.info("Ligne %d : %s (%d champ(s)).", position + 1, label, wrote)
        return results


# ─── Moteur ─────────────────────────────────────────────────────────────────


class Engine:
    """Un seul thread touche au navigateur : celui-ci."""

    def __init__(self, server: str):
        self.cfg = load_config()
        self.api = Api(self.cfg.get("server") or server)
        self.api.key = self.cfg.get("agentKey", "")
        self.browser = Browser()
        self.lock = threading.Lock()
        self.shutdown = threading.Event()
        self.commands: "deque" = deque()
        self.erp_url: str = self.cfg.get("erpUrl", "")
        self.paused = bool(self.cfg.get("paused"))
        self.pairing: Optional[Dict[str, Any]] = None
        self.task: Optional[Dict[str, Any]] = None
        self.last_result: Optional[Dict[str, Any]] = self.cfg.get("lastResult")
        self.last_error = ""
        self.server_ok = True
        self._last_poll = 0.0
        self._last_beat = 0.0
        self._last_update = time.time()

    # ── État affiché dans le panneau ──

    def state(self) -> Dict[str, Any]:
        paired = bool(self.api.key)
        if not paired:
            status = "pairing"
        elif not self.erp_url:
            status = "setup"
        elif self.task:
            status = "running"
        elif self.paused:
            status = "paused"
        else:
            status = "ready"
        return {
            "version": AGENT_VERSION, "os": SYSTEM, "status": status, "paired": paired,
            "pharmacyName": self.cfg.get("pharmacyName", ""), "erpUrl": self.erp_url,
            "pairingCode": (self.pairing or {}).get("code"), "task": self.task,
            "lastResult": self.last_result, "lastError": self.last_error,
            "serverOk": self.server_ok, "server": self.api.server,
            "logs": list(LOG_LINES)[-60:],
        }

    def submit(self, name: str, payload: Dict[str, Any]) -> Any:
        done = threading.Event()
        box: Dict[str, Any] = {}

        def run() -> None:
            try:
                box["result"] = self._handle(name, payload)
            except Exception as e:
                box["error"] = e
            finally:
                done.set()

        self.commands.append(run)
        if not done.wait(timeout=180):
            raise TimeoutError("L'agent met trop de temps à répondre.")
        if "error" in box:
            raise box["error"]
        return box.get("result")

    def _persist(self) -> None:
        self.cfg.update({
            "server": self.api.server, "agentKey": self.api.key, "erpUrl": self.erp_url,
            "paused": self.paused, "lastResult": self.last_result,
        })
        save_config(self.cfg)

    # ── Commandes du panneau ──

    def _handle(self, name: str, p: Dict[str, Any]) -> Any:
        if name == "set_url":
            url = (p.get("erpUrl") or "").strip()
            if url and not re.match(r"^https?://", url):
                url = "https://" + url
            if not url:
                raise ValueError("Indiquez l'adresse de l'ERP.")
            self.erp_url = url
            self._persist()
            # Le serveur a besoin d'un profil pour autoriser l'envoi des bons.
            try:
                self.api.call("PUT", "/api/agent-client/profile", {
                    "mode": "web", "erpUrl": url, "headerSteps": [], "lineSteps": [], "auto": True,
                })
            except ApiError as e:
                log.info("Profil non enregistré sur le serveur : %s", e)
            log.info("ERP enregistré : %s", url)
            return True
        if name == "open_erp":
            if not self.erp_url:
                raise ValueError("Indiquez d'abord l'adresse de l'ERP.")
            self.browser.open(self.erp_url)
            return True
        if name == "pause":
            self.paused = not self.paused
            self._persist()
            return {"paused": self.paused}
        if name == "unpair":
            self.api.key = ""
            for k in ("agentKey", "pharmacyId", "pharmacyName"):
                self.cfg.pop(k, None)
            self._persist()
            return True
        if name == "quit":
            self.shutdown.set()
            return True
        raise ValueError("Commande inconnue : " + name)

    # ── Saisie d'un bon ──

    def _run_task(self, task: Dict[str, Any]) -> None:
        header = task.get("header") or {}
        lines = task.get("lines") or []
        started = time.time()
        self.task = {
            "documentNumber": header.get("documentNumber") or "?",
            "total": len(lines), "done": 0, "current": "",
        }
        log.info("Saisie : %s (%d ligne(s)).", self.task["documentNumber"], len(lines))
        status, message, results = "done", "", []
        try:
            page = self.browser.open(self.erp_url)
            Browser._settle(page)

            def progress(i: int, total: int, label: str) -> None:
                self.task["done"] = i
                self.task["current"] = label

            filler = Filler(page, progress)
            survey = filler.survey()
            if not survey.get("header") and not survey.get("rows") and not survey.get("hasLineTable"):
                raise RuntimeError(
                    "Aucun champ de saisie sur « %s ». Ouvrez dans l'ERP l'écran de réception d'un bon de livraison."
                    % (survey.get("url") or self.erp_url)[:80]
                )
            filler.fill_header(header, survey)
            results = filler.fill_lines(lines)
            ok_lines = sum(1 for r in results if r.get("ok"))
            message = "%d champ(s) saisi(s), %d ligne(s) sur %d, en %.1f s." % (
                filler.filled, ok_lines, len(lines), time.time() - started)
            if filler.skipped:
                message += " Non rempli : " + ", ".join(filler.skipped[:6]) + "."
            message += " Vérifiez puis validez dans l'ERP."
            try:
                page.screenshot(path=str(HOME / "derniere_saisie.png"), full_page=True)
            except Exception:
                pass
            if not filler.filled:
                status = "failed"
                message = ("Rien n'a pu être rempli sur « %s » : les champs du formulaire n'ont pas été reconnus."
                           % (survey.get("url") or "")[:80])
        except Exception as e:
            status, message = "failed", str(e)[:300]
            log.info("Saisie en échec : %s", message)
        duration = int((time.time() - started) * 1000)
        self.task = None
        self.last_result = {
            "documentNumber": header.get("documentNumber") or "?", "status": status,
            "message": message, "at": datetime.now().strftime("%d/%m %H:%M"),
        }
        self._persist()
        log.info("%s", message)
        if task.get("id"):
            try:
                self.api.call("POST", "/api/agent-client/tasks/%s/result" % task["id"], {
                    "status": status, "message": message, "durationMs": duration, "lines": results,
                })
            except ApiError as e:
                log.info("Compte rendu non transmis : %s", e)

    # ── Boucle ──

    def _pair(self) -> None:
        if self.pairing and time.time() - self.pairing["at"] < 600:
            try:
                r = self.api.call("GET", "/api/agent-client/pair/status?pairingId=%s&secret=%s"
                                  % (self.pairing["id"], self.pairing["secret"]))
                self.server_ok = True
                if r.get("status") == "paired":
                    self.api.key = r["agentKey"]
                    self.cfg.update({"agentKey": r["agentKey"], "pharmacyId": r.get("pharmacyId"),
                                     "pharmacyName": r.get("pharmacyName")})
                    self.pairing = None
                    self._persist()
                    log.info("Ordinateur appairé à « %s ».", r.get("pharmacyName") or "la pharmacie")
                    return
            except ApiError as e:
                if e.status == 404:
                    self.pairing = None
                else:
                    self.server_ok = e.status != 0
            return
        try:
            r = self.api.call("POST", "/api/agent-client/pair/start",
                              {"hostname": socket.gethostname(), "os": SYSTEM})
            self.server_ok = True
            self.pairing = {"id": r["pairingId"], "secret": r["secret"], "code": r["code"], "at": time.time()}
            log.info("Code d'appairage : %s", r["code"])
        except ApiError as e:
            self.server_ok = e.status != 0
            self.last_error = str(e)

    def _beat(self) -> None:
        try:
            self.api.call("POST", "/api/agent-client/heartbeat", {
                "hostname": socket.gethostname(), "os": platform.platform(), "version": AGENT_VERSION,
                "state": (self.task or {}).get("documentNumber") and "Saisie en cours" or "En attente",
                "mode": "web", "target": self.erp_url,
                "lastResult": (self.last_result or {}).get("message", ""), "lastError": self.last_error,
                "logs": [l["t"] + " " + l["msg"] for l in list(LOG_LINES)[-25:]],
            })
            self.server_ok = True
        except ApiError as e:
            self._on_api_error(e)
        self._last_beat = time.time()

    def _claim(self) -> None:
        try:
            r = self.api.call("POST", "/api/agent-client/claim")
            self.server_ok = True
            task = r.get("task")
            if task:
                self._run_task(task)
        except ApiError as e:
            self._on_api_error(e)
        self._last_poll = time.time()

    def _on_api_error(self, e: ApiError) -> None:
        if e.status == 401:
            log.info("Appairage révoqué : nouvel appairage nécessaire.")
            self.api.key = ""
            self.cfg.pop("agentKey", None)
            self._persist()
        else:
            self.server_ok = e.status != 0
            self.last_error = str(e)

    def loop(self) -> None:
        log.info("Agent Floki %s démarré (%s) — serveur %s", AGENT_VERSION, SYSTEM, self.api.server)
        while not self.shutdown.is_set():
            if time.time() - self._last_update > UPDATE_CHECK_SECONDS and not self.task:
                self._last_update = time.time()
                self_update(self.api.server)
            if self.commands:
                self.commands.popleft()()
                continue
            now = time.time()
            if not self.api.key:
                if now - self._last_poll > 3:
                    self._last_poll = now
                    self._pair()
            else:
                if now - self._last_beat > HEARTBEAT_SECONDS:
                    self._beat()
                if not self.paused and self.erp_url and now - self._last_poll > POLL_SECONDS:
                    self._claim()
            time.sleep(0.2)
        self.browser.close()


# ─── Panneau local ──────────────────────────────────────────────────────────

PANEL_HTML = r"""<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><title>Agent Floki — PharmAgent</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
:root{--bg:#0b1020;--card:#141b31;--line:#243049;--ink:#e8edf7;--mut:#93a0bd;--ok:#35d39a;--bad:#ff6b6b;--acc:#4f8cff}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;padding:24px}
.wrap{max-width:720px;margin:0 auto}
h1{font-size:19px;margin:0}
.sub{color:var(--mut);font-size:13px}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:18px;margin-top:14px}
.head{display:flex;align-items:center;gap:12px;justify-content:space-between}
.pill{border-radius:999px;padding:5px 13px;font-size:12px;font-weight:600;border:1px solid var(--line)}
.ok{color:var(--ok);border-color:var(--ok)}.bad{color:var(--bad);border-color:var(--bad)}
label{display:block;font-size:12px;color:var(--mut);margin-bottom:6px}
input{width:100%;padding:11px 13px;border-radius:10px;border:1px solid var(--line);background:#0e1527;color:var(--ink);font-size:15px}
button{border:0;border-radius:10px;padding:11px 16px;font-size:14px;font-weight:600;cursor:pointer;background:var(--acc);color:#fff}
button.sec{background:#1d2740;color:var(--ink)}
button:disabled{opacity:.5;cursor:default}
.row{display:flex;gap:10px;margin-top:12px;flex-wrap:wrap}
.code{flex:1 1 auto;min-width:0;font:28px ui-monospace,Menlo,monospace;letter-spacing:7px;text-align:center;color:var(--ok);padding:16px;border:1px dashed var(--line);border-radius:12px;user-select:all}
.coderow{display:flex;gap:10px;align-items:stretch;margin-top:10px}
.coderow button{flex:0 0 auto}
.guard{font-size:13px;color:var(--mut);border-left:3px solid var(--ok);padding-left:12px}
.err{color:var(--bad);font-size:13px;margin-top:10px}
pre{background:#0e1527;border:1px solid var(--line);border-radius:10px;padding:12px;max-height:260px;overflow:auto;font:12px ui-monospace,Menlo,monospace;color:var(--mut);white-space:pre-wrap}
.bar{height:6px;background:#0e1527;border-radius:999px;overflow:hidden;margin-top:10px}
.bar i{display:block;height:100%;background:var(--ok)}
</style></head><body><div class="wrap" id="app">Chargement…</div>
<script>
let S={},busy=false,urlDraft=null,lastDraw='';
function copyText(text,btn){
  const done=()=>{const o=btn.textContent;btn.textContent='Copié';setTimeout(()=>{btn.textContent=o;},1600);};
  if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(text).then(done,()=>selectText(btn));}
  else selectText(btn);
}
function selectText(btn){
  const el=btn.previousElementSibling;if(!el)return;
  const r=document.createRange();r.selectNodeContents(el);
  const s=window.getSelection();s.removeAllRanges();s.addRange(r);
  const o=btn.textContent;btn.textContent='Sélectionné';setTimeout(()=>{btn.textContent=o;},1600);
}
const esc=s=>String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
async function call(name,payload){
  busy=true;render();
  try{
    const r=await fetch('/api/'+name,{method:'POST',headers:{'Content-Type':'application/json','X-PharmAgent':'1'},body:JSON.stringify(payload||{})});
    const j=await r.json();
    if(j.error) alert(j.error); else if(name==='set_url') urlDraft=null;
  }catch(e){alert(String(e));}
  busy=false;await tick();
}
async function tick(){
  try{const r=await fetch('/api/state',{headers:{'X-PharmAgent':'1'}});S=await r.json();}catch(e){}
  render();
}
function render(){
  const a=document.getElementById('app');
  if(!S.version){a.textContent='Chargement…';return;}
  // Ne jamais redessiner pendant que l'utilisateur écrit ou sélectionne du texte :
  // reconstruire le HTML lui arracherait sa saisie ou sa sélection.
  const act=document.activeElement;
  if(act&&act.tagName==='INPUT'&&a.contains(act))return;
  const sel=window.getSelection();
  if(sel&&!sel.isCollapsed&&sel.anchorNode&&a.contains(sel.anchorNode))return;
  const st=S.status;
  let h=`<div class="head"><div><h1>Agent Floki</h1><div class="sub">${esc(S.pharmacyName||'non appairé')} · v${esc(S.version)} · ${esc(S.os)}</div></div>
  <span class="pill ${S.serverOk?'ok':'bad'}">${S.serverOk?'Serveur OK':'Serveur injoignable'}</span></div>`;

  if(st==='pairing'){
    const pc=S.pairingCode||'';
    h+=`<div class="card"><label>1. Appairage</label><p class="sub">Saisissez ce code dans PharmAgent › Agent local.</p>
    <div class="coderow"><div class="code">${esc(pc||'……')}</div>
    ${pc?`<button class="sec" onclick="copyText('${esc(pc)}',this)">Copier</button>`:''}</div></div>`;
  }else{
    h+=`<div class="card"><label>Adresse de l'écran de réception de l'ERP</label>
    <input id="url" oninput="urlDraft=this.value" value="${esc(urlDraft!==null?urlDraft:(S.erpUrl||''))}" placeholder="https://erp.mapharmacie.sn">
    <div class="row"><button ${busy?'disabled':''} onclick="call('set_url',{erpUrl:document.getElementById('url').value})">Enregistrer</button>
    <button class="sec" ${busy?'disabled':''} onclick="call('open_erp')">Ouvrir l'ERP</button>
    <button class="sec" ${busy?'disabled':''} onclick="call('pause')">${S.status==='paused'?'Reprendre':'Mettre en pause'}</button></div></div>`;
  }

  if(S.task){
    const p=S.task.total?Math.round(100*S.task.done/S.task.total):0;
    h+=`<div class="card"><label>Saisie en cours</label><b>${esc(S.task.documentNumber)}</b>
    <div class="sub">${esc(S.task.current||'')} — ${S.task.done}/${S.task.total}</div>
    <div class="bar"><i style="width:${p}%"></i></div></div>`;
  }else if(S.lastResult){
    h+=`<div class="card"><label>Dernière saisie</label><b>${esc(S.lastResult.documentNumber)}</b>
    <div class="sub">${esc(S.lastResult.at)} — ${esc(S.lastResult.message)}</div></div>`;
  }

  h+=`<div class="card"><div class="guard"><b>Garde-fou actif.</b> L'agent remplit l'écran de saisie puis s'arrête.
  Il ne clique jamais sur Valider, Confirmer, Clôturer ni Enregistrer définitivement : la validation reste au pharmacien.</div>
  ${S.lastError?`<div class="err">${esc(S.lastError)}</div>`:''}</div>`;

  h+=`<div class="card"><label>Journal</label><pre>${S.logs.map(l=>esc(l.t+'  '+l.msg)).join('\n')}</pre>
  <div class="row"><button class="sec" onclick="if(confirm('Détacher cet ordinateur de la pharmacie ?'))call('unpair')">Détacher</button></div></div>`;
  // Rien n'a bougé : on laisse le HTML tel quel plutôt que de le reconstruire pour rien.
  const stamp=h+'|'+busy;
  if(stamp===lastDraw)return;
  lastDraw=stamp;
  a.innerHTML=h;
}
tick();setInterval(tick,1500);
</script></body></html>"""


class Panel(BaseHTTPRequestHandler):
    engine: Engine

    def log_message(self, *_args: Any) -> None:  # silence
        pass

    def _local_only(self) -> bool:
        return self.client_address[0] in ("127.0.0.1", "::1")

    def _send(self, code: int, body: bytes, ctype: str) -> None:
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _json(self, code: int, obj: Any) -> None:
        self._send(code, json.dumps(obj, ensure_ascii=False).encode("utf-8"), "application/json; charset=utf-8")

    def do_GET(self) -> None:
        if not self._local_only():
            return self._json(403, {"error": "Accès refusé."})
        if self.path == "/":
            return self._send(200, PANEL_HTML.encode("utf-8"), "text/html; charset=utf-8")
        if self.path == "/api/state":
            return self._json(200, self.engine.state())
        self._json(404, {"error": "Inconnu."})

    def do_POST(self) -> None:
        if not self._local_only() or self.headers.get("X-PharmAgent") != "1":
            return self._json(403, {"error": "Accès refusé."})
        name = self.path[5:] if self.path.startswith("/api/") else ""
        if name not in ("set_url", "open_erp", "pause", "unpair", "quit"):
            return self._json(404, {"error": "Commande inconnue."})
        length = min(int(self.headers.get("Content-Length") or 0), 100000)
        try:
            payload = json.loads(self.rfile.read(length) or b"{}") if length else {}
        except ValueError:
            payload = {}
        try:
            self._json(200, {"result": self.engine.submit(name, payload)})
        except Exception as e:
            self._json(400, {"error": str(e) or e.__class__.__name__})


# ─── Mise à jour automatique ────────────────────────────────────────────────


def self_update(server: str) -> None:
    if os.environ.get("PHARMAGENT_NO_UPDATE") == "1":
        return
    host = urlparse(server).hostname or ""
    if not server.lower().startswith("https://") and host not in ("127.0.0.1", "localhost"):
        return
    try:
        me = Path(__file__).resolve()
        current = hashlib.sha256(me.read_bytes()).hexdigest()
        info = Api(server).call("GET", "/agent/version", timeout=15)
        if not info.get("sha256") or info["sha256"] == current:
            return
        req = urllib.request.Request(server.rstrip("/") + "/agent/pharmagent_agent.py",
                                     headers={"User-Agent": "PharmAgent-Agent/" + AGENT_VERSION})
        with urllib.request.urlopen(req, timeout=30) as r:
            new = r.read()
        if hashlib.sha256(new).hexdigest() != info["sha256"] or b"AGENT_VERSION" not in new:
            return
        tmp = me.with_suffix(".new")
        tmp.write_bytes(new)
        tmp.replace(me)
        log.info("Agent mis à jour (%s) : redémarrage.", info.get("version"))
        os.execv(sys.executable, [sys.executable, str(me)] + sys.argv[1:])
    except Exception as e:
        log.info("Mise à jour ignorée : %s", str(e)[:120])


def ensure_mac_app(server: str) -> None:
    """Crée l'application « PharmAgent » dans ~/Applications (lancement en un clic)."""
    if SYSTEM != "Darwin":
        return
    try:
        agent = Path(__file__).resolve()
        cmd = "%s %s --server %s" % (shlex.quote(sys.executable), shlex.quote(str(agent)), shlex.quote(server))
        say = "PharmAgent tourne dans cette fenêtre : réduisez-la, ne la fermez pas."
        shell_line = "clear; echo %s; %s" % (shlex.quote(say), cmd)
        applescript = shell_line.replace("\\", "\\\\").replace('"', '\\"')
        app = Path.home() / "Applications" / "PharmAgent.app"
        stamp = hashlib.sha256((cmd + "|v3").encode()).hexdigest()
        marker = HOME / "launcher.sha"
        if app.exists() and marker.exists() and marker.read_text().strip() == stamp:
            return
        app.parent.mkdir(parents=True, exist_ok=True)
        if app.exists():
            shutil.rmtree(app)
        args = ["osacompile", "-o", str(app)]
        for line in ['tell application "Terminal"', "activate", 'do script "%s"' % applescript, "end tell"]:
            args += ["-e", line]
        subprocess.run(args, check=True, capture_output=True, timeout=30)
        agents_dir = Path.home() / "Library" / "LaunchAgents"
        agents_dir.mkdir(parents=True, exist_ok=True)
        (agents_dir / "com.pharmagent.agent.plist").write_bytes(plistlib.dumps(
            {"Label": "com.pharmagent.agent",
             "ProgramArguments": ["/usr/bin/open", "-g", "-a", str(app)], "RunAtLoad": True}))
        marker.write_text(stamp)
        log.info("Application « PharmAgent » créée dans %s", app)
    except Exception as e:
        log.info("Application PharmAgent non créée : %s", str(e)[:120])


# ─── Démarrage ──────────────────────────────────────────────────────────────


def main() -> None:
    server = DEFAULT_SERVER
    argv = sys.argv[1:]
    for i, a in enumerate(argv):
        if a == "--server" and i + 1 < len(argv):
            server = argv[i + 1]
    background = "--background" in argv

    engine = Engine(server)
    Panel.engine = engine
    try:
        httpd = ThreadingHTTPServer(("127.0.0.1", PANEL_PORT), Panel)
    except OSError:
        print("Le panneau tourne déjà : http://127.0.0.1:%d/" % PANEL_PORT)
        return
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    url = "http://127.0.0.1:%d/" % PANEL_PORT
    log.info("Panneau de contrôle : %s", url)
    ensure_mac_app(engine.api.server)
    if not background:
        try:
            if SYSTEM == "Darwin":
                subprocess.run(["open", url], check=False)
            elif SYSTEM == "Windows":
                os.startfile(url)  # type: ignore[attr-defined]
            else:
                subprocess.run(["xdg-open", url], check=False)
        except Exception:
            pass
    try:
        engine.loop()
    except KeyboardInterrupt:
        engine.shutdown.set()
        engine.browser.close()


if __name__ == "__main__":
    main()
