import {
  ENoticeTone,
  isLocalSetting,
  NOTICE_WARN_MS,
  type JsonValue,
  type NoticePort,
  type SettingDefinition,
  type SettingsDocument,
  type SettingsRead,
  type SettingsStorePort,
} from '@dltech/atlas-core'

import type { CloudSettingsStore } from './cloud-settings-store'
import { decodeSettingValue, encodeSettingValue } from './sync-settings'

const ORIGIN = 'Atlas Cloud settings'

type Pending = { value: string | null; sequence: number }

export const localOnlySettingIds = (
  definitions: readonly SettingDefinition[],
): ReadonlySet<string> =>
  new Set(definitions.filter(isLocalSetting).map((definition) => definition.id))

const sameValue = (args: { left: JsonValue | undefined; right: JsonValue | undefined }): boolean =>
  JSON.stringify(args.left) === JSON.stringify(args.right)

export class CloudUserSettingsStore implements SettingsStorePort {
  private readonly pending = new Map<string, Pending>()
  private readonly unsubscribe: () => void
  private chain: Promise<void> = Promise.resolve()
  private sequence = 0
  private lastSeen: { version: number; values: Record<string, string> } = {
    version: -1,
    values: {},
  }
  private identity: string | undefined

  constructor(
    private readonly args: {
      local: SettingsStorePort
      cloud: CloudSettingsStore
      localOnly: ReadonlySet<string>
      notice: NoticePort
      onChange: () => void
    },
  ) {
    this.identity = args.cloud.sessionToken()
    this.unsubscribe = args.cloud.subscribe(args.onChange)
  }

  close(): void {
    this.unsubscribe()
  }

  origin(): string {
    return this.args.cloud.signedIn() ? ORIGIN : this.args.local.origin()
  }

  read(): SettingsRead {
    this.followSession()
    const local = this.args.local.read()
    if (!this.args.cloud.signedIn()) return local

    const values: Record<string, JsonValue> = { ...this.remoteValues() }
    for (const [key, value] of Object.entries(local.document.values)) {
      if (this.args.localOnly.has(key)) values[key] = value
    }

    return {
      document: { values },
      ...(local.problem === undefined ? {} : { problem: local.problem }),
    }
  }

  write(document: SettingsDocument): void {
    this.followSession()
    if (!this.args.cloud.signedIn()) {
      this.args.local.write(document)
      return
    }

    this.writeLocal(document)
    this.writeRemote(document)
  }

  private followSession(): void {
    const token = this.args.cloud.sessionToken()
    if (token === this.identity) return

    this.identity = token
    this.pending.clear()
    this.lastSeen = { version: -1, values: {} }
  }

  private writeLocal(document: SettingsDocument): void {
    const held = Object.entries(this.args.local.read().document.values)
    const kept = held.filter(([key]) => !this.args.localOnly.has(key))
    const mine = Object.entries(document.values).filter(([key]) => this.args.localOnly.has(key))
    this.args.local.write({ values: Object.fromEntries([...kept, ...mine]) })
  }

  private writeRemote(document: SettingsDocument): void {
    const current = this.remoteValues()
    const next = Object.fromEntries(
      Object.entries(document.values).filter(([key]) => !this.args.localOnly.has(key)),
    )

    for (const [key, value] of Object.entries(next)) {
      if (!sameValue({ left: current[key], right: value }))
        this.enqueue({ key, value: encodeSettingValue(value) })
    }
    for (const key of Object.keys(current)) {
      if (!(key in next)) this.enqueue({ key, value: null })
    }
  }

  private remoteValues(): Record<string, JsonValue> {
    const stored = new Map<string, string | null>(Object.entries(this.cloudValues()))
    for (const [key, held] of this.pending) stored.set(key, held.value)

    const values: Record<string, JsonValue> = {}
    for (const [key, value] of stored) {
      if (value === null || this.args.localOnly.has(key)) continue
      values[key] = decodeSettingValue(value)
    }
    return values
  }

  private cloudValues(): Record<string, string> {
    const version = this.args.cloud.version()
    const values = this.args.cloud.values()
    const midRefresh = version === this.lastSeen.version && Object.keys(values).length === 0
    if (midRefresh) return this.lastSeen.values

    this.lastSeen = { version, values }
    return values
  }

  private enqueue(args: { key: string; value: string | null }): void {
    const { key, value } = args
    const sequence = (this.sequence += 1)
    const token = this.args.cloud.sessionToken()
    this.pending.set(key, { value, sequence })

    const settle = (): void => {
      if (this.pending.get(key)?.sequence === sequence) this.pending.delete(key)
    }

    this.chain = this.chain
      .then(() => {
        if (this.args.cloud.sessionToken() !== token) return
        return value === null
          ? this.args.cloud.remove({ key })
          : this.args.cloud.set({ key, value })
      })
      .then(settle, (error: unknown) => {
        settle()
        this.args.notice.notify({
          key: `cloud:settings-write:${key}`,
          tone: ENoticeTone.Warn,
          ttlMs: NOTICE_WARN_MS,
          text: `could not save ${key} to Atlas Cloud (${error instanceof Error ? error.message : 'unknown failure'}) — the change was dropped.`,
        })
        this.args.onChange()
      })
  }
}
