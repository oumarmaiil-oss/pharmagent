"""Test réel sur Windows : l'agent tape au clavier dans le Bloc-notes, puis on relit le texte saisi."""
import pathlib
import subprocess
import sys
import threading
import time

if sys.platform != "win32":
    print("(ignoré : Windows uniquement)")
    raise SystemExit(0)

import ctypes  # noqa: E402

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from _agent import Checker, load_agent  # noqa: E402

A = load_agent()
check = Checker()
user32 = ctypes.windll.user32
proc = subprocess.Popen(["notepad.exe"])
try:
    title = None
    for _ in range(60):
        found = [w for w in A.list_windows() if "notepad" in w.lower() or "bloc-notes" in w.lower()]
        if found:
            title = found[0]
            break
        time.sleep(0.25)
    check("Bloc-notes présent dans la liste des fenêtres", title, A.list_windows())
    if not title:
        check.exit()
    A.activate_window(title)
    time.sleep(0.8)
    check("Bloc-notes au premier plan", A.foreground_is(title), A.foreground_title())

    steps = [{"kind": "type", "field": "supplier"}, {"kind": "key", "key": "enter"},
             {"kind": "type", "field": "documentNumber"}, {"kind": "key", "key": "tab"},
             {"kind": "type", "field": "quantity"}]
    values = {"supplier": "PHARMADIS SÉNÉGAL", "documentNumber": "BL-2026-6001", "quantity": 100}
    player = A.KeyPlayer(title, threading.Event())
    try:
        player.run(steps, values, True)
    finally:
        player.close()
    time.sleep(0.8)

    hwnd = user32.FindWindowW("Notepad", None)
    edit = user32.FindWindowExW(hwnd, None, "Edit", None) or user32.FindWindowExW(hwnd, None, "RichEditD2DPT", None)
    n = user32.SendMessageW(edit, 0x000E, 0, 0)  # WM_GETTEXTLENGTH
    buf = ctypes.create_unicode_buffer(n + 1)
    user32.SendMessageW(edit, 0x000D, n + 1, buf)  # WM_GETTEXT
    text = buf.value.replace("\r\n", "\n").replace("\r", "\n")
    check("texte tapé par l'agent identique (accents, Entrée, Tab)", text == "PHARMADIS SÉNÉGAL\nBL-2026-6001\t100", repr(text))
finally:
    proc.kill()
check.exit()
