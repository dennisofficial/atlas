import { afterEach, describe, expect, it } from 'bun:test'

import { ERunner, ESettingId } from '@dltech/atlas-core'
import type { ThreadId } from '@dltech/atlas-core'

import { currentNotices, dismissNotice } from '../../../ui/notice-store'
import {
  fakeApp,
  fakeSignedOutCloud,
  scriptedModelPort,
  type FakeApp,
} from '../../__tests__/fake-app'
import { bornWith, preferredRunner, rememberPlacement } from '../born-cloud'
import { bornPlacementChip } from '../born-placement-chip'

afterEach(() => dismissNotice())

const appOn = (args: { signedIn: boolean; vercel: boolean }): FakeApp =>
  fakeApp({
    model: scriptedModelPort({ script: { thinking: '', reply: 'ok' } }),
    ...(args.signedIn ? {} : { cloud: fakeSignedOutCloud() }),
    ...(args.vercel ? { secrets: { [ESettingId.VercelToken]: 'vercel-token' } } : {}),
    settings: {
      values: args.vercel
        ? { [ESettingId.VercelTeamId]: 'team_1', [ESettingId.VercelProjectId]: 'prj_1' }
        : {},
    },
  })

const rig = (args: { app: FakeApp; choice?: ERunner; preflight?: string | null }) => {
  const calls = {
    births: [] as { threadId: ThreadId; runner: ERunner; projectId: string | null }[],
    signIns: 0,
  }
  const threadId = args.app.ids.nextThreadId()
  const run = bornWith({
    app: args.app,
    threadId,
    ...(args.choice === undefined ? {} : { choice: args.choice }),
    ...(args.preflight === undefined ? {} : { preflightBirth: async () => args.preflight ?? null }),
    requireSignIn: () => {
      calls.signIns += 1
    },
    resolveProject: async () => ({ projectId: null }),
    birthCloud: (born) => calls.births.push(born),
  })
  return { calls, run, threadId }
}

const noticeKeys = (): string[] => currentNotices().map((notice) => notice.key)

describe('where a thread is born on its first send', () => {
  it('births on the remembered runner when no choice is passed', async () => {
    const app = appOn({ signedIn: true, vercel: true })
    rememberPlacement({ app, runner: ERunner.Vercel })
    const { calls, run, threadId } = rig({ app })

    await run

    expect(preferredRunner(app)).toBe(ERunner.Vercel)
    expect(calls.births).toEqual([{ threadId, runner: ERunner.Vercel, projectId: null }])
  })

  for (const choice of [undefined, ERunner.Local, ERunner.Vercel]) {
    it(`refuses every birth while signed out (${choice ?? 'default'}) and opens the cloud sign-in`, async () => {
      const app = appOn({ signedIn: false, vercel: true })
      const { calls, run, threadId } = rig({ app, ...(choice === undefined ? {} : { choice }) })

      await run

      expect(calls.signIns).toBe(1)
      expect(calls.births).toEqual([])
      expect(bornPlacementChip(app).snapshot()).toBeNull()
      expect(noticeKeys()).toEqual(['born-sign-in'])
      expect(currentNotices()[0]?.text).toContain('sign in to Atlas Cloud')
      expect(threadId).toBeDefined()
    })
  }

  it('births into a local pod by default', async () => {
    const app = appOn({ signedIn: true, vercel: false })
    const { calls, run, threadId } = rig({ app })

    await run

    expect(calls.births).toEqual([{ threadId, runner: ERunner.Local, projectId: null }])
    expect(calls.signIns).toBe(0)
    expect(bornPlacementChip(app).snapshot()).toMatchObject({
      threadId,
      runner: ERunner.Local,
      provisioning: true,
    })
  })

  it('births on Vercel when that is chosen and configured', async () => {
    const app = appOn({ signedIn: true, vercel: true })
    const { calls, run, threadId } = rig({ app, choice: ERunner.Vercel })

    await run

    expect(calls.births).toEqual([{ threadId, runner: ERunner.Vercel, projectId: null }])
    expect(bornPlacementChip(app).snapshot()?.runner).toBe(ERunner.Vercel)
  })

  it('shows the not-configured notice and births nothing when Vercel has no credential', async () => {
    const app = appOn({ signedIn: true, vercel: false })
    const { calls, run } = rig({ app, choice: ERunner.Vercel })

    await run

    expect(calls.births).toEqual([])
    expect(noticeKeys()).toEqual(['born-cloud-preflight'])
    expect(currentNotices()[0]?.text).toContain('not set up')
  })

  it('names Docker Desktop and births nothing when the pod preflight refuses', async () => {
    const app = appOn({ signedIn: true, vercel: false })
    const refusal =
      "Docker isn't answering at /x (nope) — start Docker Desktop, or point ATLAS_DOCKER_SOCKET at a running engine"
    const { calls, run } = rig({ app, preflight: refusal })

    await run

    expect(calls.births).toEqual([])
    expect(currentNotices()[0]?.text).toContain('Docker Desktop')
  })
})
