import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  ATLAS_SETTINGS,
  EExecutionLocation,
  executionLocationNote,
} from '@dltech/atlas-core'
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

describe('the mounts bindSandbox hands the tail block', () => {
  it('names a configured mount in the note the model reads', async () => {
    const cwd = await freshProject(
      JSON.stringify({ mounts: [{ path: '/Users/operator/Developer/shared-lib' }] }),
    )

    const { mounts } = await bindIn(cwd)

    const note = executionLocationNote({ location: EExecutionLocation.Docker, mounts })
    expect(note).toContain('/Users/operator/Developer/shared-lib')
  })

  it('describes filesystem access through the configured container mounts', async () => {
    const cwd = await freshProject(
      JSON.stringify({ mounts: [{ path: '/Users/operator/Developer/shared-lib' }] }),
    )

    const { mounts } = await bindIn(cwd)

    const note = executionLocationNote({ location: EExecutionLocation.Docker, mounts })
    expect(note).toContain('Filesystem access uses the container’s mounted paths')
    expect(note).toContain('Additional configured mounts:')
  })

  it('omits an additional-mount list when nothing is configured', async () => {
    const cwd = await freshProject()

    const { mounts } = await bindIn(cwd)

    expect(mounts).toEqual([])
    const note = executionLocationNote({ location: EExecutionLocation.Docker, mounts })
    expect(note).not.toContain('Additional configured mounts:')
    expect(note).not.toContain('project directory is mounted')
  })

  it('tells the model it can reach the mounted atlas home subtrees, never the home root', async () => {
    const cwd = await freshProject()
    const atlasHome = await mkdtemp(join(tmpdir(), 'atlas-sandbox-home-'))
    projects.push(atlasHome)
    await mkdir(join(atlasHome, 'memory'), { recursive: true })
    await writeFile(join(atlasHome, 'auth.json'), '{"secret":true}')

    const { mounts } = await bindIn(cwd, atlasHome)

    expect(mounts).toEqual([join(atlasHome, 'memory')])
    const note = executionLocationNote({ location: EExecutionLocation.Docker, mounts })
    expect(note).toContain(join(atlasHome, 'memory'))
    expect(note).not.toContain('auth.json')
  })
})
