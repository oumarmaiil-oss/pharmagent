#!/usr/bin/env python3
"""
PharmAgent — Agent local de saisie (Windows / macOS / Linux)

Rôle : recevoir les bons approuvés par le pharmacien et les saisir dans l'ERP
de l'officine, à la vitesse de la machine, en rejouant la démonstration faite
une seule fois par le pharmacien.

  • ERP web          : Playwright pilote le navigateur et remplit les champs
                       directement (sélecteurs, jamais de coordonnées).
  • Logiciel installé : rejeu clavier (Tab, Entrée…) dans la fenêtre de l'ERP.

GARDE-FOU ABSOLU : l'agent ne valide, ne confirme, ne clôture JAMAIS.
Il remplit le formulaire et s'arrête. La validation reste au pharmacien.

Panneau de contrôle : http://127.0.0.1:8765 (s'ouvre automatiquement).
"""
from __future__ import annotations

import argparse
import base64
import difflib
import hashlib
import json
import logging
import logging.handlers
import os
import platform
import plistlib
import queue
import re
import shlex
import shutil
import socket
import subprocess
import sys
import threading
import time
import traceback
import unicodedata
import urllib.error
import urllib.request
import webbrowser
from collections import deque
from concurrent.futures import Future
from datetime import date, datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional
from urllib.parse import urlparse

AGENT_VERSION = "2.3.4"
DEFAULT_SERVER = "https://pharmagent.onrender.com"
PANEL_PORT = int(os.environ.get("PHARMAGENT_PORT", "8765"))
POLL_SECONDS = float(os.environ.get("PHARMAGENT_POLL", "5"))
HEARTBEAT_SECONDS = 20
SYSTEM = platform.system()  # 'Windows' | 'Darwin' | 'Linux'
# Applications qui ne sont jamais l'ERP (évite de surveiller Finder par erreur)
IGNORED_APPS = {"Finder", "Terminal", "iTerm2", "Python", "PharmAgent", "osascript", "System Events", "Réglages Système", "System Settings", "SystemUIServer", "Dock"}


def app_home() -> Path:
    env = os.environ.get("PHARMAGENT_HOME")
    if env:
        return Path(env)
    if SYSTEM == "Windows":
        return Path(os.environ.get("LOCALAPPDATA", str(Path.home()))) / "PharmAgent"
    if SYSTEM == "Darwin":
        return Path.home() / "Library" / "Application Support" / "PharmAgent"
    return Path.home() / ".local" / "share" / "PharmAgent"


HOME = app_home()
HOME.mkdir(parents=True, exist_ok=True)
CONFIG_PATH = HOME / "config.json"

# ─── Journal ────────────────────────────────────────────────────────────────

LOG_LINES: deque = deque(maxlen=200)
log = logging.getLogger("pharmagent")
log.setLevel(logging.INFO)
_fh = logging.handlers.RotatingFileHandler(HOME / "agent.log", maxBytes=1_000_000, backupCount=3, encoding="utf-8")
_fh.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
log.addHandler(_fh)
if sys.stdout and not os.environ.get("PHARMAGENT_QUIET"):
    _sh = logging.StreamHandler(sys.stdout)
    _sh.setFormatter(logging.Formatter("[PharmAgent] %(message)s"))
    log.addHandler(_sh)


class _PanelLog(logging.Handler):
    def emit(self, record: logging.LogRecord) -> None:
        LOG_LINES.append({"t": datetime.now().strftime("%H:%M:%S"), "level": record.levelname, "msg": record.getMessage()})


log.addHandler(_PanelLog())

# ─── Configuration ──────────────────────────────────────────────────────────


def load_config() -> Dict[str, Any]:
    try:
        return json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    except Exception:
        return {}


def save_config(cfg: Dict[str, Any]) -> None:
    tmp = CONFIG_PATH.with_suffix(".tmp")
    tmp.write_text(json.dumps(cfg, indent=2, ensure_ascii=False), encoding="utf-8")
    tmp.replace(CONFIG_PATH)


# ─── Client serveur ─────────────────────────────────────────────────────────


class ApiError(Exception):
    def __init__(self, status: int, message: str, code: str = ""):
        super().__init__(message)
        self.status = status
        self.code = code


class Api:
    def __init__(self, server: str):
        self.server = server.rstrip("/")
        self.key = ""

    def call(self, method: str, path: str, body: Any = None, timeout: float = 30) -> Any:
        data = json.dumps(body).encode("utf-8") if body is not None else None
        req = urllib.request.Request(self.server + path, data=data, method=method)
        req.add_header("Content-Type", "application/json")
        req.add_header("User-Agent", f"PharmAgent-Agent/{AGENT_VERSION}")
        if self.key:
            req.add_header("X-Agent-Key", self.key)
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                raw = r.read()
                return json.loads(raw) if raw else {}
        except urllib.error.HTTPError as e:
            try:
                payload = json.loads(e.read() or b"{}")
            except Exception:
                payload = {}
            raise ApiError(e.code, payload.get("error") or f"Erreur serveur {e.code}", payload.get("code", "")) from None
        except (urllib.error.URLError, socket.timeout, ConnectionError) as e:
            raise ApiError(0, f"Serveur injoignable ({getattr(e, 'reason', e)})") from None


# ─── Garde-fou ──────────────────────────────────────────────────────────────

FORBIDDEN = [
    r"\bvalid(er|ation|ez)\b", r"\bd[ée]finitiv", r"\bcl[oô]tur", r"\bcomptabilis", r"\bencaiss",
    r"\bconfirm(er|ation|ez)?\b", r"\bsoumettre\b", r"\bfinali[sz]", r"\bsubmit\b", r"\bcommit\b",
    r"\bpost(er)?\b", r"\benvoyer\b", r"\bvalidate\b", r"\bconfirm\b",
    # Site du grossiste : le panier est préparé, la commande n'est jamais passée par l'agent
    r"\bcommander\b", r"passer (la |ma )?commande", r"\bpayer\b", r"\bpaiement\b", r"\bcheckout\b", r"\bplace order\b", r"\bacheter\b",
]
_FORBIDDEN_RE = re.compile("|".join(FORBIDDEN), re.I)


def forbidden_text(text: str) -> bool:
    return bool(text) and bool(_FORBIDDEN_RE.search(text))


class GuardrailError(Exception):
    pass


class StepError(Exception):
    pass


class Aborted(Exception):
    pass


class _FileDone(Exception):
    """Fin normale du mode fichier (porte le message de résultat)."""


# ─── Champs et mise en forme des valeurs ────────────────────────────────────

HEADER_FIELDS = {
    "supplier": "Fournisseur", "documentNumber": "N° du bon", "documentDate": "Date du bon", "totalAmount": "Montant total",
}
LINE_FIELDS = {
    "product": "Produit (libellé ERP)", "cip": "Code CIP", "designation": "Libellé grossiste", "quantity": "Quantité",
    "lotNumber": "N° de lot", "expiryDate": "Date de péremption", "purchasePrice": "Prix d'achat",
    "salePrice": "Prix de vente", "lineTotal": "Total ligne", "freeUnits": "UG (gratuits)",
}
DATE_FIELDS = {"documentDate", "expiryDate"}
NUM_FIELDS = {"quantity", "purchasePrice", "salePrice", "lineTotal", "totalAmount", "freeUnits"}
DATE_FORMATS = ["%d/%m/%Y", "%d/%m/%y", "%m/%Y", "%m/%y", "%Y-%m-%d", "%d-%m-%Y", "%d.%m.%Y", "%m-%Y", "%d%m%Y", "%d%m%y", "%m%y", "%m%Y"]
KEYWORD_FIELDS = [
    (r"\bug\b|gratuit|\bfree\b", "freeUnits"),
    (r"cip|ean|code.?barre", "cip"), (r"lot", "lotNumber"), (r"p[ée]rem|expir|\bexp\b|dlu", "expiryDate"),
    (r"qt[ée]|quantit|qty|nombre", "quantity"), (r"prix.*achat|\bp\.?a\b|achat|co[uû]t", "purchasePrice"),
    (r"prix.*vente|\bp\.?v\b|ppv|public|vente", "salePrice"), (r"fournisseur|grossiste|supplier", "supplier"),
    (r"n[°o]?\s*(bl|bon|facture|doc)|r[ée]f[ée]rence|num[ée]ro", "documentNumber"), (r"date", "documentDate"),
    (r"produit|d[ée]signation|article|libell|m[ée]dicament", "product"),
]


