import type { OrphanSandbox, StoredSandboxState } from './orphan-sandbox-sweep'

export const NOW = new Date('2026-11-10T06:00:00Z')
export const daysAgo = (days: number): number => NOW.getTime() - days * 24 * 60 * 60 * 1_000

export const sandbox = (name: string, overrides: Partial<OrphanSandbox> = {}): OrphanSandbox => ({
  name,
  status: 'stopped',
  createdAt: daysAgo(5),
  ...overrides,
})

export const fakeStore = (sandboxes: OrphanSandbox[]) => {
  const deleted: string[] = []
  const stopped: string[] = []
  return {
    deleted,
    stopped,
    store: {
      listSandboxes: async () => sandboxes,
      deleteSandbox: async (args: { name: string }) => {
        deleted.push(args.name)
      },
      stopSandbox: async (args: { name: string }) => {
        stopped.push(args.name)
      },
    },
  }
}

export const storedRow = (
  name: string,
  overrides: Partial<StoredSandboxState> = {},
): StoredSandboxState => ({
  name,
  state: 'running',
  lastActivityAt: new Date(daysAgo(1)),
  ...overrides,
})

export const parkedNames = (plan: { park: StoredSandboxState[] }): string[] =>
  plan.park.map((row) => row.name)
