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

### Requisitos

1. **Hermes Agent** (probado en v0.23.2). El panel requiere Hermes Desktop; sin desktop,
   `/spellcheck` responde texto plano.
2. **Servidor LanguageTool** accesible desde la máquina donde corre el gateway.

### Opción A - gestor de plugins (recomendada)

El repo es público, así que no pide credenciales:

```bash
hermes plugins install rjmalagon/hermes-spellcheck --enable
```

Instala la mitad de agente (`/spellcheck`, `/corregir`) y recarga el gateway en vivo
(`reload-plugins`), sin reiniciar. Para fijar un commit exacto, `--ref` acepta un
**SHA completo de 40 caracteres** (no un tag):

```bash
git ls-remote https://github.com/rjmalagon/hermes-spellcheck.git refs/tags/v0.2.2
hermes plugins install rjmalagon/hermes-spellcheck --ref <sha-completo> --enable
```

### Opción B - manual con git

```bash
git clone https://github.com/rjmalagon/hermes-spellcheck.git
ln -s "$PWD/hermes-spellcheck" ~/.hermes/plugins/spellcheck
hermes plugins enable spellcheck
```

### Mitad desktop (opt-in)

Al instalar el paquete, Hermes copia `desktop/plugin.js` a
`~/.hermes/desktop-plugins/spellcheck/`, pero esa mitad queda **apagada por diseño**:
actívala en **Capabilities -> Plugins**. Si no aparece: `CMD+K` / `Ctrl+K`
-> **Reload desktop plugins**.

Si la copia automática no ocurre:

```bash
mkdir -p ~/.hermes/desktop-plugins/spellcheck
cp ~/.hermes/plugins/spellcheck/desktop/plugin.js ~/.hermes/desktop-plugins/spellcheck/plugin.js
```

Aviso: el id del paquete es `spellcheck`; el panel standalone de desarrollo es
`spellcheck-panel`. Si tienes ambos activos verás dos paneles "Spellcheck": desactiva uno.

### Cómo abrir el panel

Funciona igual en la vista **Simple** y en la **Avanzada**. El desktop guarda un layout
persistido distinto por vista, y en la avanzada la columna derecha ya la ocupan
`files`/`review`, así que un pane adoptado puede quedar como pestaña no activa. Para no
depender del layout, hay tres vías estables:

| Vía | Cómo |
|---|---|
| Sidebar | fila **Spellcheck** en la barra lateral |
| Paleta | `CMD+K` / `Ctrl+K` -> **Spellcheck: abrir panel** |
| Ruta | `#/spellcheck` |

El comando `/spellcheck` no cambia: solo escribe el borrador y el panel lo muestra.

### Endpoint de LanguageTool

El default del repo es `http://localhost:8010/v2/check`. Se cambia sin tocar código:

```bash
# en ~/.hermes/.env
SPELLCHECK_ENDPOINT=http://localhost:8010/v2/check
```

o por invocación:

```text
/spellcheck --endpoint http://localhost:8010/v2/check <texto>
```

Si no tienes servidor:

```bash
docker run -d -p 8010:8010 erikvl87/languagetool
```

o usa el API oficial `https://languagetool.org/v2/check` (tu texto viaja a un tercero).

### Verificar

```text
/spellcheck El otro dia fui a la tienda y compre un ejmplio.
```

Debe responder con el resumen y, en desktop, el panel con las marcas
(rojo = ortografía, ámbar = gramática/estilo).

### Actualizar

```bash
hermes plugins update spellcheck
```

Instalar encima sobrescribe la copia local: si tu endpoint vive ahí, muévelo antes a
`SPELLCHECK_ENDPOINT`.

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

Nota: el agregador también participó como referencia (misma familia `deepseek-v4.1-flash-1017`).

## Licencia

MIT — ver [LICENSE](LICENSE).
