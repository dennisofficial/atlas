import { mkdir, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { writeFileAtomic } from '../src/atomic'
import { sha256Hex } from '../src/hash'
import type { CapturedExample } from '../src/curation/inventory'

export type CaptureFixture = { threadId: string; captureId: string; json: unknown }

export type CaptureOverrides = Partial<Omit<CapturedExample, 'change' | 'digests'>>

export const smallSyntheticScopeText = (): string =>
  [
    'export class Counter {',
    '  private total = 0',
    '',
    '  add(amount: number): number {',
    '    this.total += amount',
    '    return this.total',
    '  }',
    '}',
    '',
  ].join('\n')

export const secretBearingScopeText = (): string =>
  [
    'export const client = {',
    '  apiKey: "sk-live-abcdef123456",',
    '  cache: "/Users/someone/project/.cache",',
    '}',
    '',
  ].join('\n')

export function buildCaptureJson({
  path,
  before,
  after,
  ...overrides
}: {
  path: string
  before: string | null
  after: string
} & CaptureOverrides): CapturedExample {
  const captureId = overrides.captureId ?? `capture-${sha256Hex({ text: `${path}\0${before ?? ''}\0${after}` }).slice(0, 12)}`
  return {
    schemaVersion: 1,
    captureId,
    threadId: overrides.threadId ?? 'thread-1',
    runId: overrides.runId ?? 'run-1',
    callId: overrides.callId ?? 'call-1',
    capturedAt: overrides.capturedAt ?? '2026-10-01T00:00:00.000Z',
    adapterVersion: overrides.adapterVersion ?? 'ts-adapter@1',
    change: { path, before, after },
    digests: {
      beforeSha256: before === null ? null : sha256Hex({ text: before }),
      afterSha256: sha256Hex({ text: after }),
    },
  }
}

export const makeTmpDir = (): Promise<string> => mkdtemp(join(tmpdir(), 'atlas-curation-'))

export async function makeExampleDir({ tmp, captures }: { tmp: string; captures: readonly CaptureFixture[] }): Promise<string> {
  await mkdir(tmp, { recursive: true })
  for (const capture of captures) {
    const path = join(tmp, 'threads', capture.threadId, 'quality', 'examples', `${capture.captureId}.json`)
    await writeFileAtomic({ path, content: `${JSON.stringify(capture.json, null, 2)}\n` })
  }
  return tmp
}

export const captureFixture = ({ example }: { example: CapturedExample }): CaptureFixture => ({
  threadId: example.threadId,
  captureId: example.captureId,
  json: example,
})
