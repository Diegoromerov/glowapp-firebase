#!/usr/bin/env python3
"""Auditoria reproducible de la app CLIENTE (apps/glow_client).

Re-mide lo medible sin dispositivo, compara con el estado guardado en
docs/auditoria/estado-cliente-*.json y sale con codigo 1 si hay criticos en rojo.
Se corre igual antes y despues de las correcciones.

Uso:
  python tools/auditoria_cliente.py                 # completo (analyze + tests)
  python tools/auditoria_cliente.py --rapido        # sin analyze/tests (~30 s)
  python tools/auditoria_cliente.py --json out.json --md out.md

Solo stdlib. Requiere flutter en PATH para analyze/tests y gh (opcional) para el CI.
"""
from __future__ import annotations

import argparse
import datetime
import glob
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import urllib.error
import urllib.request
from collections import Counter
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[1]
APP = RAIZ / "apps" / "glow_client"
LIB = APP / "lib"
API = "https://glowapp-api-production.up.railway.app"
SITIO = "https://glowapp-client.web.app"
BASE = {"User-Agent": "glowapp-audit/1.0", "X-App-Audience": "client"}

VERDE, AMBAR, ROJO, GRIS = "PASA", "PARCIAL", "FALLA", "N/V"
resultados: list[dict] = []


def add(cid, nombre, estado, evidencia, critico=False):
    resultados.append({"id": cid, "nombre": nombre, "estado": estado,
                       "evidencia": evidencia, "critico": critico})


def corre(cmd, cwd=None, timeout=900, tail_kb=200):
    """Ejecuta y se queda solo con la cola de la salida: `flutter test` imprime
    decenas de MB con los errores de tiles y capturarlo entero agota la memoria."""
    import tempfile
    fd, ruta = tempfile.mkstemp(suffix=".log")
    try:
        with os.fdopen(fd, "wb") as f:
            try:
                p = subprocess.run(cmd, cwd=str(cwd or RAIZ), stdout=f,
                                   stderr=subprocess.STDOUT, timeout=timeout,
                                   shell=(os.name == "nt"))
                rc = p.returncode
            except subprocess.TimeoutExpired:
                rc = 124
        datos = Path(ruta).read_bytes()
        return rc, datos[-tail_kb * 1024:].decode("utf-8", "replace")
    except FileNotFoundError:
        return 127, "no encontrado"
    finally:
        try:
            os.unlink(ruta)
        except OSError:
            pass


def _curl(url, headers, data, timeout=25):
    """Fallback por curl: el almacen de CA del Python de Hermes en esta maquina
    esta vencido (SSLCertVerificationError), mientras curl y Chrome validan bien."""
    import tempfile
    fd, ruta = tempfile.mkstemp(suffix=".body")
    os.close(fd)
    args = ["curl", "-sS", "-D", "-", "-o", ruta, "-w", "%{http_code}",
            "--max-time", str(timeout)]
    if data:
        args += ["-X", "POST", "--data-binary", data.decode("utf-8")]
    for k, v in {**BASE, **(headers or {})}.items():
        args += ["-H", f"{k}: {v}"]
    args.append(url)
    try:
        p = subprocess.run(args, capture_output=True, text=True, timeout=timeout + 10,
                           encoding="utf-8", errors="replace")
        partes = p.stdout.rsplit("\n", 1)
        cabeceras, st = partes[0], partes[-1].strip()
        hdrs = {}
        for linea in cabeceras.splitlines():
            if ":" in linea:
                k, v = linea.split(":", 1)
                hdrs[k.strip()] = v.strip()
        return int(st or 0), hdrs, Path(ruta).read_bytes()
    except Exception:
        return 0, {}, b""
    finally:
        try:
            os.unlink(ruta)
        except OSError:
            pass


def http(url, headers=None, data=None, timeout=25):
    req = urllib.request.Request(url, data=data, headers={**BASE, **(headers or {})},
                                 method="POST" if data else "GET")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, dict(r.headers), r.read()
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), e.read()
    except urllib.error.URLError as e:
        if "CERTIFICATE_VERIFY_FAILED" in str(e) and shutil.which("curl"):
            return _curl(url, headers, data, timeout)
        return 0, {}, str(e).encode()
    except Exception as e:
        return 0, {}, str(e).encode()


