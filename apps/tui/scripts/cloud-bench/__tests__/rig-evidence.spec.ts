import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  createRedactor,
  EVerdict,
  renderEvidence,
  sawInOrder,
  type ScenarioEvidence,
  ScenarioFailed,
  trustOf,
  writeEvidence,
} from '../rig-evidence'

const failingEvidence = (): ScenarioEvidence => ({
  id: 2,
  slug: 'idle-park',
  title: 'Idle park',
  commands: ['wait for the idle park', 'probe the box'],
  observations: [
    {
      at: '2026-10-17T12:00:00.000Z',
      step: 'idle park',
      view: 'connected',
      phase: 'serving',
      stamps: 'dev-abc/25',
      provider: 'running',
    },
    {
      at: '2026-10-17T12:08:00.000Z',
      step: 'idle park',
      view: null,
      phase: null,
      stamps: null,
      provider: null,
    },
  ],
  logs: [
    {
      label: 'serve log',
      text: 'boot on team_abc123 with Authorization: Bearer tok.en-value\nready',
    },
  ],
  verdict: EVerdict.Fail,
  failure: { step: 'idle park', expected: 'record parked', observed: 'record serving' },
  reason: 'the box never parked',
})

describe('createRedactor', () => {
  test('strips a held secret of eight or more characters', () => {
    const redactor = createRedactor()
    redactor.hold('super-secret-token')
    expect(redactor.redact('token=super-secret-token;')).toBe('token=<redacted>;')
  })

  test('ignores held secrets shorter than eight characters', () => {
    const redactor = createRedactor()
    redactor.hold('short')
    expect(redactor.redact('a short line')).toBe('a short line')
  })

  test('always strips team_ and prj_ identifiers', () => {
    const redactor = createRedactor()
    expect(redactor.redact('team_AbC123 / prj_XyZ789')).toBe('team_<redacted> / prj_<redacted>')
  })

  test('strips bearer credentials', () => {
    const redactor = createRedactor()
    const redacted = redactor.redact('Authorization: Bearer eyJhbGc.payload.sig and bearer.abc123')
    expect(redacted).not.toContain('eyJhbGc')
    expect(redacted).not.toContain('abc123')
    expect(redacted).toContain('<redacted>')
  })
})

describe('renderEvidence', () => {
  test('carries the verdict, the failure and a redacted log', () => {
    const redactor = createRedactor()
    redactor.hold('tok.en-value')
    const markdown = renderEvidence({ evidence: failingEvidence(), redact: redactor.redact })

    expect(markdown).toContain('# Scenario 2 — Idle park')
    expect(markdown).toContain('Verdict: **FAIL**')
    expect(markdown).toContain('the box never parked')
    expect(markdown).toContain('- failing step: idle park')
    expect(markdown).toContain('- expected: record parked')
    expect(markdown).toContain('- observed: record serving')
    expect(markdown).toContain('1. wait for the idle park\n2. probe the box')
    expect(markdown).toContain('| at | step | view | record phase | stamps | provider | note |')
    expect(markdown).toContain('```text\nboot on team_<redacted>')
    expect(markdown).not.toContain('team_abc123')
    expect(markdown).not.toContain('tok.en-value')
  })

  test('orders reason, failure, commands, observations and logs', () => {
    const markdown = renderEvidence({ evidence: failingEvidence(), redact: (text) => text })
    const order = [
      'Verdict:',
      '## Reason',
      '## Failure',
      '## Commands',
      '## Observations',
      '## serve log',
    ]
    const positions = order.map((heading) => markdown.indexOf(heading))
    expect(positions.every((position) => position >= 0)).toBe(true)
    expect([...positions].sort((left, right) => left - right)).toEqual(positions)
  })
})

describe('writeEvidence', () => {
  let dir: string | null = null

  afterEach(async () => {
    if (dir !== null) await rm(dir, { recursive: true, force: true })
    dir = null
  })

  test('writes scenario-<id>-<slug>.md into a created dir', async () => {
    dir = await mkdtemp(join(tmpdir(), 'rig-evidence-'))
    const target = join(dir, 'nested', 'out')
    const path = await writeEvidence({
      dir: target,
      evidence: failingEvidence(),
      redactor: createRedactor(),
    })

    expect(path).toBe(join(target, 'scenario-2-idle-park.md'))
    expect(await readFile(path, 'utf8')).toContain('Verdict: **FAIL**')
  })
})

describe('trustOf', () => {
  test('trusts a dev- build on protocol 25', () => {
    expect(trustOf({ version: 'dev-abc', protocol: 25 }).trusted).toBe(true)
  })

  test('does not trust a released build', () => {
    expect(trustOf({ version: '1.70.0', protocol: 25 }).trusted).toBe(false)
  })

  test('does not trust another protocol', () => {
    expect(trustOf({ version: 'dev-x', protocol: 24 }).trusted).toBe(false)
  })

  test('does not trust unread stamps', () => {
    expect(trustOf({ version: null, protocol: null }).trusted).toBe(false)
    expect(trustOf({ version: 'dev-abc', protocol: null }).trusted).toBe(false)
    expect(trustOf({ version: null, protocol: 25 }).trusted).toBe(false)
  })
})

describe('sawInOrder', () => {
  const timeline = ['parked', 'waking', 'reconnecting', 'connected']

  test('finds the states as a subsequence', () => {
    expect(sawInOrder({ timeline, states: ['waking', 'connected'] })).toBe(true)
  })

  test('rejects the states out of order', () => {
    expect(sawInOrder({ timeline, states: ['connected', 'waking'] })).toBe(false)
  })

  test('rejects a state the timeline never held', () => {
    expect(sawInOrder({ timeline, states: ['waking', 'disconnected'] })).toBe(false)
  })
})

describe('ScenarioFailed', () => {
  test('carries its failure', () => {
    const failure = { step: 'wake', expected: 'connected', observed: 'disconnected' }
    const error = new ScenarioFailed(failure)
    expect(error).toBeInstanceOf(Error)
    expect(error.failure).toEqual(failure)
    expect(error.message).toContain('expected connected')
  })
})
