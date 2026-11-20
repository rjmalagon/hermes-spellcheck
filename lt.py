'''Cliente mínimo de LanguageTool + offsets UTF-16 -> code points (y coordenadas JS).'''
from __future__ import annotations

import json
import os
import re
import urllib.parse
import urllib.request

DEFAULT_ENDPOINT = os.environ.get("SPELLCHECK_ENDPOINT", "http://localhost:8010/v2/check")


class LTError(Exception):
    '''Error legible para el usuario, nunca un traceback.'''


def u16_to_cp(text: str, units: int) -> int:
    '''Indice de unidad UTF-16 -> indice de caracter Python.'''
    if units <= 0:
        return 0
    n = 0
    for i, ch in enumerate(text):
        if n >= units:
            return i
        n += 2 if ord(ch) > 0xFFFF else 1
    return len(text)


def configured_endpoint() -> str:
    '''Endpoint efectivo, resuelto en CADA llamada.

    Orden: ajuste del plugin (`plugins.entries.spellcheck.settings.endpoint`),
    variable `SPELLCHECK_ENDPOINT`, default del paquete.
    '''
    try:
        from hermes_cli.config import load_config
        cfg = load_config() or {}
        entry = ((cfg.get("plugins") or {}).get("entries") or {}).get("spellcheck") or {}
        settings = entry.get("settings") if isinstance(entry, dict) else None
        value = (settings or {}).get("endpoint") if isinstance(settings, dict) else None
        if isinstance(value, str) and value.strip():
            return value.strip()
    except Exception:
        pass
    env = os.environ.get("SPELLCHECK_ENDPOINT")
    if env and env.strip():
        return env.strip()
    return DEFAULT_ENDPOINT


def check(text: str, lang: str = "es", endpoint: str | None = None,
          picky: bool = False, timeout: float = 15.0) -> dict:
    url = (endpoint or configured_endpoint()).strip() or DEFAULT_ENDPOINT
    if "/v2/check" not in url:
        url = url.rstrip("/") + "/v2/check"
    data = {"text": text, "language": lang}
    if picky:
        data["level"] = "picky"
    body = urllib.parse.urlencode(data).encode("utf-8")
    req = urllib.request.Request(
        url, data=body, method="POST",
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.load(resp)
    except urllib.error.HTTPError as exc:
        raise LTError("LanguageTool respondio HTTP %s en %s" % (exc.code, url)) from exc
    except urllib.error.URLError as exc:
        raise LTError("no alcanzo LanguageTool en %s (%s)" % (url, exc.reason)) from exc
    except Exception as exc:
        raise LTError("fallo hablando con LanguageTool (%s)" % (exc,)) from exc


_PROTECTED = (
    re.compile(r"```.*?(?:```|$)", re.S),
    re.compile(r"`[^`\n]+`"),
    re.compile(r"https?://\S+"),
    re.compile(r"\b[\w.+-]+@[\w-]+\.[\w.-]+\b"),
    re.compile(r"(?<![\w])/(?:[\w.-]+/)+[\w.-]*"),
)


def protected_spans(text: str) -> list[tuple[int, int]]:
    spans = []
    for rx in _PROTECTED:
        for m in rx.finditer(text):
            if m.end() > m.start():
                spans.append((m.start(), m.end()))
    return spans


def normalize(text: str, payload: dict) -> tuple[list[dict], int]:
    '''Convierte los matches a indices Python (start/end) y UTF-16 (s16/e16).

    - Valida cada match contra context.text (exacto): descarta desalineados.
    - Recorta espacios comunes del fragmento y de las sugerencias.
    - Descarta sugerencias identicas al fragmento y solapes.
    '''
    spans = protected_spans(text)
    out: list[dict] = []
    dropped = 0
    for m in payload.get("matches") or []:
        rule = m.get("rule") or {}
        if rule.get("invisible"):
            continue
        off, length = m.get("offset"), m.get("length")
        if not isinstance(off, int) or not isinstance(length, int) or length <= 0:
            continue
        s16, e16 = off, off + length
        start, end = u16_to_cp(text, off), u16_to_cp(text, off + length)
        if start >= end or end > len(text):
            dropped += 1
            continue
        frag = text[start:end]
        ctx = m.get("context") or {}
        if ctx.get("text") and isinstance(ctx.get("offset"), int):
            c_start = u16_to_cp(ctx["text"], ctx["offset"])
            c_end = u16_to_cp(ctx["text"], ctx["offset"] + length)
            if ctx["text"][c_start:c_end] != frag:
                dropped += 1
                continue
        if any(start < pe and end > ps for ps, pe in spans):
            continue
        lead = len(frag) - len(frag.lstrip())
        trail = len(frag) - len(frag.rstrip())
        if lead or trail:
            start += lead
            end -= trail
            s16 += lead
            e16 -= trail
            frag = frag[lead:len(frag) - trail]
        if not frag:
            dropped += 1
            continue
        raw_reps = [r.get("value") for r in (m.get("replacements") or [])
                    if isinstance(r.get("value"), str)]
        reps: list[str] = []
        for value in raw_reps:
            clean = value.strip()
            if not clean or clean == frag or clean in reps:
                continue
            reps.append(clean)
        if raw_reps and not reps:
            dropped += 1
            continue
        out.append({
            "start": start, "end": end, "s16": s16, "e16": e16,
            "frag": frag, "reps": reps[:8],
            "rule": rule.get("id", ""), "type": rule.get("issueType", ""),
            "msg": m.get("message", ""), "desc": rule.get("description", ""),
        })
    out.sort(key=lambda x: (x["start"], -(x["end"] - x["start"])))
    clean: list[dict] = []
    last_end = -1
    for item in out:
        if item["start"] >= last_end:
            clean.append(item)
            last_end = item["end"]
    return clean, dropped


def apply_matches(text: str, matches: list[dict]) -> str:
    '''Aplica de atras hacia adelante sobre indices Python (start/end).'''
    result = text
    for m in sorted(matches, key=lambda x: x["start"], reverse=True):
        if not m["reps"]:
            continue
        result = result[: m["start"]] + m["reps"][0] + result[m["end"]:]
    return result
