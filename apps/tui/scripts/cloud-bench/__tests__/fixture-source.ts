import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

export const ROOT = 'brn_root'
export const CHILD = 'brn_child'
export const WORKSPACE_SOURCE = '/Users/someone/real-checkout'
export const BINARY = Buffer.from([0, 255, 1, 254, 2, 253, 10, 13])

export const put = (root: string, key: string, content: string | Buffer): void => {
  const file = join(root, key)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, content)
}

export const json = (value: unknown): string => JSON.stringify(value, null, 2)

const threadMeta = (id: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  v: 1,
  id,
  title: null,
  head: 2,
  createdAt: '2026-10-07T10:00:00.000Z',
  updatedAt: '2026-10-07T10:05:00.000Z',
  parentThreadId: null,
  forkSeq: null,
  forkMode: null,
  spawnerThreadId: null,
  agentType: null,
  workspace: WORKSPACE_SOURCE,
  repo: WORKSPACE_SOURCE,
  modelRef: 'openai/gpt-x',
  modelEffort: 'high',
  executionLocation: 'cloud',
  placement: {
    placement: { harness: 'cloud', driveName: 'drive-1' },
    revision: 7,
    move: {
      id: 'move-1',
      from: { harness: 'host', tools: 'host' },
      to: { harness: 'cloud' },
      phase: 'preparing',
    },
  },
  parkedTranscript: { checkpoint: { stale: true }, applied: null },
  futureField: { keep: 'me' },
  ...extra,
})

const eventLine = (fields: Record<string, unknown>): string =>
  JSON.stringify({ v: 1, depth: 0, at: '2026-10-07T10:00:00.000Z', ...fields })

export const PROSE = `the child ${CHILD} reported to ${ROOT}`

const rootEvents = (): string =>
  [
    eventLine({
      id: 'evt_1',
      seq: 1,
      threadId: ROOT,
      runId: 'run_1',
      type: 'user-message',
      body: { type: 'user-message', text: PROSE },
    }),
    eventLine({
      id: 'evt_2',
      seq: 2,
      threadId: ROOT,
      runId: 'run_1',
      type: 'agent-spawned',
      body: { type: 'agent-spawned', agentId: CHILD, nested: [{ parent: ROOT }] },
    }),
  ].join('\n') + '\n'

const childEvents = (): string =>
  eventLine({
    id: 'evt_3',
    seq: 1,
    threadId: CHILD,
    runId: 'run_2',
    parentRunId: 'run_1',
    type: 'assistant-message',
    body: { type: 'assistant-message', text: 'done' },
  }) + '\n'

const ledger = (): string =>
  [ROOT, CHILD]
    .map((threadId, index) =>
      JSON.stringify({
        v: 1,
        runId: `run_${index + 1}`,
        threadId,
        status: 'completed',
        providerId: 'p',
        modelId: 'm',
        steps: 1,
        inputTokens: 1,
        outputTokens: 1,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        startedAt: 'a',
        endedAt: 'b',
        durationMs: 1,
      }),
    )
    .join('\n') + '\n'

export const buildSourceSession = (home: string): string => {
  const session = join(home, 'sessions', ROOT)
  put(
    session,
    'meta.json',
    json({
      format: 1,
      id: ROOT,
      title: 'Big',
      createdAt: 'a',
      updatedAt: 'b',
      home: 'cloud',
      repo: WORKSPACE_SOURCE,
      workspace: WORKSPACE_SOURCE,
      worktree: `${WORKSPACE_SOURCE}/.wt`,
      pullRequests: null,
      spend: null,
      extra: 1,
    }),
  )
  put(session, 'ledger.jsonl', ledger())
  put(session, `threads/${ROOT}.meta.json`, json(threadMeta(ROOT)))
  put(
    session,
    `threads/${CHILD}.meta.json`,
    json(threadMeta(CHILD, { parentThreadId: ROOT, spawnerThreadId: ROOT, agentType: 'worker' })),
  )
  put(session, `threads/${ROOT}.events.jsonl`, rootEvents())
  put(session, `threads/${CHILD}.events.jsonl`, childEvents())
  put(session, `threads/${ROOT}/quality/report.bin`, BINARY)
  put(session, `threads/${CHILD}/notes/${CHILD}.json`, json({ threadId: CHILD, arbitrary: true }))
  put(session, 'context/plan.md', `plan for ${ROOT}\n`)
  put(session, 'images/shot.png', BINARY)
  put(session, 'scratch/data.json', json({ threadId: ROOT }))
  return session
}

export const treeOf = (root: string, prefix = ''): Record<string, string> => {
  const found: Record<string, string> = {}
  for (const name of readdirSync(join(root, prefix))) {
    const key = prefix === '' ? name : `${prefix}/${name}`
    const info = lstatSync(join(root, key))
    if (info.isDirectory()) Object.assign(found, treeOf(root, key))
    else
      found[key] = info.isSymbolicLink() ? 'symlink' : readFileSync(join(root, key)).toString('hex')
  }
  return found
}

const created: string[] = []

export const scratch = (): string => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'cloud-bench-fixture-')))
  created.push(dir)
  return dir
}

export const cleanScratch = (): void => {
  for (const dir of created.splice(0, created.length)) rmSync(dir, { recursive: true, force: true })
}

export const setup = (): {
  sourceHome: string
  source: string
  destinationHome: string
  workspace: string
} => {
  const sourceHome = scratch()
  return {
    sourceHome,
    source: buildSourceSession(sourceHome),
    destinationHome: scratch(),
    workspace: scratch(),
  }
}