# ------------------------------------------------------------------ A. codigo
def check_analyze(rapido):
    if rapido:
        add("A1", "flutter analyze", GRIS, "omitido con --rapido")
        add("A2", "flutter test", GRIS, "omitido con --rapido")
        return
    _, out = corre(["flutter", "analyze"], cwd=APP)
    err = len(re.findall(r"^\s*error\s+-", out, re.M))
    war = len(re.findall(r"^\s*warning\s+-", out, re.M))
    inf = len(re.findall(r"^\s*info\s+-", out, re.M))
    add("A1", "flutter analyze", VERDE if err == 0 else ROJO,
        f"{err} errores, {war} warnings, {inf} infos", critico=True)
    _, out = corre(["flutter", "test"], cwd=APP)
    m = re.search(r"\+(\d+)[^\n]*All tests passed", out)
    ok = "All tests passed" in out and "Some tests failed" not in out
    add("A2", "flutter test", VERDE if ok else ROJO,
        f"{m.group(1)} pruebas verdes" if m else "sin resumen parseable", critico=True)


def check_contrato():
    rc, out = corre([sys.executable, "tools/verificar_contrato_api.py", "."], timeout=300)
    linea = next((l.strip() for l in out.splitlines() if "rutas" in l.lower()), out.strip()[-160:])
    add("A3", "contrato app<->API", VERDE if rc == 0 else ROJO, linea or "(sin salida)", critico=True)


# ----------------------------------------------------------------- B. UI estatica
def check_estaticos():
    arboles = [(p, p.read_text(encoding="utf-8", errors="replace")) for p in LIB.rglob("*.dart")]
    texto = "\n".join(t for _, t in arboles)
    lineas = sum(len(t.splitlines()) for _, t in arboles)

    crudos = []
    patron = re.compile(r"\$e\b|\$\{e\}")
    for p, t in arboles:
        for i, l in enumerate(t.splitlines(), 1):
            if patron.search(l) and "debugPrint" not in l:
                crudos.append(f"{p.relative_to(RAIZ).as_posix()}:{i}")
    # Segundo camino: la excepcion se guarda en una variable y la pantalla la
    # pinta tal cual ('$_error'). El grep de "$e" no lo ve.
    variables = []
    for p, t in arboles:
        if re.search(r"\w*[Ee]rror\s*=\s*e\.toString\(\)", t) and re.search(r"\$_?\w*[Ee]rror\b", t):
            variables.append(p.relative_to(RAIZ).as_posix())
    add("B1", "errores crudos en UI",
        VERDE if not crudos and not variables else ROJO,
        "0 sitios" if not crudos and not variables else
        f"{len(crudos)} directos: " + ", ".join(crudos[:6]) +
        (f" | {len(variables)} por variable: " + ", ".join(variables) if variables else ""),
        critico=True)

    sem, tips, ib = texto.count("Semantics("), texto.count("tooltip:"), texto.count("IconButton(")
    add("B2", "accesibilidad: etiquetas",
        VERDE if sem >= 30 else AMBAR if sem >= 10 else ROJO,
        f"{sem} Semantics, {tips} tooltips, {ib} IconButton en {lineas} lineas", critico=True)

    def lum(h):
        h = h.lstrip("#")[:6]
        r, g, b = (int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))
        f = lambda c: c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4
        return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)

    def ratio(h, fondo="#FFFFFF"):
        la, lb = lum(h), lum(fondo)
        return (max(la, lb) + 0.05) / (min(la, lb) + 0.05)

    malos = Counter(h.upper() for h in re.findall(r"#[0-9A-Fa-f]{6}", texto) if ratio(h) < 4.5)
    add("B3", "contraste de texto",
        VERDE if not malos else ROJO,
        "todos >= 4.5:1" if not malos else ", ".join(f"{h} {ratio(h):.2f}:1 x{n}" for h, n in malos.most_common(5)),
        critico=True)

    forzado = "themeMode: ThemeMode.light" in texto
    add("B4", "tema del sistema / reduce-motion", AMBAR if forzado else VERDE,
        "themeMode fijo en light: darkTheme es codigo muerto" if forzado else "respeta el ajuste del sistema")

    n_prints = texto.count("debugPrint")
    add("B5", "debugPrint (no visible en release)", VERDE if n_prints == 0 else AMBAR, f"{n_prints} llamadas")

    manifest = APP / "android/app/src/main/AndroidManifest.xml"
    mtxt = manifest.read_text(encoding="utf-8") if manifest.exists() else ""
    perms = re.findall(r'uses-permission android:name="android\.permission\.([A-Z_]+)"', mtxt)
    add("B6", "permisos declarados (release)",
        VERDE if {"INTERNET", "ACCESS_FINE_LOCATION"} <= set(perms) else ROJO,
        ", ".join(perms) or "sin manifiesto")

    dl = (APP / "lib/services/deep_link_service.dart").exists() and "DeepLinkHost" in texto
    add("B7", "deep links", AMBAR if dl else ROJO,
        "servicio + host montados; falta prueba cold/warm en dispositivo" if dl else "no implementado")

    add("B8", "i18n", GRIS, "sin l10n.yaml: es-CO hardcodeado, 'en' declarado e inalcanzable")


