/** Spellcheck — panel nativo. Coordenadas UTF-16 (las de JS), re-revisión y picky. */
import { PALETTE_AREA, ROUTES_AREA, SIDEBAR_NAV_AREA, host } from '@hermes/plugin-sdk'
import { useEffect, useRef, useState } from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'

const ID = 'spellcheck'
const POLL_MS = 1500
const MUTED = 'text-(--ui-text-secondary)'
const FAINT = 'text-[0.6875rem] text-(--ui-text-quaternary)'
const CARD = 'rounded-md border border-(--ui-stroke-secondary)'
const SPELL = 'var(--ui-red, #cf222e)'
const OTHER = 'var(--ui-orange, #bf8700)'
function kindOf(m) { return m.type === 'misspelling' || m.type === 'typographical' ? SPELL : OTHER }

function sessionId() {
  const atom = host.state && host.state.focusedSessionId
  return atom && typeof atom.get === 'function' ? atom.get() : null
}

function toU16Matches(text, matches) {
  const out = []
  ;(matches || []).forEach(function (m) {
    const s = typeof m.s16 === 'number' ? m.s16 : m.start
    const e = typeof m.e16 === 'number' ? m.e16 : m.end
    if (typeof s !== 'number' || typeof e !== 'number' || s >= e) return
    if (text.slice(s, e) !== m.frag) return // guardia: índice desalineado
    out.push({ start: s, end: e, frag: m.frag, reps: m.reps || [], rule: m.rule, type: m.type, msg: m.msg, desc: m.desc })
  })
  out.sort(function (a, b) { return a.start - b.start })
  const clean = []
  let last = -1
  out.forEach(function (m) { if (m.start >= last) { clean.push(m); last = m.end } })
  return clean
}

function applyMatch(text, matches, i, value) {
  const m = matches[i]
  if (!m) return { text: text, matches: matches }
  const delta = value.length - (m.end - m.start)
  const next = text.slice(0, m.start) + value + text.slice(m.end)
  const rest = []
  matches.forEach(function (x, k) {
    if (k === i) return
    if (x.end <= m.start) { rest.push(x); return }
    if (x.start >= m.end) { rest.push(Object.assign({}, x, { start: x.start + delta, end: x.end + delta })) }
  })
  return { text: next, matches: rest }
}

function applyAllMatches(text, matches) {
  const ordered = matches.slice().sort(function (a, b) { return a.start - b.start })
  let out = ''
  let pos = 0
  const kept = []
  ordered.forEach(function (m) {
    if (m.start < pos) return
    out += text.slice(pos, m.start)
    if (m.type === 'misspelling' && m.reps && m.reps.length) {
      out += m.reps[0]
    } else {
      const s = out.length
      out += text.slice(m.start, m.end)
      kept.push(Object.assign({}, m, { start: s, end: out.length }))
    }
    pos = m.end
  })
  out += text.slice(pos)
  return { text: out, matches: kept }
}

function b64(text) {
  const bytes = new TextEncoder().encode(text)
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin)
}

function fetchDraft() {
  const sid = sessionId()
  if (!sid) return Promise.resolve({ ok: false, error: 'sin sesión activa' })
  return host.request('slash.exec', { session_id: sid, command: 'spellcheck-draft' }).then(function (r) {
    const raw = r && typeof r === 'object' && 'output' in r ? r.output : r
    if (!raw || typeof raw !== 'string') return { ok: false, error: 'respuesta vacía' }
    try {
      const d = JSON.parse(raw)
      if (d && d.ok === false) return { ok: false, error: d.error || 'sin borradores' }
      return { ok: true, draft: d && d.id ? d : (d.draft || null) }
    } catch (e) {
      return { ok: false, error: 'respuesta no-JSON' }
    }
  }, function (e) {
    return { ok: false, error: String(e && e.message ? e.message : e) }
  })
}

