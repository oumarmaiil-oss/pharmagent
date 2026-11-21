#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Appariement des médicaments : ce qui doit correspondre, et ce qui doit être refusé.

Le refus est un succès. Un mauvais appariement fausse le stock de l'officine et,
pour des molécules comme la doxycycline, peut mettre un patient en danger.
"""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent / "agent"))
import pharmagent_agent as A  # noqa: E402

CATALOGUE = [
    "COTRIMOXAZOLE 480MG CP B/20", "METRONIDAZOLE 500MG SUPP B/10",
    "QUININE 500MG CP B/20", "ARTESUNATE 100MG CP B/12",
    "PARACETAMOL 250MG SUPP B/10", "AMOXICILLINE 250MG/5ML SUSP 100ML",
    "ZINC SULFATE 20MG CP B/20", "ACIDE FOLIQUE 5MG CP B/30",
    "VITAMINE A 200000UI CAPS", "FER SULFATE 200MG CP B/30",
    "ALBENDAZOLE 400MG CP", "MEBENDAZOLE 100MG CP B/6",
    "DOXYCYCLINE 100MG GELULE B/10", "ATENOLOL 50MG CP B/30",
    "FUROSEMIDE 40MG CP B/30",
]

# (ce que porte le bon, ce que l'agent doit choisir — None = doit refuser, raison)
CAS = [
    # ── Doit refuser ──
    ("AMOXICILLINE 500MG GELULE B/12", None,
     "amoxicilline absente : ne doit PAS devenir de la doxycycline"),
    ("DOLIPRANE 1000MG CPR B/8", None, "marque absente du catalogue"),
    ("AMOXICILLINE 250MG/5ML CP B/20", None, "bonne molecule, mauvaise forme"),
    ("QUININE 300MG CP B/20", None, "bonne molecule, mauvais dosage"),
    ("MEBENDAZOLE 500MG CP B/6", None, "dosage different"),
    ("ACIDE ASCORBIQUE 500MG CP B/30", None, "acide folique n'est pas l'ascorbique"),
    ("ZINC GLUCONATE 20MG CP B/20", None, "sulfate n'est pas gluconate"),
    ("ATENOLOL 50MG CP B/30 GENERIQUE X", "ATENOLOL 50MG CP B/30",
     "mention commerciale en trop, mais molecule dosage forme identiques"),

    # ── Doit accepter ──
    ("AMOXICILLINE 250MG/5ML SUSP 100ML", "AMOXICILLINE 250MG/5ML SUSP 100ML", "identique"),
    ("amoxicilline 250mg/5ml susp 100ml", "AMOXICILLINE 250MG/5ML SUSP 100ML", "casse differente"),
    ("QUININE 500 MG COMPRIME B/20", "QUININE 500MG CP B/20", "forme ecrite en entier"),
    ("ALBENDAZOLE 400MG COMPRIMES", "ALBENDAZOLE 400MG CP", "pluriel"),
    ("FUROSEMIDE 0,04G CP B/30", "FUROSEMIDE 40MG CP B/30", "40 mg ecrit 0,04 g"),
    ("VITAMINE A 200000UI CAPSULE", "VITAMINE A 200000UI CAPS", "caps = capsule"),
    ("COTRIMOXAZOLE 480MG CP BOITE DE 20", "COTRIMOXAZOLE 480MG CP B/20", "conditionnement ecrit"),
    ("DOXYCYCLINE 100MG GELULE B/10", "DOXYCYCLINE 100MG GELULE B/10", "identique"),
    ("ATENOLOL CP B/30", "ATENOLOL 50MG CP B/30", "dosage absent du bon : pas de contradiction"),
]

fails = []
print("CATALOGUE DE L'ERP : %d articles" % len(CATALOGUE))
print()
for wanted, expected, why in CAS:
    got = A.best_option(wanted, CATALOGUE)
    ok = got == expected
    if not ok:
        fails.append((wanted, expected, got, why))
    verdict = "  OK  " if ok else " ECHEC"
    shown = got if got else "REFUSE"
    print("%s %-38s -> %-34s  (%s)" % (verdict, wanted[:38], str(shown)[:34], why))
    if not ok:
        print("        attendu : %s" % (expected if expected else "REFUSE"))

# ── Ambiguïté : deux articles conviennent autant -> refus ──
print()
ambigu = ["PARACETAMOL 500MG CP B/16", "PARACETAMOL 500MG CP B/8"]
got = A.best_option("PARACETAMOL 500MG CP", ambigu)
ok = got is None
if not ok:
    fails.append(("ambiguite", None, got, "deux conditionnements egalement valables"))
print(("  OK  " if ok else " ECHEC") + " ambiguite (B/16 vs B/8) -> %s" % (got or "REFUSE"))

# ── Décomposition : contrôle direct de la lecture d'un libellé ──
print()
d = A.parse_product("AMOXICILLINE 250MG/5ML SUSP 100ML")
checks = [
    ("denomination lue", d["name"], "amoxicilline"),
    ("forme lue", sorted(d["forms"]), ["suspension"]),
    ("dosages lus", sorted(d["doses"]), sorted([("mg", 250.0), ("ml", 5.0), ("ml", 100.0)])),
]
for label, actual, expected in checks:
    ok = actual == expected
    if not ok:
        fails.append((label, expected, actual, "decomposition"))
    print(("  OK  " if ok else " ECHEC") + " %-18s %r" % (label, actual))
    if not ok:
        print("        attendu : %r" % (expected,))

print()
print("RESULTAT :", "TOUT PASSE" if not fails else "IL RESTE %d ECHEC(S)" % len(fails))
sys.exit(0 if not fails else 1)
