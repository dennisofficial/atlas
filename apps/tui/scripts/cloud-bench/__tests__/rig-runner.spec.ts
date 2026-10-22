import { describe, expect, test } from 'vitest'

import { EVerdict, ScenarioFailed, type ScenarioEvidence } from '../rig-evidence'
import { EvidencedScenarioFailed } from '../rig-park-wait'
import {
  DEFAULT_REPO,
  combinedTrust,
  exitCodeOf,
  failedEvidence,
  notRunEvidence,
  notRunReasonOf,
  parseRigArgs,
  renderSummary,
  scenarioIdsOf,
  withTrust,
} from '../rig-runner'

const env = { ATLAS_CONTEXT_DIR: '/ctx' }
const head = { id: 2, slug: 'idle-park', title: 'Idle park' }
const tails = [{ label: 'serve log tail at failure', text: 'serve.started' }]

const passed = (id: number): ScenarioEvidence => ({
  id,
  slug: 's',
  title: 't',
  commands: ['c'],
  observations: [],
  logs: [],
  verdict: EVerdict.Pass,
})

describe('parseRigArgs', () => {
  test('defaults: scenarios 1-5 plus 6, out under the context dir, the octocat repo', () => {
    const parsed = parseRigArgs({ argv: [], env })
    expect(parsed).toEqual({
      ok: true,
      args: {
        scenarios: [1, 2, 3, 4, 5, 6],
        out: '/ctx/evidence/live-rig',
        repo: DEFAULT_REPO,
        keep: false,
        cleanup: false,
        mismatch: undefined,
      },
    })
  })

  test('reads every flag', () => {
    const parsed = parseRigArgs({
      argv: [
        '--scenarios=3,1',
        '--out=/tmp/ev',
        '--repo=https://github.com/a/b',
        '--keep',
        '--cleanup',
        '--mismatch=forge-stamp',
      ],
      env: {},
    })
    expect(parsed).toEqual({
      ok: true,
      args: {
        scenarios: [1, 3, 6],
        out: '/tmp/ev',
        repo: 'https://github.com/a/b',
        keep: true,
        cleanup: true,
        mismatch: 'forge-stamp',
      },
    })
  })

  test('refuses unknown ids, unknown flags, non-https repos and a missing out', () => {
    expect(parseRigArgs({ argv: ['--scenarios=1,9'], env })).toMatchObject({
      ok: false,
      error: expect.stringContaining('9'),
    })
    expect(parseRigArgs({ argv: ['--scenarios='], env })).toMatchObject({ ok: false })
    expect(parseRigArgs({ argv: ['--fast'], env })).toMatchObject({
      ok: false,
      error: 'unknown argument: --fast',
    })
    expect(parseRigArgs({ argv: ['--repo=/tmp/bare.git'], env })).toMatchObject({ ok: false })
    expect(parseRigArgs({ argv: [], env: {} })).toMatchObject({
      ok: false,
      error: expect.stringContaining('--out'),
    })
  })
})

describe('scenarioIdsOf', () => {
  test('pulls in scenario 1 for any thread-dependent scenario and always adds 6', () => {
    expect(scenarioIdsOf([4])).toEqual([1, 4, 6])
    expect(scenarioIdsOf([6])).toEqual([6])
    expect(scenarioIdsOf([1])).toEqual([1, 6])
  })
})

describe('notRunReasonOf', () => {
  test('runs everything once scenario 1 passed', () => {
    const verdicts = new Map([[1, EVerdict.Pass]])
    for (const id of [2, 3, 4, 5]) expect(notRunReasonOf({ id, verdicts })).toBeNull()
  })

  test('marks 2-5 NOT RUN when scenario 1 failed or never ran', () => {
    expect(notRunReasonOf({ id: 3, verdicts: new Map([[1, EVerdict.Fail]]) })).toBe(
      'depends on scenario 1, which ended FAIL',
    )
    expect(notRunReasonOf({ id: 5, verdicts: new Map() })).toBe(
      'depends on scenario 1, which did not run',
    )
  })

  test('scenario 3 does not depend on 2, and 1 and 6 depend on nothing', () => {
    const verdicts = new Map([
      [1, EVerdict.Pass],
      [2, EVerdict.Fail],
    ])
    expect(notRunReasonOf({ id: 3, verdicts })).toBeNull()
    expect(notRunReasonOf({ id: 1, verdicts: new Map() })).toBeNull()
    expect(notRunReasonOf({ id: 6, verdicts: new Map() })).toBeNull()
  })

  test('notRunEvidence carries the reason', () => {
    expect(notRunEvidence({ scenario: head, reason: 'r' })).toMatchObject({
      ...head,
      verdict: EVerdict.NotRun,
      reason: 'r',
    })
  })
})

