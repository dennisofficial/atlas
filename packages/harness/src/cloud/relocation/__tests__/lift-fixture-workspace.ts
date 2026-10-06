import { existsSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import type { Event } from '@dltech/atlas-core'

import { encodeEventLine } from '../../../store/sessions/lines'
import { SESSION_FORMAT_VERSION, newThreadMeta, type SessionMeta } from '../../../store/sessions/meta'
import { SESSION_META_NAME, sessionDirectory, threadMetaFile } from '../../../store/sessions/paths'
import { CLOUD_THREAD } from './fixture'

export const FIXTURE_AT = '2026-09-16T12:00:00.000Z'
export const FIXTURE_WORKSPACE = '/work'

export type FixtureWorkspace = { workspace: string; repo: string | null }

const gitOutput = (cwd: string, args: readonly string[]): string | null => {
  const run = Bun.spawnSync(['git', ...args], { cwd, stdout: 'pipe', stderr: 'ignore', stdin: 'ignore' })
  return run.exitCode === 0 ? run.stdout.toString().trim() : null
}

export const fixtureWorkspaceOf = ({ cwd }: { cwd: string }): FixtureWorkspace => {
  if (!existsSync(cwd)) return { workspace: cwd, repo: null }
  const workspace = realpathSync(cwd)
  const commonDir = gitOutput(workspace, ['rev-parse', '--path-format=absolute', '--git-common-dir'])
  return { workspace, repo: commonDir === null ? null : realpathSync(dirname(commonDir)) }
}

const sessionMetaOf = ({ placed }: { placed: FixtureWorkspace }): SessionMeta => ({
  format: SESSION_FORMAT_VERSION,
  id: CLOUD_THREAD,
  title: null,
  createdAt: FIXTURE_AT,
  updatedAt: FIXTURE_AT,
  home: 'host',
  repo: placed.repo,
  workspace: placed.workspace,
  worktree: null,
  pullRequests: null,
  spend: null,
})

export const seedLiftSession = ({
  home,
  placed,
  events,
}: {
  home: string
  placed: FixtureWorkspace
  events: readonly Event[]
}): void => {
  const sessionDir = sessionDirectory({ home, sessionId: CLOUD_THREAD })
  mkdirSync(join(sessionDir, 'threads'), { recursive: true })
  writeFileSync(
    join(sessionDir, 'threads', `${CLOUD_THREAD}.events.jsonl`),
    events.map((event) => `${encodeEventLine({ draft: event, envelope: event })}\n`).join(''),
  )
  writeFileSync(join(sessionDir, SESSION_META_NAME), JSON.stringify(sessionMetaOf({ placed })))
  writeFileSync(
    threadMetaFile({ sessionDir, threadId: CLOUD_THREAD }),
    JSON.stringify({
      ...newThreadMeta({ id: CLOUD_THREAD, at: FIXTURE_AT }),
      head: events.length,
      workspace: placed.workspace,
      repo: placed.repo,
    }),
  )
}
