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

import base64
import difflib
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
from typing import Any, Dict, List, Optional, Set, Tuple
from urllib.parse import urlparse

AGENT_VERSION = "3.1.0"
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
ADD_ROW_RE = re.compile(
    r"ajouter|nouvelle\s*ligne|ligne\s*suppl|"
    r"(add|new|insert|create)\s*(a\s*)?(line|row|item|product|article|entry)|"
    r"\+|＋", re.I)


PRODUCT_LIST_RE = re.compile(r"produit|article|medicament|catalogue|designation|specialite")


# ─── Appariement des produits ───────────────────────────────────────────────
#
# Un médicament ne se reconnaît PAS à la ressemblance de ses lettres.
# « AMOXICILLINE 500MG GELULE B/12 » et « DOXYCYCLINE 100MG GELULE B/10 » se
# ressemblent à 78 % caractère par caractère, et ce sont deux antibiotiques de
# familles différentes : la doxycycline est contre-indiquée avant 8 ans et chez
# la femme enceinte. Choisir l'un pour l'autre fausserait le stock de l'officine.
#
# On exige donc trois accords : la dénomination, le dosage, la forme. Au moindre
# doute — ou si deux articles du catalogue conviennent également — on refuse et
# le pharmacien saisit la ligne lui-même. Refuser coûte une minute ; se tromper
# coûte bien davantage.

# Formes galéniques : abréviations rencontrées -> forme canonique
FORMS = {
    "cp": "comprime", "cpr": "comprime", "cprs": "comprime", "comp": "comprime",
    "comprime": "comprime", "comprimes": "comprime", "tab": "comprime", "tablet": "comprime",
    "gelule": "gelule", "gelules": "gelule", "caps": "gelule", "capsule": "gelule",
    "capsules": "gelule",
    "susp": "suspension", "suspension": "suspension", "sirop": "suspension",
    "buvable": "suspension",
    "sol": "solution", "solution": "solution",
    "supp": "suppositoire", "suppo": "suppositoire", "suppositoire": "suppositoire",
    "inj": "injectable", "injectable": "injectable", "amp": "injectable",
    "ampoule": "injectable", "ampoules": "injectable", "flacon": "injectable",
    "pommade": "topique", "creme": "topique", "gel": "topique", "lotion": "topique",
    "collyre": "collyre", "sachet": "sachet", "sachets": "sachet",
    "ovule": "ovule", "ovules": "ovule", "poudre": "poudre",
    "patch": "patch", "spray": "spray", "aerosol": "spray",
}

# Mots de conditionnement : ils ne font pas partie de la dénomination
PACK_WORDS = {"b", "bte", "boite", "boites", "de", "pack", "lot", "x", "plq", "plaquette"}

# Unités de dosage, ramenées à une unité de base pour que 1 g = 1000 mg
UNITS = {
    "mg": ("mg", 1.0), "g": ("mg", 1000.0), "gr": ("mg", 1000.0),
    "mcg": ("mg", 0.001), "ug": ("mg", 0.001),
    "ml": ("ml", 1.0), "cl": ("ml", 10.0), "l": ("ml", 1000.0),
    "ui": ("ui", 1.0), "iu": ("ui", 1.0), "mui": ("ui", 1e6),
    "pc": ("pc", 1.0), "mmol": ("mmol", 1.0), "meq": ("meq", 1.0),
}
DOSE_RE = re.compile(
    r"(\d+(?:[.,]\d+)?)\s*(mg|mcg|ug|gr|g|ml|cl|l|ui|iu|mui|pc|mmol|meq)(?![a-z])")


def _dose_text(s: Any) -> str:
    """Minuscules sans accents, en gardant « % » pour les dosages en pourcentage."""
    t = strip_accents(str(s or "")).lower().replace("%", " pc ")
    t = re.sub(r"[^a-z0-9.,]+", " ", t)
    return re.sub(r"\s+", " ", t).strip()


def parse_product(label: Any) -> Dict[str, Any]:
    """Décompose un libellé de médicament en dénomination, dosages et forme."""
    text = _dose_text(label)
    doses = set()
    for value, unit in DOSE_RE.findall(text):
        base, factor = UNITS[unit]
        try:
            doses.add((base, round(float(value.replace(",", ".")) * factor, 6)))
        except ValueError:
            pass
    forms = set()
    name_tokens: List[str] = []
    name_closed = False
    for token in text.split():
        if token in FORMS:
            forms.add(FORMS[token])
            name_closed = True
            continue
        if token in PACK_WORDS or re.fullmatch(r"[\d.,]+", token) or DOSE_RE.fullmatch(token):
            name_closed = True
            continue
        if DOSE_RE.match(token):
            name_closed = True
            continue
        if not name_closed:
            name_tokens.append(token)
    return {"name": " ".join(name_tokens), "doses": doses, "forms": forms,
            "full": re.sub(r"[^a-z0-9 ]+", " ", text).strip()}


def _names_agree(a: str, b: str) -> bool:
    """La dénomination doit être la même molécule, pas une molécule voisine."""
    if not a or not b:
        return False
    if a == b:
        return True
    # Les quatre premières lettres distinguent déjà amoxicilline de doxycycline.
    if a[:4] != b[:4]:
        return False
    return difflib.SequenceMatcher(None, a, b).ratio() >= 0.90


def products_match(wanted: str, option: str) -> bool:
    """Le libellé du catalogue désigne-t-il sûrement le produit demandé ?"""
    w, o = parse_product(wanted), parse_product(option)
    if w["full"] and w["full"] == o["full"]:
        return True
    if not _names_agree(w["name"], o["name"]):
        return False
    # Dosages : s'ils sont donnés des deux côtés, ils doivent concorder.
    if w["doses"] and o["doses"] and w["doses"] != o["doses"]:
        return False
    # Forme galénique : un comprimé n'est pas une suspension.
    if w["forms"] and o["forms"] and not (w["forms"] & o["forms"]):
        return False
    return True


def best_option(target: str, options: List[str]) -> Optional[str]:
    """L'entrée de la liste qui correspond au produit cherché, ou rien si le doute subsiste."""
    if not norm(target):
        return None
    exact = [o for o in options if o and norm(o) == norm(target)]
    if exact:
        return exact[0]
    retained = [o for o in options if o and products_match(target, o)]
    if not retained:
        return None
    # Deux articles distincts qui conviennent autant : on ne devine pas.
    if len({norm(o) for o in retained}) > 1:
        log.info("Produit « %s » ambigu dans le catalogue (%s) : non choisi.",
                 str(target)[:40], " / ".join(r[:30] for r in retained[:3]))
        return None
    return retained[0]


def same_value(wanted: Any, got: Any) -> bool:
    """L'ERP reformate souvent ce qu'on lui donne (espaces, virgule décimale).
    On ne signale que les écarts qui changent réellement la valeur."""
    a = re.sub(r"[\s  ]", "", str(wanted or ""))
    b = re.sub(r"[\s  ]", "", str(got or ""))
    if a == b:
        return True
    try:
        return float(a.replace(",", ".")) == float(b.replace(",", "."))
    except ValueError:
        return False


def already_entered(survey: Dict[str, Any], header: Dict[str, Any]) -> bool:
    """Ce bon est-il déjà saisi dans l'écran ouvert ?

    Après un échec à mi-parcours, renvoyer le bon ajouterait une seconde fois
    toutes les lignes : le stock compterait les médicaments en double.
    """
    reference = str(header.get("documentNumber") or "").strip()
    if not reference or not (survey.get("rows") or []):
        return False
    field = assign(survey.get("header") or [], HEADER_VOCAB).get("documentNumber")
    return bool(field and same_value(reference, field.get("value")))


def lines_already_done(survey: Dict[str, Any], lines: List[Dict[str, Any]]) -> Set[int]:
    """Positions des lignes du bon déjà présentes dans l'écran ouvert.

    Une saisie interrompue à la cinquième ligne sur huit laisse l'écran à
    moitié rempli. Sans ce relevé, renvoyer le bon ajouterait tout une seconde
    fois — le stock compterait les médicaments en double — et le refuser
    obligerait le pharmacien à tout reprendre à la main. On reconnaît donc ce
    qui est déjà là, et on ne saisit que ce qui manque.

    Le numéro de lot identifie une ligne de façon sûre : un même médicament
    peut figurer deux fois sur un bon, avec deux lots différents. À défaut de
    lot, on se rabat sur la désignation.
    """
    available = [norm(t) for t in (survey.get("rowTexts") or []) if norm(t)]
    done: Set[int] = set()
    for position, line in enumerate(lines):
        lot = norm(line.get("lotNumber") or "")
        product = norm(line.get("product") or line.get("designation") or "")
        for marker in ([lot] if lot else []) + ([product] if product else []):
            # Un lot très court (« R1 ») se retrouverait par hasard dans un prix.
            if len(marker) < 3:
                continue
            hit = next((t for t in available if marker in t), None)
            if hit:
                available.remove(hit)  # une ligne de l'ERP ne vaut que pour un produit
                done.add(position)
                break
    return done


