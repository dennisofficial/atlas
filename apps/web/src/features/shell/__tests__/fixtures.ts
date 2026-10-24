import type { Project, WireThread } from '@dltech/atlas-wire/web'

export const NOW = Date.parse('2026-10-24T12:00:00.000Z')
export const HOUR_MS = 60 * 60 * 1000

export const agoIso = (hours: number): string => new Date(NOW - hours * HOUR_MS).toISOString()

export function threadOf(overrides: Partial<WireThread> & { id: string }): WireThread {
  return {
    head: 1,
    createdAt: agoIso(1),
    updatedAt: agoIso(1),
    workspace: null,
    repo: null,
    ...overrides,
  }
}

export function projectOf(id: string): Project {
  return {
    id,
    name: `project-${id}`,
    repo: null,
    baseBranch: null,
    additionalRepos: [],
    description: '',
    shipBehavior: 'open-pull-request' as Project['shipBehavior'],
    createdAt: agoIso(1000),
    updatedAt: agoIso(1000),
  }
}