# ------------------------------------------------------------------- C. artefacto
def check_artefacto():
    _, hdrs, body = http(f"{SITIO}/")
    html = body.decode("utf-8", "replace")
    title = re.search(r"<title>(.*?)</title>", html, re.S)
    desc = re.search(r'name="description" content="(.*?)"', html, re.S)
    t = title.group(1).strip() if title else "?"
    add("C1", "metadatos de marca", VERDE if t not in ("glow_client", "?") else AMBAR,
        f"title='{t}' desc='{desc.group(1) if desc else '?'}'")

    _, _, js = http(f"{SITIO}/main.dart.js", timeout=120)
    texto = js.decode("utf-8", "replace")
    # La apiKey web de Firebase es pública por diseño: viaja en el bundle de
    # cualquier app de Firebase y sirve solo para identificar el proyecto, no
    # para autorizar escrituras (eso lo hacen las reglas y el backend). Se cuenta
    # como contexto, no como fuga. Una fuga real es una clave privada.
    publicas = texto.count("AIzaSy")
    privadas = [p for p in ("sk_live", "prv_prod", "prv_test", "BEGIN PRIVATE KEY",
                            "service_account", "JWT_SECRET")
                if p in texto]
    add("C2", "secretos en el bundle",
        VERDE if not privadas else ROJO,
        f"{len(js)/1e6:.2f} MB · {publicas} apiKeys web de Firebase (públicas por diseño)"
        + (f" · PRIVADAS: {', '.join(privadas)}" if privadas else " · 0 claves privadas"),
        critico=True)
    add("C3", "Firebase inicializable en el build",
        VERDE if publicas else ROJO,
        "config de Firebase presente en el bundle" if publicas
        else "sin apiKey el try/catch de main.dart:89 apaga Firebase: push y Firestore muertos",
        critico=True)

    local = APP / "build/web/main.dart.js"
    if local.exists():
        igual = hashlib.md5(local.read_bytes()).hexdigest() == hashlib.md5(js).hexdigest()
        add("C4", "bundle desplegado == build local", VERDE if igual else AMBAR,
            "identicos" if igual else "distintos: el deploy no es el arbol local")
    else:
        add("C4", "bundle desplegado == build local", GRIS, "sin build local para comparar")

    add("C5", "peso del bundle", VERDE if len(js) < 4_000_000 else AMBAR,
        f"main.dart.js {len(js)/1e6:.2f} MB (+ canvaskit desde gstatic)")
    add("C6", "cabeceras del sitio",
        VERDE if "Strict-Transport-Security" in hdrs else ROJO,
        "HSTS " + ("si" if "Strict-Transport-Security" in hdrs else "no")
        + ", COOP " + ("si" if "Cross-Origin-Opener-Policy" in hdrs else "no")
        + ", CSP " + ("si" if "Content-Security-Policy" in hdrs else "no (P-091)"))


def pagina(ruta, marcadores):
    st, _, body = http(f"{SITIO}{ruta}")
    txt = body.decode("utf-8", "replace")
    shell = len(body) < 2000 and "flutter_bootstrap" in txt
    ok = st == 200 and not shell and any(m in txt for m in marcadores)
    return st, len(body), shell, ok


def check_legal():
    for cid, ruta, marc, nombre in [
        ("D1", "/privacy", ["Privacidad", "datos"], "politica de privacidad"),
        ("D2", "/account-deletion", ["Eliminar", "cuenta"], "pagina de borrado de cuenta"),
        ("D3", "/terms.html", ["Terminos", "Términos", "Condiciones"], "terminos publicados"),
    ]:
        st, n, shell, ok = pagina(ruta, marc)
        add(cid, nombre, VERDE if ok else ROJO,
            f"HTTP {st}, {n} B" + (" (shell del SPA, no la pagina)" if shell else ""))


