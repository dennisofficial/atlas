import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { ESettingId } from '@dltech/atlas-core'
import { CloudClient } from '@dltech/atlas-harness'
import { EShipBehavior, type Project } from '@dltech/atlas-wire'
import { testRender } from '@opentui/react/test-utils'
import React from 'react'

import { settle, teardown } from '../../ui/markdown/__tests__/harness'
import { App } from '../app'
import { fakeBridge, type FakeBridge } from '../cloud/__tests__/fixture'
import { unstartedConversation } from '../open-conversation'
import { editorIn, promiseGate, until } from './app-fixture'
import { fakeApp, fakeCloud, fakeSignedOutCloud, scriptedModelPort, type FakeApp } from './fake-app'

export const ACME_ORIGIN = 'https://github.com/acme/widgets.git'

export const projectOf = (args: {
  id: string
  name?: string
  repo: string | null
  updatedAt?: string
}): Project => ({
  id: args.id,
  name: args.name ?? args.id,
  repo: args.repo,
  baseBranch: null,
  additionalRepos: [],
  description: '',
  shipBehavior: EShipBehavior.OpenPullRequest,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: args.updatedAt ?? '2026-01-01T00:00:00.000Z',
})

export type CreatedProject = {
  name: string
  repo: string | null
  baseBranch: string | null
  additionalRepos: unknown[]
}

export type FakeProjectsApi = { client: CloudClient; created: CreatedProject[] }

export const fakeProjectsApi = (
  args: {
    projects?: readonly Project[]
    listFails?: boolean
    createFails?: boolean
    listGate?: Promise<void>
  } = {},
): FakeProjectsApi => {
  const projects = args.projects ?? [
    projectOf({ id: 'proj-acme', name: 'widgets', repo: 'acme/widgets' }),
  ]
  const created: CreatedProject[] = []
  const fetchFn = (async (_url: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      if (args.createFails === true)
        return Response.json({ message: 'projects are read-only' }, { status: 400 })
      const body = JSON.parse(String(init.body)) as CreatedProject
      created.push(body)
      return Response.json(projectOf({ id: 'proj-new', name: body.name, repo: body.repo }))
    }
    await args.listGate
    if (args.listFails === true)
      return Response.json({ message: 'projects are down' }, { status: 400 })
    return Response.json(projects)
  }) as unknown as typeof fetch
  return { client: new CloudClient({ url: 'https://cloud.test', token: 'test', fetchFn }), created }
}

export const launchDirWith = (origin: string | null): string => {
  const dir = mkdtempSync(join(tmpdir(), 'atlas-born-thread-spec-'))
  if (origin === null) return dir
  const git = (...gitArgs: string[]): void =>
    void execFileSync('git', gitArgs, { cwd: dir, stdio: 'ignore' })
  git('init', '-q')
  git('remote', 'add', 'origin', origin)
  git('symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main')
  return dir
}

export const bornThreadApp = (args: {
  vercel?: boolean
  signedOut?: boolean
  shape?: 'chip' | 'hero'
  origin?: string | null
  api?: FakeProjectsApi
}): FakeApp => {
  const client = (args.api ?? fakeProjectsApi()).client
  return fakeApp({
    pods: true,
    model: scriptedModelPort({ script: { thinking: 'weighing it', reply: 'done' } }),
    cwd: launchDirWith(args.origin === undefined ? ACME_ORIGIN : args.origin),
    cloud: args.signedOut === true ? fakeSignedOutCloud({ client }) : fakeCloud({ client }),
    ...(args.vercel === true ? { secrets: { [ESettingId.VercelToken]: 'vercel-token' } } : {}),
    settings: {
      values: {
        [ESettingId.Accent]: 'clay',
        ...(args.vercel === true
          ? { [ESettingId.VercelTeamId]: 'team_1', [ESettingId.VercelProjectId]: 'prj_1' }
          : {}),
        ...(args.shape === undefined ? {} : { [ESettingId.PlacementChooserShape]: args.shape }),
      },
    },
  })
}

export const holdingProvisioning = (bridge: FakeBridge): { release: () => void } => {
  const held = promiseGate()
  const create = bridge.sandboxes.create
  bridge.sandboxes.create = async (given) => {
    await held.gate
    return create(given)
  }
  return { release: held.release }
}

export async function mountUnborn(args: {
  app: FakeApp
  bridge?: FakeBridge
  preflight?: { refusal: string | null; gate?: Promise<void> | undefined }
}) {
  const bridge = args.bridge ?? fakeBridge()
  const preflight = args.preflight ?? { refusal: null }
  const previousHome = process.env.ATLAS_HOME
  process.env.ATLAS_HOME = mkdtempSync(join(tmpdir(), 'atlas-born-thread-home-'))
  const setup = await testRender(
    <App
      app={args.app}
      opened={unstartedConversation({ ids: args.app.ids })}
      createBridge={() => bridge}
      preflightBirth={async () => {
        await preflight.gate
        return preflight.refusal
      }}
    />,
    { width: 140, height: 40, exitOnCtrlC: false },
  )
  const frame = async (): Promise<string> => {
    await setup.flush()
    await settle(250)
    await setup.flush()
    return setup.captureCharFrame()
  }
  const command = async (text: string): Promise<string> => {
    await setup.mockInput.typeText(text)
    setup.mockInput.pressEnter()
    return frame()
  }
  return {
    bridge,
    preflight,
    frame,
    command,
    input: setup.mockInput,
    mouse: setup.mockMouse,
    paintedLines: () => setup.captureSpans(),
    draft: () => editorIn(setup.renderer.root)?.plainText ?? null,
    dismiss: () => setup.mockInput.pressEscape(),
    frameHolds: (holds: (shown: string) => boolean): Promise<boolean> =>
      until({ holds: async () => holds(await frame()), within: 20_000 }),
    flipChip: async (): Promise<void> => {
      setup.mockInput.pressArrow('down')
      await frame()
      setup.mockInput.pressEnter()
      await frame()
      setup.mockInput.pressArrow('up')
      await frame()
    },
    done: async () => {
      await teardown(setup)
      if (previousHome === undefined) delete process.env.ATLAS_HOME
      else process.env.ATLAS_HOME = previousHome
    },
  }
}

export type MountedUnborn = Awaited<ReturnType<typeof mountUnborn>>