function Pane() {
  const [draft, setDraft] = useState(null)
  const [text, setText] = useState('')
  const [matches, setMatches] = useState([])
  const [sel, setSel] = useState(-1)
  const [dirty, setDirty] = useState(false)
  const [picky, setPicky] = useState(true)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const lastKey = useRef('')
  const markRefs = useRef({})

  useEffect(function () {
    let alive = true
    function pull() {
      fetchDraft().then(function (r) {
        if (!alive) return
        if (!r.ok || !r.draft) { setError(r.error || 'sin borradores'); return }
        const d = r.draft
        const key = String(d.id) + ':' + String(d.created || '')
        if (key === lastKey.current) return
        lastKey.current = key
        setDraft(d)
        setText(d.text || '')
        setMatches(toU16Matches(d.text || '', d.matches || []))
        setDirty(false)
        setSel(-1)
        setPicky(d.picky !== false)
        setStatus('')
        setError('')
      })
    }
    pull()
    const t = setInterval(pull, POLL_MS)
    return function () { alive = false; clearInterval(t) }
  }, [])

  useEffect(function () {
    if (sel < 0 || dirty) return
    const el = markRefs.current[sel]
    if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'nearest' })
  }, [sel, dirty, matches])

  function jump(dir) {
    if (!matches.length || dirty) return
    let next
    if (sel < 0) next = dir > 0 ? 0 : matches.length - 1
    else {
      next = sel + dir
      if (next < 0) next = matches.length - 1
      if (next >= matches.length) next = 0
    }
    setSel(next)
  }

  function applyAt(i, value) {
    const r = applyMatch(text, matches, i, value)
    setText(r.text)
    setMatches(r.matches)
    setSel(-1)
  }

  function applyAll() {
    if (dirty) return
    const r = applyAllMatches(text, matches)
    setText(r.text)
    setMatches(r.matches)
    setSel(-1)
  }

  function recheck() {
    const sid = sessionId()
    if (!sid) { setStatus('sin sesión activa'); return }
    if (!text.trim()) { setStatus('Texto vacío.'); return }
    setStatus('revisando…')
    const cmd = 'spellcheck-b64 ' + (picky ? '--picky ' : '--no-picky ') + b64(text)
    host.request('slash.exec', { session_id: sid, command: cmd }).then(function (r) {
      const out = r && typeof r === 'object' && 'output' in r ? r.output : r
      setStatus(typeof out === 'string' ? out.slice(0, 90) : 'revisado')
    }, function (e) {
      setStatus('error: ' + String(e && e.message ? e.message : e))
    })
  }

  function send() {
    if (!text.trim()) { setStatus('Texto vacío.'); return }
    if (!host.composer) { setStatus('Esta versión no expone host.composer: copia el texto.'); return }
    let ok = false
    try { ok = host.composer.submit(null, text) } catch (e) { ok = false }
    if (ok) { setStatus('Enviado como prompt ✓'); return }
    Promise.resolve(host.composer.setDraft(null, text)).then(function (applied) {
      setStatus(applied ? 'En el composer; pulsa Enter.' : 'No hay composer activo: copia el texto.')
    }, function () { setStatus('No hay composer activo: copia el texto.') })
  }

  function copy() {
    try { navigator.clipboard.writeText(text); setStatus('Copiado.') }
    catch (e) { setStatus('No se pudo copiar.') }
  }

  const nodes = []
  let pos = 0
  if (!dirty) {
    matches.forEach(function (m, i) {
      if (m.start > pos) nodes.push(jsx('span', { key: 't' + i, children: text.slice(pos, m.start) }))
      const c = kindOf(m)
      const active = i === sel
      nodes.push(jsxs('span', {
        key: 'm' + i,
        ref: function (el) { markRefs.current[i] = el },
        'data-i': i,
        title: (i + 1) + '. ' + (m.msg || m.desc || m.rule || ''),
        onClick: function (e) { setSel(parseInt(e.currentTarget.getAttribute('data-i'), 10)) },
        className: 'cursor-pointer rounded',
        style: {
          background: 'color-mix(in srgb, ' + c + ' ' + (active ? '30%' : '14%') + ', transparent)',
          outline: active ? '1px solid ' + c : 'none',
          borderRadius: '3px'
        },
        children: [
          jsx('span', {
            style: {
              textDecorationLine: 'underline',
              textDecorationStyle: m.type === 'misspelling' ? 'wavy' : 'solid',
              textDecorationColor: c,
              textDecorationThickness: '2px',
              textUnderlineOffset: '2px',
              textDecorationSkipInk: 'none'
            },
            children: text.slice(m.start, m.end)
          }),
          jsx('sup', {
            style: {
              marginLeft: '1px', padding: '0 2px', borderRadius: '3px',
              background: c, color: '#fff', fontSize: '0.5rem', fontWeight: 700
            },
            children: String(i + 1)
          })
        ]
      }))
      pos = m.end
    })
  }
  nodes.push(jsx('span', { key: 'tail', children: dirty ? text : text.slice(pos) }))

  const selMatch = sel >= 0 ? matches[sel] : null
  const nSpell = matches.filter(function (m) { return m.type === 'misspelling' }).length
  const nOther = matches.length - nSpell
  const summary = draft ? ((draft.summary || '') + ' · ' + text.length + ' car.') : 'esperando /spellcheck…'

  return jsxs('div', {
    className: 'flex h-full flex-col gap-2 overflow-hidden p-3 text-sm',
    children: [
      jsxs('div', {
        className: 'flex items-center justify-between gap-2',
        children: [
          jsx('div', { className: 'font-medium', children: 'Spellcheck' }),
          jsxs('div', {
            className: FAINT + ' flex flex-wrap items-center gap-2',
            children: [
              jsx('span', { children: summary }),
              nSpell ? jsxs('span', { className: 'flex items-center gap-1', children: [
                jsx('span', { style: { width: '8px', height: '8px', borderRadius: '99px', background: SPELL } }),
                nSpell + ' ort.'
              ] }) : null,
              nOther ? jsxs('span', { className: 'flex items-center gap-1', children: [
                jsx('span', { style: { width: '8px', height: '8px', borderRadius: '99px', background: OTHER } }),
                nOther + ' gram.'
              ] }) : null
            ]
          })
        ]
      }),
      error ? jsx('div', { className: 'text-xs text-(--ui-danger, #cf222e)', children: error }) : null,
      jsxs('div', {
        className: CARD + ' min-h-0 flex-1 overflow-auto whitespace-pre-wrap p-2',
        children: nodes
      }),
      dirty ? jsx('div', { className: FAINT + ' text-xs', children: 'Edición manual: marcas desactivadas. Pulsa «Revisar de nuevo» para volver a resaltar.' }) : null,
      jsx('div', {
        className: CARD + ' max-h-32 shrink-0 overflow-auto p-1',
        children: matches.length
          ? matches.map(function (m, i) {
              const c = kindOf(m)
              const rep1 = (m.reps && m.reps[0]) || 'sin sugerencia'
              return jsxs('button', {
                key: 'row' + i,
                type: 'button',
                onClick: function () { setSel(i) },
                className: 'flex w-full items-center gap-2 rounded px-2 py-0.5 text-left text-xs hover:bg-(--ui-row-hover-background)',
                style: i === sel ? { background: 'color-mix(in srgb, ' + c + ' 18%, transparent)' } : undefined,
                children: [
                  jsx('span', { style: { color: c, fontWeight: 700, minWidth: '1.1rem' }, children: String(i + 1) + '.' }),
                  jsxs('span', { className: 'min-w-0 flex-1 truncate', children: [
                    jsx('span', { className: 'font-medium', children: '«' + (m.frag || '') + '»' }),
                    jsx('span', { className: FAINT, children: ' → ' + rep1 })
                  ] })
                ]
              })
            })
          : jsx('div', { className: FAINT + ' p-1 text-xs', children: 'Sin incidencias pendientes.' })
      }),
      selMatch ? jsxs('div', {
        className: CARD + ' p-2',
        children: [
          jsx('div', { className: MUTED + ' text-xs', children: '«' + selMatch.frag + '» — ' + (selMatch.msg || selMatch.desc || selMatch.rule) }),
          jsxs('div', {
            className: 'mt-1 flex flex-wrap gap-1',
            children: (selMatch.reps || []).map(function (r, i) {
              return jsx('button', {
                key: 'r' + i, type: 'button',
                className: 'rounded border border-(--ui-stroke-secondary) px-2 py-0.5 text-xs hover:border-(--ui-accent)',
                onClick: function () { applyAt(sel, r) }, children: r
              })
            }).concat([
              jsx('button', {
                key: 'skip', type: 'button',
                className: 'rounded px-2 py-0.5 text-xs ' + FAINT,
                onClick: function () { setMatches(matches.filter(function (_x, k) { return k !== sel })); setSel(-1) },
                children: 'ignorar'
              })
            ])
          })
        ]
      }) : null,
      jsx('textarea', {
        value: text, spellCheck: false,
        onChange: function (e) { setText(e.target.value); setDirty(true); setSel(-1) },
        className: CARD + ' h-24 shrink-0 resize-y bg-transparent p-2 font-mono text-[0.75rem] text-inherit outline-none'
      }),
      jsxs('div', {
        className: 'flex flex-wrap items-center gap-2',
        children: [
          jsx('button', {
            type: 'button', disabled: dirty || !matches.length, title: 'error anterior',
            className: 'rounded border border-(--ui-stroke-secondary) px-2 py-1 text-xs hover:border-(--ui-accent) disabled:opacity-40',
            onClick: function () { jump(-1) }, children: '‹'
          }),
          jsx('button', {
            type: 'button', disabled: dirty || !matches.length, title: 'siguiente error',
            className: 'rounded border border-(--ui-stroke-secondary) px-2 py-1 text-xs hover:border-(--ui-accent) disabled:opacity-40',
            onClick: function () { jump(1) }, children: '›'
          }),
          jsx('button', {
            type: 'button', disabled: dirty,
            className: 'rounded border border-(--ui-stroke-secondary) px-2 py-1 text-xs hover:border-(--ui-accent) disabled:opacity-40',
            onClick: applyAll, children: 'Aplicar todas'
          }),
          jsx('button', {
            type: 'button',
            className: 'rounded bg-(--ui-accent) px-2 py-1 text-xs text-white',
            onClick: send, children: 'Enviar como prompt'
          }),
          jsx('button', {
            type: 'button',
            className: 'rounded border border-(--ui-stroke-secondary) px-2 py-1 text-xs hover:border-(--ui-accent)',
            onClick: recheck, children: 'Revisar de nuevo'
          }),
          jsxs('label', {
            className: FAINT + ' flex items-center gap-1',
            children: [
              jsx('input', { type: 'checkbox', checked: picky, onChange: function (e) { setPicky(e.target.checked) } }),
              'picky'
            ]
          }),
          jsx('button', {
            type: 'button',
            className: 'rounded border border-(--ui-stroke-secondary) px-2 py-1 text-xs hover:border-(--ui-accent)',
            onClick: copy, children: 'Copiar'
          }),
          jsx('span', { className: FAINT, children: status })
        ]
      })
    ]
  })
}

export default {
  id: ID,
  name: 'Spellcheck',
  register(ctx) {
    ctx.registerMany([
      {
        id: 'pane',
        area: 'panes',
        title: 'Spellcheck',
        data: {
          placement: 'right',
          width: '380px',
          minWidth: '300px',
          collapsible: true,
          revealAliases: ['spellcheck', 'ortografia'],
          dock: { pane: 'workspace', pos: 'right' }
        },
        render: function () { return jsx(Pane, {}) }
      },
      {
        id: 'page',
        area: ROUTES_AREA,
        data: { path: '/spellcheck' },
        render: function () {
          return jsx('div', { className: 'h-full min-w-0 w-full overflow-hidden', children: jsx(Pane, {}) })
        }
      },
      {
        id: 'nav',
        area: SIDEBAR_NAV_AREA,
        data: { path: '/spellcheck', label: 'Spellcheck', codicon: 'checklist' }
      },
      {
        id: 'open',
        area: PALETTE_AREA,
        data: {
          id: 'spellcheck.open',
          label: 'Spellcheck: abrir panel',
          keywords: ['spellcheck', 'ortografia', 'corregir', 'languagetool'],
          run: function () { host.navigate('/spellcheck') }
        }
      }
    ])
  }
}
