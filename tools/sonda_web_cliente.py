#!/usr/bin/env python3
"""Sonda visual de la app cliente en produccion (Flutter web = canvas).

Abre Chrome headless por CDP, activa la semantica, hace clics por texto o por
coordenada, toma capturas y recolecta errores de consola y respuestas >=400.
Es la parte "lo que ve el usuario" de la auditoria; la parte medible esta en
tools/auditoria_cliente.py.

Requisitos: Chrome + `pip install websockets`.

Uso:
  python tools/sonda_web_cliente.py --url https://glowapp-client.web.app/ \
      --pasos "Ver lista|Perfil" --salida docs/auditoria/shots/cliente

  # recorrer el GlowGuide (8 pasos) y terminar en la lista:
  python tools/sonda_web_cliente.py --guia --pasos "Ver lista"

Pasos:
  texto            clic en el primer nodo de semantica que contenga ese texto
  texto>otro       clic en el nodo que contenga ambos textos
  @x,y             clic en coordenadas de viewport
Salida: <salida>-NN.png por paso + volcado de textos, consola y red.
"""
from __future__ import annotations

import argparse
import base64
import json
import os
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

try:
    from websockets.sync.client import connect
except ImportError:  # pragma: no cover
    sys.exit("falta websockets: pip install websockets")

CHROME_DEFECTO = r"C:/Program Files/Google/Chrome/Application/chrome.exe"


