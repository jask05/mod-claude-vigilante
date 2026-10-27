# vigilante — mod para Claude Code

Un mod de Claude Code que vigila lo que se queda colgado mientras trabajas con subagentes y con el plugin de Codex, y limpia lo que dejan atrás las sesiones viejas.

Nace de un problema real: subagentes que se quedan más de una hora «esperando al CI» sin que nadie se entere, procesos de Codex que no se cierran al terminar una revisión (en una máquina llegó a haber 39, algunos con tres semanas encima, y la CPU al 100 %) y `/tmp` llenándose de scratchpads y worktrees de sesiones que ya no existen.

## Qué hace

### 1. Avisa de subagentes atascados

Cada minuto revisa los subagentes de la sesión. Cuando uno pasa de **30 minutos**:

- salta un aviso (toast) una sola vez por subagente;
- aparece una banda encima del prompt con lo que lleva y **en qué está esperando**: la última herramienta que usó y hace cuánto (por ejemplo `⚠ «implementar» lleva 47 min · Bash: ./esperar_ci.sh (hace 40 min)`);
- el botón **ver** abre la conversación de ese subagente para que decidas si pararlo.

### 2. Detecta procesos de Codex huérfanos

Cada 10 minutos cuenta los `app-server-broker.mjs` del plugin de Codex cuya sesión de Claude ya no existe. Un broker se considera **huérfano** cuando el proceso de Claude que lo lanzó (la variable `CLAUDE_PID` de su entorno) ya no está vivo; los de sesiones abiertas no se tocan nunca. Si hay huérfanos, la banda lo dice junto con lo que ocupa `/tmp`.

Al **salir** de una sesión (no con `/clear`), cierra los brokers de Codex que abrió esa misma sesión, para que no se queden huérfanos.

### 3. `/limpieza`

| Orden | Qué hace |
| --- | --- |
| `/limpieza` | **Solo lista**: los brokers huérfanos (con su antigüedad) y los scratchpads de sesiones paradas hace más de 2 días, con su tamaño. No borra nada. |
| `/limpieza ya` | Mata los brokers huérfanos (y sus procesos hijos) y borra esos scratchpads, quitando antes los worktrees de git que contengan (`git worktree prune` en el repositorio original). |

Un scratchpad es `/tmp/claude-<uid>/<proyecto>/<id de sesión>/`. Se considera abandonado cuando la transcripción de esa sesión (`~/.claude/projects/<proyecto>/<id>.jsonl`) lleva más de 2 días sin cambios. Nunca se borra el de la sesión actual, y **un worktree con cambios sin commitear se conserva** y se avisa.

## Instalación

En el prompt de una sesión de Claude Code en la terminal:

```
/plugin install vigilante --marketplace jask05/mod-claude-vigilante
```

Responde `y` para añadir el marketplace y elige el ámbito (el de usuario, el primero, sirve para todas tus sesiones).

Desde una shell:

```
claude plugin install vigilante --marketplace jask05/mod-claude-vigilante
```

En la app de escritorio, donde `/plugin` no funciona: pulsa **+** junto a la caja del prompt, luego **Plugins**, **Add marketplace** con `jask05/mod-claude-vigilante`, y después **Add plugin**.

## Requisitos

- Linux (lee `/proc/<pid>/environ` para saber a qué sesión pertenece cada broker).
- `bash`, `pgrep`, `ps`, `du`, `find` y `git`.
- El plugin de Codex es opcional: sin él, simplemente no hay brokers que vigilar.

## Ajustes

Están como constantes al principio de los ficheros:

- `UMBRAL_MIN` (30), `CADA_AGENTES_MS` (1 min) y `CADA_SALUD_MS` (10 min) en `hooks/register.tsx`.
- Los días para considerar una sesión abandonada: variable `VIGILANTE_DIAS` (2 por defecto) en `scripts/limpieza.sh`.

## Cómo está hecho

- `hooks/register.tsx`: el módulo de hooks del mod (eventos `session.start`, `tool.call`, `command.run`, `session.end` y el dibujo de la banda en `ui.render`).
- `scripts/limpieza.sh`: la detección y la limpieza, con los modos `contar`, `listar`, `limpiar` y `fin <pid>`.
- `types/index.d.ts`: los tipos del estado que guarda el mod.
