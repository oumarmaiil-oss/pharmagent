#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Fabrique toutes les icônes et la miniature de partage à partir d'une source.

Une seule image d'origine (public/pwa-512x512.png) donne : l'icône de l'onglet
du navigateur, celle du raccourci Windows, celle de l'application macOS, et la
miniature affichée quand on partage le lien. Les refaire se résume à relancer
ce fichier, pour qu'elles ne divergent jamais entre elles.

    python3 outils/icones.py
"""
import pathlib
import struct

from PIL import Image, ImageDraw, ImageFont

RACINE = pathlib.Path(__file__).resolve().parent.parent
SOURCE = RACINE / "public" / "pwa-512x512.png"
PUBLIC = RACINE / "public"
AGENT = RACINE / "agent"

MARQUE = "PharmAgent"
PROMESSE = "L'IA lit le bon de livraison.\nVous validez. L'agent saisit."
GARDE = "L'agent ne valide jamais"
CONTACT = "Dr. O. Sow  ·  oumarmaiil@gmail.com"

# Exactement le fond de l'icône elle-même : sinon son carré se détache
# du bandeau et la vignette a l'air bricolée.
FOND = (21, 35, 43)
TEXTE = (241, 245, 249)
ATTENUE = (148, 163, 184)
VERT = (52, 211, 153)

POLICE = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
POLICE_G = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"


def police(chemin, taille):
    try:
        return ImageFont.truetype(chemin, taille)
    except OSError:
        return ImageFont.load_default()


def carre(taille):
    """L'icône à une taille donnée, en RGBA, avec un rendu net."""
    im = Image.open(SOURCE).convert("RGBA")
    return im.resize((taille, taille), Image.LANCZOS)


def ecrire_ico(chemin, tailles):
    """Un .ico contient plusieurs tailles, pour que Windows prenne la bonne.

    Il faut partir de la PLUS GRANDE : enregistrer depuis une petite image
    écrase toutes les tailles demandées à celle de la source, et le raccourci
    se retrouve avec une icône de 16 pixels étirée.
    """
    base = carre(max(tailles))
    base.save(chemin, format="ICO", sizes=[(t, t) for t in sorted(tailles)])
    return chemin


def ecrire_icns(chemin, entrees):
    """Un .icns est aussi un conteneur : en-tête « icns », puis des blocs typés.

    macOS accepte des blocs PNG depuis Mac OS X 10.7 ; on s'en tient à ceux-là,
    ce qui évite les anciens formats compressés à la main.
    """
    import io
    blocs = b""
    for type_bloc, taille in entrees:
        tampon = io.BytesIO()
        carre(taille).save(tampon, format="PNG")
        donnees = tampon.getvalue()
        blocs += type_bloc.encode("ascii") + struct.pack(">I", len(donnees) + 8) + donnees
    chemin.write_bytes(b"icns" + struct.pack(">I", len(blocs) + 8) + blocs)
    return chemin


def ecrire_miniature(chemin):
    """La vignette affichée quand on partage le lien (WhatsApp, Slack, réseaux)."""
    L, H = 1200, 630
    im = Image.new("RGB", (L, H), FOND)
    d = ImageDraw.Draw(im)

    # Un liseré vert en haut : le rappel du garde-fou, jusque dans la vignette.
    d.rectangle([0, 0, L, 6], fill=VERT)

    logo = carre(168)
    im.paste(logo, (72, 86), logo)

    d.text((272, 96), MARQUE, font=police(POLICE_G, 68), fill=TEXTE)
    d.text((274, 182), "Saisie des bons de livraison en officine",
           font=police(POLICE, 30), fill=ATTENUE)

    y = 300
    for ligne in PROMESSE.split("\n"):
        d.text((74, y), ligne, font=police(POLICE_G, 44), fill=TEXTE)
        y += 60

    # Le garde-fou, encadré : c'est la promesse qui doit survivre au partage.
    boite = [74, 448, 74 + 460, 448 + 58]
    d.rounded_rectangle(boite, radius=12, outline=VERT, width=2)
    d.text((98, 466), GARDE, font=police(POLICE_G, 26), fill=VERT)

    d.text((74, 560), CONTACT, font=police(POLICE, 24), fill=ATTENUE)
    im.save(chemin, format="PNG", optimize=True)
    return chemin


if __name__ == "__main__":
    faits = []
    # Onglet du navigateur : .ico pour les vieux navigateurs, PNG pour les autres.
    faits.append(ecrire_ico(PUBLIC / "favicon.ico", [16, 32, 48]))
    for t in (32, 192):
        c = PUBLIC / ("favicon-%dx%d.png" % (t, t))
        carre(t).save(c, format="PNG", optimize=True)
        faits.append(c)
    # Raccourci Windows et application macOS.
    faits.append(ecrire_ico(AGENT / "pharmagent.ico", [16, 32, 48, 64, 128, 256]))
    faits.append(ecrire_icns(AGENT / "pharmagent.icns",
                             [("icp4", 16), ("icp5", 32), ("ic07", 128),
                              ("ic08", 256), ("ic09", 512)]))
    faits.append(ecrire_miniature(PUBLIC / "og-image.png"))
    for f in faits:
        print("  %-34s %7d octets" % (f.relative_to(RACINE), f.stat().st_size))