def norm(s: Any) -> str:
    s = unicodedata.normalize("NFD", str(s or ""))
    s = "".join(c for c in s if unicodedata.category(c) != "Mn").upper()
    s = re.sub(r"(\d),(\d)", r"\1.\2", s)
    s = re.sub(r"[^A-Z0-9.%/]+", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def parse_num(v: str) -> Optional[float]:
    t = re.sub(r"[\s  ]", "", str(v)).replace(",", ".")
    try:
        return float(t)
    except ValueError:
        return None


def parse_iso(v: Any) -> Optional[date]:
    try:
        return datetime.strptime(str(v)[:10], "%Y-%m-%d").date()
    except ValueError:
        return None


_CONTROL = re.compile(r"[\x00-\x1f\x7f-\x9f\u2028\u2029]+")


def format_value(field: str, value: Any, fmt: Optional[str]) -> str:
    # Jamais de saut de ligne ni de tabulation dans un texte tapé : ce seraient les touches Entrée/Tab (risque de validation)
    return _CONTROL.sub(" ", _format_value(field, value, fmt)).strip()


def _format_value(field: str, value: Any, fmt: Optional[str]) -> str:
    if value is None:
        return ""
    if field in DATE_FIELDS:
        d = parse_iso(value)
        if not d:
            return str(value)
        return d.strftime(fmt or "%d/%m/%Y")
    if field in NUM_FIELDS:
        n = parse_num(value) if not isinstance(value, (int, float)) else float(value)
        if n is None:
            return str(value)
        if field == "quantity" or float(n).is_integer():
            return str(int(round(n)))
        s = f"{n:.2f}"
        return s.replace(".", ",") if fmt == "decimal_comma" else s
    return str(value)


def guess_field(value: str, label: str, phase: str, sample: Dict[str, Any]) -> (str, Optional[str]):
    """Devine quel champ du bon le pharmacien a saisi, d'après la valeur et le libellé du champ."""
    v = (value or "").strip()
    order = (list(LINE_FIELDS) + list(HEADER_FIELDS)) if phase == "line" else (list(HEADER_FIELDS) + list(LINE_FIELDS))
    if v:
        for f in order:
            sv = sample.get(f)
            if sv in (None, ""):
                continue
            if f in DATE_FIELDS:
                d = parse_iso(sv)
                if d:
                    for fmt in DATE_FORMATS:
                        if d.strftime(fmt) == v:
                            return f, fmt
                continue
            if f in NUM_FIELDS:
                n = parse_num(v)
                if n is not None and parse_num(str(sv)) == n:
                    return f, ("decimal_comma" if "," in v else None)
                continue
            if norm(v) == norm(sv):
                return f, None
        prod = norm(sample.get("product"))
        if phase == "line" and len(norm(v)) >= 3 and prod.startswith(norm(v)):
            return "product", None
    lab = (label or "").lower()
    for pattern, f in KEYWORD_FIELDS:
        if re.search(pattern, lab):
            if phase == "header" and f in LINE_FIELDS and f != "product":
                continue
            if phase == "line" and f in HEADER_FIELDS:
                continue
            if f in DATE_FIELDS:
                return f, infer_date_format(v)
            if f in NUM_FIELDS:
                return f, ("decimal_comma" if re.search(r"\d,\d", v) else None)
            return f, None
    return "const", None


def infer_date_format(v: str) -> Optional[str]:
    """Format d'une date tapée pendant la démo (« 12/2027 » → mm/aaaa)."""
    for fmt in DATE_FORMATS:
        try:
            datetime.strptime(v.strip(), fmt)
            return fmt
        except ValueError:
            continue
    return None


def value_for(step: Dict[str, Any], values: Dict[str, Any]) -> str:
    f = step.get("field") or "const"
    if f == "const":
        return step.get("value") or ""
    return format_value(f, values.get(f), step.get("format"))


# ─── Fenêtres du système (logiciel installé) ────────────────────────────────


def title_matches(actual: str, wanted: str) -> bool:
    a, w = (actual or "").casefold(), (wanted or "").casefold().strip()
    if not w:
        return True
    if w in a:
        return True
    head = w.split(" - ")[0].strip()
    return bool(head) and len(head) >= 4 and head in a


def list_windows() -> List[str]:
    try:
        if SYSTEM == "Windows":
            import ctypes
            from ctypes import wintypes
            user32 = ctypes.windll.user32
            titles: List[str] = []
            proc = ctypes.WINFUNCTYPE(ctypes.c_bool, wintypes.HWND, wintypes.LPARAM)

            def cb(hwnd, _):
                if user32.IsWindowVisible(hwnd):
                    n = user32.GetWindowTextLengthW(hwnd)
                    if n:
                        buf = ctypes.create_unicode_buffer(n + 1)
                        user32.GetWindowTextW(hwnd, buf, n + 1)
                        if buf.value.strip() and buf.value not in ("Program Manager",) and "PharmAgent" not in buf.value:
                            titles.append(buf.value)
                return True

            user32.EnumWindows(proc(cb), 0)
            return sorted(set(titles))
        if SYSTEM == "Darwin":
            out = subprocess.run(
                ["osascript", "-e", 'tell application "System Events" to get name of every process whose background only is false'],
                capture_output=True, text=True, timeout=8,
            ).stdout
            return sorted({x.strip() for x in out.split(",") if x.strip()} - IGNORED_APPS)
        out = subprocess.run(["wmctrl", "-l"], capture_output=True, text=True, timeout=5).stdout
        return sorted({t for t in (" ".join(l.split()[3:]) for l in out.splitlines() if len(l.split()) > 3) if "PharmAgent" not in t})
    except Exception:
        return []


def foreground_title() -> Optional[str]:
    try:
        if SYSTEM == "Windows":
            import ctypes
            user32 = ctypes.windll.user32
            hwnd = user32.GetForegroundWindow()
            n = user32.GetWindowTextLengthW(hwnd)
            buf = ctypes.create_unicode_buffer(n + 1)
            user32.GetWindowTextW(hwnd, buf, n + 1)
            return buf.value
        if SYSTEM == "Darwin":
            r = subprocess.run(
                ["osascript", "-e", 'tell application "System Events" to get name of first process whose frontmost is true'],
                capture_output=True, text=True, timeout=5,
            )
            # Échec d'osascript (autorisation refusée) : on ne bloque pas la démo sur une réponse vide
            return r.stdout.strip() if r.returncode == 0 and r.stdout.strip() else None
        r = subprocess.run(["xdotool", "getactivewindow", "getwindowname"], capture_output=True, text=True, timeout=3)
        return r.stdout.strip() if r.returncode == 0 else None
    except Exception:
        return None


def activate_window(title: str) -> bool:
    try:
        if SYSTEM == "Windows":
            import ctypes
            from ctypes import wintypes
            user32 = ctypes.windll.user32
            found: List[int] = []
            proc = ctypes.WINFUNCTYPE(ctypes.c_bool, wintypes.HWND, wintypes.LPARAM)

            def cb(hwnd, _):
                if user32.IsWindowVisible(hwnd):
                    n = user32.GetWindowTextLengthW(hwnd)
                    if n:
                        buf = ctypes.create_unicode_buffer(n + 1)
                        user32.GetWindowTextW(hwnd, buf, n + 1)
                        if title_matches(buf.value, title):
                            found.append(hwnd)
                            return False
                return True

            user32.EnumWindows(proc(cb), 0)
            if not found:
                return False
            hwnd = found[0]
            if user32.IsIconic(hwnd):
                user32.ShowWindow(hwnd, 9)
            fg = user32.GetForegroundWindow()
            if fg == hwnd:
                return True
            # Jamais de touche Alt seule : elle ouvre le menu de l'ERP et la frappe suivante y déclencherait une commande
            cur = ctypes.windll.kernel32.GetCurrentThreadId()
            fg_thread = user32.GetWindowThreadProcessId(fg, None) if fg else 0
            attached = bool(fg_thread) and fg_thread != cur and bool(user32.AttachThreadInput(cur, fg_thread, True))
            try:
                user32.SetForegroundWindow(hwnd)
                user32.BringWindowToTop(hwnd)
            finally:
                if attached:
                    user32.AttachThreadInput(cur, fg_thread, False)
            if user32.GetForegroundWindow() != hwnd:
                user32.keybd_event(0x10, 0, 0, 0)  # Maj : frappe neutre qui autorise le passage au premier plan
                user32.keybd_event(0x10, 0, 2, 0)
                user32.SetForegroundWindow(hwnd)
            return True
        if SYSTEM == "Darwin":
            safe = title.replace('"', "")
            # « is running » ne lance pas l'application : un logiciel fermé reste fermé, rien n'est tapé
            script = f'if application "{safe}" is running then\ntell application "{safe}" to activate\nreturn "ok"\nend if\nreturn "absent"'
            r = subprocess.run(["osascript", "-e", script], capture_output=True, text=True, timeout=8)
            return r.returncode == 0 and r.stdout.strip() == "ok"
        r = subprocess.run(["xdotool", "search", "--name", title, "windowactivate"], capture_output=True, timeout=5)
        return r.returncode == 0
    except Exception:
        return False


SHEET_EXT = (".xlsx", ".xls", ".xlsm", ".numbers", ".ods", ".csv")


def pick_file() -> str:
    """Fenêtre « Ouvrir » du système pour choisir le fichier Excel / Numbers à remplir (rien à taper)."""
    if SYSTEM == "Darwin":
        script = ('tell application (path to frontmost application as text)\n'
                  'set f to choose file with prompt "Fichier Excel ou Numbers à remplir par PharmAgent"\nend tell\nPOSIX path of f')
        r = subprocess.run(["osascript", "-e", script], capture_output=True, text=True, timeout=600)
        return r.stdout.strip() if r.returncode == 0 else ""
    if SYSTEM == "Windows":
        ps = ("Add-Type -AssemblyName System.Windows.Forms; $d = New-Object System.Windows.Forms.OpenFileDialog; "
              "$d.Filter = 'Tableur (*.xlsx;*.xls;*.xlsm;*.ods;*.csv)|*.xlsx;*.xls;*.xlsm;*.ods;*.csv|Tous les fichiers|*.*'; "
              "$d.Title = 'Fichier Excel a remplir par PharmAgent'; if ($d.ShowDialog() -eq 'OK') { $d.FileName }")
        r = subprocess.run(["powershell", "-NoProfile", "-STA", "-Command", ps], capture_output=True, text=True, timeout=600)
        return r.stdout.strip() if r.returncode == 0 else ""
    r = subprocess.run(["zenity", "--file-selection", "--title=Fichier à remplir"], capture_output=True, text=True, timeout=600)
    return r.stdout.strip() if r.returncode == 0 else ""


def open_file(path: str) -> None:
    try:
        if SYSTEM == "Windows":
            os.startfile(path)  # type: ignore[attr-defined]
        elif SYSTEM == "Darwin":
            subprocess.Popen(["open", path])
        else:
            subprocess.Popen(["xdg-open", path])
    except Exception as e:
        log.info("Ouverture du fichier impossible : %s", e)


def filled_path(template: str, document_number: str) -> Path:
    """Un nouveau fichier par bon, à côté du modèle : le modèle n'est jamais modifié ni écrasé."""
    src = Path(template)
    num = re.sub(r"[^\w.-]+", "-", document_number or "bon").strip("-")[:40] or "bon"
    out = src.with_name(f"{src.stem} - {num}.xlsx")
    k = 2
    while out.exists():
        out = src.with_name(f"{src.stem} - {num} ({k}).xlsx")
        k += 1
    return out


def capture_screen() -> Optional[bytes]:
    """Capture de l'écran en JPEG réduit, pour l'aide à distance (jamais sans clic de l'utilisateur)."""
    tmp = HOME / "aide.jpg"
    try:
        if SYSTEM == "Darwin":
            # Sans l'autorisation « Enregistrement de l'écran », macOS ne capture que le fond d'écran : on l'envoie quand même
            subprocess.run(["screencapture", "-x", "-t", "jpg", str(tmp)], timeout=20, check=True)
            subprocess.run(["sips", "-Z", "1600", "-s", "formatOptions", "60", str(tmp)], timeout=20, capture_output=True)
        elif SYSTEM == "Windows":
            ps = ("Add-Type -AssemblyName System.Windows.Forms,System.Drawing; $b=[System.Windows.Forms.Screen]::PrimaryScreen.Bounds; "
                  "$i=New-Object System.Drawing.Bitmap $b.Width,$b.Height; $g=[System.Drawing.Graphics]::FromImage($i); "
                  "$g.CopyFromScreen($b.Location,[System.Drawing.Point]::Empty,$b.Size); "
                  f"$i.Save('{tmp}',[System.Drawing.Imaging.ImageFormat]::Jpeg)")
            subprocess.run(["powershell", "-NoProfile", "-Command", ps], timeout=30, check=True, capture_output=True)
        else:
            return None
        data = tmp.read_bytes()
        tmp.unlink(missing_ok=True)
        return data if len(data) < 6_000_000 else None
    except Exception as e:
        log.info("Capture d'écran impossible : %s", e)
        return None


def foreground_is(title: str) -> bool:
    # Sécurité : si l'on ne sait pas quelle fenêtre est au premier plan, on considère que ce n'est PAS le logiciel
    fg = foreground_title()
    return fg is not None and title_matches(fg, title)


def mac_accessibility_ok() -> bool:
    if SYSTEM != "Darwin":
        return True
    try:
        import ctypes
        lib = ctypes.cdll.LoadLibrary("/System/Library/Frameworks/ApplicationServices.framework/ApplicationServices")
        lib.AXIsProcessTrusted.restype = ctypes.c_bool
        return bool(lib.AXIsProcessTrusted())
    except Exception:
        return True


def mac_input_monitoring_ok() -> bool:
    if SYSTEM != "Darwin":
        return True
    try:
        import ctypes
        cg = ctypes.cdll.LoadLibrary("/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics")
        cg.CGPreflightListenEventAccess.restype = ctypes.c_bool
        return bool(cg.CGPreflightListenEventAccess())
    except Exception:
        return True


_MAC_ACCESSIBILITY_PROMPT = '''
import ctypes
ax = ctypes.cdll.LoadLibrary("/System/Library/Frameworks/ApplicationServices.framework/ApplicationServices")
cf = ctypes.cdll.LoadLibrary("/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation")
key = ctypes.c_void_p.in_dll(ax, "kAXTrustedCheckOptionPrompt")
val = ctypes.c_void_p.in_dll(cf, "kCFBooleanTrue")
keys = (ctypes.c_void_p * 1)(key.value)
vals = (ctypes.c_void_p * 1)(val.value)
cf.CFDictionaryCreate.restype = ctypes.c_void_p
cf.CFDictionaryCreate.argtypes = [ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_long, ctypes.c_void_p, ctypes.c_void_p]
opts = cf.CFDictionaryCreate(None, keys, vals, 1, None, None)
ax.AXIsProcessTrustedWithOptions.argtypes = [ctypes.c_void_p]
ax.AXIsProcessTrustedWithOptions.restype = ctypes.c_bool
ax.AXIsProcessTrustedWithOptions(opts)
'''

_MAC_LISTEN_PROMPT = '''
import ctypes
cg = ctypes.cdll.LoadLibrary("/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics")
cg.CGRequestListenEventAccess.restype = ctypes.c_bool
cg.CGRequestListenEventAccess()
'''


def mac_request_permissions() -> None:
    # Appels faits dans un sous-processus : macOS rattache la demande à l'application qui a lancé l'agent
    # (Terminal, PharmAgent…), et un éventuel plantage ne touche pas l'agent.
    if SYSTEM != "Darwin":
        return
    for code in (_MAC_ACCESSIBILITY_PROMPT, _MAC_LISTEN_PROMPT):
        try:
            subprocess.run([sys.executable, "-c", code], capture_output=True, timeout=25)
        except Exception as e:
            log.info("Demande d'autorisation macOS impossible : %s", e)
    try:
        subprocess.run(["open", "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"], timeout=8)
    except Exception:
        pass


# ─── Enregistrement / rejeu clavier (logiciel installé) ─────────────────────

KEY_NAMES = ["tab", "enter", "up", "down", "left", "right", "esc", "delete", "home", "end", "page_up", "page_down", "insert"] + [f"f{i}" for i in range(1, 13)]
SKIP_COMBOS = {"alt+tab", "cmd+tab", "ctrl+alt+delete", "cmd+space", "ctrl+esc"}


class KeyRecorder:
    """Enregistre les frappes faites dans la fenêtre de l'ERP pendant la démo."""

    def __init__(self, window_title: str):
        self.window_title = window_title
        self.steps: List[Dict[str, Any]] = []
        self.buf = ""
        self.mods: set = set()
        self.fg_ok = True
        self.fg_title = ""
        self._stop = threading.Event()
        self._listener = None

    def start(self) -> None:
        from pynput import keyboard  # noqa: import tardif (dépendance optionnelle)
        self._listener = keyboard.Listener(on_press=self._on_press, on_release=self._on_release)
        self._listener.start()
        threading.Thread(target=self._watch_foreground, daemon=True).start()

    def stop(self) -> List[Dict[str, Any]]:
        self._stop.set()
        if self._listener:
            self._listener.stop()
        self._flush()
        return self.steps

    def _watch_foreground(self) -> None:
        while not self._stop.is_set():
            fg = foreground_title()
            self.fg_title = fg or ""
            self.fg_ok = True if fg is None else title_matches(fg, self.window_title)
            time.sleep(0.3)

    def _flush(self) -> None:
        if self.buf:
            self.steps.append({"kind": "type", "value": self.buf})
            self.buf = ""

    def snapshot(self) -> List[Dict[str, Any]]:
        ev = [{"type": st["kind"], "value": st.get("value"), "key": st.get("key")} for st in list(self.steps)]
        if self.buf:
            ev.append({"type": "type", "value": self.buf})
        return ev

    @staticmethod
    def _mod_name(key) -> Optional[str]:
        from pynput.keyboard import Key
        table = {
            Key.ctrl: "ctrl", Key.ctrl_l: "ctrl", Key.ctrl_r: "ctrl", Key.alt: "alt", Key.alt_l: "alt",
            Key.alt_r: "alt", Key.cmd: "cmd", Key.cmd_l: "cmd", Key.cmd_r: "cmd",
        }
        if getattr(Key, "alt_gr", None) is not None and key == Key.alt_gr:
            return "altgr"
        return table.get(key)

    def _on_release(self, key) -> None:
        name = self._mod_name(key)
        if name:
            self.mods.discard(name)

    def _on_press(self, key) -> None:
        from pynput.keyboard import Key
        mod = self._mod_name(key)
        if mod:
            self.mods.add(mod)
            return
        if key in (Key.shift, Key.shift_l, Key.shift_r, Key.caps_lock):
            return
        if not self.fg_ok:
            return
        char = getattr(key, "char", None)
        combo_mods = [m for m in ("ctrl", "alt", "cmd") if m in self.mods]
        is_combo = "cmd" in self.mods or ("ctrl" in self.mods and "alt" not in self.mods and "altgr" not in self.mods)
        if char and char.isprintable() and not is_combo:
            self.buf += char
            return
        if key == Key.space and not is_combo:
            self.buf += " "
            return
        if key == Key.backspace and self.buf and not is_combo:
            self.buf = self.buf[:-1]
            return
        name = None
        if char and char.isprintable():
            name = char.lower()
        elif getattr(key, "vk", None) and 65 <= key.vk <= 90:
            name = chr(key.vk).lower()
        elif isinstance(key, Key):
            name = key.name
        if not name:
            return
        full = "+".join(combo_mods + [name]) if (combo_mods and is_combo) or (combo_mods and name not in KEY_NAMES) else name
        if full in SKIP_COMBOS:
            return
        self._flush()
        self.steps.append({"kind": "key", "key": full})


class KeyPlayer:
    def __init__(self, window_title: str, stop_event: threading.Event):
        from pynput.keyboard import Controller, Key, Listener
        self.Key = Key
        self.kb = Controller()
        self.title = window_title
        self.stop_event = stop_event
        self.injecting_esc = False
        self._listener = Listener(on_press=self._watch_esc)
        self._listener.start()
        # Windows : tant que l'écoute du clavier démarre, la première frappe envoyée peut être perdue
        self._listener.wait()
        time.sleep(0.3)

    def close(self) -> None:
        self._listener.stop()

    def _watch_esc(self, key) -> None:
        if key == self.Key.esc and not self.injecting_esc:
            self.stop_event.set()

    def ensure_window(self) -> None:
        if not self.title:
            raise StepError("Aucun logiciel choisi : refaites le réglage dans le panneau d'Agent Floki.")
        if foreground_is(self.title):
            return
        if not activate_window(self.title):
            raise StepError(f"Le logiciel « {self.title} » n'est pas ouvert : rien n'a été tapé. Ouvrez-le sur l'écran de saisie, puis renvoyez le bon.")
        time.sleep(0.5)
        if foreground_is(self.title):
            return
        if foreground_title() is None:
            raise StepError("Impossible de vérifier la fenêtre au premier plan : rien n'a été tapé. Sur Mac, autorisez Terminal dans Réglages Système › Confidentialité et sécurité › Automatisation et Accessibilité.")
        raise StepError(f"La fenêtre « {self.title} » n'est pas au premier plan (une autre fenêtre a pris la main) : saisie arrêtée. Ouvrez l'écran de saisie puis renvoyez le bon.")

    def press(self, combo: str) -> None:
        parts = combo.split("+")
        mods = {"ctrl": self.Key.ctrl, "alt": self.Key.alt, "cmd": self.Key.cmd, "shift": self.Key.shift}
        held = [mods[p] for p in parts[:-1] if p in mods]
        last = parts[-1]
        key = getattr(self.Key, last, None) if last in KEY_NAMES or last == "backspace" else last
        if key is None:
            return
        self.injecting_esc = last == "esc"
        try:
            for m in held:
                self.kb.press(m)
            self.kb.press(key)
            self.kb.release(key)
            for m in reversed(held):
                self.kb.release(m)
        finally:
            self.injecting_esc = False

    def run(self, steps: List[Dict[str, Any]], values: Dict[str, Any], check_each_step: bool) -> None:
        self.ensure_window()
        for i, st in enumerate(steps):
            if self.stop_event.is_set():
                raise Aborted("Arrêt demandé (touche Échap).")
            if check_each_step and i:
                self.ensure_window()
            kind = st.get("kind")
            if kind == "type":
                text = value_for(st, values)
                if text:
                    if check_each_step and not foreground_is(self.title):
                        self.ensure_window()
                    self.kb.type(text)
                if st.get("field") in ("product", "cip"):
                    time.sleep(0.7)  # laisse la liste de recherche de l'ERP se remplir
            elif kind == "key":
                self.press(st.get("key", ""))
            elif kind == "wait":
                time.sleep(min(10, (st.get("ms") or 300) / 1000))
            time.sleep(0.06)


def desktop_steps_from(raw: List[Dict[str, Any]], phase: str, sample: Dict[str, Any]) -> List[Dict[str, Any]]:
    steps = []
    for st in raw:
        if st["kind"] == "type":
            field, fmt = guess_field(st["value"], "", phase, sample)
            st = {**st, "field": field, "format": fmt, "label": ""}
        steps.append(st)
    return steps


# ─── Navigateur (ERP web) ───────────────────────────────────────────────────

RECORDER_JS = r"""
(() => {
  if (window.__paRec) return; window.__paRec = true;
  const DYN = /\d{4,}|[0-9a-f]{8,}|^(ext-|ember|react-|mui-|ng-|j_id|:r|rc-|headlessui|radix-)/i;
  const q = (s) => String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const clean = (s, n = 80) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);
  const EDIT = new Set(['', 'text', 'search', 'number', 'tel', 'email', 'date', 'datetime-local', 'month', 'url', 'password']);
  const send = (ev) => { try { if (window.__pharmagentRecord) window.__pharmagentRecord(ev); } catch (e) {} };
  const isEditable = (el) => {
    if (!el || el.nodeType !== 1) return false;
    if (el.isContentEditable) return true;
    if (el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') return true;
    return el.tagName === 'INPUT' && EDIT.has((el.getAttribute('type') || '').toLowerCase());
  };
  const valueOf = (el) => el.tagName === 'SELECT' ? (el.options[el.selectedIndex] ? el.options[el.selectedIndex].text : '')
    : el.isContentEditable ? el.innerText : el.value;
  const realLabel = (el) => {
    const a = el.getAttribute('aria-label'); if (a) return clean(a);
    if (el.id) { const l = document.querySelector(`label[for="${q(el.id)}"]`); if (l) return clean(l.innerText); }
    const lb = el.getAttribute('aria-labelledby');
    if (lb) { const l = document.getElementById(lb.split(' ')[0]); if (l) return clean(l.innerText); }
    const pl = el.closest('label'); if (pl) return clean(pl.innerText);
    return '';
  };
  const hintLabel = (el) => {
    const r = realLabel(el); if (r) return r;
    const td = el.closest('td,th');
    if (td) {
      const table = td.closest('table');
      const th = table && table.querySelectorAll('thead th, tr:first-child th')[td.cellIndex];
      if (th) return clean(th.innerText);
    }
    let p = el.parentElement;
    for (let i = 0; p && i < 3; i++, p = p.parentElement) {
      const t = clean(p.innerText, 60); if (t) return t;
    }
    return clean(el.getAttribute('placeholder') || el.getAttribute('name') || el.getAttribute('title') || '');
  };
  const roleOf = (el) => el.getAttribute('role') || ({ BUTTON: 'button', A: 'link' })[el.tagName]
    || (el.tagName === 'INPUT' && /^(button|submit|reset)$/i.test(el.type) ? 'button' : '');
  const cssPath = (el) => {
    const parts = []; let cur = el;
    for (let d = 0; cur && cur.nodeType === 1 && d < 8; d++) {
      const tag = cur.tagName.toLowerCase();
      if (cur.id && !DYN.test(cur.id)) { parts.unshift('#' + CSS.escape(cur.id)); break; }
      if (tag === 'body' || tag === 'html') { parts.unshift(tag); break; }
      const parent = cur.parentElement; let part = tag;
      if (parent) {
        const same = Array.from(parent.children).filter((c) => c.tagName === cur.tagName);
        if (same.length > 1) {
          const idx = same.indexOf(cur);
          // Ligne de tableau : « la dernière » plutôt que « la n-ième » (nouvelle ligne ajoutée à la fin)
          part += (tag === 'tr' && idx === same.length - 1) ? ':last-of-type' : `:nth-of-type(${idx + 1})`;
        }
      }
      parts.unshift(part); cur = parent;
    }
    return parts.join(' > ');
  };
  const selectorsFor = (el, editable) => {
    const s = []; const tag = el.tagName.toLowerCase();
    const add = (x) => { if (x && !s.includes(x)) s.push(x); };
    if (el.id && !DYN.test(el.id)) add('#' + CSS.escape(el.id));
    for (const attr of ['name', 'data-testid', 'data-test', 'data-field', 'formcontrolname', 'ng-model', 'aria-label', 'placeholder', 'title']) {
      const v = el.getAttribute(attr);
      if (v && !DYN.test(v) && v.length < 80) add(`${tag}[${attr}="${q(v)}"]`);
    }
    if (editable) { const l = realLabel(el); if (l) add('label=' + l); }
    else {
      const t = clean(el.innerText || el.value, 50); const r = roleOf(el);
      if (t && r) add(`role=${r}|${t}`);
      if (t) add('text=' + t);
    }
    add(cssPath(el));
    return s;
  };
  const OPTION_SEL = '[role=option], [role=listbox] li, .ui-menu-item, .ui-autocomplete li, .dropdown-item, .autocomplete-suggestion, .tt-suggestion, .select2-results__option, .typeahead li, .awesomplete li, [class*=suggest] li, [class*=autocomplete] li, [class*=result] li, [class*=dropdown] li, [class*=option]';
  const optionGeneric = (el) => {
    const tag = el.tagName.toLowerCase(); const role = el.getAttribute('role');
    const cls = Array.from(el.classList).filter((c) => !/active|hover|focus|select|highlight|ui-state|current|^is-|^has-/i.test(c) && !DYN.test(c)).slice(0, 2);
    return tag + (role ? `[role="${q(role)}"]` : '') + cls.map((c) => '.' + CSS.escape(c)).join('');
  };
  const initial = new WeakMap(); const viaOf = new WeakMap(); let lastMouseAt = 0;
  const flush = (el, fromChange) => {
    if (!el || !isEditable(el)) return;
    // Une liste <select> peut changer sans avoir eu le focus (choix au clavier, raccourci)
    if (!initial.has(el)) { if (!fromChange) return; initial.set(el, ''); }
    const v = valueOf(el);
    if (v === initial.get(el)) return;
    initial.set(el, v);
    send({ type: el.tagName === 'SELECT' ? 'select' : 'fill', selectors: selectorsFor(el, true), value: clean(v, 300),
           label: hintLabel(el), via: viaOf.get(el) || 'mouse' });
  };
  window.__paFlush = () => flush(document.activeElement);
  document.addEventListener('focusin', (e) => {
    const el = e.target; if (!isEditable(el)) return;
    initial.set(el, valueOf(el));
    viaOf.set(el, Date.now() - lastMouseAt < 700 ? 'mouse' : 'key');
  }, true);
  document.addEventListener('focusout', (e) => flush(e.target), true);
  document.addEventListener('change', (e) => flush(e.target, true), true);
  document.addEventListener('keydown', (e) => {
    if (!['Enter', 'ArrowDown', 'ArrowUp', 'Tab', 'Escape'].includes(e.key)) return;
    const el = e.target; flush(el);
    send({ type: 'press', key: (e.shiftKey && e.key === 'Tab') ? 'Shift+Tab' : e.key, selectors: isEditable(el) ? selectorsFor(el, true) : [] });
  }, true);
  document.addEventListener('mousedown', (e) => {
    lastMouseAt = Date.now();
    const t = e.target instanceof Element ? e.target : null; if (!t) return;
    flush(document.activeElement);
    if (isEditable(t)) return;
    const lab = t.closest('label'); if (lab && lab.control && isEditable(lab.control)) return;
    const optEl = t.closest(OPTION_SEL);
    const el = optEl || t.closest('button, a, [role=button], [role=option], [role=menuitem], [role=tab], li, tr, td, input[type=button], input[type=submit], input[type=reset], input[type=checkbox], input[type=radio], [onclick], .btn');
    if (!el) return;
    send({ type: 'click', selectors: selectorsFor(el, false), text: clean(el.innerText || el.value || el.getAttribute('aria-label') || el.title, 80),
           isOption: !!optEl, option: optEl ? optionGeneric(optEl) : null });
  }, true);
})();
"""

OPTION_SEL_ALL = (
    "[role=option], [role=listbox] li, .ui-menu-item, .ui-autocomplete li, .dropdown-item, .autocomplete-suggestion, "
    ".tt-suggestion, .select2-results__option, .typeahead li, .awesomplete li, [class*=suggest] li, "
    "[class*=autocomplete] li, [class*=result] li, [class*=dropdown] li"
)
VISIBLE_TEXTS_JS = "els => els.slice(0, 80).map(e => [ (e.innerText || e.textContent || '').replace(/\\s+/g,' ').trim(), !!(e.offsetWidth || e.offsetHeight || e.getClientRects().length) ])"
ACTIVE_EDITABLE_JS = """() => { const e = document.activeElement; if (!e) return false;
  if (e.isContentEditable) return true; if (e.tagName === 'TEXTAREA') return true;
  return e.tagName === 'INPUT' && !/^(button|submit|reset|checkbox|radio|hidden|file|image)$/i.test(e.type || ''); }"""

# JS qui scanne TOUTES les zones de saisie de la page pour le mapping automatique (PharmSync)
DOM_SURVEY_JS = r"""() => {
  const EDIT = new Set(['', 'text', 'search', 'number', 'tel', 'email', 'date', 'datetime-local', 'month', 'url', 'password']);
  const FORBIDDEN = /valider|confirmer|cl[oô]turer|soumettre|commander|payer|checkout|enregistrer.{0,20}(d[ée]finitiv|final)/i;
  const q = s => String(s).replace(/"/g, '\\"');
  function getLabel(el) {
    const a = el.getAttribute('aria-label'); if (a && a.trim()) return a.trim().slice(0, 80);
    if (el.id) { const l = document.querySelector('label[for="' + q(el.id) + '"]'); if (l) return l.innerText.trim().slice(0, 80); }
    const lb = el.getAttribute('aria-labelledby');
    if (lb) { const l = document.getElementById(lb.split(' ')[0]); if (l) return l.innerText.trim().slice(0, 80); }
    const pl = el.closest('label'); if (pl) return pl.innerText.replace(el.value||'','').trim().slice(0, 80);
    const td = el.closest('td,th');
    if (td) { const t = td.closest('table'); const th = t && t.querySelectorAll('thead th, tr:first-child th')[td.cellIndex]; if (th) return th.innerText.trim().slice(0, 80); }
    return (el.getAttribute('placeholder') || el.getAttribute('title') || el.getAttribute('name') || '').trim().slice(0, 80);
  }
  function getSels(el) {
    const s = []; const tag = el.tagName.toLowerCase();
    if (el.id && !/^\d|^ext-|^ember|^react-|^ng-/i.test(el.id)) s.push('#' + CSS.escape(el.id));
    for (const a of ['name','data-testid','data-field','aria-label','placeholder']) {
      const v = el.getAttribute(a); if (v && v.length < 60 && !/^\d{4,}/.test(v)) s.push(tag+'['+a+'="'+q(v)+'"]');
    }
    const lbl = getLabel(el); if (lbl) s.push('label='+lbl);
    return s.slice(0, 4);
  }
  function inLine(el) {
    if (el.closest('tr') && el.closest('tbody')) return true;
    const cls = ['line','row','item','product','article','ligne','produit'];
    return cls.some(c => el.closest('[class*="'+c+'"]') && document.querySelectorAll('[class*="'+c+'"]').length > 1);
  }
  const fields = Array.from(document.querySelectorAll('input,select,textarea'))
    .filter(el => { const t=(el.getAttribute('type')||'').toLowerCase(); return el.tagName!=='INPUT'||EDIT.has(t); })
    .filter(el => !el.closest('[style*="display:none"],[hidden],[style*="visibility:hidden"]'))
    .filter(el => el.offsetWidth>0||el.offsetHeight>0)
    .map(el => ({ label: getLabel(el), type: el.tagName==='SELECT'?'select':(el.getAttribute('type')||'text').toLowerCase(), selectors: getSels(el), inLine: inLine(el), required: el.required||el.getAttribute('aria-required')==='true' }))
    .filter(f => f.selectors.length>0 && f.label);
  const addBtns = Array.from(document.querySelectorAll('button,[type="button"],a[role="button"]'))
    .filter(el => /ajouter|add.*(ligne|line|produit|article)|nouvelle.*(ligne|line)/i.test(el.innerText||el.title||el.getAttribute('aria-label')||''))
    .filter(el => !FORBIDDEN.test(el.innerText||''))
    .map(el => ({ text: (el.innerText||el.title||'').trim().slice(0,60), selectors: getSels(el) }));
  return { url: location.href, title: document.title.slice(0,120), fields, addLineButtons: addBtns };
}"""

PRODUCT_HINT = re.compile(r"\d|\b(CP|CPR|GEL|SIROP|SIR|SUSP|INJ|AMP|SACH|CREME|POMM|COLL|SUPPO|SOL|GTT|PDRE|MG|ML|B/)\b")


def option_score(text: str, target: str) -> float:
    t, g = norm(text), norm(target)
    if not t or not g:
        return 0.0
    if t == g:
        return 1.0
    nums_g = set(re.findall(r"\d+(?:\.\d+)?", g))
    nums_t = set(re.findall(r"\d+(?:\.\d+)?", t))
    if g in t:
        return 0.96 if nums_g <= nums_t else 0.5
    if nums_g and not nums_g <= nums_t:
        return 0.0
    if t in g and len(t) >= 0.6 * len(g):
        return 0.9
    return difflib.SequenceMatcher(None, t, g).ratio() * 0.95


def extract_products(payload: Any) -> List[Dict[str, Any]]:
    """Récupère des produits dans une réponse JSON de la recherche produit de l'ERP."""
    label_k = re.compile(r"lib|design|denom|^nom|name|label|produit|product|article|title", re.I)
    cip_k = re.compile(r"cip|ean|gtin|barcode|code", re.I)
    pa_k = re.compile(r"achat|^pa$|^pa_|cost|cout|purchase|pamp", re.I)
    pv_k = re.compile(r"vente|^pv$|^pv_|ppv|public|price|prix|tarif|sale", re.I)
    st_k = re.compile(r"stock|qte|qty|quant", re.I)
    rows: List[Dict[str, Any]] = []

    def arrays(obj: Any, depth: int = 0):
        if depth > 3:
            return
        if isinstance(obj, list) and obj and isinstance(obj[0], dict):
            yield obj
        elif isinstance(obj, dict):
            for v in obj.values():
                yield from arrays(v, depth + 1)

    for arr in arrays(payload):
        found = []
        for d in arr[:500]:
            if not isinstance(d, dict):
                continue
            label = next((v for k, v in d.items() if label_k.search(k) and isinstance(v, str) and 3 <= len(v) <= 150), None)
            if not label:
                continue
            row: Dict[str, Any] = {"erpLabel": label.strip()}
            for k, v in d.items():
                if isinstance(v, bool) or v in (None, ""):
                    continue
                if "cip" not in row and cip_k.search(k) and re.fullmatch(r"\d{7,14}", str(v).strip()):
                    row["cip"] = str(v).strip()
                elif "purchasePriceFCFA" not in row and pa_k.search(k) and parse_num(v) is not None:
                    row["purchasePriceFCFA"] = parse_num(v)
                elif "salePriceFCFA" not in row and pv_k.search(k) and parse_num(v) is not None:
                    row["salePriceFCFA"] = parse_num(v)
                elif "stockQty" not in row and st_k.search(k) and parse_num(v) is not None:
                    row["stockQty"] = parse_num(v)
            found.append(row)
        # Écarte les listes qui ne ressemblent pas à des produits (clients, utilisateurs…)
        if found and sum(1 for r in found if PRODUCT_HINT.search(norm(r["erpLabel"]))) >= max(1, len(found) // 2):
            rows.extend(found)
    return rows


def web_steps_from(events: List[Dict[str, Any]], phase: str, sample: Dict[str, Any], warnings: List[str]) -> List[Dict[str, Any]]:
    steps: List[Dict[str, Any]] = []
    for ev in events:
        t = ev.get("type")
        frame = ev.get("frame")
        if t in ("fill", "select"):
            kind = "fill" if t == "fill" else "select"
            last = steps[-1] if steps else None
            # Après un choix dans la liste, l'ERP réécrit lui-même le champ produit : ce n'est pas une saisie
            if last and last["kind"] == "pick" and len(steps) >= 2 and steps[-2]["kind"] == "fill" \
                    and steps[-2].get("selectors", [None])[:1] == ev.get("selectors", [None])[:1]:
                continue
            if last and last["kind"] == kind and last.get("selectors", [None])[:1] == ev.get("selectors", [None])[:1]:
                last["value"] = ev.get("value", "")
                continue
            steps.append({"kind": kind, "selectors": ev.get("selectors", []), "value": ev.get("value", ""),
                          "label": ev.get("label", ""), "via": ev.get("via", "mouse"), "frame": frame})
        elif t == "click":
            text = ev.get("text", "")
            if forbidden_text(text):
                warnings.append(f"Clic sur « {text} » ignoré : Agent Floki ne valide jamais à la place du pharmacien.")
                continue
            prev = next((s for s in reversed(steps) if s["kind"] != "press"), None)
            if ev.get("isOption") and prev and prev["kind"] == "fill":
                # Les flèches/Entrée tapées pour choisir dans la liste sont remplacées par le choix
                while steps and steps[-1]["kind"] == "press" and steps[-1].get("key") in ("ArrowDown", "ArrowUp", "Enter"):
                    steps.pop()
                steps.append({"kind": "pick", "selectors": [ev["option"]] if ev.get("option") else [],
                              "value": text, "label": prev.get("label", ""), "frame": frame})
                continue
            steps.append({"kind": "click", "selectors": ev.get("selectors", []), "text": text, "label": text, "frame": frame})
        elif t == "press":
            key = ev.get("key", "")
            if key == "Escape":
                continue
            steps.append({"kind": "press", "key": key, "selectors": ev.get("selectors", []), "frame": frame})

    # Choix au clavier dans une liste : saisie, flèches…, Entrée → choix dans la liste
    out: List[Dict[str, Any]] = []
    i = 0
    while i < len(steps):
        st = steps[i]
        out.append(st)
        if st["kind"] == "fill":
            j = i + 1
            arrows = 0
            while j < len(steps) and steps[j]["kind"] == "press" and steps[j]["key"] in ("ArrowDown", "ArrowUp"):
                arrows += 1
                j += 1
            if arrows and j < len(steps) and steps[j]["kind"] == "press" and steps[j]["key"] == "Enter":
                out.append({"kind": "pick", "selectors": [], "value": "", "label": st.get("label", ""), "frame": st.get("frame")})
                i = j + 1
                continue
        i += 1

    for idx, st in enumerate(out):
        if st["kind"] in ("fill", "select"):
            field, fmt = guess_field(st.get("value", ""), st.get("label", ""), phase, sample)
            st["field"], st["format"] = field, fmt
    for idx, st in enumerate(out):
        if st["kind"] == "pick":
            prev = next((s for s in reversed(out[:idx]) if s["kind"] == "fill"), None)
            if prev and prev.get("field") not in ("product", "cip"):
                prev["field"], prev["format"] = "product", None
            st["field"] = prev.get("field", "product") if prev else "product"
    return out


class WebDriver:
    """Pilote le navigateur de l'ERP (un seul thread : celui du moteur)."""

    def __init__(self, on_event: Callable[[Dict[str, Any]], None]):
        self.on_event = on_event
        self.pw = None
        self.ctx = None
        self.responses: deque = deque(maxlen=60)

    @property
    def is_open(self) -> bool:
        try:
            return self.ctx is not None and self.ctx.pages is not None
        except Exception:
            return False

    def open(self, url: Optional[str] = None) -> None:
        if not self.is_open:
            self._launch()
        page = self.page()
        if url and (not page.url or page.url == "about:blank"):
            page.goto(url, wait_until="domcontentloaded", timeout=45000)
        page.bring_to_front()

    def _launch(self) -> None:
        from playwright.sync_api import sync_playwright
        if self.pw is None:
            self.pw = sync_playwright().start()
        exe = os.environ.get("PHARMAGENT_CHROMIUM_PATH")
        if os.environ.get("PHARMAGENT_BROWSER_CHANNEL"):
            channels = [os.environ["PHARMAGENT_BROWSER_CHANNEL"]]
        elif SYSTEM == "Windows":
            channels = ["msedge", "chrome", None]
        elif SYSTEM == "Darwin":
            channels = ["chrome", "msedge", None]
        else:
            channels = [None, "chrome"]
        args = ["--start-maximized", "--disable-features=Translate", "--no-default-browser-check"]
        if os.environ.get("PHARMAGENT_CDP_PORT"):
            args.append(f"--remote-debugging-port={os.environ['PHARMAGENT_CDP_PORT']}")
        last_err: Optional[Exception] = None
        for ch in ([None] if exe else channels):
            try:
                kw: Dict[str, Any] = dict(
                    user_data_dir=str(HOME / "navigateur"), headless=os.environ.get("PHARMAGENT_HEADLESS") == "1",
                    no_viewport=True, args=args,
                )
                if exe:
                    kw["executable_path"] = exe
                elif ch:
                    kw["channel"] = ch
                self.ctx = self.pw.chromium.launch_persistent_context(**kw)
                log.info("Navigateur ouvert (%s).", ch or "Chromium")
                break
            except Exception as e:  # navigateur absent : on essaie le suivant
                last_err = e
        else:
            raise RuntimeError(f"Impossible d'ouvrir le navigateur : {last_err}")
        self.ctx.add_init_script(RECORDER_JS)
        self.ctx.expose_binding("__pharmagentRecord", self._binding)
        self.ctx.on("response", self._on_response)
        self.ctx.on("close", lambda *_: setattr(self, "ctx", None))

    def close(self) -> None:
        try:
            if self.ctx:
                self.ctx.close()
        except Exception:
            pass
        self.ctx = None

    def page(self):
        pages = [p for p in self.ctx.pages if not p.is_closed()]
        if not pages:
            return self.ctx.new_page()
        return pages[-1]

    def erp_page(self, erp_url: Optional[str], form_url: Optional[str]):
        origins = {urlparse(u).netloc for u in (erp_url, form_url) if u}
        pages = [p for p in self.ctx.pages if not p.is_closed()]
        for p in reversed(pages):
            if urlparse(p.url).netloc in origins:
                return p
        return self.page()

    def pump(self, ms: int = 100) -> None:
        if self.is_open:
            try:
                self.page().wait_for_timeout(ms)
                return
            except Exception:
                pass
        time.sleep(ms / 1000)

    def _binding(self, source: Dict[str, Any], ev: Dict[str, Any]) -> None:
        frame = source.get("frame")
        desc = None
        try:
            page = source.get("page")
            if frame is not None and page is not None and frame != page.main_frame:
                desc = f"name:{frame.name}" if frame.name else f"url:{urlparse(frame.url).path}"
        except Exception:
            pass
        ev = dict(ev)
        ev["frame"] = desc
        ev["at"] = time.time()
        self.on_event(ev)

    def _on_response(self, response) -> None:
        try:
            if response.request.resource_type in ("xhr", "fetch") and "json" in (response.headers.get("content-type") or ""):
                self.responses.append((time.time(), response))
        except Exception:
            pass

    def collect_products(self, since: float) -> List[Dict[str, Any]]:
        rows: List[Dict[str, Any]] = []
        for at, resp in list(self.responses):
            if at < since:
                continue
            try:
                body = resp.body()
                if len(body) > 3_000_000:
                    continue
                rows.extend(extract_products(json.loads(body)))
            except Exception:
                continue
        return rows

    def flush_inputs(self) -> None:
        for p in self.ctx.pages:
            for f in p.frames:
                try:
                    f.evaluate("() => window.__paFlush && window.__paFlush()")
                except Exception:
                    pass

    def install_recorder(self) -> None:
        for p in self.ctx.pages:
            for f in p.frames:
                try:
                    f.evaluate(RECORDER_JS)
                except Exception:
                    pass

    # ── Rejeu ──

    @staticmethod
    def frame_for(page, desc: Optional[str]):
        if not desc:
            return page.main_frame
        kind, _, val = desc.partition(":")
        for f in page.frames:
            if kind == "name" and f.name == val:
                return f
            if kind == "url" and urlparse(f.url).path == val:
                return f
        return page.main_frame

    @staticmethod
    def _locator(frame, sel: str):
        if sel.startswith("label="):
            return frame.get_by_label(sel[6:], exact=True)
        if sel.startswith("text="):
            return frame.get_by_text(sel[5:], exact=True)
        if sel.startswith("role="):
            role, _, name = sel[5:].partition("|")
            return frame.get_by_role(role, name=name, exact=True)
        return frame.locator(sel)

    def find(self, frame, selectors: List[str], what: str, timeout: float = 8.0):
        deadline = time.time() + timeout
        while True:
            for sel in selectors:
                try:
                    loc = self._locator(frame, sel)
                    n = loc.count()
                    if n == 0:
                        continue
                    vis = loc.evaluate_all(VISIBLE_TEXTS_JS)
                    for i, (_, visible) in enumerate(vis):
                        if visible:
                            return loc.nth(i)
                except Exception:
                    continue
            if time.time() > deadline:
                raise StepError(f"Champ « {what} » introuvable à l'écran. L'ERP est-il ouvert sur l'écran de saisie ?")
            time.sleep(0.12)

    def run_steps(self, page, steps: List[Dict[str, Any]], values: Dict[str, Any], should_stop: Callable[[], bool], captured: List[Dict[str, Any]]) -> None:
        for idx, st in enumerate(steps):
            if should_stop():
                raise Aborted("Saisie arrêtée depuis le panneau.")
            kind = st.get("kind")
            frame = self.frame_for(page, st.get("frame"))
            what = st.get("label") or st.get("text") or LINE_FIELDS.get(st.get("field", ""), HEADER_FIELDS.get(st.get("field", ""), "champ"))
            nxt = steps[idx + 1] if idx + 1 < len(steps) else None
            if kind == "fill":
                val = value_for(st, values)
                is_search = bool(nxt and nxt.get("kind") == "pick")
                if is_search:
                    self._search_and_pick(page, frame, st, nxt, val, what, captured)
                    continue
                self._type_into(page, frame, st, val, what, slow=False)
            elif kind == "pick":
                continue  # traité avec la saisie qui le précède
            elif kind == "select":
                val = value_for(st, values)
                loc = self.find(frame, st.get("selectors", []), what)
                options = loc.evaluate("el => Array.from(el.options).map(o => [o.value, o.text])")
                best, best_sc = None, 0.0
                for value, text in options:
                    t, v = norm(text), norm(val)
                    if not t:
                        continue
                    sc = 1.0 if t == v else 0.9 if (t in v.split() or v.startswith(t) or t.startswith(v)) else option_score(text, val)
                    if sc > best_sc:
                        best, best_sc = value, sc
                if best is None or best_sc < 0.6:
                    raise StepError(f"« {val} » absent de la liste « {what} » de l'ERP.")
                loc.select_option(value=best, timeout=3000)
            elif kind == "click":
                loc = self.find(frame, st.get("selectors", []), what)
                actual = ""
                try:
                    actual = loc.inner_text(timeout=1000) or loc.get_attribute("value") or ""
                except Exception:
                    pass
                if forbidden_text(actual) or forbidden_text(st.get("text", "")):
                    raise GuardrailError(f"Garde-fou : clic sur « {actual or st.get('text')} » refusé. Agent Floki ne valide jamais.")
                loc.click(timeout=5000)
            elif kind == "press":
                key = st.get("key", "")
                if key:
                    page.keyboard.press(key)
            elif kind == "wait":
                page.wait_for_timeout(min(10000, int(st.get("ms") or 300)))

    def _type_into(self, page, frame, st: Dict[str, Any], val: str, what: str, slow: bool) -> None:
        if st.get("via") == "key":
            try:
                if frame.evaluate(ACTIVE_EDITABLE_JS):
                    page.keyboard.press("ControlOrMeta+A")
                    if val:
                        page.keyboard.type(val, delay=25 if slow else 0)
                    else:
                        page.keyboard.press("Delete")
                    return
            except Exception:
                pass
        loc = self.find(frame, st.get("selectors", []), what)
        if slow:
            loc.click(timeout=5000)
            loc.press("ControlOrMeta+A")
            loc.press_sequentially(val, delay=25)
        else:
            loc.fill(val, timeout=5000)

    def _search_and_pick(self, page, frame, fill_step, pick_step, target: str, what: str, captured: List[Dict[str, Any]]) -> None:
        words = norm(target).split()
        queries = [target]
        if len(words) > 2:
            queries.append(" ".join(words[:2]))
        if words and len(words[0]) >= 4:
            queries.append(words[0])
        selectors = (pick_step.get("selectors") or []) + [OPTION_SEL_ALL]
        for qi, query in enumerate(dict.fromkeys(queries)):
            started = time.time()
            self._type_into(page, frame, fill_step, query, what, slow=True)
            deadline = time.time() + (2.5 if qi < len(queries) - 1 else 4.0)
            while time.time() < deadline:
                best = None
                for fr in [frame] + [f for f in page.frames if f != frame]:
                    for sel in selectors:
                        try:
                            loc = fr.locator(sel)
                            items = loc.evaluate_all(VISIBLE_TEXTS_JS)
                        except Exception:
                            continue
                        for i, (text, visible) in enumerate(items):
                            if not visible:
                                continue
                            sc = option_score(text, target)
                            if sc >= 0.85 and (best is None or sc > best[0]):
                                best = (sc, loc, i, text)
                    if best and best[0] == 1.0:
                        break
                if best:
                    captured.extend(self.collect_products(started - 0.5))
                    best[1].nth(best[2]).click(timeout=5000)
                    return
                page.wait_for_timeout(120)
        raise StepError(f"Produit « {target} » introuvable dans la liste de l'ERP.")


# ─── PharmSync : mapping automatique des champs ERP ────────────────────────

# Champs canoniques d'un BL avec leurs synonymes (utilisés dans le prompt AI)
BL_CANONICAL = {
    "header": {
        "supplier":       "fournisseur / grossiste / distributeur / laboratoire",
        "documentNumber": "numéro BL / référence / N° bon de livraison / N° facture",
        "documentDate":   "date de livraison / date du bon / date BL",
    },
    "line": {
        "product":       "désignation / libellé produit / médicament — champ texte avec autocomplete/liste déroulante",
        "cip":           "code CIP / code article / code-barres / EAN",
        "quantity":      "quantité reçue / quantité livrée / qté",
        "lotNumber":     "numéro de lot / lot / lot fabricant",
        "expiryDate":    "date de péremption / expiration / DLUO / date exp.",
        "purchasePrice": "prix d'achat HT / prix unitaire / PA",
        "salePrice":     "prix de vente / PPV / prix public",
        "freeUnits":     "unités gratuites / UG / gratuits",
    },
}


class SmartMapper:
    """Mappe automatiquement les champs d'un ERP web aux champs d'un BL, sans démo.
    Le mapping est mis en cache par URL dans HOME/mappings/."""

    def __init__(self):
        self._dir = HOME / "mappings"
        self._dir.mkdir(parents=True, exist_ok=True)

    def _cache_path(self, url: str) -> Path:
        from urllib.parse import urlparse
        p = urlparse(url)
        key = hashlib.md5(f"{p.netloc}{p.path}".encode()).hexdigest()[:14]
        return self._dir / f"{key}.json"

    def load(self, url: str) -> Optional[Dict[str, Any]]:
        try:
            path = self._cache_path(url)
            if path.exists():
                return json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            pass
        return None

    def save(self, url: str, mapping: Dict[str, Any]) -> None:
        try:
            self._cache_path(url).write_text(json.dumps(mapping, ensure_ascii=False, indent=2), encoding="utf-8")
        except Exception:
            pass

    def survey(self, page) -> Dict[str, Any]:
        try:
            return page.evaluate(DOM_SURVEY_JS)
        except Exception as e:
            return {"url": page.url, "title": "", "fields": [], "addLineButtons": [], "error": str(e)}

    def map_with_ai(self, survey: Dict[str, Any], api) -> Dict[str, Any]:
        """Appelle le serveur pour obtenir le mapping IA des champs."""
        try:
            return api.call("POST", "/api/agent-client/map-fields", {"survey": survey, "canonical": BL_CANONICAL})
        except Exception as e:
            log.warning("Mapping IA échoué : %s", e)
            return {}

    def header_steps(self, mapping: Dict[str, Any]) -> List[Dict[str, Any]]:
        steps = []
        for field, info in (mapping.get("header") or {}).items():
            if not info or not info.get("selectors"):
                continue
            steps.append({"kind": "fill", "field": field, "label": info.get("label", ""), "selectors": info["selectors"]})
        return steps

    def line_steps(self, mapping: Dict[str, Any]) -> List[Dict[str, Any]]:
        steps = []
        for field, info in (mapping.get("line") or {}).items():
            if not info or not info.get("selectors"):
                continue
            steps.append({"kind": "fill", "field": field, "label": info.get("label", ""), "selectors": info["selectors"]})
            if info.get("isSearch") or field == "product":
                steps.append({"kind": "pick", "field": field, "selectors": info.get("dropdownSelectors") or [], "label": info.get("label", "")})
        return steps

    def smart_fill(self, engine: "Engine", page, mapping: Dict[str, Any], header: Dict[str, Any],
                   lines: List[Dict[str, Any]], captured: List[Dict[str, Any]]) -> Dict[str, Any]:
        """Remplit l'ERP via le mapping. Saute les champs inconnus sans bloquer."""
        h_steps = self.header_steps(mapping)
        l_steps = self.line_steps(mapping)
        add_sel = mapping.get("addLineSelector") or ""
        filled, skipped = 0, []

        # En-tête
        for step in h_steps:
            try:
                engine.web.run_steps(page, [step], header, engine.stop_flag.is_set, captured)
                filled += 1
            except StepError as e:
                skipped.append({"phase": "header", "field": step.get("field"), "label": step.get("label", "?"), "reason": str(e)})

        # Lignes
        for i, line in enumerate(lines):
            if engine.stop_flag.is_set():
                break
            idx = line.get("index", i)
            lbl = line.get("product") or line.get("designation") or "?"
            engine.task["current"] = lbl
            if line.get("skip"):
                skipped.append({"phase": "line", "index": idx, "field": "product", "label": lbl, "reason": line["skip"]})
                engine.task["done"] += 1
                continue
            # Ajouter une ligne si nécessaire
            if i > 0 and add_sel:
                try:
                    page.locator(add_sel).first.click(timeout=3000)
                    page.wait_for_timeout(400)
                except Exception:
                    pass
            values = {**header, **line}
            for step in l_steps:
                try:
                    engine.web.run_steps(page, [step], values, engine.stop_flag.is_set, captured)
                    filled += 1
                except StepError as e:
                    skipped.append({"phase": "line", "index": idx, "field": step.get("field"), "label": step.get("label", "?"), "reason": str(e)})
            engine.task["done"] += 1

        return {"filled": filled, "skipped": skipped}


# ─── Moteur ─────────────────────────────────────────────────────────────────


class Engine:
    """Toutes les actions navigateur/clavier passent par ce thread unique."""

    def __init__(self, server: str):
        self.cfg = load_config()
        self.api = Api(self.cfg.get("server") or server)
        self.api.key = self.cfg.get("agentKey", "")
        self.commands: "queue.Queue[tuple]" = queue.Queue()
        self.lock = threading.Lock()
        self.stop_flag = threading.Event()
        self.shutdown = threading.Event()
        self.web = WebDriver(self._on_web_event)
        self.profile: Optional[Dict[str, Any]] = None
        self.sample: Dict[str, Any] = {"header": {}, "line": {}}
        self.pairing: Optional[Dict[str, Any]] = None
        self.recording: Optional[Dict[str, Any]] = None
        self.key_recorder: Optional[KeyRecorder] = None
        self._last_update_check = time.time()
        self.review: Optional[Dict[str, Any]] = None
        self.setup: Dict[str, Any] = dict(self.cfg.get("setup") or {})
        self.task: Optional[Dict[str, Any]] = None
        self.last_result: Optional[Dict[str, Any]] = self.cfg.get("lastResult")
        self.paused = bool(self.cfg.get("paused"))
        self.status_override: Optional[str] = None
        self.last_error = ""
        self.server_ok = True
        self._last_poll = 0.0
        self._last_beat = 0.0
        self._pending_products: List[Dict[str, Any]] = []
        self._last_products_push = 0.0

    # ── État exposé au panneau ──

    def state(self) -> Dict[str, Any]:
        with self.lock:
            paired = bool(self.api.key)
            if not paired:
                status = "pairing"
            elif self.recording:
                status = "rec_" + self.recording["phase"]
            elif self.review:
                status = "review"
            elif self.task:
                status = "running"
            elif self.status_override:
                status = self.status_override
            elif not self.profile:
                status = "prepare" if self.setup.get("mode") else "setup"
            else:
                status = "paused" if self.paused else "ready"
            prof = None
            if self.profile:
                prof = {k: self.profile.get(k) for k in ("mode", "erpUrl", "formUrl", "windowTitle", "filePath", "recordedAt")}
                prof["lineSteps"] = len(self.profile.get("lineSteps") or [])
                prof["headerSteps"] = len(self.profile.get("headerSteps") or [])
            return {
                "version": AGENT_VERSION, "os": SYSTEM, "server": self.api.server, "serverOk": self.server_ok,
                "paired": paired, "pharmacyName": self.cfg.get("pharmacyName", ""), "status": status,
                "pairingCode": (self.pairing or {}).get("code"), "profile": prof, "setup": self.setup,
                "recording": self._recording_view(),
                "review": self.review, "sample": self.sample, "task": self.task, "lastResult": self.last_result,
                "browserOpen": self.web.ctx is not None,
                "accessibilityOk": mac_accessibility_ok(), "inputMonitoringOk": mac_input_monitoring_ok(), "lastError": self.last_error,
                "fields": {"header": HEADER_FIELDS, "line": LINE_FIELDS},
                "logs": list(LOG_LINES)[-60:],
            }

    def _recording_view(self) -> Optional[Dict[str, Any]]:
        rec = self.recording
        if not rec:
            return None
        if self.key_recorder:
            evs = self.key_recorder.snapshot()
            return {"phase": rec["phase"], "count": len(evs), "preview": self._preview({"events": evs}),
                    "fgOk": self.key_recorder.fg_ok, "fgTitle": self.key_recorder.fg_title,
                    "wanted": self.setup.get("windowTitle", "")}
        return {"phase": rec["phase"], "count": len(rec["events"]), "preview": self._preview(rec)}

    @staticmethod
    def _preview(rec: Dict[str, Any]) -> List[str]:
        out = []
        for ev in rec["events"][-8:]:
            if ev.get("type") in ("fill", "select"):
                out.append(f"Saisie « {ev.get('value', '')} »" + (f" ({ev.get('label')})" if ev.get("label") else ""))
            elif ev.get("type") == "click":
                out.append(("Choix dans la liste : " if ev.get("isOption") else "Clic : ") + f"« {ev.get('text', '')} »")
            elif ev.get("type") == "press":
                out.append(f"Touche {ev.get('key')}")
            elif ev.get("type") == "type":
                out.append(f"Saisie « {ev.get('value', '')} »")
            elif ev.get("type") == "key":
                out.append(f"Touche {ev.get('key')}")
        return out

    def _persist(self) -> None:
        self.cfg["setup"] = self.setup
        self.cfg["paused"] = self.paused
        self.cfg["lastResult"] = self.last_result
        self.cfg["server"] = self.api.server
        save_config(self.cfg)

    # ── Commandes du panneau ──

    def submit(self, name: str, payload: Dict[str, Any]) -> Future:
        fut: Future = Future()
        self.commands.put((name, payload, fut))
        return fut

    def _handle(self, name: str, p: Dict[str, Any]) -> Any:
        if name == "pick_file":
            return pick_file()
        if name == "support":
            # Aide à distance : l'utilisateur envoie capture + état + journal ; le serveur rend un code valable 1 h
            shot = capture_screen()
            st = self.state()
            res = self.api.call("POST", "/api/agent-client/support", {
                "screenshot": base64.b64encode(shot).decode() if shot else "",
                "state": {k: st.get(k) for k in ("version", "os", "status", "profile", "setup", "task", "lastResult", "lastError",
                                                   "accessibilityOk", "inputMonitoringOk", "serverOk", "paired")},
                "windows": list_windows(), "foreground": foreground_title(),
                "logs": [f"{x['t']} {x['level']} {x['msg']}" for x in LOG_LINES],
                "code": p.get("code") or "",
            }, timeout=60)
            log.info("Aide à distance : informations envoyées (code %s).", res.get("code"))
            return res.get("code")
        if name == "setup" and p.get("mode") == "file":
            path = (p.get("filePath") or "").strip()
            if not path or not Path(path).is_file():
                raise ValueError("Choisissez le fichier à remplir (bouton « Choisir le fichier »).")
            if not path.lower().endswith(SHEET_EXT):
                raise ValueError("Ce n'est pas un fichier de tableur (Excel, Numbers, LibreOffice ou CSV).")
            res = self.api.call("PUT", "/api/agent-client/profile", {"mode": "file", "filePath": path})
            self.profile = res.get("profile")
            self.setup = {"mode": "file", "filePath": path}
            self.status_override = None
            self._persist()
            log.info("Réglage : remplissage direct de %s (aucune démo).", Path(path).name)
            return True
        if name == "setup":
            mode = p.get("mode")
            if mode not in ("web", "desktop"):
                raise ValueError("Choisissez « Site web » ou « Logiciel installé ».")
            if mode == "web":
                url = (p.get("erpUrl") or "").strip()
                if not re.match(r"^https?://", url):
                    url = "https://" + url if url else ""
                if not url:
                    raise ValueError("Indiquez l'adresse de l'ERP.")
                self.setup = {"mode": "web", "erpUrl": url}
            else:
                title = (p.get("windowTitle") or "").strip()
                if not title:
                    raise ValueError("Choisissez la fenêtre de l'ERP.")
                if re.search(r"numbers|excel|libreoffice|calc", title, re.I) and not p.get("force"):
                    raise ValueError(f"« {title} » est un tableur : choisissez plutôt « Fichier Excel ou Numbers » (plus fiable, sans démo).")
                if title in IGNORED_APPS:
                    raise ValueError(f"« {title} » n'est pas le logiciel de saisie : choisissez la fenêtre de l'ERP (par exemple Numbers ou Excel).")
                self.setup = {"mode": "desktop", "windowTitle": title}
            self._persist()
            self.status_override = "prepare"  # sinon « Changer d'ERP » laisse le panneau bloqué sur le choix
            if mode == "web":
                self.web.open(self.setup["erpUrl"])
            return True
        if name == "mac_permissions":
            mac_request_permissions()
            return True
        if name == "quit":
            log.info("Arrêt demandé (remplacement par une version plus récente).")
            self.shutdown.set()
            return True
        if name == "open_erp":
            cfg = self.profile or self.setup
            if cfg.get("mode") == "file":
                if not Path(cfg.get("filePath", "")).is_file():
                    raise ValueError("Fichier introuvable : il a été déplacé ou renommé. « Changer d'ERP » pour le choisir à nouveau.")
                open_file(cfg["filePath"])
                return True
            if cfg.get("mode") == "web":
                self.web.open(cfg.get("formUrl") or cfg.get("erpUrl"))
            elif cfg.get("mode") == "desktop":
                if not activate_window(cfg.get("windowTitle", "")):
                    raise ValueError("Fenêtre de l'ERP introuvable : ouvrez le logiciel.")
            return True
        if name == "windows":
            return list_windows()
        if name == "record_start":
            return self._record_start(p.get("phase", "line"))
        if name == "record_stop":
            return self._record_stop()
        if name == "record_cancel":
            self._record_abort()
            self.review = None
            return True
        if name == "review_save":
            return self._review_save(p)
        if name == "redo_demo":
            self.review = None
            self.status_override = "prepare"
            self.setup = {k: v for k, v in (self.profile or self.setup).items() if k in ("mode", "erpUrl", "windowTitle")} or self.setup
            return True
        if name == "skip_demo":
            url = self.setup.get("erpUrl", "")
            res = self.api.call("PUT", "/api/agent-client/profile", {"mode": "web", "erpUrl": url, "headerSteps": [], "lineSteps": []})
            if isinstance(res, dict):
                self.profile = res.get("profile") or res
            self.status_override = None
            self._persist()
            return True
        if name == "change_setup":
            self.status_override = "setup"
            return True
        if name == "test_run":
            if not self.profile:
                raise ValueError("Enregistrez d'abord la démo.")
            if self.profile.get("mode") == "file":
                if not Path(self.profile.get("filePath", "")).is_file():
                    raise ValueError("Fichier introuvable : il a été déplacé ou renommé. « Changer d'ERP » pour le choisir à nouveau.")
                log.info("Fichier prêt : %s. Approuvez un bon dans PharmAgent, le fichier rempli s'ouvrira.", Path(self.profile["filePath"]).name)
                return True
            self._run_task({"id": "", "header": self.sample.get("header", {}), "lines": [self.sample.get("line", {})], "test": True})
            return True
        if name == "pause":
            self.paused = bool(p.get("paused"))
            self._persist()
            return True
        if name == "unpair":
            self.api.key = ""
            for k in ("agentKey", "pharmacyId", "pharmacyName"):
                self.cfg.pop(k, None)
            self.profile = None
            self._persist()
            return True
        if name == "pharmsync":
            # Scan la page ERP ouverte et mappe les champs via l'IA
            if not self.web.is_open:
                raise ValueError("Ouvrez d'abord l'ERP dans le navigateur Agent Floki.")
            page = self.web.page()
            mapper = SmartMapper()
            survey = mapper.survey(page)
            if not survey.get("fields"):
                raise ValueError("Aucun champ de saisie trouvé sur cette page. Naviguez vers le formulaire de réception de BL.")
            smart_map = mapper.map_with_ai(survey, self.api)
            if not smart_map.get("header") and not smart_map.get("line"):
                raise ValueError("Le mapping automatique n'a rien trouvé. Essayez sur la page de saisie du BL.")
            mapper.save(page.url, smart_map)
            h = len([v for v in (smart_map.get("header") or {}).values() if v])
            l = len([v for v in (smart_map.get("line") or {}).values() if v])
            unmapped = smart_map.get("unmapped") or []
            log.info("PharmSync terminé : %d champ(s) en-tête, %d par ligne. Non trouvés : %s", h, l, unmapped or "aucun")
            return {"mappedHeader": h, "mappedLine": l, "unmapped": unmapped, "url": page.url}
        if name == "memorize":
            # Relit la page après correction du pharmacien, met à jour le mapping
            if not self.web.is_open:
                raise ValueError("Navigateur non ouvert.")
            page = self.web.page()
            mapper = SmartMapper()
            survey = mapper.survey(page)
            if not survey.get("fields"):
                raise ValueError("Aucun champ trouvé sur la page.")
            smart_map = mapper.map_with_ai(survey, self.api)
            if smart_map.get("header") or smart_map.get("line"):
                mapper.save(page.url, smart_map)
                log.info("Mémorisation : mapping mis à jour pour %s", page.url[:60])
            return True
        raise ValueError(f"Commande inconnue : {name}")

    # ── Démo ──

    def _on_web_event(self, ev: Dict[str, Any]) -> None:
        if self.recording and self.recording["mode"] == "web":
            self.recording["events"].append(ev)

    def _refresh_sample(self) -> None:
        try:
            s = self.api.call("GET", "/api/agent-client/sample")
            self.sample = {"header": s.get("header") or {}, "line": s.get("line") or {}}
        except ApiError as e:
            log.warning("Exemple indisponible : %s", e)

    def _record_start(self, phase: str) -> bool:
        if phase not in ("header", "line"):
            raise ValueError("Phase inconnue.")
        mode = self.setup.get("mode") or (self.profile or {}).get("mode")
        if not mode:
            raise ValueError("Configurez d'abord le type d'ERP.")
        if phase == "header" or not self.sample.get("line"):
            self._refresh_sample()
        if phase == "header":
            self.review = None
        rec = {"phase": phase, "mode": mode, "events": [], "started": time.time()}
        if mode == "web":
            self.web.open(self.setup.get("erpUrl"))
            self.web.install_recorder()
            rec["url"] = self.web.page().url
        else:
            if SYSTEM == "Darwin" and not mac_accessibility_ok():
                raise ValueError("macOS bloque le clavier : autorisez PharmAgent dans Réglages › Confidentialité › Accessibilité, puis relancez.")
            activate_window(self.setup.get("windowTitle", ""))
            self.key_recorder = KeyRecorder(self.setup.get("windowTitle", ""))
            self.key_recorder.start()
        self.status_override = None
        self.recording = rec
        log.info("Démo : enregistrement %s démarré.", "de l'en-tête" if phase == "header" else "d'une ligne")
        return True

    def _record_abort(self) -> None:
        if self.key_recorder:
            self.key_recorder.stop()
            self.key_recorder = None
        self.recording = None

    def _record_stop(self) -> Dict[str, Any]:
        rec = self.recording
        if not rec:
            raise ValueError("Aucun enregistrement en cours.")
        if rec["mode"] == "web":
            self.web.flush_inputs()
            self.web.pump(300)  # dernières frappes
        sample = {**self.sample.get("header", {}), **self.sample.get("line", {})}
        warnings: List[str] = []
        if rec["mode"] == "web":
            steps = web_steps_from(rec["events"], rec["phase"], sample, warnings)
            if any(s["kind"] == "pick" for s in steps):
                self._pending_products.extend(self.web.collect_products(rec["started"]))
        else:
            raw = self.key_recorder.stop() if self.key_recorder else []
            self.key_recorder = None
            steps = desktop_steps_from(raw, rec["phase"], sample)
        self.recording = None
        review = self.review or {"headerSteps": [], "lineSteps": [], "warnings": [], "mode": rec["mode"]}
        review["headerSteps" if rec["phase"] == "header" else "lineSteps"] = steps
        review["warnings"] = review.get("warnings", []) + warnings
        if rec["phase"] == "header":
            review["formUrl"] = rec.get("url")
            if not steps:
                review["warnings"].append("Aucune saisie d'en-tête enregistrée (c'est possible si l'ERP n'en a pas).")
        if rec["phase"] == "line" and not steps:
            review["warnings"].append("Aucune saisie enregistrée pour la ligne : recommencez la démo de la ligne.")
        self.review = review
        if rec["phase"] == "header":
            # On enchaîne directement sur la ligne
            self.review = review
            self._record_start("line")
            return {"next": "line"}
        log.info("Démo terminée : %d étape(s) d'en-tête, %d par ligne.", len(review["headerSteps"]), len(review["lineSteps"]))
        return {"next": "review"}

    def _review_save(self, p: Dict[str, Any]) -> bool:
        if not self.review:
            raise ValueError("Rien à enregistrer.")
        header = [s for s in p.get("headerSteps", self.review["headerSteps"]) if s.get("field") != "ignore"]
        lines = [s for s in p.get("lineSteps", self.review["lineSteps"]) if s.get("field") != "ignore"]
        if not lines:
            raise ValueError("La démo de la ligne est vide.")
        mode = self.review.get("mode") or self.setup.get("mode")
        body = {
            "mode": mode, "erpUrl": self.setup.get("erpUrl"), "formUrl": self.review.get("formUrl"),
            "windowTitle": self.setup.get("windowTitle"), "headerSteps": header, "lineSteps": lines,
        }
        res = self.api.call("PUT", "/api/agent-client/profile", body)
        self.profile = res.get("profile")
        self.review = None
        self.status_override = None
        log.info("Démo enregistrée sur le serveur. L'agent est prêt.")
        return True

    # ── Saisie ──

    def _run_task(self, task: Dict[str, Any]) -> None:
        prof = self.profile or {}
        header = task.get("header") or {}
        lines = task.get("lines") or []
        is_test = bool(task.get("test"))
        self.stop_flag.clear()
        self.task = {"id": task.get("id"), "documentNumber": header.get("documentNumber") or "Exemple",
                     "total": len(lines), "done": 0, "current": "", "test": is_test}
        started = time.time()
        results: List[Dict[str, Any]] = []
        status, message = "done", ""
        captured: List[Dict[str, Any]] = []
        player: Optional[KeyPlayer] = None
        all_skipped_labels: List[str] = []  # pour l'affichage dans le panneau
        log.info("%s : %s (%d ligne(s)).", "Test" if is_test else "Saisie", self.task["documentNumber"], len(lines))
        try:
            if prof.get("mode") == "file":
                template = prof.get("filePath", "")
                if not Path(template).is_file():
                    raise StepError("Fichier à remplir introuvable (déplacé ou renommé) : choisissez-le à nouveau dans le panneau de l'agent, puis renvoyez le bon.")
                if not task.get("id"):
                    raise StepError("Le test se fait avec un vrai bon approuvé.")
                self.task["current"] = Path(template).name
                res = self.api.call("POST", f"/api/agent-client/tasks/{task['id']}/fill-file",
                                    {"fileBase64": base64.b64encode(Path(template).read_bytes()).decode()})
                out = filled_path(template, header.get("documentNumber", ""))
                out.write_bytes(base64.b64decode(res["fileBase64"]))
                rep = res.get("report") or {}
                results = [{"index": l.get("index", i), "ok": True} for i, l in enumerate(lines)]
                self.task["done"] = len(lines)
                miss = rep.get("missingLabels") or []
                message = (f"Fichier rempli : « {out.name} » ({rep.get('linesWritten', len(lines))} ligne(s), à côté du modèle)"
                           + (f" · colonnes absentes du modèle : {', '.join(miss)}" if miss else "") + ". Vérifiez puis validez.")
                open_file(str(out))
                lines = []  # rien à taper
            elif prof.get("mode") == "web":
                erp_url = prof.get("erpUrl") or self.setup.get("erpUrl") or ""
                self.web.open(prof.get("formUrl") or erp_url)
                page = self.web.erp_page(erp_url, prof.get("formUrl"))
                page.bring_to_front()
                form = prof.get("formUrl")
                if form and page.url.split("#")[0] != form.split("#")[0]:
                    page.goto(form, wait_until="domcontentloaded", timeout=45000)
                    try:
                        page.wait_for_load_state("networkidle", timeout=5000)
                    except Exception:
                        pass
                # ── Mapping automatique (PharmSync) ──
                mapper = SmartMapper()
                smart_map = mapper.load(page.url)
                use_smart = bool(smart_map)
                if not smart_map and not prof.get("lineSteps"):
                    # Première fois sur cet ERP : scan + mapping IA
                    log.info("PharmSync : scan de la page %s…", page.url[:60])
                    survey = mapper.survey(page)
                    if survey.get("fields"):
                        smart_map = mapper.map_with_ai(survey, self.api)
                        if smart_map.get("header") or smart_map.get("line"):
                            mapper.save(page.url, smart_map)
                            use_smart = True
                            log.info("PharmSync : %d champs en-tête, %d par ligne mappés.",
                                     len(smart_map.get("header") or {}), len(smart_map.get("line") or {}))
                if use_smart and smart_map:
                    res_smart = mapper.smart_fill(self, page, smart_map, header, lines, captured)
                    sk = res_smart["skipped"]
                    skipped_fields = [f"{s['label'] or s['field']} ({s['phase']})" for s in sk if s["phase"] == "header"]
                    skipped_lines = [s for s in sk if s["phase"] == "line"]
                    all_skipped_labels = [f"{s['label'] or s['field']}" for s in sk]
                    message = f"{res_smart['filled']} champ(s) saisi(s) en {time.time() - started:.1f} s"
                    if skipped_fields:
                        message += f" · En-tête non rempli : {', '.join(skipped_fields)}"
                    if skipped_lines:
                        message += f" · {len(skipped_lines)} champ(s) de ligne ignoré(s)"
                    message += ". Vérifiez puis validez dans l'ERP."
                    results = [{"index": l.get("index", i), "ok": not any(s.get("index") == l.get("index", i) for s in skipped_lines)} for i, l in enumerate(lines)]
                    lines = []  # déjà traité
                else:
                    # Démo enregistrée (compatibilité)
                    self.web.run_steps(page, prof.get("headerSteps") or [], header, self.stop_flag.is_set, captured)
            else:
                player = KeyPlayer(prof.get("windowTitle", ""), self.stop_flag)
                player.run(prof.get("headerSteps") or [], header, check_each_step=True)
            for line in lines:
                idx = line.get("index", 0)
                label = line.get("product") or line.get("designation") or "?"
                self.task["current"] = label
                if line.get("skip"):
                    results.append({"index": idx, "ok": False, "message": line["skip"]})
                    self.task["done"] += 1
                    continue
                values = {**header, **line}
                if prof.get("mode") == "web":
                    self.web.run_steps(page, prof.get("lineSteps") or [], values, self.stop_flag.is_set, captured)
                else:
                    player.run(prof.get("lineSteps") or [], values, check_each_step=True)
                results.append({"index": idx, "ok": True})
                self.task["done"] += 1
            skipped = [r for r in results if not r["ok"]]
            if prof.get("mode") == "file":
                raise _FileDone(message)
            if not message:
                message = f"{len(results) - len(skipped)} ligne(s) saisie(s) en {time.time() - started:.1f} s"
                if skipped:
                    message += f", {len(skipped)} ignorée(s) (nouveaux produits)"
                message += ". Vérifiez puis validez dans l'ERP."
        except _FileDone as e:
            message = str(e)
        except (StepError, GuardrailError, Aborted) as e:
            status, message = "failed", str(e)
        except Exception as e:  # toujours signalée au serveur, jamais de bon bloqué « en cours »
            log.error(traceback.format_exc())
            first = str(e).split("\n")[0]
            if "Timeout" in type(e).__name__ or "Timeout" in first:
                status, message = "failed", "L'ERP n'a pas répondu à temps (écran figé ou champ bloqué). Vérifiez l'écran de saisie puis relancez."
            else:
                status, message = "failed", f"Erreur inattendue : {first[:200]}"
        finally:
            if player:
                player.close()
        # ── Niveau 3 : validation automatique ──────────────────────
        v_level = int(task.get("validationLevel") or 1)
        if status == "done" and v_level == 3 and not is_test and prof.get("mode") in ("web", "desktop"):
            skipped_auto = [r for r in results if not r["ok"]]
            total_declared = float(header.get("totalAmount") or 0)
            if skipped_auto:
                log.warning("Auto-validation annulée : %d ligne(s) non saisie(s).", len(skipped_auto))
                message += f" [auto-validation annulée : {len(skipped_auto)} ligne(s) non saisie(s)]"
            else:
                # Trouver et cliquer le bouton de validation (UNIQUEMENT en niveau 3 activé par le superviseur)
                try:
                    if prof.get("mode") == "web":
                        VALIDATE_JS = r"""() => {
  const VALIDATE = /^(valider|confirmer|enregistrer|soumettre|valider la réception|valider le bon|confirmer la réception|enregistrer definitivement|valider définitivement)/i;
  for (const btn of document.querySelectorAll('button,input[type=submit],input[type=button],[role=button],a[class*=btn]')) {
    const t = (btn.innerText || btn.value || btn.getAttribute('aria-label') || '').trim();
    if (VALIDATE.test(t)) return {found: true, text: t, selector: btn.id ? '#'+btn.id : null};
  }
  return {found: false};
}"""
                        vbtn = page.evaluate(VALIDATE_JS)
                        if vbtn.get("found"):
                            if total_declared > 0:
                                # Lire le total affiché dans l'ERP pour vérification
                                READ_TOTAL_JS = r"""() => {
  const cells = [...document.querySelectorAll('td,th,span,div,label,input')];
  for (const c of cells) {
    const t = c.innerText?.trim() || '';
    if (/total\s*(ht|hors|ttc|net|général|general)?\s*:/i.test(t) || /total\s*(ht|ttc|net)\b/i.test(t)) {
      const sib = c.nextElementSibling || c.parentElement?.querySelector('input,span:last-child');
      const val = parseFloat((sib?.innerText || sib?.value || '').replace(/[^\d,.]/g, '').replace(',', '.'));
      if (val > 0) return val;
    }
  }
  return null;
}"""
                                erp_total = page.evaluate(READ_TOTAL_JS)
                                if erp_total and abs(erp_total - total_declared) / max(total_declared, 1) > 0.02:
                                    log.warning("Auto-validation annulée : total ERP %.0f ≠ BL %.0f (>2%% d'écart).", erp_total, total_declared)
                                    message += f" [auto-validation annulée : total ERP {erp_total:.0f} ≠ BL {total_declared:.0f}]"
                                    total_declared = -1  # marque l'échec
                            if total_declared >= 0:
                                log.info("Auto-validation niveau 3 : clic sur « %s ».", vbtn.get("text", "?"))
                                if vbtn.get("selector"):
                                    page.click(vbtn["selector"])
                                else:
                                    # Chercher et cliquer par texte exact
                                    page.locator(f"button:has-text('{vbtn['text']}')").first.click(timeout=5000)
                                message += " [validé automatiquement — niveau 3]"
                        else:
                            log.warning("Auto-validation niveau 3 : bouton de validation non trouvé sur la page.")
                            message += " [auto-validation : bouton non trouvé, validez manuellement]"
                except Exception as e_v:
                    log.warning("Auto-validation échouée : %s", e_v)
                    message += " [auto-validation échouée : vérifiez manuellement]"
        if status == "failed":
            done = self.task["done"]
            cur = lines[done] if done < len(lines) else {}
            results.append({"index": cur.get("index", done), "ok": False, "message": message})
            message = f"Ligne {done + 1} ({self.task['current'] or 'en-tête'}) : {message}" if self.task["current"] else message
        duration = int((time.time() - started) * 1000)
        self.last_result = {"documentNumber": self.task["documentNumber"], "status": status, "message": message,
                            "at": datetime.now().strftime("%d/%m %H:%M"), "test": is_test,
                            "skipped": all_skipped_labels or None}
        (log.info if status == "done" else log.warning)("%s", message)
        self.task = None
        self._persist()
        if captured:
            self._pending_products.extend(captured)
        if not is_test and task.get("id"):
            try:
                self.api.call("POST", f"/api/agent-client/tasks/{task['id']}/result",
                              {"status": status, "message": message, "durationMs": duration, "lines": results})
            except ApiError as e:
                log.error("Résultat non transmis : %s", e)

    # ── Boucle ──

    def _pairing_tick(self) -> None:
        try:
            if not self.pairing or time.time() - self.pairing["at"] > 14 * 60:
                r = self.api.call("POST", "/api/agent-client/pair/start", {"hostname": socket.gethostname(), "os": f"{SYSTEM} {platform.release()}"})
                self.pairing = {"id": r["pairingId"], "secret": r["secret"], "code": f"{r['code'][:3]} {r['code'][3:]}", "at": time.time()}
                log.info("Code d'appairage : %s", self.pairing["code"])
            r = self.api.call("GET", f"/api/agent-client/pair/status?pairingId={self.pairing['id']}&secret={self.pairing['secret']}")
            self.server_ok = True
            if r.get("status") == "paired":
                self.api.key = r["agentKey"]
                self.cfg.update({"agentKey": r["agentKey"], "pharmacyId": r["pharmacyId"], "pharmacyName": r["pharmacyName"]})
                self.pairing = None
                self._persist()
                log.info("Ordinateur appairé à « %s ».", r["pharmacyName"])
                self._heartbeat()
        except ApiError as e:
            if e.status == 404:
                self.pairing = None
            else:
                self.server_ok = e.status != 0
                self.last_error = str(e)

    def _heartbeat(self) -> None:
        state = "Saisie en cours" if self.task else ("En pause" if self.paused else ("Démo à faire" if not self.profile else "En attente"))
        prof = self.profile or {}
        lr = self.last_result or {}
        r = self.api.call("POST", "/api/agent-client/heartbeat", {
            "hostname": socket.gethostname(), "os": f"{SYSTEM} {platform.release()}", "version": AGENT_VERSION, "state": state,
            # Diagnostic visible dans l'onglet Agent du site : plus besoin d'être devant l'ordinateur pour savoir ce qui bloque
            "mode": prof.get("mode") or self.setup.get("mode") or "",
            "target": Path(prof.get("filePath") or "").name or prof.get("windowTitle") or prof.get("erpUrl") or "",
            "lastResult": f"{lr.get('at', '')} {lr.get('documentNumber', '')} : {lr.get('message', '')}" if lr else "",
            "lastError": self.last_error or "",
            "logs": [f"{x['t']} {x['msg']}" for x in list(LOG_LINES)[-25:]],
        })
        self.server_ok = True
        self.last_error = ""
        self.cfg["pharmacyName"] = r.get("pharmacy", {}).get("name", self.cfg.get("pharmacyName", ""))
        if not self.review and not self.recording:
            self.profile = r.get("profile")
        self._last_beat = time.time()

    def _handle_api_error(self, e: ApiError) -> None:
        if e.status == 401 and e.code == "invalid_agent_key":
            log.warning("Appairage révoqué ou serveur réinitialisé : nouvel appairage nécessaire.")
            self.api.key = ""
            self.cfg.pop("agentKey", None)
            self.profile = None
            self._persist()
        else:
            self.server_ok = e.status != 0
            self.last_error = str(e)

    def loop(self) -> None:
        log.info("Agent Floki %s démarré (%s) — serveur %s", AGENT_VERSION, SYSTEM, self.api.server)
        while not self.shutdown.is_set():
            if time.time() - self._last_update_check > 1800 and not (self.recording or self.review or self.task):
                self._last_update_check = time.time()
                self_update(self.api.server)
            try:
                name, payload, fut = self.commands.get_nowait()
            except queue.Empty:
                name = None
            if name:
                try:
                    fut.set_result(self._handle(name, payload))
                except ApiError as e:
                    self._handle_api_error(e)
                    fut.set_exception(e)
                except Exception as e:
                    log.warning("%s", e)
                    fut.set_exception(e)
                continue
            try:
                if not self.api.key:
                    self._pairing_tick()
                    self._wait(2.0)
                    continue
                now = time.time()
                if now - self._last_beat > HEARTBEAT_SECONDS:
                    self._heartbeat()
                if self._pending_products and now - self._last_products_push > 10:
                    self._push_products()
                if self.profile and not self.paused and not self.recording and not self.review and now - self._last_poll > POLL_SECONDS:
                    self._last_poll = now
                    r = self.api.call("POST", "/api/agent-client/claim", {})
                    self.server_ok = True
                    if r.get("task"):
                        self._run_task(r["task"])
                        self._heartbeat()
            except ApiError as e:
                self._handle_api_error(e)
            except Exception:
                log.error(traceback.format_exc())
            self._wait(0.2)
        self.web.close()

    def _wait(self, seconds: float) -> None:
        end = time.time() + seconds
        while time.time() < end and self.commands.empty() and not self.shutdown.is_set():
            if self.web.ctx is not None:
                self.web.pump(100)
            else:
                time.sleep(0.1)

    def _push_products(self) -> None:
        rows, seen = [], set()
        for r in self._pending_products:
            k = norm(r.get("erpLabel"))
            if k and k not in seen:
                seen.add(k)
                rows.append(r)
        self._pending_products = []
        self._last_products_push = time.time()
        if rows:
            r = self.api.call("POST", "/api/agent-client/catalog", {"products": rows[:5000]})
            log.info("Catalogue ERP : %d produit(s) transmis (%d nouveaux).", len(rows), r.get("added", 0))


# ─── Panneau de contrôle local ──────────────────────────────────────────────

PANEL_HTML = r"""<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Agent Floki — PharmAgent</title>
<style>
:root{--bg:#070d1a;--card:#0e1729;--card2:#132036;--line:#1e2d47;--text:#e8eef9;--muted:#8a9bb8;--brand:#10b981;--brand2:#34d399;--warn:#f59e0b;--bad:#f87171;--blue:#60a5fa}
*{box-sizing:border-box}body{margin:0;font:15px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:var(--text);background:var(--bg);min-height:100vh}
body:before{content:"";position:fixed;inset:0;z-index:-1;background:
radial-gradient(60rem 30rem at 85% -10%,rgba(16,185,129,.14),transparent 60%),radial-gradient(40rem 30rem at -10% 110%,rgba(96,165,250,.10),transparent 60%),
url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='56' height='56'%3E%3Cpath d='M26 20h4v6h6v4h-6v6h-4v-6h-6v-4h6z' fill='%2310b981' fill-opacity='.07'/%3E%3Ccircle cx='4' cy='4' r='1.2' fill='%2360a5fa' fill-opacity='.10'/%3E%3C/svg%3E")}
.wrap{max-width:860px;margin:0 auto;padding:24px 16px 60px}
header{display:flex;align-items:center;gap:12px;margin-bottom:20px}.logo{width:40px;height:40px;border-radius:12px;background:linear-gradient(135deg,#059669,#10b981);display:grid;place-items:center;box-shadow:0 6px 24px rgba(16,185,129,.35)}
h1{font-size:18px;margin:0}.sub{color:var(--muted);font-size:13px}.pill{margin-left:auto;font-size:12px;padding:4px 10px;border-radius:99px;border:1px solid var(--line);background:var(--card)}
.ok{color:var(--brand2);border-color:rgba(16,185,129,.4)}.warn{color:var(--warn);border-color:rgba(245,158,11,.4)}.bad{color:var(--bad);border-color:rgba(248,113,113,.4)}
.card{background:linear-gradient(180deg,var(--card),rgba(14,23,41,.85));border:1px solid var(--line);border-radius:18px;padding:22px;margin-bottom:16px;backdrop-filter:blur(6px)}
h2{font-size:16px;margin:0 0 6px}p{margin:6px 0;color:var(--muted)}b{color:var(--text)}
.code{font:700 52px/1 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;letter-spacing:.12em;text-align:center;padding:26px;border-radius:16px;background:var(--card2);border:1px dashed rgba(16,185,129,.45);color:var(--brand2);margin:16px 0}
button{font:600 14px system-ui,sans-serif;border:0;border-radius:12px;padding:11px 16px;cursor:pointer;color:#fff;background:var(--brand);transition:.15s}button:hover{filter:brightness(1.1)}button:disabled{opacity:.5;cursor:default}
button.sec{background:var(--card2);border:1px solid var(--line);color:var(--text)}button.red{background:#b91c1c}button.big{width:100%;padding:15px;font-size:15px}
.row{display:flex;gap:10px;flex-wrap:wrap;margin-top:12px}.grid2{display:grid;grid-template-columns:1fr 1fr;gap:12px}@media(max-width:640px){.grid2{grid-template-columns:1fr}}
.choice{padding:18px;border-radius:14px;border:1px solid var(--line);background:var(--card2);cursor:pointer;text-align:left;color:var(--text)}.choice.on{border-color:var(--brand);box-shadow:0 0 0 1px var(--brand) inset}
.choice .t{font-weight:700;margin-bottom:4px}.choice .d{color:var(--muted);font-size:13px;font-weight:400}
input,select{width:100%;font:14px system-ui,sans-serif;padding:11px 12px;border-radius:10px;border:1px solid var(--line);background:#0a1324;color:var(--text);outline:none}input:focus,select:focus{border-color:var(--brand)}
label.l{display:block;font-size:12px;color:var(--muted);margin:12px 0 6px}
.steps{display:flex;gap:6px;margin:4px 0 14px}.steps span{flex:1;height:4px;border-radius:4px;background:var(--line)}.steps span.on{background:var(--brand)}
.sample{display:grid;grid-template-columns:auto 1fr;gap:4px 14px;background:var(--card2);border:1px solid var(--line);border-radius:12px;padding:12px 14px;margin:10px 0;font-size:14px}.sample div:nth-child(odd){color:var(--muted)}
.rec{display:inline-flex;align-items:center;gap:8px;color:var(--bad);font-weight:700}.rec:before{content:"";width:10px;height:10px;border-radius:50%;background:var(--bad);animation:p 1s infinite}@keyframes p{50%{opacity:.3}}
table{width:100%;border-collapse:collapse;font-size:13px}td,th{padding:8px 6px;border-bottom:1px solid var(--line);text-align:left;vertical-align:middle}th{color:var(--muted);font-weight:500}
.tag{font-size:11px;padding:2px 8px;border-radius:99px;background:var(--card2);border:1px solid var(--line);color:var(--muted)}
.bar{height:10px;background:var(--card2);border-radius:99px;overflow:hidden;margin:10px 0}.bar i{display:block;height:100%;background:linear-gradient(90deg,#059669,#34d399);transition:width .3s}
.logs{font:12px/1.6 ui-monospace,Menlo,Consolas,monospace;color:var(--muted);max-height:180px;overflow:auto;background:#081020;border-radius:12px;padding:10px 12px;border:1px solid var(--line)}
.alert{padding:12px 14px;border-radius:12px;margin:10px 0;font-size:14px}.alert.w{background:rgba(245,158,11,.1);border:1px solid rgba(245,158,11,.35);color:#fcd34d}.alert.e{background:rgba(248,113,113,.1);border:1px solid rgba(248,113,113,.35);color:#fca5a5}.alert.g{background:rgba(16,185,129,.1);border:1px solid rgba(16,185,129,.35);color:#6ee7b7}
.shield{display:flex;gap:10px;align-items:flex-start;font-size:13px;color:var(--muted)}
.muted{color:var(--muted);font-size:13px}
</style></head><body><div class="wrap">
<header><div class="logo"><svg width="22" height="22" viewBox="0 0 32 32"><path d="M16 6v20M6 16h20" stroke="#fff" stroke-width="4" stroke-linecap="round"/></svg></div>
<div><h1>Agent Floki</h1><div class="sub" id="sub"></div></div><span class="pill" id="pill">…</span></header>
<div id="app"></div>
<div class="card"><div class="shield"><span>🛡️</span><div><b>Garde-fou actif.</b> L'agent remplit l'écran de saisie de l'ERP puis s'arrête. Il ne clique jamais sur Valider, Confirmer, Clôturer ou Enregistrer définitivement : la validation reste au pharmacien.</div></div></div>
<div class="card"><h2>Aide à distance</h2><p class="muted">Envoie au support une capture de l'écran, l'état et le journal d'Agent Floki. Rien n'est envoyé sans ce clic. Donnez ensuite le code au support (valable 1 heure).</p>
<div class="row"><button class="sec" id="supbtn" onclick="support()">Envoyer au support</button></div><div id="supcode"></div></div>
<details class="card"><summary class="muted" style="cursor:pointer">Journal de l'agent</summary><div class="logs" id="logs"></div></details>
</div>
<script>
let S=null, busy=false, edit=null, winList=null, setupMode=null, winPick=null, urlPick=null, filePick=null;
const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function call(cmd, body){busy=true;render();try{const r=await fetch('/api/'+cmd,{method:'POST',headers:{'Content-Type':'application/json','X-PharmAgent':'1'},body:JSON.stringify(body||{})});const d=await r.json();if(!r.ok)throw new Error(d.error||'Erreur');return d.result}catch(e){alert(e.message);throw e}finally{busy=false;await refresh()}}
async function refresh(){try{const r=await fetch('/api/state',{headers:{'X-PharmAgent':'1'}});S=await r.json();render()}catch(e){$('#pill').textContent='Agent arrêté';$('#pill').className='pill bad'}}
const FL=()=>({...S.fields.header,...S.fields.line});
const macAlert=()=>S.os==='Darwin'&&(!S.accessibilityOk||S.inputMonitoringOk===false)?`<div class="alert w">macOS bloque le clavier pour l'application qui a lancé PharmAgent (« Terminal » ou « PharmAgent »). Cliquez sur le bouton, puis activez cette application dans <b>Accessibilité</b> et <b>Surveillance de l'entrée</b>, et relancez PharmAgent.<div class="row"><button class="sec" onclick="call('mac_permissions')">Autoriser sur ce Mac</button></div></div>`:'';
function sampleCard(phase){const s=phase==='header'?S.sample.header:S.sample.line;const f=phase==='header'?S.fields.header:S.fields.line;
 const fmt=(k,v)=>/Date$/.test(k)&&/^\d{4}-\d\d-\d\d$/.test(v)?v.split('-').reverse().join('/'):v;
 return '<div class="sample">'+Object.entries(f).filter(([k])=>s&&s[k]!==undefined&&s[k]!==''&&k!=='designation'&&k!=='lineTotal').map(([k,l])=>`<div>${esc(l)}</div><div><b>${esc(fmt(k,s[k]))}</b></div>`).join('')+'</div>'}
function stepsBar(n){return '<div class="steps">'+[1,2,3,4].map(i=>`<span class="${i<=n?'on':''}"></span>`).join('')+'</div>'}
function render(){if(!S)return;const st=S.status;
 $('#sub').textContent=(S.pharmacyName?S.pharmacyName+' · ':'')+'v'+S.version+' · '+S.os;
 const pill=$('#pill');const pl={pairing:['À appairer','warn'],setup:['Configuration','warn'],prepare:['Démo à faire','warn'],rec_header:['Démo en cours','bad'],rec_line:['Démo en cours','bad'],review:['Vérification','warn'],ready:['Prêt','ok'],running:['Saisie en cours','ok'],paused:['En pause','warn']}[st]||[st,''];
 pill.textContent=S.serverOk?pl[0]:'Serveur injoignable';pill.className='pill '+(S.serverOk?pl[1]:'bad');
 $('#logs').innerHTML=S.logs.slice().reverse().map(l=>`<div>${l.t} ${esc(l.msg)}</div>`).join('');
 const a=$('#app');let h='';
 if(!S.serverOk&&S.lastError)h+=`<div class="alert e">${esc(S.lastError)} — vérifiez la connexion Internet.</div>`;
 if(st==='pairing'){h+=`<div class="card"><h2>Relier cet ordinateur à l'officine</h2><p>Sur votre téléphone, ouvrez <b>PharmAgent › Agent Floki</b>, choisissez l'officine puis <b>Appairer un ordinateur</b> et saisissez ce code :</p>
  <div class="code">${S.pairingCode?esc(S.pairingCode):'…'}</div><p class="muted">Le code est valable 15 minutes. Cette page se met à jour toute seule.</p></div>`}
 else if(st==='setup'){const m=setupMode||S.setup.mode||'web';h+=`<div class="card">${stepsBar(1)}<h2>1. Où se trouve l'ERP de l'officine ?</h2>
  <div class="grid2" style="margin-top:12px"><button class="choice ${m==='web'?'on':''}" onclick="setupMode='web';render()"><div class="t">🌐 Site web</div><div class="d">L'ERP s'ouvre dans un navigateur (adresse https://…)</div></button>
  <button class="choice ${m==='desktop'?'on':''}" onclick="setupMode='desktop';loadWins()"><div class="t">🖥️ Logiciel installé</div><div class="d">Un logiciel de pharmacie sur cet ordinateur (saisie au clavier, démo une fois)</div></button>
  <button class="choice ${m==='file'?'on':''}" onclick="setupMode='file';render()"><div class="t">📄 Fichier Excel ou Numbers</div><div class="d">Le bon est écrit directement dans le fichier : aucune démo, aucune frappe</div></button></div>`;
  if(m==='file')h+=`<p>Choisissez votre fichier de réception (modèle vide). Pour chaque bon approuvé, Agent Floki crée à côté une copie remplie, <b>« nom du fichier - N° du bon »</b>, et l'ouvre. Votre modèle n'est jamais modifié.</p>
   <div class="row"><button class="sec" ${busy?'disabled':''} onclick="pickFile()">Choisir le fichier…</button></div>
   <label class="l">ou collez son chemin (Mac : clic droit sur le fichier, touche Option › « Copier … en tant que nom de chemin »)</label><input id="fpath" placeholder="/Users/…/Reception.numbers" value="${esc(filePick||'')}" oninput="filePick=this.value.trim().replace(/^['\"]|['\"]$/g,'')">${filePick?`<p class="muted">Fichier : <b>${esc(filePick)}</b></p><div class="row"><button ${busy?'disabled':''} onclick="call('setup',{mode:'file',filePath:filePick})">Utiliser ce fichier</button></div>`:''}`;
  else if(m==='web')h+=`<label class="l">Adresse de l'ERP</label><input id="url" placeholder="https://erp.mapharmacie.sn" oninput="urlPick=this.value" value="${esc(urlPick??(S.setup.erpUrl||''))}"><div class="row"><button class="big" ${busy?'disabled':''} onclick="call('setup',{mode:'web',erpUrl:$('#url').value})">Ouvrir l'ERP dans le navigateur Agent Floki</button></div><p class="muted">Un navigateur dédié s'ouvre : connectez-vous à l'ERP une fois, la session est conservée.</p>`;
  else h+=`<label class="l">Fenêtre de l'ERP (ouvrez d'abord le logiciel)</label><select id="win" onchange="winPick=this.value"><option value="">— Choisissez la fenêtre de l'ERP —</option>${(winList||[]).map(w=>`<option ${w===(winPick??S.setup.windowTitle)?'selected':''}>${esc(w)}</option>`).join('')}</select>
   <div class="row"><button class="sec" onclick="loadWins()">Actualiser la liste</button><button ${busy?'disabled':''} onclick="call('setup',{mode:'desktop',windowTitle:$('#win').value})">Continuer</button></div>
   ${macAlert()}`;
  h+='</div>'}
 else if(st==='prepare'){h+=`<div class="card">${stepsBar(2)}<h2>2. Démonstration (une seule fois)</h2>
  <p>Ouvrez dans l'ERP l'écran de <b>réception d'un bon de livraison</b> (nouvelle réception). Vous allez saisir <b>l'en-tête puis une ligne</b>, normalement, pendant que Agent Floki observe.</p>
  <p>${S.setup.mode==='desktop'?'Logiciel installé : utilisez <b>uniquement le clavier</b> (Tab, Entrée, flèches) pour passer d\'un champ à l\'autre.':'Utilisez la souris ou le clavier comme d\'habitude.'}</p>
  <div class="alert w">Ne cliquez pas sur Valider à la fin : Agent Floki s'arrête toujours avant.</div>
  ${S.setup.mode==='desktop'?`<p class="muted">Fenêtre surveillée : <b>${esc(S.setup.windowTitle||'')}</b> (« Changer d'ERP » pour en choisir une autre)</p>`:''}${macAlert()}
  <div class="row">${S.setup.mode==='web'?`<button class="big" ${busy?'disabled':''} onclick="call('skip_demo')">⚡ Remplissage automatique (sans démo)</button>`:''}
  <button class="sec" onclick="call('open_erp')">Afficher l'ERP</button><button class="sec" onclick="call('change_setup')">Changer d'ERP</button><button ${busy?'disabled':''} onclick="call('record_start',{phase:'header'})">▶ Commencer la démo</button></div></div>`}
 else if(st==='rec_header'||st==='rec_line'){const ph=st==='rec_header'?'header':'line';h+=`<div class="card">${stepsBar(ph==='header'?2:3)}<span class="rec">Enregistrement</span>
  <h2 style="margin-top:8px">${ph==='header'?"Saisissez l'en-tête du bon dans l'ERP":'Saisissez maintenant UNE ligne produit'}</h2><p>Utilisez ces valeurs d'exemple (c'est un brouillon : vous pourrez l'effacer) :</p>${sampleCard(ph)}
  ${ph==='line'?'<p class="muted">Pour le produit, tapez le début du nom puis <b>choisissez-le dans la liste</b> de l\'ERP, comme d\'habitude. Si l\'ERP a un bouton « Ajouter la ligne », cliquez dessus.</p>':''}
  <p class="muted">Actions vues : <b>${S.recording.count}</b></p>
  ${S.recording.fgOk===undefined?'':(S.recording.fgOk?`<p class="muted">Fenêtre active : <b>${esc(S.recording.fgTitle)}</b> ✓</p>`:`<div class="alert w">La fenêtre active est « ${esc(S.recording.fgTitle)} », pas « ${esc(S.recording.wanted)} » : vos touches sont ignorées. Cliquez sur la barre de titre de « ${esc(S.recording.wanted)} ».</div>`)}${macAlert()}<div class="logs">${S.recording.preview.map(esc).join('<br>')||'En attente de vos saisies…'}</div>
  <div class="row"><button class="sec" onclick="call('record_cancel')">Annuler</button><button ${busy?'disabled':''} onclick="call('record_stop')">${ph==='header'?"✓ En-tête terminé (ou pas d'en-tête)":'✓ Ligne terminée'}</button></div></div>`}
 else if(st==='review'){const r=S.review;if(!edit)edit={headerSteps:JSON.parse(JSON.stringify(r.headerSteps)),lineSteps:JSON.parse(JSON.stringify(r.lineSteps))};
  h+=`<div class="card">${stepsBar(4)}<h2>3. Vérifiez ce qu'Agent Floki a compris</h2><p>Pour chaque saisie, le champ du bon à utiliser. « Texte fixe » retape toujours la même valeur.</p>`+(r.warnings||[]).map(w=>`<div class="alert w">${esc(w)}</div>`).join('');
  for(const part of ['headerSteps','lineSteps']){const list=edit[part];if(!list.length)continue;h+=`<h2 style="margin-top:14px">${part==='headerSteps'?'En-tête':'Chaque ligne'}</h2><table><tr><th>#</th><th>Action</th><th>Valeur de la démo</th><th>Champ du bon</th></tr>`;
   list.forEach((s,i)=>{const act={fill:'Saisie',select:'Liste',type:'Saisie',pick:'Choix dans la liste',click:'Clic',press:'Touche',key:'Touche'}[s.kind]||s.kind;
    const val=s.kind==='click'?s.text:s.kind==='press'||s.kind==='key'?s.key:s.value;
    let sel='';if(['fill','select','type'].includes(s.kind)){sel=`<select onchange="edit.${part}[${i}].field=this.value">`+Object.entries(FL()).map(([k,l])=>`<option value="${k}" ${s.field===k?'selected':''}>${esc(l)}</option>`).join('')+`<option value="const" ${s.field==='const'?'selected':''}>Texte fixe</option><option value="ignore">Ignorer cette saisie</option></select>`}
    else if(s.kind==='pick')sel=`<span class="tag">Produit trouvé dans la liste</span>`;else sel=`<span class="tag">Rejoué tel quel</span>`;
    h+=`<tr><td>${i+1}</td><td>${act}${s.label?`<div class="muted">${esc(s.label)}</div>`:''}</td><td>${esc(val||'')}</td><td>${sel}</td></tr>`});h+='</table>'}
  h+=`<div class="row"><button class="sec" onclick="edit=null;call('redo_demo')">Recommencer la démo</button><button ${busy?'disabled':''} onclick="call('review_save',edit).then(()=>edit=null)">✓ Enregistrer la démo</button></div></div>`}
 else if(st==='running'){const t=S.task;const pc=t.total?Math.round(100*t.done/t.total):0;h+=`<div class="card"><h2>${t.test?'Test sur l\'exemple':'Saisie du bon '+esc(t.documentNumber)}</h2><div class="bar"><i style="width:${pc}%"></i></div>
  <p>${t.done} / ${t.total} ligne(s) · ${esc(t.current||'')}</p>${S.profile&&S.profile.mode==='desktop'?'<p class="muted">Ne touchez pas au clavier. Touche <b>Échap</b> pour arrêter.</p>':''}</div>`}
 else{const p=S.profile||{};const lr=S.lastResult;h+=`<div class="card"><h2><span style="display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:8px;background:${st==='paused'?'var(--warn)':'var(--brand)'};box-shadow:0 0 10px ${st==='paused'?'var(--warn)':'var(--brand)'}"></span>${st==='paused'?'Agent en pause':'Prêt : en attente des bons approuvés'}</h2>
  <p>Dès qu'un bon est approuvé dans PharmAgent (téléphone ou ordinateur), il est ${p.mode==='file'?'écrit automatiquement dans une copie du fichier « '+esc((p.filePath||'').split(/[\\/]/).pop())+' », qui s\'ouvre':'saisi ici automatiquement dans l\'ERP'+(p.mode==='web'?' (navigateur Agent Floki)':' « '+esc(p.windowTitle||'')+' »')}.</p>
  ${p.mode==='desktop'&&/numbers|excel|libreoffice|calc/i.test(p.windowTitle||'')?`<div class="alert w"><b>« ${esc(p.windowTitle)} » est un tableur.</b> Le mode clavier y est peu fiable. Passez en <b>mode Fichier</b> : Agent Floki écrit directement dans le fichier, sans démo.<div class="row"><button onclick="setupMode='file';call('change_setup')">Passer en mode Fichier</button></div></div>`:''}
  ${lr?`<div class="alert ${lr.status==='done'?'g':'e'}"><b>${lr.test?'Test':'Dernier bon'} ${esc(lr.documentNumber)}</b> · ${esc(lr.at)}<br>${esc(lr.message)}</div>`:''}
  ${lr&&lr.skipped&&lr.skipped.length?`<div class="alert w"><b>Champs non remplis (${lr.skipped.length})</b><ul style="margin:6px 0 0 16px">${lr.skipped.map(s=>`<li>${esc(s)}</li>`).join('')}</ul><div class="row" style="margin-top:8px"><button class="sec" onclick="call('pharmsync').then(()=>alert('Mémorisation lancée — naviguez vers le formulaire BL dans l\\'ERP puis cliquez Mémoriser.'))">Corriger maintenant</button><button class="sec" onclick="alert('Les champs manquants ont été enregistrés dans le dossier de formation.')">Corriger plus tard</button></div></div>`:''}
  <div class="row">${p.mode==='file'?'':`<button ${busy?'disabled':''} onclick="call('test_run')">▶ Tester avec l'exemple</button>`}${p.mode==='web'?`<button class="sec" ${busy?'disabled':''} onclick="call('pharmsync').then(r=>alert('PharmSync : '+JSON.stringify(r)))">🔍 PharmSync</button>`:''}${p.mode==='web'?`<button class="sec" ${busy?'disabled':''} onclick="call('memorize').then(()=>alert('Mapping mémorisé.'))">💾 Mémoriser</button>`:''}
  <button class="sec" onclick="call('open_erp')">${p.mode==='file'?'Ouvrir le modèle':"Afficher l'ERP"}</button><button class="sec" onclick="call('pause',{paused:${st!=='paused'}})">${st==='paused'?'Reprendre':'Mettre en pause'}</button>${p.mode==='file'?`<button class="sec" onclick="setupMode='file';call('change_setup')">Changer de fichier</button>`:`<button class="sec" onclick="edit=null;call('redo_demo')">Refaire la démo</button>`}<button class="sec" onclick="setupMode=null;call('change_setup')">Changer de mode</button></div>
  <p class="muted" style="margin-top:14px">${p.mode==='file'?`Modèle : ${esc(p.filePath||'')} · choisissez de préférence un modèle <b>vide</b> (sinon les lignes s'ajoutent après celles déjà présentes).`:`Démo du ${p.recordedAt?new Date(p.recordedAt).toLocaleString('fr-FR'):'—'} · ${p.headerSteps||0} étape(s) d'en-tête · ${p.lineSteps||0} par ligne`}</p></div>`;
  h+=`<div class="card"><h2>Cet ordinateur</h2><p>Relié à <b>${esc(S.pharmacyName)}</b> · serveur ${esc(S.server)}</p><div class="row"><button class="sec red" onclick="if(confirm('Délier cet ordinateur de l\\'officine ?'))call('unpair')">Délier l'ordinateur</button></div></div>`}
 if(a.dataset.h!==h){a.innerHTML=h;a.dataset.h=h}}
let supportCode='';
async function support(){const b=$('#supbtn');b.disabled=true;b.textContent='Envoi…';try{const r=await fetch('/api/support',{method:'POST',headers:{'X-PharmAgent':'1','Content-Type':'application/json'},body:JSON.stringify({code:supportCode})});const d=await r.json();if(d.result){supportCode=d.result;$('#supcode').innerHTML=`<div class="code">${esc(supportCode)}</div><p class="muted">Code à donner au support. « Envoyer au support » à nouveau envoie une nouvelle capture avec le même code.</p>`}else{$('#supcode').innerHTML=`<div class="alert e">${esc(d.error||'Envoi impossible')}</div>`}}catch(e){$('#supcode').innerHTML='<div class="alert e">Envoi impossible</div>'}b.disabled=false;b.textContent='Envoyer au support'}
async function pickFile(){busy=true;render();try{const r=await fetch('/api/pick_file',{method:'POST',headers:{'X-PharmAgent':'1','Content-Type':'application/json'},body:'{}'});const d=await r.json();if(d.result)filePick=d.result}catch(e){}busy=false;render()}
async function loadWins(){try{const r=await fetch('/api/windows',{method:'POST',headers:{'X-PharmAgent':'1'}});winList=(await r.json()).result||[]}catch(e){winList=[]}render()}
refresh();setInterval(()=>{if(!busy&&!(S&&S.status==='review'))refresh()},1000);
</script></body></html>
"""


class Panel(BaseHTTPRequestHandler):
    engine: Engine = None  # type: ignore

    def log_message(self, *_):
        pass

    def _local_only(self) -> bool:
        host = (self.headers.get("Host") or "").split(":")[0]
        return host in ("127.0.0.1", "localhost")

    def _json(self, code: int, obj: Any) -> None:
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if not self._local_only():
            return self._json(403, {"error": "Accès local uniquement."})
        if self.path in ("/", "/index.html"):
            body = PANEL_HTML.encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)
        elif self.path == "/api/state":
            if self.headers.get("X-PharmAgent") != "1":
                return self._json(403, {"error": "En-tête manquant."})
            self._json(200, self.engine.state())
        else:
            self._json(404, {"error": "Introuvable."})

    def do_POST(self):
        # Contre les sites web malveillants : hôte local + en-tête personnalisé (bloqué par CORS)
        if not self._local_only() or self.headers.get("X-PharmAgent") != "1":
            return self._json(403, {"error": "Accès refusé."})
        name = self.path.removeprefix("/api/") if hasattr(str, "removeprefix") else self.path[5:]
        allowed = {"setup", "open_erp", "windows", "record_start", "record_stop", "record_cancel", "review_save",
                   "redo_demo", "skip_demo", "change_setup", "test_run", "pause", "unpair", "mac_permissions", "quit", "pick_file", "support",
                   "pharmsync", "memorize"}
        if name not in allowed:
            return self._json(404, {"error": "Commande inconnue."})
        length = min(int(self.headers.get("Content-Length") or 0), 2_000_000)
        try:
            payload = json.loads(self.rfile.read(length) or b"{}") if length else {}
        except ValueError:
            payload = {}
        timeout = 600 if name in ("test_run", "pick_file") else 120
        try:
            result = self.engine.submit(name, payload).result(timeout=timeout)
            self._json(200, {"result": result})
        except Exception as e:
            self._json(400, {"error": str(e) or e.__class__.__name__})


# ─── Mise à jour automatique ────────────────────────────────────────────────


def self_update(server: str) -> None:
    if os.environ.get("PHARMAGENT_NO_UPDATE") == "1":
        return
    host = urlparse(server).hostname or ""
    if not server.lower().startswith("https://") and host not in ("127.0.0.1", "localhost"):
        log.info("Mise à jour automatique ignorée : serveur sans HTTPS (%s).", server)
        return
    try:
        me = Path(__file__).resolve()
        current = hashlib.sha256(me.read_bytes()).hexdigest()
        api = Api(server)
        info = api.call("GET", "/agent/version", timeout=15)
        if not info.get("sha256") or info["sha256"] == current:
            return
        req = urllib.request.Request(server.rstrip("/") + "/agent/pharmagent_agent.py", headers={"User-Agent": f"PharmAgent-Agent/{AGENT_VERSION}"})
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
        log.info("Mise à jour non vérifiée : %s", e)


# ─── Démarrage ──────────────────────────────────────────────────────────────


def ensure_mac_launcher(server: str) -> None:
    """macOS : crée ou met à jour l'application « PharmAgent » (double-clic = ouvre le Terminal et lance l'agent),
    puis le démarrage à l'ouverture de session par cette même application : une seule application à autoriser."""
    if SYSTEM != "Darwin":
        return
    try:
        agent = Path(__file__).resolve()
        cmd = f"{shlex.quote(sys.executable)} {shlex.quote(str(agent))} --server {shlex.quote(server)}"
        say = "PharmAgent tourne dans cette fenêtre : réduisez-la, ne la fermez pas."
        shell_line = f"clear; echo {shlex.quote(say)}; {cmd}"
        applescript = shell_line.replace("\\", "\\\\").replace('"', '\\"')
        app = Path.home() / "Applications" / "PharmAgent.app"
        stamp = hashlib.sha256((cmd + "|launcher-v1").encode()).hexdigest()
        marker = HOME / "launcher.sha"
        if app.exists() and marker.exists() and marker.read_text().strip() == stamp:
            return
        app.parent.mkdir(parents=True, exist_ok=True)
        if app.exists():
            shutil.rmtree(app)
        lines = ['tell application "Terminal"', "activate", f'do script "{applescript}"', "end tell"]
        args = ["osacompile", "-o", str(app)]
        for line in lines:
            args += ["-e", line]
        subprocess.run(args, check=True, capture_output=True, timeout=30)
        agents_dir = Path.home() / "Library" / "LaunchAgents"
        agents_dir.mkdir(parents=True, exist_ok=True)
        (agents_dir / "com.pharmagent.agent.plist").write_bytes(plistlib.dumps(
            {"Label": "com.pharmagent.agent", "ProgramArguments": ["/usr/bin/open", "-g", "-a", str(app)], "RunAtLoad": True}))
        marker.write_text(stamp)
        log.info("Application « PharmAgent » créée dans %s", app)
    except Exception as e:
        log.info("Application PharmAgent non créée : %s", e)


def replace_running_agent(panel_url: str) -> bool:
    """Demande à un agent d'une autre version, déjà lancé, de s'arrêter pour reprendre sa place."""
    try:
        hdr = {"X-PharmAgent": "1", "Content-Type": "application/json"}
        with urllib.request.urlopen(urllib.request.Request(panel_url + "api/state", headers=hdr), timeout=3) as r:
            old = json.loads(r.read())
        if old.get("version") == AGENT_VERSION:
            return False
        try:
            urllib.request.urlopen(urllib.request.Request(panel_url + "api/quit", data=b"{}", method="POST", headers=hdr), timeout=5).read()
        except Exception:
            pass  # l'ancien agent peut couper la connexion en s'arrêtant, avant d'avoir répondu
        time.sleep(2.5)
        return True
    except Exception:
        return False


def main() -> None:
    ap = argparse.ArgumentParser(description="PharmAgent — agent local de saisie")
    ap.add_argument("--server", help="Adresse du serveur PharmAgent")
    ap.add_argument("--background", action="store_true", help="Ne pas ouvrir le panneau au démarrage")
    args = ap.parse_args()

    cfg = load_config()
    server = args.server or os.environ.get("PHARMAGENT_SERVER") or cfg.get("server") or DEFAULT_SERVER
    if args.server or not cfg.get("server"):
        cfg["server"] = server
        save_config(cfg)
    panel_url = f"http://127.0.0.1:{PANEL_PORT}/"

    try:
        httpd = ThreadingHTTPServer(("127.0.0.1", PANEL_PORT), Panel)
    except OSError:
        # Déjà lancé : un agent plus ancien est remplacé, sinon on affiche simplement son panneau
        httpd = None
        if replace_running_agent(panel_url):
            try:
                httpd = ThreadingHTTPServer(("127.0.0.1", PANEL_PORT), Panel)
            except OSError:
                httpd = None
        if httpd is None:
            if not args.background:
                webbrowser.open(panel_url)
            return

    self_update(server)
    ensure_mac_launcher(server)
    engine = Engine(server)
    Panel.engine = engine
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    if not args.background:
        threading.Timer(1.0, lambda: webbrowser.open(panel_url)).start()
    log.info("Panneau de contrôle : %s", panel_url)
    try:
        engine.loop()
    except KeyboardInterrupt:
        pass
    finally:
        engine.shutdown.set()
        httpd.shutdown()


if __name__ == "__main__":
    main()
