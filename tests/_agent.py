"""Chargement de l'agent dans un dossier temporaire (n'écrit rien dans la configuration réelle)."""
import importlib.util
import os
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.environ["PHARMAGENT_HOME"] = tempfile.mkdtemp()
os.environ["PHARMAGENT_NO_UPDATE"] = "1"


def load_agent():
    spec = importlib.util.spec_from_file_location("pharmagent_agent", os.path.join(ROOT, "agent", "pharmagent_agent.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


class Checker:
    def __init__(self):
        self.ok = True

    def __call__(self, name, cond, info=""):
        self.ok &= bool(cond)
        print(("OK  " if cond else "KO  ") + name, info if not cond else "", flush=True)

    def exit(self):
        raise SystemExit(0 if self.ok else 1)
