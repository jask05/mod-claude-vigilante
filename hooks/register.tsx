import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Agente, Salud } from '../types'

// Minutos a partir de los cuales un subagente se considera atascado.
const UMBRAL_MIN = 30
const CADA_AGENTES_MS = 60_000
const CADA_SALUD_MS = 10 * 60_000

const agentes = atom({ plugin: 'vigilante', key: 'agentes' } as const, [], {
  shape: 'agentes-1',
})
const salud = atom({ plugin: 'vigilante', key: 'salud' } as const, {
  huerfanos: 0,
  tmpMb: 0,
})
const oculto = atom({ plugin: 'vigilante', key: 'oculto' } as const, false)

const minutos = (desde: number, ahora: number) =>
  Math.floor((ahora - desde) / 60_000)

// Toasts ya dados, para no repetir el aviso del mismo agente.
const avisados = new Set<string>()

function script($: EngineInterface) {
  return `${$.plugin.root}/scripts/limpieza.sh`
}

async function correr($: EngineInterface, args: string[], timeoutMs = 60_000) {
  const env = { VIGILANTE_SESION: await $.session.id() }
  return $.process.run(['bash', script($), ...args], { env, timeoutMs })
}

async function medirSalud($: EngineInterface) {
  const { stdout } = await correr($, ['contar'])
  const n = /huerfanos=(\d+)/.exec(stdout)?.[1]
  const mb = /tmp_mb=(\d+)/.exec(stdout)?.[1]
  const nueva: Salud = { huerfanos: Number(n ?? 0), tmpMb: Number(mb ?? 0) }
  await update($, salud, () => nueva)
}

async function revisarAgentes($: EngineInterface) {
  const ahora = await $.clock.now()
  const vivos = (await $.agent.list()).filter(a =>
    ['pending', 'running', 'waiting'].includes(a.status),
  )
  await update($, agentes, lista => {
    const previos = new Map(lista.map(a => [a.id, a]))
    return vivos.map(a => {
      const antes = previos.get(a.id)
      return {
        id: a.id,
        nombre: a.name ?? a.description,
        tipo: a.type,
        desde: antes?.desde ?? ahora,
        ultimo: antes?.ultimo ?? '',
        ultimoDesde: antes?.ultimoDesde ?? ahora,
      }
    })
  })
  for (const a of await read($, agentes)) {
    if (minutos(a.desde, ahora) >= UMBRAL_MIN && !avisados.has(a.id)) {
      avisados.add(a.id)
      $.ui.toast(`Subagente «${a.nombre}» lleva ${minutos(a.desde, ahora)} min`)
    }
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'limpieza',
      description:
        'Lista procesos de Codex huérfanos y scratchpads abandonados; «/limpieza ya» los borra',
      argumentHint: '[ya]',
    })
    $.clock.every(CADA_AGENTES_MS, () => revisarAgentes($))
    $.clock.every(CADA_SALUD_MS, () => medirSalud($))
    void medirSalud($)

    return next(e)
  })

  // Lo último que hizo cada subagente, para saber en qué está esperando.
  on('tool.call', async ($, e, next) => {
    if (e.agentId !== undefined) {
      const ahora = await $.clock.now()
      const detalle =
        e.tool === 'Bash' ? `Bash: ${e.command.slice(0, 60)}` : String(e.tool)
      const id = e.agentId
      await update($, agentes, lista =>
        lista.map(a =>
          a.id === id ? { ...a, ultimo: detalle, ultimoDesde: ahora } : a,
        ),
      )
    }

    return next(e)
  })

  on('command.run', { command: 'limpieza' }, async ($, e) => {
    const ya = e.args.trim() === 'ya'
    const { stdout, exitCode } = await correr($, [ya ? 'limpiar' : 'listar'], 300_000)
    if (ya) await medirSalud($)

    return {
      text: exitCode === 0 ? stdout.trim() : `La limpieza falló (código ${exitCode}).`,
    }
  })

  // Al salir, cierra los brokers de Codex que abrió esta sesión.
  on('session.end', async ($, e, next) => {
    if (e.reason !== 'clear') {
      await $.process
        .run(['bash', '-c', `bash "$0" fin "$PPID"`, script($)], { timeoutMs: 1000 })
        .catch(() => undefined)
    }

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const lista = await read($, agentes)
    const { huerfanos, tmpMb } = await read($, salud)
    const ahora = await $.clock.now()
    const lentos = lista.filter(a => minutos(a.desde, ahora) >= UMBRAL_MIN)

    if (e.props.hasSurvey || (await read($, oculto)) || (lentos.length === 0 && huerfanos === 0)) {
      return next(e)
    }

    const { Box, Button, Text } = $.ui.resolve(e)

    return (
      <Box flexDirection="column">
        {lentos.map(a => (
          <Box>
            <Text color="warning">
              ⚠ «{a.nombre}» lleva {minutos(a.desde, ahora)} min
              {a.ultimo !== '' ? ` · ${a.ultimo} (hace ${minutos(a.ultimoDesde, ahora)} min)` : ''}{' '}
            </Text>
            <Button key={`ver-${a.id}`} label="ver" onPress={() => $.ui.view({ agentId: a.id })} />
          </Box>
        ))}
        {huerfanos > 0 && (
          <Box>
            <Text dimColor>
              {huerfanos} procesos de Codex huérfanos · /tmp {tmpMb} MB · revisa con /limpieza{' '}
            </Text>
            <Button key="ocultar" label="ocultar" onPress={() => update($, oculto, () => true)} />
          </Box>
        )}
      </Box>
    )
  })
}