def looks_like_login(survey: Dict[str, Any]) -> bool:
    """Un écran de connexion n'a jamais de tableau de lignes à remplir."""
    if survey.get("hasLineTable"):
        return False
    if survey.get("hasPassword"):
        return True
    texts = " ".join(str(b.get("text") or "") for b in survey.get("buttons") or [])
    return bool(re.search(r"se\s*connecter|connexion|s'identifier|sign\s*in|log\s*in", texts, re.I))


def map_key(url: str) -> str:
    """Les corrections sont rangées par écran d'ERP, sans tenir compte des paramètres."""
    try:
        u = urlparse(url or "")
        return ("%s://%s%s" % (u.scheme, u.netloc, u.path)).rstrip("/").lower()
    except Exception:
        return (url or "").lower()


def friendly_error(e: Exception) -> str:
    """Traduit les pannes courantes de Playwright en une phrase qui dit quoi faire."""
    text = str(e)
    if "has been closed" in text or "Target closed" in text or "Target page" in text:
        return ("La fenêtre de l'ERP a été fermée pendant la saisie. "
                "Laissez la fenêtre ouverte, puis renvoyez le bon depuis PharmAgent.")
    if "Timeout" in text or "timeout" in text:
        return ("L'ERP n'a pas répondu à temps. Vérifiez que l'écran de réception est bien "
                "ouvert, puis renvoyez le bon.")
    return text.splitlines()[0][:300]


