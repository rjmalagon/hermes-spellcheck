'''spellcheck — LanguageTool en el chat.'''
from __future__ import annotations

import base64
import hashlib
import json
import os
import time
from pathlib import Path

from . import lt

DEFAULT_ENDPOINT = lt.DEFAULT_ENDPOINT
USAGE = (
    'uso: /spellcheck [--lang es|es-AR|es-ES] [--no-picky] [--endpoint URL] <texto>\n'
    'ejemplo: /spellcheck El otro dia fui a la tienda y compre un ejmplio.'
)


def _home() -> Path:
    return Path(os.environ.get('HERMES_HOME') or (Path.home() / '.hermes'))


def _drafts() -> Path:
    d = _home() / 'cache' / 'spellcheck'
    d.mkdir(parents=True, exist_ok=True)
    return d


def _parse(raw: str):
    opts = {'lang': 'es', 'picky': True, 'endpoint': None}
    s = (raw or '').strip()
    while s.startswith('--'):
        head, _, tail = s.partition(' ')
        tail = tail.strip()
        key, eq, val = head.partition('=')
        if key == '--picky' and not eq:
            opts['picky'] = True
            s = tail
            continue
        if key == '--no-picky' and not eq:
            opts['picky'] = False
            s = tail
            continue
        if key in ('--lang', '--endpoint'):
            if not eq:
                val, _, tail = tail.partition(' ')
                tail = tail.strip()
            if not val:
                return None, None, 'falta el valor de %s' % key
            opts[key[2:]] = val
            s = tail
            continue
        return None, None, 'opcion desconocida: %s' % head
    return s, opts, None


def _lang_of(payload: dict, fallback: str) -> str:
    info = payload.get('language') or {}
    return info.get('longCode') or info.get('code') or fallback


def _text_fallback(text: str, matches: list, lang: str, dropped: int) -> str:
    lines = ['%d posibles errores (%s)' % (len(matches), lang)]
    if dropped:
        lines[0] += ' · %d omitidos' % dropped
    fixes = [m for m in matches if m['type'] == 'misspelling' and m['reps']]
    fixed = lt.apply_matches(text, fixes) if fixes else text
    if fixed != text:
        lines += ['', 'Texto con ortografia aplicada (revisalo):', '', fixed]
    lines += ['', 'Sugerencias:']
    for i, m in enumerate(matches[:40], 1):
        rep = ' / '.join(m['reps'][:3]) or '(sin sugerencias)'
        lines.append('%d. «%s» -> %s' % (i, m['frag'], rep))
    if len(matches) > 40:
        lines.append('... y %d mas' % (len(matches) - 40))
    return '\n'.join(lines)


def _cleanup(directory: Path, days: int = 7) -> None:
    cutoff = time.time() - days * 86400
    try:
        for p in directory.glob('draft-*.*'):
            if p.stat().st_mtime < cutoff:
                p.unlink()
    except OSError:
        pass


def _run_check(text: str, opts: dict, ctx) -> str:
    if len(text) > 60000:
        return '✗ texto demasiado largo (%d caracteres; maximo 60 000)' % len(text)
    endpoint = opts['endpoint'] or lt.configured_endpoint()
    try:
        payload = lt.check(text, opts['lang'], endpoint, opts['picky'])
    except lt.LTError as exc:
        return '✗ ' + str(exc)
    matches, dropped = lt.normalize(text, payload)
    lang = _lang_of(payload, opts['lang'])
    if not matches:
        return '✓ Sin errores detectados (%s) · %d caracteres' % (lang, len(text))
    try:
        surface = ctx.session_surface()
    except Exception:
        surface = ''
    drafts = _drafts()
    _cleanup(drafts)
    draft_id = hashlib.sha1((text + lang + str(time.time())).encode('utf-8')).hexdigest()[:8]
    summary = '%d posibles errores · %s' % (len(matches), lang)
    if dropped:
        summary += ' · %d omitidos' % dropped
    payload_out = {
        'id': draft_id, 'created': int(time.time()), 'text': text,
        'lang': lang, 'endpoint': endpoint,
        'picky': bool(opts['picky']), 'matches': matches, 'summary': summary,
    }
    body = json.dumps(payload_out, ensure_ascii=False)
    (drafts / ('draft-%s.json' % draft_id)).write_text(body, encoding='utf-8')
    tmp = drafts / 'latest.json.tmp'
    tmp.write_text(body, encoding='utf-8')
    tmp.replace(drafts / 'latest.json')
    if surface in ('desktop', 'local', ''):
        return 'spellcheck: %s · borrador %s · panel Spellcheck' % (summary, draft_id)
    return _text_fallback(text, matches, lang, dropped)


def register(ctx):
    def _spellcheck(raw_args, session_key='', platform='', session_id=None, source=None):
        text, opts, err = _parse(raw_args)
        if err:
            return '✗ ' + err + '\n' + USAGE
        if not text:
            return USAGE
        return _run_check(text, opts, ctx)

    ctx.register_command(
        'spellcheck', _spellcheck,
        description='Corrige ortografia con LanguageTool y abre el borrador en el panel',
        args_hint='<texto>', argument_mode='text',
    )
    ctx.register_command(
        'corregir', _spellcheck,
        description='Alias de /spellcheck',
        args_hint='<texto>', argument_mode='text',
    )

    def _b64(raw_args, session_key='', platform='', session_id=None, source=None):
        blob, opts, err = _parse(raw_args)
        if err:
            return '✗ ' + err
        if not blob:
            return '✗ falta el texto en base64'
        try:
            text = base64.b64decode(blob.strip(), validate=True).decode('utf-8')
        except Exception:
            return '✗ base64 invalido'
        return _run_check(text, opts, ctx)

    ctx.register_command(
        'spellcheck-b64', _b64,
        description='(interno) vuelve a revisar un texto en base64',
    )

    def _draft(raw_args, session_key='', platform='', session_id=None, source=None):
        p = _drafts() / 'latest.json'
        try:
            return p.read_text(encoding='utf-8')
        except OSError:
            return '{"ok": false, "error": "sin borradores"}'

    ctx.register_command(
        'spellcheck-draft', _draft,
        description='(interno) ultimo borrador de spellcheck en JSON',
    )
