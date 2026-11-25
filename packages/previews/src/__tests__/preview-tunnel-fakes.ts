import { vi } from 'bun:test'
import { type Db, type Tx } from '@dltech/atlas-db'
import { type CloudflareTunnelClient } from '../cloudflare-tunnel.client'
import { type PreviewSecretCipher } from '../preview-tunnels'

export const fakeCipher: PreviewSecretCipher = {
  encrypt: (plain) => `enc:${plain}`,
  decrypt: (blob) => blob.slice(4),
}

export const tunnelFakes = () => {
  const held = new Map<string, { id: string; token: string }>()
  const counts = { created: 0 }
  const gates: { beforeCreate: (() => Promise<void>) | undefined } = { beforeCreate: undefined }
  const cloudflare = {
    ensureTunnel: vi.fn(async (args: { name: string }) => {
      const existing = held.get(args.name)
      if (existing !== undefined) return existing
      await gates.beforeCreate?.()
      counts.created += 1
      const tunnel = { id: `tun-${counts.created}`, token: `tok-${counts.created}` }
      held.set(args.name, tunnel)
      return tunnel
    }),
    putIngress: vi.fn(async (_args: { tunnelId: string; rules: unknown[] }) => undefined),
    createCname: vi.fn(async (args: { hostname: string; tunnelId: string }) => ({
      id: `rec-${args.hostname}`,
    })),
    findDnsRecord: vi.fn(
      async (_args: { hostname: string }): Promise<{ id: string; content: string } | undefined> =>
        undefined,
    ),
    repointCname: vi.fn(
      async (_args: { recordId: string; hostname: string; tunnelId: string }) => undefined,
    ),
    deleteDnsRecord: vi.fn(async (_args: { recordId: string }) => undefined),
    deleteTunnel: vi.fn(async (_args: { tunnelId: string }) => undefined),
  }
  const reset = () => {
    counts.created = 0
    gates.beforeCreate = undefined
    held.clear()
    for (const mock of Object.values(cloudflare)) mock.mockClear()
  }
  return {
    cloudflare,
    counts,
    gates,
    reset,
    client: cloudflare as unknown as CloudflareTunnelClient,
  }
}

export const transactionSignals = (real: Db) => {
  const waiters: Array<() => void> = []
  const db = {
    orm: real.orm,
    raw: real.raw,
    query: real.query.bind(real),
    transaction: async <T>(work: (tx: Tx) => Promise<T>): Promise<T> => {
      const result = await real.transaction(work)
      waiters.shift()?.()
      return result
    },
  } as unknown as Db
  const next = () => {
    const signal = Promise.withResolvers<void>()
    waiters.push(() => signal.resolve())
    return signal.promise
  }
  return { db, next }
}
