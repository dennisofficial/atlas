import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { type EOomScope, type OomMemory } from '@dltech/atlas-core'
import { OOM_JOURNAL_LIMIT, type OomIncident, oomIncidentSchema } from '@dltech/atlas-protocol'
import { z } from 'zod'

export const OOM_JOURNAL_FILE = 'oom-incidents.json'

export type OomRecord = {
  scope: EOomScope
  command?: string | undefined
  processes: number
  memory: OomMemory
}

const storedSchema = z.object({
  total: z.number().int().min(0),
  incidents: z.array(oomIncidentSchema),
})

type Stored = { total: number; incidents: OomIncident[] }

const storedOf = (path: string): Stored => {
  try {
    const parsed = storedSchema.safeParse(JSON.parse(readFileSync(path, 'utf8')))
    if (!parsed.success) return { total: 0, incidents: [] }
    return { total: parsed.data.total, incidents: parsed.data.incidents }
  } catch {
    return { total: 0, incidents: [] }
  }
}

export class OomJournal {
  readonly path: string
  private incidents: OomIncident[]
  private total: number

  constructor(home: string) {
    this.path = join(home, OOM_JOURNAL_FILE)
    const stored = storedOf(this.path)
    this.incidents = stored.incidents.slice(-OOM_JOURNAL_LIMIT)
    this.total = stored.total
  }

  get count(): number {
    return this.total
  }

  list(): OomIncident[] {
    return [...this.incidents]
  }

  record(args: OomRecord): OomIncident {
    const incident: OomIncident = {
      incidentId: randomUUID(),
      at: Date.now(),
      scope: args.scope,
      ...(args.command === undefined ? {} : { command: args.command }),
      processes: args.processes,
      memory: args.memory,
    }
    this.incidents.push(incident)
    if (this.incidents.length > OOM_JOURNAL_LIMIT) {
      this.incidents.splice(0, this.incidents.length - OOM_JOURNAL_LIMIT)
    }
    this.total += 1
    this.save()
    return incident
  }

  private save(): void {
    try {
      mkdirSync(dirname(this.path), { recursive: true })
      writeFileSync(this.path, JSON.stringify({ total: this.total, incidents: this.incidents }))
    } catch {
      return
    }
  }
}