def strip_accents(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn")


def norm(s: Any) -> str:
    """Minuscules, sans accents, sans ponctuation : pour comparer des libellés."""
    t = strip_accents(str(s or "")).lower()
    t = re.sub(r"[^a-z0-9]+", " ", t)
    return re.sub(r"\s+", " ", t).strip()


# ─── Vocabulaire : libellé d'ERP → champ du bon de livraison ────────────────

# Chaque champ : (synonymes, mots qui disqualifient)
# Chaque donnée du bon est décrite par ses appellations en français ET en
# anglais, puis par les mots qui la disqualifient. Les ERP d'officine mélangent
# les deux langues, abrègent, et inventent leurs propres tournures : ajouter une
# appellation ici suffit à la faire reconnaître partout.
#
# Les mots qui disqualifient comptent autant que les synonymes : sans « vente »
# dans la liste d'exclusion du prix d'achat, l'agent écrirait un prix de vente
# dans la colonne du prix d'achat, et la marge de l'officine serait fausse.

HEADER_VOCAB: Dict[str, Tuple[List[str], List[str]]] = {
    "supplier": ([
        # français
        "fournisseur", "grossiste", "laboratoire", "labo", "repartiteur",
        "vendeur", "expediteur", "depositaire",
        # anglais
        "supplier", "vendor", "wholesaler", "distributor", "shipper",
    ], ["client", "customer", "livre a", "ship to"]),

    "documentNumber": ([
        # français
        "reference bl", "ref bl", "reference bon", "numero bl", "n bl", "no bl",
        "numero bon", "numero du bon", "n du bon", "no du bon", "num bon", "n bon",
        "bon de livraison", "reference livraison", "numero piece", "n piece",
        "numero document", "reference", "bl",
        # anglais
        "delivery note", "delivery note no", "delivery number", "note no",
        "document no", "document number", "receipt no", "invoice no", "grn",
        "dispatch note", "waybill",
    ], ["interne", "commande", "order", "internal"]),

    "documentDate": ([
        # français
        "date reception", "date de reception", "date livraison", "date du bon",
        "date entree", "date d entree", "date bl", "date document", "date",
        # anglais
        "receipt date", "delivery date", "posting date", "date received",
        "document date", "grn date",
    ], ["peremption", "expiration", "commande", "expiry", "expiration date", "order date"]),
}

LINE_VOCAB: Dict[str, Tuple[List[str], List[str]]] = {
    # « nom » seul est trop vague : « Nom du fournisseur » n'est pas une désignation
    # de produit. C'est ce qui faisait écraser le fournisseur à chaque ligne.
    "designation": ([
        # français
        "designation produit", "designation", "nom du produit", "nom commercial",
        "produit", "article", "libelle", "medicament", "denomination", "description",
        "specialite",
        # anglais
        "product", "product name", "item", "item name", "drug", "medicine",
        "description of goods",
    ], ["code", "cip", "ean", "fournisseur", "grossiste", "laboratoire",
        "supplier", "vendor", "barcode"]),

    "lotNumber": ([
        "numero de lot", "n lot", "no lot", "numero lot", "lot",
        "batch", "batch no", "batch number", "lot no", "lot number", "serial",
    ], []),

    "quantity": ([
        # français
        "quantite recue", "qte recue", "quantite livree", "qte livree",
        "quantite", "qte", "nombre", "recu",
        # anglais
        "qty received", "quantity received", "qty delivered", "qty", "quantity",
        "received", "delivered",
    ], ["commandee", "commande", "gratuit", "restant", "ordered", "free",
        "backorder", "reliquat"]),

    "purchasePrice": ([
        # français
        "prix d achat", "prix achat", "px achat", "prix unitaire", "pu ht", "pu",
        "prix", "tarif", "cout",
        # anglais
        "unit price", "unit cost", "purchase price", "cost price", "buying price",
        "price", "cost",
    ], ["vente", "public", "total", "ttc", "selling", "retail", "sale",
        "sales", "line total", "amount"]),

    "expiryDate": ([
        # français
        "date de peremption", "date peremption", "peremption", "date expiration",
        "expiration", "dlc", "dluo", "exp", "perime",
        # anglais
        "expiry", "expiry date", "expiration date", "expires", "best before",
        "use by", "shelf life",
    ], ["reception", "livraison", "receipt", "delivery"]),

    # ── Champs que l'agent sait reconnaître sans forcément les remplir ──────
    #
    # Les déclarer sert à deux choses : les remplir le jour où le bon les porte,
    # et surtout les empêcher d'être pris pour autre chose. Sans « code article »
    # ici, la colonne du code serait candidate à la désignation du médicament.

    "cip": ([
        "code cip", "cip", "code article", "code produit", "code ean", "ean",
        "reference article", "ref article",
        "product code", "item code", "article code", "barcode", "sku",
    ], ["lot", "batch"]),

    "salePrice": ([
        "prix de vente", "prix vente", "prix public", "ppc", "pv", "ptt",
        "selling price", "retail price", "sale price", "public price",
    ], ["achat", "purchase", "cost"]),

    "discount": ([
        "remise", "ristourne", "rabais", "taux de remise",
        "discount", "rebate", "discount %",
    ], []),

    "freeQuantity": ([
        "quantite gratuite", "qte gratuite", "gratuit", "unite gratuite", "ug",
        "free qty", "free quantity", "bonus",
    ], []),

    "orderedQuantity": ([
        "quantite commandee", "qte commandee", "commande",
        "qty ordered", "quantity ordered", "ordered",
    ], ["recue", "received", "livree", "delivered"]),
}

# Ces colonnes se calculent toutes seules dans l'ERP. L'agent les reconnaît pour
# ne pas s'y tromper, mais n'y écrit jamais : le total est l'affaire de l'ERP,
# et sa vérification celle du pharmacien.
CALCULE_PAR_L_ERP = {"lineTotal", "vat"}

LINE_VOCAB["lineTotal"] = ([
    "total ligne", "montant ligne", "montant ht", "total ht", "total",
    "montant", "line total", "amount", "extended price", "net amount",
], [])
LINE_VOCAB["vat"] = ([
    "tva", "taux tva", "taux de tva", "vat", "vat rate", "tax", "tax rate",
], [])


# ─── Forme attendue d'un champ ──────────────────────────────────────────────
#
# Quand le vocabulaire ne reconnaît pas un intitulé — un ERP qui écrit « Péremp. »
# ou rien du tout — il reste un indice : la forme du champ. Un champ de date ne
# ressemble pas à un champ de quantité. On s'en sert pour deviner, puis on relit
# pour vérifier, plutôt que de laisser la colonne vide sans rien dire.

_NOMBRE_RE = re.compile(r"^[\s0-9.,]*$")
_DATE_INDICE_RE = re.compile(r"\bjj\b|\bdd\b|\bmm\b|\baa\b|\byy\b|\baaaa\b|\byyyy\b|date")


def forme_du_champ(field: Dict[str, Any]) -> str:
    """« date », « nombre » ou « texte » : ce que ce champ a l'air d'attendre."""
    itype = str(field.get("type") or "").lower()
    if itype in ("date", "month"):
        return "date"
    if itype == "number":
        return "nombre"
    indice = norm(str(field.get("placeholder") or "") + " " +
                  str(field.get("label") or "") + " " + str(field.get("name") or ""))
    if _DATE_INDICE_RE.search(indice):
        return "date"
    ph = str(field.get("placeholder") or "").strip()
    if ph and _NOMBRE_RE.match(ph) and any(c.isdigit() for c in ph):
        return "nombre"
    return "texte"


# Forme attendue par chaque donnée du bon. La désignation n'y figure pas : on ne
# devine jamais où va le nom d'un médicament.
FORME_ATTENDUE = {
    "documentDate": "date", "expiryDate": "date",
    "quantity": "nombre", "purchasePrice": "nombre", "salePrice": "nombre",
    "discount": "nombre", "freeQuantity": "nombre", "orderedQuantity": "nombre",
    "supplier": "texte", "documentNumber": "texte", "lotNumber": "texte", "cip": "texte",
}


def deduire(mapping: Dict[str, Dict[str, Any]], fields: List[Dict[str, Any]],
            data: Dict[str, Any],
            interdits: Optional[set] = None) -> Dict[str, Dict[str, Any]]:
    """Propose un champ pour chaque donnée que le vocabulaire n'a pas placée.

    Prudent par construction : jamais pour la désignation du médicament, et
    seulement quand un seul champ libre a la bonne forme. S'il y a deux
    candidats, on ne devine pas — on laisse vide, ce qui se voit et se corrige.

    Et jamais pour une donnée dont le pharmacien a dit qu'elle n'a pas de champ
    dans son ERP : deviner par-dessus son avis reviendrait à le contredire.
    """
    pris = {f["sel"] for f in mapping.values()}
    libres = [f for f in fields if f["sel"] not in pris]
    propositions: Dict[str, Dict[str, Any]] = {}
    for canonical, forme in FORME_ATTENDUE.items():
        if canonical in mapping or canonical in CALCULE_PAR_L_ERP:
            continue
        if canonical in (interdits or set()):
            continue
        if not str(data.get(canonical) or "").strip():
            continue                      # le bon ne porte pas cette donnée
        candidats = [f for f in libres
                     if f["sel"] not in {g["sel"] for g in propositions.values()}
                     and forme_du_champ(f) == forme]
        if len(candidats) == 1:
            propositions[canonical] = candidats[0]
    return propositions


def identite_champ(field: Dict[str, Any], cle: str) -> str:
    """Comment nommer ce champ pour le retrouver la prochaine fois.

    Les colonnes de ligne changent de sélecteur à chaque rangée : on les repère
    par leur intitulé. Une colonne muette — il y en a — se repère par son rang,
    qui, lui, ne bouge pas.
    """
    valeur = str(field.get(cle) or "").strip()
    if valeur:
        return valeur
    if field.get("col") is not None:
        return "#colonne-%d" % field["col"]
    return ""


def resolve(fields: List[Dict[str, Any]], vocab: Dict[str, Tuple[List[str], List[str]]],
            overrides: Optional[Dict[str, str]], key: str,
            appris: Optional[Dict[str, str]] = None) -> Dict[str, Dict[str, Any]]:
    """Association automatique, ce que l'agent a appris, puis les corrections.

    « key » vaut « sel » pour l'en-tête (champs stables) et « label » pour les
    colonnes de ligne, dont le sélecteur change à chaque nouvelle ligne.

    Trois couches, dans cet ordre : le vocabulaire place ce qu'il reconnaît ; ce
    que l'agent a appris sur CET ERP comble les trous ; les corrections du
    pharmacien passent par-dessus tout, car lui seul connaît son logiciel.
    """
    mapping = assign(fields, vocab)
    pris = {f["sel"] for f in mapping.values()}
    for canonical, identite in (appris or {}).items():
        if canonical in mapping:
            continue
        match = next((f for f in fields if identite_champ(f, key) == identite), None)
        if match and match["sel"] not in pris:
            mapping[canonical] = match
            pris.add(match["sel"])
    for canonical, chosen in (overrides or {}).items():
        if chosen == "":
            mapping.pop(canonical, None)       # le pharmacien a dit : ce champ n'existe pas
            continue
        match = next((f for f in fields if (f.get(key) or "") == chosen), None)
        if match:
            mapping[canonical] = match
    return mapping


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
    # L'ERP dit lui-même ce qu'il attend, dans son indice de saisie : « JJ/MM/AAAA »,
    # « MM/AA », « YYYY-MM-DD »... On écrit dans sa langue, pas dans la nôtre.
    hint = norm(str(field.get("placeholder") or "") + " " + str(field.get("label") or ""))
    wants_day = bool(re.search(r"\bjj\b|\bdd\b", hint))
    # « AAAA » et « YYYY » ne doivent pas être pris pour « AA » / « YY ».
    year2 = bool(re.search(r"\baa\b|\byy\b", hint))
    iso = bool(re.search(r"(aaaa|yyyy)\s+mm", hint))
    if iso:
        return ("%04d-%02d-%02d" % (year, month, day or 1)) if wants_day else ("%04d-%02d" % (year, month))
    if year2:
        return ("%02d/%02d/%02d" % (day or 1, month, year % 100)) if wants_day \
            else ("%02d/%02d" % (month, year % 100))
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
        if (head && head.children[i]) {
          const t = head.children[i].textContent.trim();
          if (t) return t;
        }
        // Beaucoup d'ERP n'ont pas de <thead> : leur ligne d'intitules est une
        // ligne ordinaire, faite de <td>, qui ne contient aucun champ de saisie.
        for (const row of table.querySelectorAll('tr')) {
          if (row === tr) break;
          if (row.querySelector('input, select, textarea')) continue;
          const cell = row.children[i];
          const t = cell ? cell.textContent.trim() : '';
          if (t) return t;
        }
      }
    }
    // Dernier recours : un intitule place juste avant le champ, sans « for ».
    const prev = el.previousElementSibling;
    if (prev && /^(LABEL|SPAN|B|STRONG|DIV|P)$/.test(prev.tagName)) {
      const t = prev.textContent.trim();
      if (t && t.length < 60) return t;
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
  // Texte de chaque ligne deja presente, valeurs des champs comprises : c'est ce
  // qui permet de reconnaitre ce qui a deja ete saisi apres une interruption,
  // que l'ERP affiche ses lignes en champs modifiables ou en texte fige.
  const rowTexts = [];
  if (lineTable) {
    for (const tr of lineTable.querySelectorAll('tbody tr')) {
      const fields = Array.from(tr.querySelectorAll('input, select, textarea')).filter((e) => editable(e) && visible(e)).map(describe);
      const values = Array.from(tr.querySelectorAll('input, select, textarea')).map((e) => e.value || '');
      const text = ((tr.textContent || '') + ' ' + values.join(' ')).replace(/\s+/g, ' ').trim();
      if (fields.length) rows.push(fields);
      if (text) rowTexts.push(text);
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

  return { url: location.href, title: document.title, header: header, rows: rows,
           rowTexts: rowTexts, buttons: buttons,
           hasLineTable: !!lineTable, hasPassword: !!document.querySelector('input[type=password]') };
}"""


# Liste de suggestions ouverte sous un champ : on ne retient que ce qui est
# visible, proche du champ, et qui ressemble à une entrée de liste.
SUGGEST_JS = r"""(sel) => {
  const input = document.querySelector(sel);
  if (!input) return [];
  const r = input.getBoundingClientRect();
  const FORBIDDEN = /valid|confirm|clotur|soumett|submit|commander|payer|checkout/i;
  const esc = (s) => (window.CSS && CSS.escape ? CSS.escape(s) : String(s).replace(/[^\w-]/g, '\\$&'));
  const path = (el) => {
    if (el.id) return '#' + esc(el.id);
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
  const holders = '[role=listbox], [class*=suggest], [class*=autocomplete], [class*=typeahead], [class*=result], [class*=dropdown]';
  const nodes = new Set();
  // Une liste de suggestions n'a pas toujours un nom de classe reconnaissable :
  // c'est la position sous le champ qui la désigne, filtrée juste après.
  document.querySelectorAll('[role=option], li').forEach((e) => nodes.add(e));
  document.querySelectorAll(holders).forEach((h) => h.querySelectorAll('a, div[data-value], [class*=item]').forEach((e) => nodes.add(e)));
  const out = [];
  for (const el of nodes) {
    if (el.querySelector('li, [role=option]')) continue;      // conteneur, pas une entrée
    const b = el.getBoundingClientRect();
    if (!b.width || !b.height) continue;
    const s = getComputedStyle(el);
    if (s.visibility === 'hidden' || s.display === 'none') continue;
    if (b.top < r.top - 40 || b.top > r.bottom + 420) continue;   // doit être sous le champ
    if (b.right < r.left - 40 || b.left > r.right + 320) continue; // et aligné avec lui
    const text = (el.textContent || '').trim();
    if (!text || text.length > 160 || FORBIDDEN.test(text)) continue;
    out.push({ sel: path(el), text: text });
    if (out.length > 60) break;
  }
  return out;
}"""


# ─── Navigateur ─────────────────────────────────────────────────────────────


class Browser:
    """Fenêtre Chrome dédiée à l'agent (profil séparé : la session ERP y reste ouverte)."""

    def __init__(self) -> None:
        self.pw = None
        self.ctx = None

    @property
    def is_open(self) -> bool:
        # Une fenêtre fermée par le pharmacien laisse un contexte mort derrière elle :
        # sans ce contrôle, l'agent écrit dans une page qui n'existe plus.
        try:
            return bool(self.ctx and self.ctx.pages and not self.ctx.pages[0].is_closed())
        except Exception:
            return False

    def _discard(self) -> None:
        try:
            if self.ctx:
                self.ctx.close()
        except Exception:
            pass
        self.ctx = None

    def open(self, url: Optional[str] = None):
        if not self.is_open:
            self._discard()
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

    def __init__(self, page, on_progress=None, overrides: Optional[Dict[str, Any]] = None):
        self.page = page
        self.on_progress = on_progress or (lambda *_: None)
        self.overrides = overrides or {}
        self.filled = 0
        self.skipped: List[str] = []
        self.altered: List[Dict[str, str]] = []
        # Trace de chaque champ écrit, avec ce que l'ERP a réaffiché : c'est ce
        # qui permet, des semaines plus tard, de savoir si une quantité fausse
        # vient de la lecture du bon, de l'approbation, ou de la saisie.
        self.written: List[Dict[str, str]] = []
        self.header_used: set = set()
        # Ce que l'agent savait déjà de cet ERP, et ce qu'il vient d'y apprendre.
        self.appris: Dict[str, Dict[str, str]] = {
            "header": dict((self.overrides.get("apprisHeader") or {})),
            "line": dict((self.overrides.get("apprisLine") or {})),
        }
        self.nouveau: Dict[str, Dict[str, str]] = {"header": {}, "line": {}}

    def survey(self) -> Dict[str, Any]:
        return self.page.evaluate(SURVEY_JS)

    def write(self, field: Dict[str, Any], value: Any, pick: bool = False,
              canonical: str = "") -> bool:
        """Remplit un champ. Jamais de touche Entrée (elle pourrait valider).

        « pick » : champ produit, où l'ERP peut ouvrir une liste de suggestions
        qu'il faut cliquer plutôt que de laisser le texte libre.
        """
        # Les totaux et la TVA se calculent dans l'ERP. L'agent les reconnaît
        # pour ne pas s'y tromper de colonne, mais n'y touche jamais : leur
        # vérification revient au pharmacien.
        if canonical in CALCULE_PAR_L_ERP:
            return False
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
                written = choice
            else:
                loc.scroll_into_view_if_needed(timeout=3000)
                loc.fill(text, timeout=5000)
                written = text
                if pick:
                    chosen = self.pick_suggestion(field, text)
                    self._dismiss_list()
                    if chosen:
                        # L'ERP a inscrit lui-même l'article : sa version fait foi.
                        self.filled += 1
                        log.info("Produit choisi dans la liste : %s", chosen[:60])
                        return True
            # Beaucoup d'ERP ne valident et ne reformatent qu'en quittant le champ.
            # On se contente de le quitter : Playwright a déjà émis « change », et le
            # réémettre ferait reformater deux fois (650 deviendrait 65 000).
            try:
                loc.evaluate("e => e.blur()")
            except Exception:
                pass
            self.filled += 1
            self._verify(loc, field, written)
            return True
        except Exception as e:
            log.info("Champ « %s » non rempli : %s", field.get("label") or field.get("sel"), str(e)[:90])
            return False

    def _click(self, loc, what: str) -> bool:
        """Clique en réessayant une fois : une liste restée ouverte peut masquer le bouton."""
        try:
            loc.click(timeout=4000)
            return True
        except Exception:
            self._dismiss_list()
            try:
                loc.click(timeout=4000)
                return True
            except Exception as e:
                log.info("%s : clic impossible (%s)", what, str(e).splitlines()[0][:90])
                return False

    def _dismiss_list(self) -> None:
        """Referme une liste restée ouverte : elle recouvrirait les boutons de la page.
        Échap ne valide rien — contrairement à Entrée, qu'on ne touche jamais."""
        try:
            self.page.keyboard.press("Escape")
            self.page.wait_for_timeout(80)
        except Exception:
            pass

    def pick_suggestion(self, field: Dict[str, Any], wanted: str) -> Optional[str]:
        """Choisit dans la liste qui s'ouvre sous un champ produit. Ne clique qu'à coup sûr."""
        try:
            self.page.wait_for_timeout(350)
            items = self.page.evaluate(SUGGEST_JS, field["sel"])
        except Exception:
            return None
        if not items:
            return None
        texts = [i["text"] for i in items]
        choice = best_option(wanted, texts)
        if not choice:
            log.info("Liste ouverte sous « %s » mais aucune entrée ne correspond à « %s » : "
                     "le texte est laissé tel quel.", field.get("label") or field["sel"], wanted[:40])
            return None
        target = next(i for i in items if i["text"] == choice)
        try:
            self.page.locator(target["sel"]).first.click(timeout=4000)
            self.page.wait_for_timeout(200)
            return choice
        except Exception as e:
            log.info("Entrée « %s » non cliquable : %s", choice[:40], str(e)[:80])
            return None

    def _verify(self, loc, field: Dict[str, Any], wanted: str) -> None:
        """Relit le champ : l'ERP peut avoir tronqué, reformaté ou refusé la valeur."""
        try:
            if field.get("tag") == "select":
                got = loc.evaluate("e => (e.options[e.selectedIndex] || {}).textContent || ''").strip()
            else:
                got = loc.input_value(timeout=2000)
        except Exception:
            # Champ devenu illisible : on garde quand même la trace de l'écriture.
            got = None
        label = field.get("label") or field.get("name") or field.get("sel")
        trace = {"champ": str(label)[:60], "valeur": str(wanted)[:80]}
        if got is not None and not same_value(wanted, got):
            trace["affiche"] = str(got)[:80]
        self.written.append(trace)
        if got is None or same_value(wanted, got):
            return
        self.altered.append({"champ": label, "voulu": wanted, "obtenu": got})
        log.info("Champ « %s » : écrit « %s », l'ERP affiche « %s ».", label, wanted, got)

    def value_for(self, name: str, data: Dict[str, Any], field: Dict[str, Any]) -> Any:
        raw = data.get(name)
        if name in ("documentDate", "expiryDate"):
            return format_date(str(raw or ""), field)
        return raw

    def fill_header(self, header: Dict[str, Any], survey: Dict[str, Any]) -> None:
        champs = survey.get("header") or []
        mapping = resolve(champs, HEADER_VOCAB, self.overrides.get("header"), "sel",
                          self.appris["header"])
        if not mapping and not champs:
            log.info("Aucun champ d'en-tête reconnu sur cette page.")
        _, manques = self.ecrire_champs(mapping, header, champs, "header", "sel")
        self.skipped.extend(manques)
        self.header_used = {f["sel"] for f in mapping.values()}

    def ecrire_champs(self, mapping: Dict[str, Dict[str, Any]], data: Dict[str, Any],
                      fields: List[Dict[str, Any]], zone: str, cle: str,
                      pick_designation: bool = False) -> Tuple[int, List[str]]:
        """Écrit les champs, devine ceux qui manquent, retient ce qui a marché.

        Une donnée que le vocabulaire n'a pas su placer n'est plus abandonnée :
        on cherche le seul champ libre dont la forme convient, on écrit, et on
        relit. Si l'ERP a bien repris la valeur, l'association est retenue pour
        cet ERP — la prochaine fois elle sera immédiate, sans deviner.
        """
        # Le pharmacien a pu dire d'un champ qu'il n'existe pas chez lui : on ne
        # le redevine surtout pas derrière son dos.
        interdits = {c for c, v in (self.overrides.get(zone) or {}).items() if v == ""}
        devines = deduire(mapping, fields, data, interdits)
        for canonical, field in devines.items():
            mapping[canonical] = field
            log.info("Champ « %s » non reconnu : essai sur « %s » (%s).", canonical,
                     field.get("label") or field.get("name") or field["sel"],
                     forme_du_champ(field))
        ecrits, manques = 0, []
        for name, field in mapping.items():
            value = self.value_for(name, data, field)
            label = field.get("label") or field.get("name") or name
            avant = len(self.written)
            if self.write(field, value, pick=(pick_designation and name == "designation"),
                          canonical=name):
                ecrits += 1
                # Déduction confirmée par la relecture : on la retient.
                if name in devines:
                    trace = self.written[avant:]
                    if trace and not any(t.get("affiche") for t in trace):
                        identite = identite_champ(field, cle)
                        if identite:
                            self.appris[zone][name] = identite
                            self.nouveau[zone][name] = identite
                            log.info("Appris : « %s » se saisit dans « %s ».", name, identite)
            elif str(value or "").strip() and name not in CALCULE_PAR_L_ERP:
                manques.append(label)
                if name in devines:
                    mapping.pop(name, None)   # l'essai n'a rien donné : on l'oublie
        return ecrits, manques

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
            if not self._click(self.page.locator(btn["sel"]).first, "Ajout d'une ligne"):
                return None
            self.page.wait_for_timeout(120)
            survey = self.survey()
            rows = survey.get("rows") or []
            guard += 1
        return rows[index] if len(rows) > index else None

    def catalogue(self, survey: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Repère le bloc « choisir un produit du catalogue, puis Ajouter ».

        Ce chemin rattache la ligne à un article réel de l'ERP — code, stock, prix —
        là où une ligne tapée librement reste du texte.
        """
        header = survey.get("header") or []
        chooser = None
        for f in header:
            if f.get("tag") != "select":
                continue
            options = [o for o in (f.get("options") or []) if norm(o)]
            label = norm(str(f.get("label") or "") + " " + str(f.get("name") or ""))
            if len(options) >= 3 or PRODUCT_LIST_RE.search(label):
                chooser = f
                break
        if not chooser:
            return None
        # Un champ déjà reconnu comme appartenant à l'en-tête du bon n'est pas un champ
        # de ligne : sans cela l'agent écraserait le fournisseur avec le nom du produit.
        rest = [f for f in header if f["sel"] != chooser["sel"] and f["sel"] not in self.header_used]
        for rang, champ in enumerate(rest):
            champ["col"] = rang
        fields = resolve(rest, LINE_VOCAB, self.overrides.get("line"), "label",
                         self.appris["line"])
        button = None
        for b in survey.get("buttons") or []:
            text = b.get("text") or ""
            if b.get("forbidden") or not re.search(r"ajouter|add", text, re.I):
                continue
            if re.search(r"ligne|row|line", text, re.I):  # celui-là crée une ligne vide
                continue
            button = b
            break
        if not button or not fields:
            return None
        return {"chooser": chooser, "fields": fields, "button": button}

    def fill_lines_catalogue(self, lines: List[Dict[str, Any]], cat: Dict[str, Any]) -> List[Dict[str, Any]]:
        results: List[Dict[str, Any]] = []
        options = cat["chooser"].get("options") or []
        chooser = self.page.locator(cat["chooser"]["sel"]).first
        adder = self.page.locator(cat["button"]["sel"]).first
        for position, line in enumerate(lines):
            idx = line.get("index", position)
            wanted = line.get("product") or line.get("designation") or ""
            if line.get("skip"):
                results.append({"index": idx, "ok": False, "message": str(line["skip"])[:300]})
                continue
            self.on_progress(position, len(lines), wanted or "?")
            mark = len(self.written)  # pour isoler ce qui est écrit pour cette ligne
            choice = best_option(wanted, options)
            if not choice:
                results.append({"index": idx, "ok": False,
                                "message": "« %s » est absent du catalogue de l'ERP : créez l'article, puis renvoyez le bon." % wanted[:80]})
                log.info("Ligne %d : « %s » absent du catalogue.", position + 1, wanted[:50])
                continue
            try:
                chooser.select_option(label=choice, timeout=5000)
                self.page.wait_for_timeout(150)
                # Le médicament retenu est la donnée la plus importante de la trace :
                # on note le libellé du bon et l'article du catalogue effectivement choisi.
                trace = {"champ": str(cat["chooser"].get("label") or "Produit")[:60],
                         "valeur": str(choice)[:80]}
                if norm(choice) != norm(wanted):
                    trace["affiche"] = "demandé : " + str(wanted)[:66]
                self.written.append(trace)
            except Exception as e:
                results.append({"index": idx, "ok": False, "message": "Choix du produit impossible : %s" % str(e)[:150]})
                continue
            data = dict(line)
            data.setdefault("designation", wanted)
            _, missed = self.ecrire_champs(cat["fields"], data, list(cat["fields"].values()),
                                           "line", "label")
            before = len(self.survey().get("rows") or [])
            if not self._click(adder, "Ajout au bon"):
                results.append({"index": idx, "ok": False,
                                "message": "Le bouton « %s » de l'ERP n'a pas pu être cliqué." % (cat["button"].get("text") or "Ajouter")[:40]})
                continue
            self.page.wait_for_timeout(250)
            added = len(self.survey().get("rows") or []) > before
            results.append({
                "index": idx, "ok": added,
                "message": (("Non rempli : " + ", ".join(missed))[:300] if missed else None) if added
                           else "L'ERP n'a pas ajouté la ligne.",
                "written": self.written[mark:],
            })
            log.info("Ligne %d : %s (catalogue).", position + 1, choice[:60])
        return results

    def fill_lines(self, lines: List[Dict[str, Any]], survey: Optional[Dict[str, Any]] = None) -> List[Dict[str, Any]]:
        cat = self.catalogue(survey) if survey else None
        if cat:
            log.info("Catalogue détecté : les produits sont choisis dans la liste « %s ».",
                     cat["chooser"].get("label") or cat["chooser"].get("name"))
            return self.fill_lines_catalogue(lines, cat)
        results: List[Dict[str, Any]] = []
        for position, line in enumerate(lines):
            idx = line.get("index", position)
            if line.get("skip"):
                results.append({"index": idx, "ok": False, "message": str(line["skip"])[:300]})
                continue
            label = line.get("product") or line.get("designation") or "?"
            self.on_progress(position, len(lines), label)
            mark = len(self.written)
            fields = self.ensure_row(position)
            if fields is not None:
                for rang, champ in enumerate(fields):
                    champ["col"] = rang
            if fields is None:
                results.append({"index": idx, "ok": False, "message": "Impossible d'ajouter une ligne dans l'ERP."})
                continue
            mapping = resolve(fields, LINE_VOCAB, self.overrides.get("line"), "label",
                              self.appris["line"])
            if not mapping:
                results.append({"index": idx, "ok": False, "message": "Aucune colonne de saisie reconnue."})
                continue
            data = dict(line)
            data.setdefault("designation", line.get("product") or "")
            if not data.get("designation"):
                data["designation"] = line.get("product") or ""
            wrote, missed = self.ecrire_champs(mapping, data, fields, "line", "label",
                                               pick_designation=True)
            results.append({
                "index": idx,
                "ok": wrote > 0,
                "message": ("Non rempli : " + ", ".join(missed))[:300] if missed else None,
                "written": self.written[mark:],
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
        self.support_code: str = ""
        self.mappings: Dict[str, Any] = dict(self.cfg.get("mappings") or {})
        self.check: Optional[Dict[str, Any]] = None
        self.diagnosis: Optional[Dict[str, Any]] = None
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
            "supportCode": self.support_code, "check": self.check,
            "diagnosis": self.diagnosis,
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

    # ── Mode essai : montrer l'agent sans brancher le vrai ERP ─────────────

    # Bon d'exemple : produits du catalogue de l'ERP de démonstration.
    DEMO_TASK = {
        "header": {"supplier": "UBIPHARM SENEGAL", "documentNumber": "BL-DEMO-001",
                   "documentDate": "2026-11-21"},
        "lines": [
            {"index": 0, "product": "COTRIMOXAZOLE 480MG CP B/20", "quantity": 30,
             "lotNumber": "LOT-CTX-2611", "expiryDate": "2028-08-31", "purchasePrice": 650},
            {"index": 1, "product": "PARACETAMOL 250MG SUPP B/10", "quantity": 60,
             "lotNumber": "LOT-PAR-2615", "expiryDate": "2029-01-31", "purchasePrice": 420},
            {"index": 2, "product": "FER SULFATE 200MG CP B/30", "quantity": 45,
             "lotNumber": "LOT-FER-2620", "expiryDate": "2028-05-31", "purchasePrice": 720},
        ],
    }

    def _demo(self) -> Dict[str, Any]:
        """Remplit l'ERP de démonstration servi par PharmAgent, sous les yeux du pharmacien.

        Ne touche ni au vrai ERP, ni aux bons de la pharmacie : rien n'est
        envoyé au serveur, et le garde-fou reste entier — la réception de
        démonstration n'est pas validée non plus.
        """
        url = self.api.server.rstrip("/") + "/demo/erp"
        log.info("Démonstration : ouverture de l'ERP d'exemple.")
        page = self.browser.open(url)
        Browser._settle(page)
        filler = Filler(page)
        survey = filler.survey()
        if not survey.get("header") and not survey.get("hasLineTable"):
            raise RuntimeError(
                "L'ERP de démonstration ne s'est pas chargé. Vérifiez la connexion à PharmAgent.")
        started = time.time()
        filler.fill_header(self.DEMO_TASK["header"], survey)
        results = filler.fill_lines(self.DEMO_TASK["lines"], survey)
        ok = sum(1 for r in results if r.get("ok"))
        interdits = [b.get("text") for b in survey.get("buttons") or [] if b.get("forbidden")]
        message = ("Démonstration : %d champ(s) et %d ligne(s) sur %d remplis en %.1f s, "
                   "sans rien valider." % (filler.filled, ok, len(self.DEMO_TASK["lines"]),
                                           time.time() - started))
        log.info("%s", message)
        return {"message": message, "lignes": ok, "total": len(self.DEMO_TASK["lines"]),
                "jamaisClique": [str(t)[:40] for t in interdits]}

    # ── « Un problème ? » : l'agent se relit et se répare lui-même ──────────

    def _diagnose(self) -> Dict[str, Any]:
        """Cherche la cause de la panne, répare ce qui est sans risque, dit le reste.

        Conçu pour une officine sans personne à appeler : tout se passe sur le
        poste, rien ne part sur le réseau, et le garde-fou n'est jamais touché —
        aucune réparation ne clique un bouton de validation.
        """
        constats: List[Dict[str, Any]] = []

        def note(etat: str, titre: str, explication: str, geste: str = "", repare: bool = False) -> None:
            constats.append({"etat": etat, "titre": titre, "explication": explication,
                             "geste": geste, "repare": repare})

        # 1. Le lien avec PharmAgent — vérifié pour de bon, pas d'après un
        #    indicateur qui peut dater de plusieurs minutes.
        try:
            self.api.call("GET", "/agent/version", timeout=10)
            self.server_ok = True
            self.last_error = ""
        except ApiError as e:
            self.server_ok = e.status != 0 and e.status < 500
            if not self.server_ok:
                self.last_error = str(e)
        except Exception as e:
            self.server_ok = False
            self.last_error = str(e)

        if not self.api.key:
            note("attention", "Cet ordinateur n'est pas encore relié à la pharmacie",
                 "Sans liaison, aucun bon ne peut arriver jusqu'ici.",
                 "Saisissez le code affiché ci-dessus dans PharmAgent, à la page « Agent local ».")
        elif not self.server_ok:
            note("probleme", "PharmAgent est injoignable",
                 "L'agent n'arrive pas à parler au serveur : %s" % (self.last_error or "cause inconnue")[:150],
                 "Vérifiez la connexion Internet du poste. L'agent réessaie tout seul en continu.")
        else:
            note("ok", "Liaison avec PharmAgent en ordre",
                 "Le serveur répond et cet ordinateur est reconnu comme celui de « %s »."
                 % (self.cfg.get("pharmacyName") or "la pharmacie"))

        # 2. L'agent est-il en pause ?
        if self.paused:
            self.paused = False
            self._persist()
            note("repare", "L'agent était en pause",
                 "En pause, il reçoit les bons mais n'écrit rien dans l'ERP.",
                 repare=True)

        # 3. L'adresse de l'ERP
        if not self.erp_url:
            note("probleme", "Aucune adresse d'ERP n'est enregistrée",
                 "L'agent ne sait pas quelle page remplir.",
                 "Collez l'adresse de l'écran de réception de votre ERP dans le champ ci-dessus.")
            self.diagnosis = {"at": datetime.now().strftime("%d/%m %H:%M"), "constats": constats,
                              "repares": sum(1 for c in constats if c.get("repare")),
                              "restants": sum(1 for c in constats if c["etat"] == "probleme")}
            return self.diagnosis

        # 4. Le navigateur, et la page réellement ouverte
        try:
            relance = not self.browser.is_open
            page = self.browser.open(self.erp_url)
            Browser._settle(page)
            if relance:
                note("repare", "La fenêtre de l'agent était fermée",
                     "Elle a été rouverte sur votre ERP : la saisie peut reprendre.", repare=True)
        except Exception as e:
            note("probleme", "Le navigateur ne démarre pas",
                 friendly_error(e),
                 "Relancez l'installateur PharmAgent : il réinstalle le navigateur et le vérifie.")
            self.diagnosis = {"at": datetime.now().strftime("%d/%m %H:%M"), "constats": constats,
                              "repares": sum(1 for c in constats if c.get("repare")),
                              "restants": sum(1 for c in constats if c["etat"] == "probleme")}
            return self.diagnosis

        over = self.mappings.get(map_key(page.url)) or {}
        filler = Filler(page, overrides=over)
        survey = filler.survey()

        if looks_like_login(survey):
            note("attention", "Votre ERP demande une connexion",
                 "L'agent n'écrit jamais dans un écran de connexion, et ne connaît pas votre mot de passe.",
                 "Dans la fenêtre Agent Floki, connectez-vous, ouvrez l'écran de réception d'un bon, "
                 "puis renvoyez le bon depuis PharmAgent.")
        elif not survey.get("header") and not survey.get("rows") and not survey.get("hasLineTable"):
            bonne_page = (page.url or "").split("#")[0] != (self.erp_url or "").split("#")[0]
            if bonne_page:
                try:
                    page.goto(self.erp_url, wait_until="domcontentloaded", timeout=60000)
                    Browser._settle(page)
                    survey = filler.survey()
                    note("repare", "La fenêtre s'était égarée sur une autre page",
                         "Elle a été ramenée sur l'écran de votre ERP.", repare=True)
                except Exception:
                    pass
            if not survey.get("header") and not survey.get("rows") and not survey.get("hasLineTable"):
                note("probleme", "Cette page ne contient aucun champ à remplir",
                     "L'agent voit « %s », qui n'est pas un écran de saisie."
                     % (survey.get("title") or survey.get("url") or "")[:70],
                     "Ouvrez dans la fenêtre Agent Floki l'écran de réception d'un bon de livraison, "
                     "puis cliquez « Vérifier l'ERP ».")
        else:
            head_map = resolve(survey.get("header") or [], HEADER_VOCAB, over.get("header"), "sel")
            manquants = [n for n in ("supplier", "documentNumber", "documentDate") if n not in head_map]
            noms = {"supplier": "Fournisseur", "documentNumber": "Référence du bon",
                    "documentDate": "Date de réception"}
            if manquants:
                note("attention", "Des champs d'en-tête ne sont pas reconnus",
                     "L'agent ne sait pas où écrire : %s." % ", ".join(noms[n] for n in manquants),
                     "Cliquez « Vérifier l'ERP » : vous pourrez désigner vous-même le bon champ.")
            else:
                note("ok", "L'écran de votre ERP est bien reconnu",
                     "En-tête, colonnes de ligne et boutons sont identifiés.")
            interdits = [b.get("text") for b in survey.get("buttons") or [] if b.get("forbidden")]
            if interdits:
                note("ok", "Le garde-fou est en place",
                     "L'agent ne cliquera jamais : %s." % ", ".join(str(t)[:30] for t in interdits[:4]))

        # 5. Ce que dit la dernière saisie
        dernier = self.last_result or {}
        if dernier.get("status") == "failed":
            note("attention", "La dernière saisie s'est arrêtée",
                 dernier.get("message") or "",
                 "Renvoyez le bon depuis PharmAgent : l'agent reprend là où il s'était arrêté, "
                 "sans saisir deux fois ce qui est déjà dans l'écran.")
        elif dernier.get("message"):
            note("ok", "Dernière saisie : %s" % dernier.get("at", ""), dernier["message"])

        repares = sum(1 for c in constats if c.get("repare"))
        restants = [c for c in constats if c["etat"] == "probleme"]
        log.info("Diagnostic : %d réparation(s), %d problème(s) restant(s).", repares, len(restants))
        self.diagnosis = {"at": datetime.now().strftime("%d/%m %H:%M"), "constats": constats,
                          "repares": repares, "restants": len(restants)}
        return self.diagnosis

    def _persist(self) -> None:
        self.cfg.update({
            "server": self.api.server, "agentKey": self.api.key, "erpUrl": self.erp_url,
            "paused": self.paused, "lastResult": self.last_result, "mappings": self.mappings,
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
        if name == "check_erp":
            if not self.erp_url:
                raise ValueError("Indiquez d'abord l'adresse de l'ERP.")
            page = self.browser.open(self.erp_url)
            Browser._settle(page)
            over = self.mappings.get(map_key(page.url)) or {}
            filler = Filler(page, overrides=over)
            survey = filler.survey()
            head_fields = survey.get("header") or []
            row_fields = (survey.get("rows") or [[]])[0]
            if not row_fields and survey.get("hasLineTable"):
                # Tableau vide : on crée une ligne pour voir ses colonnes, puis on l'enlève.
                if filler.ensure_row(0) is not None:
                    row_fields = (filler.survey().get("rows") or [[]])[0]
            for rang, champ in enumerate(row_fields):
                champ["col"] = rang
            head_map = resolve(head_fields, HEADER_VOCAB, over.get("header"), "sel",
                               over.get("apprisHeader"))
            line_map = resolve(row_fields, LINE_VOCAB, over.get("line"), "label",
                               over.get("apprisLine"))
            self.check = {
                "url": page.url,
                "login": looks_like_login(survey),
                "header": {
                    "choices": [{"key": f["sel"], "label": f.get("label") or f.get("name") or f["sel"]}
                                for f in head_fields],
                    "mapping": {c: f["sel"] for c, f in head_map.items()},
                },
                "line": {
                    "choices": [{"key": f.get("label") or f.get("name") or f["sel"],
                                 "label": f.get("label") or f.get("name") or f["sel"]} for f in row_fields],
                    "mapping": {c: (f.get("label") or f.get("name") or f["sel"]) for c, f in line_map.items()},
                },
                "buttons": [{"texte": b.get("text"), "interdit": bool(b.get("forbidden"))}
                            for b in survey.get("buttons") or []],
                "catalogue": bool(filler.catalogue(survey)),
            }
            log.info("Vérification de l'ERP : %d champ(s) d'en-tête, %d colonne(s) de ligne.",
                     len(head_fields), len(row_fields))
            return self.check
        if name == "demo":
            return self._demo()
        if name == "diagnose":
            return self._diagnose()
        if name == "close_diagnosis":
            self.diagnosis = None
            return True
        if name == "save_mapping":
            if not self.check:
                raise ValueError("Lancez d'abord « Vérifier l'ERP ».")
            key = map_key(self.check.get("url") or self.erp_url)
            garde = self.mappings.get(key) or {}
            self.mappings[key] = {
                "header": dict(p.get("header") or {}), "line": dict(p.get("line") or {}),
                "apprisHeader": dict(garde.get("apprisHeader") or {}),
                "apprisLine": dict(garde.get("apprisLine") or {}),
            }
            self.check = None
            self._persist()
            log.info("Correspondance des champs enregistrée pour %s", key[:70])
            return True
        if name == "close_check":
            self.check = None
            return True
        if name == "forget_mapping":
            self.mappings.pop(map_key(self.check.get("url") if self.check else self.erp_url), None)
            self.check = None
            self._persist()
            log.info("Corrections et apprentissage effacés : retour à la détection automatique.")
            return True
        if name == "support":
            # Envoi volontaire : état, journal, et surtout ce que l'agent voit de l'ERP.
            payload: Dict[str, Any] = {
                "state": self.state(),
                "logs": [l["t"] + " " + l["msg"] for l in LOG_LINES],
                "code": self.support_code or None,
            }
            try:
                if self.browser.is_open:
                    page = self.browser.ctx.pages[0]
                    payload["foreground"] = page.url
                    # Les champs reconnus sur la page : c'est ce qui explique un mauvais remplissage.
                    survey = Filler(page).survey()
                    payload["windows"] = {
                        "enTete": [f.get("label") or f.get("name") for f in survey.get("header") or []],
                        "colonnes": [f.get("label") or f.get("name") for f in (survey.get("rows") or [[]])[0]],
                        "lignesPresentes": len(survey.get("rows") or []),
                        "boutons": [{"texte": b.get("text"), "interdit": b.get("forbidden")}
                                    for b in survey.get("buttons") or []],
                    }
                    payload["screenshot"] = base64.b64encode(page.screenshot(full_page=True)).decode()
            except Exception as e:
                payload["foreground"] = "lecture de l'ERP impossible : %s" % str(e)[:120]
            res = self.api.call("POST", "/api/agent-client/support", payload, timeout=60)
            self.support_code = str((res or {}).get("code") or "")
            log.info("Aide à distance : code %s (valable 1 heure).", self.support_code)
            return {"code": self.support_code}
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
        header_written: List[Dict[str, str]] = []
        try:
            try:
                page = self.browser.open(self.erp_url)
            except Exception:
                # Navigateur laissé dans un état inutilisable : on repart d'un neuf.
                self.browser.close()
                page = self.browser.open(self.erp_url)
            Browser._settle(page)

            def progress(i: int, total: int, label: str) -> None:
                self.task["done"] = i
                self.task["current"] = label

            filler = Filler(page, progress, self.mappings.get(map_key(page.url)) or {})
            survey = filler.survey()
            if looks_like_login(survey):
                raise RuntimeError(
                    "L'ERP demande une connexion : rien n'a été saisi. Connectez-vous dans la "
                    "fenêtre Agent Floki, ouvrez l'écran de réception, puis renvoyez le bon."
                )
            if not survey.get("header") and not survey.get("rows") and not survey.get("hasLineTable"):
                raise RuntimeError(
                    "Aucun champ de saisie sur « %s ». Ouvrez dans l'ERP l'écran de réception d'un bon de livraison."
                    % (survey.get("url") or self.erp_url)[:80]
                )

            # ── Reprise d'une saisie interrompue ──
            # Un échec à la cinquième ligne sur huit laissait le pharmacien sans
            # issue : tout resaisir comptait les médicaments en double, et le
            # renvoi du bon était refusé en bloc. On relève donc ce qui est déjà
            # dans l'écran et on ne saisit que ce qui manque.
            done = lines_already_done(survey, lines)
            if lines and len(done) >= len(lines):
                raise RuntimeError(
                    "Le bon %s est déjà entièrement saisi dans l'écran ouvert (%d ligne(s)) : rien "
                    "n'a été ajouté. Vérifiez puis validez dans l'ERP."
                    % (header.get("documentNumber") or "", len(lines))
                )
            header_done = already_entered(survey, header)
            if done or header_done:
                log.info("Reprise de la saisie : %d ligne(s) sur %d déjà présente(s) dans l'ERP.",
                         len(done), len(lines))
            if not header_done:
                filler.fill_header(header, survey)
            # Ce qui précède la première ligne est la trace de l'en-tête.
            header_written = list(filler.written)
            remaining = [line for i, line in enumerate(lines) if i not in done]
            filled = filler.fill_lines(remaining, survey) if remaining else []

            # Compte rendu rendu au bon dans son ordre d'origine, lignes reprises comprises.
            by_index = {r.get("index"): r for r in filled}
            results = []
            for i, line in enumerate(lines):
                idx = line.get("index", i)
                if i in done:
                    results.append({"index": idx, "ok": True,
                                    "message": "Déjà présente dans l'ERP : non resaisie."})
                else:
                    results.append(by_index.get(idx, {"index": idx, "ok": False,
                                                      "message": "Non traitée."}))

            ok_lines = sum(1 for r in results if r.get("ok"))
            message = "%d champ(s) saisi(s), %d ligne(s) sur %d, en %.1f s." % (
                filler.filled, ok_lines, len(lines), time.time() - started)
            if done:
                message += " %d ligne(s) déjà présente(s), non resaisie(s)." % len(done)
            if filler.skipped:
                message += " Non rempli : " + ", ".join(filler.skipped[:6]) + "."
            if filler.altered:
                message += " %d champ(s) affichés différemment par l'ERP : %s." % (
                    len(filler.altered),
                    ", ".join("%s (« %s » → « %s »)" % (a["champ"], a["voulu"], a["obtenu"])
                              for a in filler.altered[:4]))
            message += " Vérifiez puis validez dans l'ERP."
            # Ce que l'agent vient de comprendre de CET ERP est conservé : la
            # prochaine livraison n'aura pas à le redécouvrir.
            if filler.nouveau["header"] or filler.nouveau["line"]:
                cle = map_key(page.url)
                memoire = self.mappings.setdefault(cle, {})
                memoire.setdefault("apprisHeader", {}).update(filler.nouveau["header"])
                memoire.setdefault("apprisLine", {}).update(filler.nouveau["line"])
                self._persist()
                log.info("Retenu pour %s : %s", cle[:50],
                         ", ".join(list(filler.nouveau["header"]) + list(filler.nouveau["line"])))
            try:
                page.screenshot(path=str(HOME / "derniere_saisie.png"), full_page=True)
            except Exception:
                pass
            if not filler.filled:
                status = "failed"
                message = ("Rien n'a pu être rempli sur « %s » : les champs du formulaire n'ont pas été reconnus."
                           % (survey.get("url") or "")[:80])
        except Exception as e:
            status, message = "failed", friendly_error(e)
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
                    "headerWritten": header_written,
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
.l2{display:block;font-size:12px;color:var(--mut);margin:16px 0 8px;text-transform:uppercase;letter-spacing:.06em}
.maprow{display:flex;gap:10px;align-items:center;margin-bottom:8px;flex-wrap:wrap}
.maprow span{flex:0 0 165px;font-size:13px}
.maprow select{flex:1 1 180px;min-width:0;padding:9px 11px;border-radius:9px;border:1px solid var(--line);background:#0e1527;color:var(--ink);font-size:14px}
.guard{font-size:13px;color:var(--mut);border-left:3px solid var(--ok);padding-left:12px}
.err{color:var(--bad);font-size:13px;margin-top:10px}
.diag{border-left:3px solid var(--line);padding:2px 0 2px 12px;margin:12px 0}
.diag.ok{border-color:var(--ok)}.diag.repare{border-color:var(--ok)}
.diag.attention{border-color:#d08a1e}.diag.probleme{border-color:var(--bad)}
.diag b{display:block;font-size:14px;margin-bottom:3px}
.diag .geste{display:block;margin-top:6px;font-size:13px}
.tag{font-size:11px;font-weight:700;letter-spacing:.05em;text-transform:uppercase}
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
const LBL={supplier:"Fournisseur",documentNumber:"N° du bon",documentDate:"Date de réception",
  designation:"Désignation du produit",lotNumber:"N° de lot",quantity:"Quantité reçue",
  purchasePrice:"Prix d'achat",expiryDate:"Date de péremption",cip:"Code CIP",salePrice:"Prix de vente"};
const HORDER=['supplier','documentNumber','documentDate'];
const LORDER=['designation','lotNumber','quantity','purchasePrice','expiryDate','cip','salePrice'];
function mapRows(kind,data){
  const order=kind==='header'?HORDER:LORDER, cur=data.mapping||{}, ch=data.choices||[];
  return order.map(c=>{
    const opts=['<option value="">— aucun —</option>'].concat(
      ch.map(o=>`<option value="${esc(o.key)}"${o.key===cur[c]?' selected':''}>${esc(o.label)}</option>`));
    return `<div class="maprow"><span>${esc(LBL[c])}</span><select data-kind="${kind}" data-canon="${c}">${opts.join('')}</select></div>`;
  }).join('');
}
function collectMapping(){
  const out={header:{},line:{}};
  document.querySelectorAll('#app select[data-canon]').forEach(s=>{out[s.dataset.kind][s.dataset.canon]=s.value;});
  return out;
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
  if(act&&(act.tagName==='INPUT'||act.tagName==='SELECT')&&a.contains(act))return;
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
    <button class="sec" ${busy?'disabled':''} onclick="call('check_erp')">Vérifier l'ERP</button>
    <button class="sec" ${busy?'disabled':''} onclick="call('pause')">${S.status==='paused'?'Reprendre':'Mettre en pause'}</button></div>
    <p class="sub">« Vérifier l'ERP » montre ce que l'agent a compris de votre écran de réception. Facultatif : sans cela, il se débrouille seul.</p></div>
    <div class="card"><label>Quelque chose ne va pas ?</label>
    <p class="sub">L'agent relit son journal et son écran, répare ce qu'il peut tout seul, et vous dit quoi faire pour le reste. Rien ne sort de la pharmacie.</p>
    <div class="row"><button ${busy?'disabled':''} onclick="call('diagnose')">Un problème ?</button>
    <button class="sec" ${busy?'disabled':''} onclick="call('demo')">Démonstration</button></div>
    <p class="sub">« Démonstration » remplit un ERP d'exemple, sans toucher au vôtre : à montrer avant de brancher le vrai.</p></div>`;
  }

  if(S.diagnosis){
    const d=S.diagnosis, mot={ok:'En ordre',repare:'Réparé',attention:'À regarder',probleme:'Bloquant'};
    const coul={ok:'var(--ok)',repare:'var(--ok)',attention:'#d08a1e',probleme:'var(--bad)'};
    h+=`<div class="card"><label>Diagnostic du ${esc(d.at||'')}</label>
    <p class="sub">${d.repares?`${d.repares} chose(s) réparée(s) automatiquement. `:''}${d.restants?`${d.restants} point(s) demandent votre geste.`:'Rien ne bloque la saisie.'}</p>
    ${(d.constats||[]).map((c)=>`<div class="diag ${esc(c.etat)}">
      <span class="tag" style="color:${coul[c.etat]||'var(--mut)'}">${esc(mot[c.etat]||c.etat)}</span>
      <b>${esc(c.titre)}</b>
      <span class="sub">${esc(c.explication||'')}</span>
      ${c.geste?`<span class="geste">→ ${esc(c.geste)}</span>`:''}
    </div>`).join('')}
    <div class="row"><button class="sec" ${busy?'disabled':''} onclick="call('diagnose')">Revérifier</button>
    <button class="sec" ${busy?'disabled':''} onclick="call('close_diagnosis')">Fermer</button></div></div>`;
  }

  if(S.check){
    const c=S.check;
    h+=`<div class="card"><label>Ce que l'agent a compris de votre ERP</label>
    <p class="sub">${esc(c.url)}</p>
    ${c.login?`<div class="err">Cette page demande une connexion. Connectez-vous dans la fenêtre Agent Floki, puis relancez la vérification.</div>`:''}
    <div class="l2">En-tête du bon</div>${mapRows('header',c.header)}
    <div class="l2">Colonnes des lignes</div>${mapRows('line',c.line)}
    ${c.catalogue?`<p class="sub">Catalogue déroulant détecté : les produits seront choisis dans la liste plutôt que tapés.</p>`:''}
    <div class="l2">Boutons vus sur la page</div>
    <pre>${(c.buttons||[]).map(b=>esc((b.interdit?'JAMAIS CLIQUÉ   ':'utilisable      ')+(b.texte||''))).join('\n')}</pre>
    <p class="sub">Les boutons de validation ne sont jamais cliqués par l'agent : cette liste est en lecture seule.</p>
    <div class="row"><button ${busy?'disabled':''} onclick="call('save_mapping',collectMapping())">Enregistrer les corrections</button>
    <button class="sec" ${busy?'disabled':''} onclick="call('close_check')">Fermer</button>
    <button class="sec" ${busy?'disabled':''} onclick="call('forget_mapping')">Revenir à la détection automatique</button></div></div>`;
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

  h+=`<div class="card"><label>Aide à distance</label>
  <p class="sub">Envoie au support l'état de l'agent, son journal, et ce qu'il voit de l'ERP. Rien n'est envoyé sans ce clic.</p>
  <div class="row"><button class="sec" ${busy?'disabled':''} onclick="call('support')">Envoyer au support</button></div>
  ${S.supportCode?`<div class="coderow"><div class="code">${esc(S.supportCode)}</div>
  <button class="sec" onclick="copyText('${esc(S.supportCode)}',this)">Copier</button></div>
  <p class="sub">Donnez ce code au support (valable 1 heure).</p>`:''}</div>`;

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
        if name not in ("set_url", "open_erp", "pause", "unpair", "support", "quit",
                        "check_erp", "save_mapping", "close_check", "forget_mapping",
                        "diagnose", "close_diagnosis", "demo"):
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
