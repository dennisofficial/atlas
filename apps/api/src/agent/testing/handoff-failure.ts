import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import type { HandoffContext } from './handoff-context'
import type { HostProcess } from './fault-rig'

type Fact = { key?: unknown; kind?: unknown; value?: unknown }

const factsOf = async (ctx: HandoffContext): Promise<readonly string[]> => {
  const rows = await ctx.record()
  return rows.flatMap((row) => {
    if (row.type === 'fact-recorded') {
      const fact = row.event as Fact
      return [`${String(fact.key)} ${String(fact.kind)} ${JSON.stringify(fact.value)}`]
    }
    if (row.type === 'tool-dispatched' || row.type === 'tool-result') {
      const event = row.event as { callId?: unknown; interrupted?: unknown }
      return [`${row.type} ${String(event.callId)} interrupted=${String(event.interrupted)}`]
    }
    return []
  })
}

const journalsOf = (home: string): readonly string[] => {
  const directory = join(home, 'daemon', 'calls')
  try {
    return readdirSync(directory)
      .sort()
      .map((name) => {
        try {
          return `${name} ${readFileSync(join(directory, name, 'state.json'), 'utf8')}`
        } catch {
          return `${name} (no state)`
        }
      })
  } catch {
    return []
  }
}

const SERVICE_LOG_TAIL_BYTES = 2_048

const serviceLogsOf = (home: string): readonly string[] => {
  const directory = join(home, 'daemon', 'services')
  try {
    return readdirSync(directory)
      .sort()
      .map((serviceId) => {
        try {
          const text = readFileSync(join(directory, serviceId, 'log.bin'), 'utf8')
          return `${serviceId}: ${JSON.stringify(text.slice(-SERVICE_LOG_TAIL_BYTES))}`
        } catch {
          return `${serviceId} (no log)`
        }
      })
  } catch {
    return []
  }
}

const sectionOf = (title: string, lines: readonly string[]): string =>
  `${title}: ${lines.length === 0 ? '(none)' : `\n  ${lines.join('\n  ')}`}`

export const handoffFailureOf = async (args: {
  ctx: HandoffContext
  hosts: readonly HostProcess[]
}): Promise<string> => {
  const facts = await factsOf(args.ctx)
  return [
    sectionOf('record', facts),
    sectionOf('daemon journals', journalsOf(args.ctx.daemon.home)),
    sectionOf('service logs', serviceLogsOf(args.ctx.daemon.home)),
    ...args.hosts.map((host) => `${host.label} logs:\n${host.logs().join('\n')}`),
  ].join('\n')
}