class Pagina:
    def __init__(self, puerto: int):
        self.puerto = puerto
        self.proc = None
        self.ws = None
        self._id = 0
        self.consola: list[tuple[str, str]] = []
        self.red: list[str] = []

    # -- ciclo de vida -----------------------------------------------------
    def abrir(self, chrome: str, ancho: int, alto: int):
        perfil = tempfile.mkdtemp(prefix="sonda-web-")
        self.proc = subprocess.Popen(
            [chrome, "--headless=new", f"--remote-debugging-port={self.puerto}",
             f"--user-data-dir={perfil}", "--no-first-run", "--no-default-browser-check",
             f"--window-size={ancho},{alto}", "--disable-gpu", "about:blank"],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for _ in range(40):
            try:
                with urllib.request.urlopen(f"http://127.0.0.1:{self.puerto}/json/list") as r:
                    objetivos = json.load(r)
                if objetivos:
                    break
            except Exception:
                time.sleep(0.5)
        else:
            raise RuntimeError("CDP no responde")
        objetivo = [t for t in objetivos if t["type"] == "page"][0]
        self.ws = connect(objetivo["webSocketDebuggerUrl"], max_size=100 * 1024 * 1024)
        self.cmd("Page.enable")
        self.cmd("Runtime.enable")
        self.cmd("Log.enable")
        self.cmd("Network.enable")
        self.cmd("Emulation.setDeviceMetricsOverride",
                 width=ancho, height=alto, deviceScaleFactor=2, mobile=False)

    def cerrar(self):
        try:
            if self.ws:
                self.ws.close()
        finally:
            if self.proc:
                self.proc.terminate()

    # -- CDP ---------------------------------------------------------------
    def cmd(self, metodo, **params):
        self._id += 1
        self.ws.send(json.dumps({"id": self._id, "method": metodo, "params": params}))
        while True:
            msg = json.loads(self.ws.recv())
            if msg.get("id") == self._id:
                if "error" in msg:
                    raise RuntimeError(msg["error"])
                return msg.get("result", {})
            ev = msg.get("method")
            if ev == "Runtime.consoleAPICalled" and msg["params"].get("type") in ("error", "warning"):
                texto = " ".join(str(a.get("value") or a.get("description"))
                                 for a in msg["params"]["args"])
                self.consola.append((msg["params"]["type"], texto[:300]))
            if ev == "Log.entryAdded" and msg["params"]["entry"]["level"] in ("error", "warning"):
                e = msg["params"]["entry"]
                self.consola.append((e["level"], (e.get("text", "") + " " + e.get("url", ""))[:300]))
            if ev == "Network.loadingFailed":
                self.red.append(msg["params"].get("errorText", ""))
            if ev == "Network.responseReceived":
                r = msg["params"]["response"]
                if r["status"] >= 400:
                    self.red.append(f'{r["status"]} {r["url"][:140]}')

    def ev(self, expr):
        r = self.cmd("Runtime.evaluate", expression=expr, returnByValue=True, awaitPromise=True)
        return r["result"].get("value")

    # -- acciones ----------------------------------------------------------
    def ir(self, url: str, espera: float):
        self.cmd("Page.navigate", url=url)
        time.sleep(espera)
        self.semantica()

    def semantica(self):
        self.ev("""(() => { const p = document.querySelector('flt-semantics-placeholder');
                          if (p) { p.click(); return 'ok'; } return 'no'; })()""")
        time.sleep(1.2)

    def textos(self):
        return self.ev("""(() => {
          const out = [];
          document.querySelectorAll('flt-semantics, [role]').forEach(e => {
            const t = (e.getAttribute('aria-label') || e.textContent || '').trim();
            if (!t || t.length > 120) return;
            const r = e.getBoundingClientRect();
            if (r.width < 2 || r.height < 2) return;
            out.push({t, x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2)});
          });
          return out; })()""") or []

    def clic(self, x: int, y: int):
        for tipo in ("mousePressed", "mouseReleased"):
            self.cmd("Input.dispatchMouseEvent", type=tipo, x=x, y=y, button="left", clickCount=1)

    def clic_texto(self, *agujas):
        for item in self.textos():
            if all(a.lower() in item["t"].lower() for a in agujas):
                self.clic(item["x"], item["y"])
                return item
        return None

    def captura(self, ruta: Path):
        data = self.cmd("Page.captureScreenshot", format="png")["data"]
        ruta.parent.mkdir(parents=True, exist_ok=True)
        ruta.write_bytes(base64.b64decode(data))
        return ruta


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default="https://glowapp-client.web.app/")
    ap.add_argument("--pasos", default="", help="separados por | ; '>' = varias agujas; @x,y = coordenada")
    ap.add_argument("--salida", default="docs/auditoria/shots/cliente")
    ap.add_argument("--chrome", default=os.environ.get("CHROME", CHROME_DEFECTO))
    ap.add_argument("--guia", action="store_true", help="recorrer los 8 pasos del GlowGuide")
    ap.add_argument("--espera", type=float, default=22)
    ap.add_argument("--puerto", type=int, default=9335)
    a = ap.parse_args()

    pag = Pagina(a.puerto)
    salida = Path(a.salida)
    try:
        pag.abrir(a.chrome, 430, 932)
        pag.ir(a.url, a.espera)
        print("inicio:", pag.captura(salida.with_name(salida.name + "-00.png")))
        print("hash:", pag.ev("location.hash"))

        pasos = []
        if a.guia:
            pasos += ["Siguiente"] * 7 + ["Listo"]
        pasos += [p.strip() for p in a.pasos.split("|") if p.strip()]

        for i, paso in enumerate(pasos, 1):
            if paso.startswith("@"):
                x, y = (int(v) for v in paso[1:].split(","))
                pag.clic(x, y)
                hit = {"xy": (x, y)}
            else:
                hit = pag.clic_texto(*[p.strip() for p in paso.split(">")])
            time.sleep(2.5)
            print(f"paso {i} {paso!r} -> {hit}  hash={pag.ev('location.hash')}")
            pag.captura(salida.with_name(f"{salida.name}-{i:02d}.png"))

        print("\n--- textos finales ---")
        for item in pag.textos()[:45]:
            print(f"{item['x']},{item['y']}  {item['t'][:90]}")
        print("\n--- consola (error/warning) ---")
        for lvl, txt in pag.consola[:40]:
            print(f"[{lvl}] {txt}")
        print("\n--- red con fallo ---")
        for f in sorted(set(pag.red))[:40]:
            print(f)
        print(f"\ntotales: {len(pag.consola)} consola, {len(set(pag.red))} red")
    finally:
        pag.cerrar()


if __name__ == "__main__":
    main()