# --------------------------------------------------------------------- D. API
def check_api():
    st, _, body = http(f"{API}/api/health")
    commit = ""
    if st == 200:
        try:
            commit = " commit " + str(json.loads(body).get("commit", "?"))[:8]
        except Exception:
            pass
    add("E1", "/api/health sin X-App-Audience", VERDE if st == 200 else ROJO,
        f"HTTP {st}{commit}", critico=True)

    st, _, body = http(f"{API}/api/providers?lat=4.6735&lng=-74.1422")
    try:
        n = json.loads(body).get("count")
    except Exception:
        n = None
    add("E2", "catalogo /api/providers", VERDE if st == 200 and n else ROJO, f"HTTP {st}, count={n}")

    st, _, body = http(f"{API}/api/products")
    try:
        n = json.loads(body).get("count")
    except Exception:
        n = None
    add("E3", "catalogo /api/products (datos mock)",
        VERDE if st == 200 and n else AMBAR,
        f"HTTP {st}, count={n}" + (": la tienda de demostracion se ve vacia (dato mock, no bloquea)" if st == 200 and not n else ""))

    payload = json.dumps({"events": [{"event_type": "APP_AUDIT", "screen_name": "/audit"}]}).encode()
    st, _, _ = http(f"{API}/api/analytics/events",
                    {"Content-Type": "application/json"}, data=payload)
    ok = bool(st) and st < 400
    add("E4", "analitica/crash anonimos", VERDE if ok else ROJO,
        f"POST sin token -> HTTP {st}"
        + (": embudo anonimo y crashes sin sesion aceptados" if ok
           else ": el embudo anonimo y los crashes sin sesion se pierden"),
        critico=True)

    st, _, _ = http(f"{API}/api/config/flags")
    add("E5", "feature flags", VERDE if st == 200 else AMBAR, f"GET /api/config/flags -> {st}")


def check_ci():
    if not shutil.which("gh"):
        add("F1", "CI de apps", GRIS, "gh no instalado")
        return
    rc, out = corre(["gh", "run", "list", "--workflow=apps-ci.yml", "--limit", "3",
                     "--json", "conclusion,createdAt,headBranch"], timeout=120)
    if rc != 0:
        add("F1", "CI de apps", GRIS, out.strip()[:150])
        return
    try:
        runs = json.loads(out)
    except Exception:
        add("F1", "CI de apps", GRIS, "salida no parseable")
        return
    ult = runs[0] if runs else {}
    add("F1", "CI de apps", VERDE if ult.get("conclusion") == "success" else ROJO,
        f"ultima: {ult.get('conclusion')} en {ult.get('headBranch')} @ {ult.get('createdAt')}"
        " (workflow manual: no corre en push)")


# ------------------------------------------------------------------- resumen
def tabla():
    filas = ["| ID | Comprobacion | Estado | Evidencia |", "|---|---|---|---|"]
    for r in resultados:
        filas.append(f"| {r['id']} | {r['nombre']} | **{r['estado']}** | {r['evidencia']} |")
    return "\n".join(filas)


def resumen_items(baseline):
    if not baseline or not Path(baseline).exists():
        return None
    items = json.load(open(baseline, encoding="utf-8")).get("items", {})
    est = Counter(v["estado_2026_11_09"] for v in items.values())
    total = len(items)
    sin_na = total - est.get("N/A", 0)
    medible = sin_na - est.get("N/V", 0)
    puntos = est.get(VERDE, 0) + 0.5 * est.get(AMBAR, 0)
    return {"conteo": dict(est), "total": total,
            "pct_sin_na": round(puntos / sin_na * 100, 1) if sin_na else 0.0,
            "pct_medible": round(puntos / medible * 100, 1) if medible else 0.0}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--rapido", action="store_true")
    ap.add_argument("--json")
    ap.add_argument("--md")
    ap.add_argument("--baseline", default=None)
    a = ap.parse_args()

    if not a.baseline:
        cands = sorted(glob.glob(str(RAIZ / "docs" / "auditoria" / "estado-cliente-*.json")))
        a.baseline = cands[-1] if cands else None

    check_analyze(a.rapido)
    check_contrato()
    check_estaticos()
    check_artefacto()
    check_legal()
    check_api()
    check_ci()

    print(tabla())
    res = resumen_items(a.baseline)
    if res:
        print(f"\nItems {res['total']}: {res['conteo']}")
        print(f"Ejecucion sobre lo medible: {res['pct_medible']}%  (sobre el total sin N/A: {res['pct_sin_na']}%)")

    rojos = [r["id"] for r in resultados if r["estado"] == ROJO and r["critico"]]
    print(f"\nCriticos en rojo: {len(rojos)}" + (f" -> {', '.join(rojos)}" if rojos else ""))

    if a.json:
        Path(a.json).write_text(json.dumps(
            {"fecha": datetime.date.today().isoformat(), "resultados": resultados, "resumen": res},
            ensure_ascii=False, indent=1), encoding="utf-8")
    if a.md:
        Path(a.md).write_text("# Auditoria cliente\n\n" + tabla() + "\n", encoding="utf-8")
    return 1 if rojos else 0


if __name__ == "__main__":
    sys.exit(main())
