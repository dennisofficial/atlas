import { watch, type FSWatcher } from 'node:fs'
import { join } from 'node:path'

import {
  EKilledBy,
  type DeclaredServicesView,
  type ProcessPort,
  type ThreadId,
} from '@dltech/atlas-core'

import { ensureDeclaredServices, stopAndWait, type EnsuredService } from './declared-ensure'
import { launchDeclared, type DeclaredContext, type DeclaredEnsureOptions } from './declared-launch'
import type { TrackedService } from './service-endings'
import { loadDeclaredServices } from './declared-services'
import { buildDeclaredView } from './declared-view'
import type { ServiceSnapshot } from './service-process'
import type { ServiceRegistryPort, StartedServiceOutcome } from './service-registry-port'

export class DeclaredServicesSupport {
  private readonly ensuring = new Map<string, Promise<EnsuredService>>()
  private readonly setupDone = new Set<string>()
  private watcher: FSWatcher | undefined

  constructor(
    private readonly args: {
      services: ServiceRegistryPort
      processes: ProcessPort
      root: string
      options: DeclaredEnsureOptions | undefined
      onChange: () => void
    },
  ) {}

  private load() {
    return (this.args.options?.load ?? loadDeclaredServices)({ root: this.args.root })
  }

  ensure({
    threadId,
    names,
  }: {
    threadId: ThreadId
    names?: readonly string[] | undefined
  }): Promise<readonly EnsuredService[]> {
    this.attach()
    return ensureDeclaredServices({
      threadId,
      names,
      services: this.args.services,
      processes: this.args.processes,
      root: this.args.root,
      inflight: this.ensuring,
      setupDone: this.setupDone,
      options: this.args.options,
    })
  }

  async names(): Promise<readonly string[]> {
    return (await this.load()).services.map((one) => one.name)
  }

  async view({
    crashLooping,
    list,
  }: {
    crashLooping: (name: string) => boolean
    list: () => readonly ServiceSnapshot[]
  }): Promise<DeclaredServicesView> {
    this.attach()
    return buildDeclaredView({
      read: await this.load(),
      snapshots: list(),
      inflight: new Set(this.ensuring.keys()),
      crashLooping,
    })
  }

  async restart({
    serviceId,
    entry,
  }: {
    serviceId: string
    entry: TrackedService
  }): Promise<StartedServiceOutcome | undefined> {
    const { name } = entry.launch
    if (name === undefined) return undefined
    const wasDeclared = entry.launch.declarationHash !== undefined
    const read = await this.load()
    const declared = read.services.find((one) => one.name === name)
    if (declared === undefined) {
      if (!wasDeclared) return undefined
      const rejection = read.rejections.find((one) => one.name === name)
      return {
        ok: false,
        reason:
          rejection === undefined
            ? `${name} is no longer declared in .atlas/services.yaml; it was left running`
            : `${name} is invalid in .atlas/services.yaml (${rejection.detail}); it was left running`,
      }
    }

    await stopAndWait({
      services: this.args.services,
      serviceId,
      by: EKilledBy.Model,
    })
    const context: DeclaredContext = {
      services: this.args.services,
      processes: this.args.processes,
      root: this.args.root,
      threadId: entry.threadId,
      options: this.args.options,
    }
    const launched = await launchDeclared({ declared, context })
    return launched.ok ? { ok: true, snapshot: launched.snapshot } : launched
  }

  attach(): void {
    if (this.watcher !== undefined) return
    try {
      this.watcher = watch(join(this.args.root, '.atlas'), (_event, filename) => {
        if (filename === null || String(filename) === 'services.yaml') this.args.onChange()
      })
      this.watcher.on('error', () => this.detach())
    } catch {
      this.watcher = undefined
    }
  }

  private detach(): void {
    this.watcher?.close()
    this.watcher = undefined
  }

  close(): void {
    this.detach()
  }
}
