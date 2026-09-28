import { copyFile, mkdtemp, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import React from 'react'

import { testRender } from '@opentui/react/test-utils'

import { ModelPort, toThreadId } from '@dltech/atlas-core'
import {
  composeHarness,
  portToken,
  runGit,
  type CloudBridge,
  type SettingsBinding,
} from '@dltech/atlas-harness'

import { teardown } from '../../ui/markdown/__tests__/harness'
import { tldrFeed } from '../../ui/tldr-feed-store'
import { App } from '../app'
import { captureWorkspace } from '../cloud/workspace-snapshot'
import type { AtlasApp } from '../compose'
import { EOpenMode } from '../config'
import { noticePortBinding } from '../notice-binding'
import type { ContributedSurface, PluginSurface } from '../../plugins/surface'
import type { MoveStepTiming } from '../use-container-move'
import type { OpenedConversation } from '../open-conversation'
import { scriptedModelPort } from './fake-app'

export const LOCAL_EDIT = 'local edit before the lift'
export const REMOTE_EDIT = 'remote edit made in the sandbox'
export const FILE = 'roundtrip.txt'

const THINKING = 'Reading the transcript off the event log.'
const REPLY = 'The transcript is the one record.'

export const git = (args: readonly string[], cwd: string) => runGit({ args, cwd })

export type Scratch = { dir: string; remote: string }

/**
 * A local bare repo stands in for origin: the lift's capture reads the remote URL off it, and the
 * descend's publish pushes to it over the filesystem, so the merge home fetches for real without
 * touching the network.
 */
export async function scratchRepo(): Promise<Scratch> {
  const remote = await mkdtemp(join(tmpdir(), 'atlas-roundtrip-remote-'))
  await git(['init', '--bare', '--initial-branch=main'], remote)

  const dir = await mkdtemp(join(tmpdir(), 'atlas-roundtrip-repo-'))
  await git(['init', '--initial-branch=main'], dir)
  await git(['config', 'user.name', 'Atlas Roundtrip'], dir)
  await git(['config', 'user.email', 'roundtrip@atlas.dev'], dir)
  await writeFile(join(dir, FILE), 'base contents\n')
  await git(['add', '-A'], dir)
  await git(['commit', '-m', 'base'], dir)
  await git(['remote', 'add', 'origin', remote], dir)
  await git(['push', '-u', 'origin', 'main'], dir)
  await writeFile(join(dir, FILE), `base contents\n${LOCAL_EDIT}\n`)
  return { dir, remote }
}

export type Home = { dir: string }

const REAL_HOME_FILES = ['cloud.json', 'key', 'secrets.json', 'settings.json'] as const

export async function throwawayHome(): Promise<Home> {
  const dir = await mkdtemp(join(tmpdir(), 'atlas-roundtrip-home-'))
  const real = join(homedir(), '.atlas')
  for (const name of REAL_HOME_FILES) {
    await copyFile(join(real, name), join(dir, name)).catch(() => undefined)
  }
  return { dir }
}

export type Mounted = Awaited<ReturnType<typeof mountLive>>

export async function mountLive(args: {
  scratch: Scratch
  bridge: CloudBridge
  timings: MoveStepTiming[]
  settings: SettingsBinding
}) {
  const command = 'atlas-roundtrip-live'
  const harness = await composeHarness<undefined, never, PluginSurface>({
    launch: {
      cwd: args.scratch.dir,
      command,
      model: undefined,
      executionLocation: undefined,
    },
    env: process.env,
    settings: args.settings,
    clientVersion: command,
    surface: { notice: noticePortBinding(), tldrFeed },
    bindPorts: ({ container }) => {
      container.register(portToken(ModelPort), {
        useValue: scriptedModelPort({ script: { thinking: THINKING, reply: REPLY } }),
      })
    },
  })

  const surfaces: readonly ContributedSurface[] = harness.pluginSurfaces
  const app: AtlasApp = {
    ...harness,
    pluginProjections: harness.pluginProjections,
    pluginSurfaces: surfaces,
    pullRequests: null,
    config: {
      model: undefined,
      executionLocation: undefined,
      open: { mode: EOpenMode.New },
      cwd: args.scratch.dir,
    },
    command,
  }

  const opened: OpenedConversation = {
    threadId: toThreadId(`roundtrip-${Date.now()}`),
    events: [],
    turns: [],
    name: null,
    started: false,
  }

  const setup = await testRender(
    <App
      app={app}
      opened={opened}
      createBridge={() => args.bridge}
      preflightLift={async () => null}
      captureWorkspace={captureWorkspace}
      onMoveStep={(timing) => args.timings.push(timing)}
    />,
    { width: 140, height: 40, exitOnCtrlC: false },
  )

  return {
    app,
    setup,
    threadId: opened.threadId,
    reply: REPLY,
    typeText: (text: string) => setup.mockInput.typeText(text),
    pressEnter: () => setup.mockInput.pressEnter(),
    done: async () => {
      await teardown(setup)
      await app.close()
    },
  }
}
