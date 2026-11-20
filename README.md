# hermes-spellcheck

Corrección ortográfica y gramatical para [Hermes Agent](https://github.com/NousResearch/hermes-agent)
usando un servidor [LanguageTool](https://languagetool.org) (autohospedado o el API oficial).

`/spellcheck <texto>` analiza el texto y abre un **panel nativo en el desktop**:

- errores resaltados (rojo = ortografía, ámbar = gramática/estilo), con subrayado ondulado y número;
- inventario clicable + botones ‹ › para saltar entre incidencias;
- sugerencias por falta, «Aplicar todas» y «Revisar de nuevo» tras editar a mano;
- **Enviar como prompt**: manda el texto corregido al composer como turno del usuario,
  sin el límite de 500 caracteres del widget `::preview`.

En CLI/TUI/mensajería responde texto plano con el texto corregido y la lista numerada.

## Requisitos

- Servidor LanguageTool. Por defecto `http://localhost:8010`; se cambia con `--endpoint`
  o con la variable `SPELLCHECK_ENDPOINT`.
- Hermes Desktop para el panel (mitad `desktop/`).

## Instalación

```bash
hermes plugins install rjmalagon/hermes-spellcheck --enable
```

La mitad desktop se copia a `~/.hermes/desktop-plugins/`; actívala en
**Capabilities → Plugins** (esa mitad es opt-in por diseño). Alternativa manual:
copia `desktop/plugin.js` a `~/.hermes/desktop-plugins/spellcheck/plugin.js`.

## Uso

```text
/spellcheck El otro dia fui a la tienda y compre un ejmplio.
/corregir  --lang es-AR <texto>
/spellcheck --no-picky <texto>
```

`picky` está activado por defecto (tildes y puntuación en español).

## Detalles técnicos

- LanguageTool entrega offsets en unidades **UTF-16**. `lt.py` emite dos pares de
  coordenadas: `start/end` (code points, Python) y `s16/e16` (UTF-16, para
  `String.slice` del panel). El panel valida cada marca contra el fragmento original
  y descarta las desalineadas — así no reaparecen los `comprée` / `unejemploo`
  cuando hay emojis antes del error.
- Se protegen URLs, código inline/fences, correos y rutas absolutas.
- Comandos internos: `/spellcheck-draft` (JSON del último borrador) y
  `/spellcheck-b64` (re-revisión de texto editado).
- Borradores en `~/.hermes/cache/spellcheck/`, purga automática a 7 días.
- El texto se envía solo al endpoint configurado; no hay fallback silencioso al API oficial.

## Pruebas

```bash
python3 -m unittest discover -s tests -v
```

## Licencia

MIT — ver [LICENSE](LICENSE).
