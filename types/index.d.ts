export type Agente = {
  id: string
  nombre: string
  tipo: string
  desde: number
  ultimo: string
  ultimoDesde: number
}

export type Salud = { huerfanos: number; tmpMb: number }

declare module 'claude-code' {
  interface PluginState {
    vigilante: {
      agentes: Shaped<Agente[]>
      salud: Salud
      oculto: boolean
    }
  }
}