describe('failedEvidence', () => {
  test('a ScenarioFailed becomes FAIL with its failure and the tails', () => {
    const failure = { step: 'park', expected: 'parked', observed: 'serving' }
    const evidence = failedEvidence({ scenario: head, error: new ScenarioFailed(failure), tails })
    expect(evidence).toMatchObject({ ...head, verdict: EVerdict.Fail, failure, logs: tails })
  })

  test('any other throw becomes FAIL at step "unexpected error" with the message', () => {
    const evidence = failedEvidence({ scenario: head, error: new Error('socket hang up'), tails })
    expect(evidence.failure).toEqual({
      step: 'unexpected error',
      expected: 'the scenario to run to a verdict',
      observed: 'socket hang up',
    })
  })

  test('an EvidencedScenarioFailed keeps its own evidence and appends the tails', () => {
    const failure = { step: 'wake', expected: 'connected', observed: 'waking' }
    const base: ScenarioEvidence = {
      ...head,
      commands: ['submit'],
      observations: [
        { at: 'a', step: 's', view: 'waking', phase: null, stamps: null, provider: 'running' },
      ],
      logs: [{ label: 'view timeline', text: 'parked → waking' }],
      verdict: EVerdict.Fail,
      failure,
    }
    const evidence = failedEvidence({
      scenario: head,
      error: new EvidencedScenarioFailed({ failure, evidence: base }),
      tails,
    })
    expect(evidence.commands).toEqual(['submit'])
    expect(evidence.observations).toEqual(base.observations)
    expect(evidence.logs).toEqual([...base.logs, ...tails])
    expect(evidence.failure).toEqual(failure)
  })
})

describe('trust', () => {
  test('needs both the box stamps and the Ready protocol', () => {
    expect(combinedTrust({ version: 'dev-abc', boxProtocol: 25, readyProtocol: 25 }).trusted).toBe(
      true,
    )
    expect(combinedTrust({ version: '0.40.1', boxProtocol: 25, readyProtocol: 25 })).toMatchObject({
      trusted: false,
      reason: expect.stringContaining('box stamps'),
    })
    expect(combinedTrust({ version: 'dev-abc', boxProtocol: 25, readyProtocol: 24 })).toMatchObject(
      {
        trusted: false,
        reason: expect.stringContaining('Ready'),
      },
    )
    expect(
      combinedTrust({ version: 'dev-abc', boxProtocol: 25, readyProtocol: null }).trusted,
    ).toBe(false)
  })

  test('withTrust downgrades PASS and FAIL to UNTRUSTED but leaves NOT RUN', () => {
    const trust = { trusted: false, reason: 'released serve' }
    const downgraded = withTrust({ evidence: passed(1), trust })
    expect(downgraded.verdict).toBe(EVerdict.Untrusted)
    expect(downgraded.reason).toContain('untrusted: released serve')
    expect(downgraded.reason).toContain('underlying verdict: PASS')
    expect(withTrust({ evidence: { ...passed(2), verdict: EVerdict.Fail }, trust }).verdict).toBe(
      EVerdict.Untrusted,
    )
    expect(
      withTrust({ evidence: notRunEvidence({ scenario: head, reason: 'r' }), trust }).verdict,
    ).toBe(EVerdict.NotRun)
    expect(withTrust({ evidence: passed(1), trust: { trusted: true, reason: 'ok' } }).verdict).toBe(
      EVerdict.Pass,
    )
  })
})

describe('summary', () => {
  const results = [
    {
      id: 1,
      slug: 'fresh',
      title: 'Fresh',
      verdict: EVerdict.Pass,
      path: '/o/scenario-1-fresh.md',
    },
    {
      id: 6,
      slug: 'api-wake',
      title: 'API wake',
      verdict: EVerdict.NotRun,
      path: '/o/scenario-6-api-wake.md',
    },
  ]

  test('exits 0 only when every verdict is PASS or NOT RUN', () => {
    expect(exitCodeOf(results)).toBe(0)
    expect(exitCodeOf([...results, { ...head, verdict: EVerdict.Untrusted, path: null }])).toBe(1)
  })

  test('lists verdicts and the sandboxes created and destroyed', () => {
    const text = renderSummary({
      startedAt: 's',
      finishedAt: 'f',
      threadId: 'thr_1',
      trust: { trusted: true, reason: 'dev-abc on 25' },
      results,
      created: ['atlas-thread-abc'],
      destroyed: ['atlas-thread-abc'],
      destroyFailures: [],
      kept: false,
      interruptedBy: null,
    })
    expect(text).toContain('| 1 | Fresh | PASS | /o/scenario-1-fresh.md |')
    expect(text).toContain('- created: `atlas-thread-abc`')
    expect(text).toContain('- destroyed: `atlas-thread-abc`')
    expect(text).not.toContain('interrupted')
  })

  test('says when the sandboxes were kept and when a signal interrupted the run', () => {
    const text = renderSummary({
      startedAt: 's',
      finishedAt: 'f',
      threadId: null,
      trust: { trusted: false, reason: 'never ran' },
      results: [],
      created: [],
      destroyed: [],
      destroyFailures: [],
      kept: true,
      interruptedBy: 'SIGINT',
    })
    expect(text).toContain('(kept: --keep)')
    expect(text).toContain('- interrupted by SIGINT')
    expect(text).toContain('(never born)')
  })
})
