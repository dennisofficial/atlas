import { describe, expect, it } from 'bun:test'

import {
  EGithubPollStatus,
  githubDeviceCodesSchema,
  githubPollResultSchema,
} from '../device-connect'
import { EGithubPrStreamFrame, githubPrStreamFrameSchema } from '../pr-stream'
import {
  ERepoTracking,
  ERepoTreeEntryKind,
  githubRepoSummarySchema,
  projectRepoTreeSchema,
} from '../repo-vocabulary'

const valuesOf = (values: Record<string, string>): string[] => Object.values(values)

const prState = {
  repoFullName: 'octocat/hello',
  prNumber: 7,
  title: 'fix',
  url: 'https://github.com/octocat/hello/pull/7',
  state: 'open',
  headBranch: 'dennis/fix',
  headSha: 'abc',
  checksRunning: 0,
  checksPassed: 3,
  checksFailed: 0,
  mergeable: null,
  version: 4,
  updatedAt: '2026-11-26T10:00:00.000Z',
}

describe('github vocabulary', () => {
  it('keeps the stored and sent enum values', () => {
    expect(valuesOf(ERepoTracking)).toEqual(['app', 'user', 'polled'])
    expect(valuesOf(ERepoTreeEntryKind)).toEqual(['file', 'folder'])
    expect(valuesOf(EGithubPrStreamFrame)).toEqual(['pr-state', 'pr-event', 'heartbeat'])
    expect(valuesOf(EGithubPollStatus)).toEqual([
      'pending',
      'slow-down',
      'denied',
      'expired',
      'missing-scopes',
      'connected',
    ])
  })

  it('validates a repo summary name and default branch', () => {
    const summary = {
      fullName: 'octocat/hello',
      isPrivate: false,
      defaultBranch: 'main',
      pushedAt: null,
    }
    expect(githubRepoSummarySchema.safeParse(summary).success).toBe(true)
    expect(githubRepoSummarySchema.safeParse({ ...summary, fullName: 'o/..' }).success).toBe(false)
    expect(githubRepoSummarySchema.safeParse({ ...summary, defaultBranch: '-x' }).success).toBe(
      false,
    )
  })

  it('accepts only known tree entry kinds', () => {
    const tree = { entries: [{ path: 'src', kind: 'folder' }], truncated: false }
    expect(projectRepoTreeSchema.safeParse(tree).success).toBe(true)
    expect(
      projectRepoTreeSchema.safeParse({ ...tree, entries: [{ path: 'x', kind: 'link' }] }).success,
    ).toBe(false)
  })

  it('carries missing scopes and the connected login in poll results', () => {
    expect(
      githubPollResultSchema.safeParse({ status: 'missing-scopes', missing: ['repo'] }).success,
    ).toBe(true)
    expect(githubPollResultSchema.safeParse({ status: 'missing-scopes' }).success).toBe(false)
    expect(githubPollResultSchema.safeParse({ status: 'connected', login: 'o' }).success).toBe(
      false,
    )
    expect(
      githubDeviceCodesSchema.safeParse({
        deviceCode: 'd',
        userCode: 'u',
        verificationUrl: 'https://github.com/login/device',
        expiresInMs: 900_000,
        intervalMs: 5_000,
      }).success,
    ).toBe(true)
  })

  it('parses each pr stream frame and rejects a fractional pr number', () => {
    expect(githubPrStreamFrameSchema.safeParse({ type: 'pr-state', state: prState }).success).toBe(
      true,
    )
    expect(githubPrStreamFrameSchema.safeParse({ type: 'heartbeat' }).success).toBe(true)
    const event = {
      id: 'e1',
      repoFullName: 'octocat/hello',
      prNumber: 7,
      kind: 'comment',
      payload: { body: 'hi' },
      createdAt: '2026-11-26T10:00:00.000Z',
    }
    expect(githubPrStreamFrameSchema.safeParse({ type: 'pr-event', event }).success).toBe(true)
    expect(
      githubPrStreamFrameSchema.safeParse({
        type: 'pr-state',
        state: { ...prState, prNumber: 7.5 },
      }).success,
    ).toBe(false)
  })
})
