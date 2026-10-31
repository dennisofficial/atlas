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
  private watchedRoot: string | undefined

  constructor(
    private readonly args: {
      services: ServiceRegistryPort
      processes: ProcessPort
      root: () => string | Promise<string>
      options: DeclaredEnsureOptions | undefined
      onChange: () => void
    },
  ) {}

  private async load() {
    const root = await this.args.root()
    return (this.args.options?.load ?? loadDeclaredServices)({ root })
  }

  async ensure({
    threadId,
    names,
  }: {
    threadId: ThreadId
    names?: readonly string[] | undefined
  }): Promise<readonly EnsuredService[]> {
    const root = await this.args.root()
    this.attach(root)
    return ensureDeclaredServices({
      threadId,
      names,
      services: this.args.services,
      processes: this.args.processes,
      root,
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
    this.attach(await this.args.root())
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
      root: await this.args.root(),
      threadId: entry.threadId,
      options: this.args.options,
    }
    const launched = await launchDeclared({ declared, context })
    return launched.ok ? { ok: true, snapshot: launched.snapshot } : launched
  }

  attach(root: string): void {
    if (this.watcher !== undefined && this.watchedRoot === root) return
    const moved = this.watchedRoot !== undefined
    this.detach()
    this.watchedRoot = root
    try {
      this.watcher = watch(join(root, '.atlas'), (_event, filename) => {
        if (filename === null || String(filename) === 'services.yaml') this.args.onChange()
      })
      this.watcher.on('error', () => this.detach())
    } catch {
      this.watcher = undefined
    }
    if (moved) this.args.onChange()
  }

  private detach(): void {
    this.watcher?.close()
    this.watcher = undefined
    this.watchedRoot = undefined
  }

  close(): void {
    this.detach()
  }
}
