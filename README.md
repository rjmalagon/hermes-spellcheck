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

## Construido con una Mezcla de Agentes (MoA) en Hermes Agent

Este plugin se desarrolló dentro de **Hermes Agent v0.23.2** con una
**Mixture of Agents**: varios modelos de referencia proponen y critican en paralelo
sobre el estado de la tarea, y un único modelo agregador —el que tiene acceso a
herramientas— ejecuta, verifica y consolida. Todo el ciclo (diseño, diagnóstico del
desfase de offsets UTF-16 de LanguageTool, tests, empaquetado, firma SSH del commit y
publicación) corrió como una sesión de Hermes.

Preset usado: `Rapidos-poderosos`.

| Rol | Modelo |
|---|---|
| Agregador / ejecutor | `nous:deepseek/deepseek-v4.1-flash-1017` |
| Referencia | `nous:z-ai/glm-5.3-flash` |
| Referencia | `nous:qwen/qwen3.8-flash` |
| Referencia | `nous:deepseek/deepseek-v4.1-flash-1017` |
| Referencia | `nous:xiaomi/mimo-v2.6-flash` |
| Referencia | `nous:tencent/hy4-flash:free` |
| Referencia | `nous:minimax/minimax-m3.1-flash` |

Notas: el agregador también participó como referencia (misma familia `deepseek-v4.1-flash-1017`);
`nous:ornith/ornith-1.5-122b` y `openrouter:thinkingmachines/inkling-2-small:free` estaban
configurados pero no disponibles en la sesión, así que no se listan como participantes.

## Licencia

MIT — ver [LICENSE](LICENSE).
