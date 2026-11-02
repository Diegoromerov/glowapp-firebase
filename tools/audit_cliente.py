#!/usr/bin/env python3
"""Auditoría del app cliente: cadenas rotas, rutas muertas, secretos y ruido.

Uso:
    python tools/audit_cliente.py            # informe legible
    python tools/audit_cliente.py --check    # sale 1 si hay hallazgos

Códigos de salida: 0 sin hallazgos, 1 con hallazgos.
"""
import os
import re
import sys

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LIB_CLIENTE = os.path.join(RAIZ, "apps", "glow_client", "lib")
LIB_CORE = os.path.join(RAIZ, "packages", "glow_core", "lib")

REGLAS = {
    "mojibake": re.compile(r"[ÃÂ]"),
    "secreto_hardcodeado": re.compile(
        r"(?i)(password|passwd|secret|api[_-]?key|private[_-]?key)\s*[:=]\s*'[^']{6,}'"
    ),
    "http_sin_tls": re.compile(r"'http://(?!127\.0\.0\.1|localhost|10\.0\.2\.2)[^']+'"),
    "print_en_produccion": re.compile(r"\bprint\("),
}


def archivos_dart(raiz):
    for base, _, ficheros in os.walk(raiz):
        for f in ficheros:
            if f.endswith(".dart"):
                yield os.path.join(base, f)


def rutas_registradas(main_dart):
    texto = open(main_dart, encoding="utf-8", errors="ignore").read()
    mapa = set(re.findall(r"'(/[A-Za-z0-9_/\-]+)'\s*:", texto))
    casos = set(re.findall(r"case\s+'(/[A-Za-z0-9_/\-]+)'", texto))
    return mapa | casos


def rutas_referidas(lib):
    ref = {}
    patron = re.compile(
        r"(?:pushNamed|pushReplacementNamed|pushNamedAndRemoveUntil)\(\s*(?:context\s*,\s*)?'(/[A-Za-z0-9_/\-]+)'"
    )
    for ruta in archivos_dart(lib):
        texto = open(ruta, encoding="utf-8", errors="ignore").read()
        for m in patron.finditer(texto):
            ref.setdefault(m.group(1), set()).add(
                os.path.relpath(ruta, lib).replace("\\", "/")
            )
    return ref


def main():
    check = "--check" in sys.argv
    hallazgos = []

    for etiqueta, raiz in (("glow_client", LIB_CLIENTE), ("glow_core", LIB_CORE)):
        for ruta in archivos_dart(raiz):
            texto = open(ruta, encoding="utf-8", errors="ignore").read()
            rel = os.path.relpath(ruta, RAIZ).replace("\\", "/")
            for nombre, patron in REGLAS.items():
                n = len(patron.findall(texto))
                if n:
                    hallazgos.append(f"{nombre}: {n} en {rel}")

    main_dart = os.path.join(LIB_CLIENTE, "main.dart")
    registradas = rutas_registradas(main_dart)
    for ruta, usos in sorted(rutas_referidas(LIB_CLIENTE).items()):
        if ruta not in registradas:
            hallazgos.append(f"ruta_muerta: {ruta} usada en {', '.join(sorted(usos))}")

    for h in hallazgos:
        print(h)
    print(f"\nTOTAL hallazgos: {len(hallazgos)}")
    if check and hallazgos:
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
