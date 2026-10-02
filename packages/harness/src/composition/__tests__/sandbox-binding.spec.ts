import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { ATLAS_SETTINGS, EExecutionLocation } from '@dltech/atlas-core'
import {
  createHarnessContainer,
  createSettingsService,
  DockerEngine,
  MemorySettingsStore,
} from '@dltech/atlas-harness'
import { afterEach, describe, expect, it } from 'bun:test'

import { recordingNotices } from './fakes'
import { createExecutionLocationState } from '../execution-location-state'
import { bindSandbox } from '../sandbox-binding'

const projects: string[] = []

afterEach(async () => {
  await Promise.all(projects.splice(0).map((project) => rm(project, { recursive: true })))
})

const freshProject = async (containerJson?: string): Promise<string> => {
  const project = await mkdtemp(join(tmpdir(), 'atlas-sandbox-binding-'))
  projects.push(project)
  if (containerJson !== undefined) {
    await mkdir(join(project, '.atlas'))
    await writeFile(join(project, '.atlas', 'container.json'), containerJson)
  }
  return project
}

const bindIn = (cwd: string, atlasHome?: string) =>
  bindSandbox({
    container: createHarnessContainer(),
    engine: new DockerEngine({ socketPath: join(cwd, 'no-daemon.sock') }),
    cwd,
    sessionKey: () => 'sandbox-binding-spec-session',
    settings: createSettingsService({
      definitions: ATLAS_SETTINGS,
      user: new MemorySettingsStore({ label: 'sandbox-binding spec' }),
    }),
    executionLocation: createExecutionLocationState({ initial: EExecutionLocation.Docker }),
    notice: recordingNotices().port,
    atlasHome: atlasHome ?? join(cwd, 'no-atlas-home-here'),
  })

describe('the mounts bindSandbox returns', () => {
  it('lists a configured mount', async () => {
    const cwd = await freshProject(
      JSON.stringify({ mounts: [{ path: '/Users/operator/Developer/shared-lib' }] }),
    )

    const { mounts } = await bindIn(cwd)

    expect(mounts).toEqual(['/Users/operator/Developer/shared-lib'])
  })

  it('is empty when nothing is configured', async () => {
    const cwd = await freshProject()

    const { mounts } = await bindIn(cwd)

    expect(mounts).toEqual([])
  })

  it('lists the mounted atlas home subtrees, never the home root', async () => {
    const cwd = await freshProject()
    const atlasHome = await mkdtemp(join(tmpdir(), 'atlas-sandbox-home-'))
    projects.push(atlasHome)
    await mkdir(join(atlasHome, 'memory'), { recursive: true })
    await writeFile(join(atlasHome, 'auth.json'), '{"secret":true}')

    const { mounts } = await bindIn(cwd, atlasHome)

    expect(mounts).toEqual([join(atlasHome, 'memory')])
  })
})
