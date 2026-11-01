import { describe, expect, test } from 'bun:test'

import { EAgentDisplay } from '@dltech/atlas-ui/ai/agent-status'

import { type AppTeammate, EAgentStatus, ESandboxState, TEAMMATES } from '../fixtures/teammates'
import {
  groupTeammates,
  hasAttentionTeammate,
  teammateCountLabel,
  teammateDisplay,
} from '../teammate-display'

function teammateWith(overrides: Partial<AppTeammate>): AppTeammate {
  return {
    id: 'tm-test',
    parentId: 'thr-test',
    title: 'Test teammate',
    run: EAgentStatus.Running,
    sandbox: ESandboxState.Ready,
    branch: 'dennis/test',
    brief: 'Test brief',
    ...overrides,
  }
}

const BY_RUN: readonly [EAgentStatus, EAgentDisplay][] = [
  [EAgentStatus.Running, EAgentDisplay.Running],
  [EAgentStatus.Blocked, EAgentDisplay.NeedsApproval],
  [EAgentStatus.Paused, EAgentDisplay.Paused],
  [EAgentStatus.WaitingForModel, EAgentDisplay.WaitingForModel],
  [EAgentStatus.Failed, EAgentDisplay.Failed],
  [EAgentStatus.Finished, EAgentDisplay.Done],
  [EAgentStatus.Stopped, EAgentDisplay.Done],
]

describe('teammateDisplay', () => {
  test.each(BY_RUN)('run %s with a ready sandbox is %s', (run, expected) => {
    expect(teammateDisplay(teammateWith({ run }))).toBe(expected)
  })

  test.each(Object.values(EAgentStatus))('a booting sandbox wins over run %s', (run) => {
    expect(teammateDisplay(teammateWith({ run, sandbox: ESandboxState.Booting }))).toBe(
      EAgentDisplay.StartingSandbox,
    )
  })

  test('every run status is mapped', () => {
    expect(BY_RUN.map(([run]) => run).sort()).toEqual(Object.values(EAgentStatus).sort())
  })
})

describe('groupTeammates', () => {
  test('puts attention first, keeps order otherwise, and folds done teammates', () => {
    const { live, done } = groupTeammates(TEAMMATES)
    expect(live.map((teammate) => teammate.id)).toEqual([
      'tm-gutter-tokens',
      'tm-typecheck-ai',
      'tm-theme-gen',
      'tm-render-check',
    ])
    expect(done.map((teammate) => teammate.id)).toEqual(['tm-legacy-home', 'tm-stopped-codemod'])
  })
})

describe('hasAttentionTeammate', () => {
  test('is true for a failed or approval-blocked teammate', () => {
    expect(hasAttentionTeammate([teammateWith({ run: EAgentStatus.Failed })])).toBe(true)
    expect(hasAttentionTeammate([teammateWith({ run: EAgentStatus.Blocked })])).toBe(true)
  })

  test('is false for running, paused and done teammates', () => {
    const quiet = [EAgentStatus.Running, EAgentStatus.Paused, EAgentStatus.Finished]
    expect(hasAttentionTeammate(quiet.map((run) => teammateWith({ run })))).toBe(false)
  })
})

describe('teammateCountLabel', () => {
  test('pluralises', () => {
    expect(teammateCountLabel(1)).toBe('1 teammate')
    expect(teammateCountLabel(6)).toBe('6 teammates')
  })
})
