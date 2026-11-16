import { describe, expect, it } from 'bun:test'

import { ArtifactSuperseded } from '../../../artifacts/artifact-port'
import { LOGIN_ENV_MARKER } from '../../../execution/login-env-process'

import { LINKED, invoke, modelTextOf, reasonOf, rigOf } from './artifact-push-rig'

describe('artifact_push builds in the session', () => {
  const BUILD = { install: 'bun install', cmd: 'bun run build', outDir: 'dist', timeoutSec: 120 }

  const built = () =>
    rigOf({
      spec: { subdomain: LINKED, build: BUILD },
      output: { 'dist/index.html': '<h1>built</h1>', 'dist/assets/app.js': 'console.log(1)' },
    })

  it('runs install and then the build command in the pushed directory', async () => {
    const rig = built()
    modelTextOf(await invoke({}, rig.tool))

    const builds = rig.processes.spawns.filter((spawn) => spawn.cmd[0] === 'bash')
    expect(builds.map((spawn) => spawn.cmd)).toEqual([
      ['bash', '-c', 'bun install'],
      ['bash', '-c', 'bun run build'],
    ])
    expect(builds.every((spawn) => spawn.cwd === '/ws')).toBe(true)
    expect(builds.every((spawn) => spawn.env?.[LOGIN_ENV_MARKER] === '1')).toBe(true)
    expect(builds.map((spawn) => spawn.threadId)).toEqual(['thr_1', 'thr_1'])
  })

  it('uploads the source and every file in outDir, with outDir files kept out of source', async () => {
    const rig = built()
    rig.processes.gitListing(['artifact.json', 'index.html', 'dist/index.html'])
    modelTextOf(await invoke({}, rig.tool))

    const entries = rig.port.beginCalls[0]?.entries ?? []
    expect(entries.filter((entry) => entry.tree === 'dist').map((entry) => entry.path)).toEqual([
      'assets/app.js',
      'index.html',
    ])
    expect(entries.filter((entry) => entry.tree === 'src').map((entry) => entry.path)).toEqual([
      'artifact.json',
      'index.html',
    ])
  })

  it('commits the build log and how long it took', async () => {
    const rig = built()
    modelTextOf(await invoke({}, rig.tool))

    const commit = rig.port.commitCalls[0]
    expect(commit?.log).toContain('==> install (exit 0)')
    expect(commit?.log).toContain('==> build (exit 0)')
    expect(commit?.durationMs).toBeGreaterThanOrEqual(0)
    expect(commit?.artifactId).toBe('art_1')
  })

  it('reports the built counts and the live URL', async () => {
    const rig = built()
    const text = modelTextOf(await invoke({}, rig.tool))

    expect(text).toContain('Built and pushed 4 source files and 2 built files')
    expect(text).toContain('it is live at https://demo.artifacts.test')
  })

  it('serves the pushed files as they are when artifact.json declares no build', async () => {
    const rig = rigOf({ spec: { subdomain: LINKED } })
    const text = modelTextOf(await invoke({}, rig.tool))

    const mirrored = rig.calls.filter((call) => call.url.startsWith('https://upload.test/dist/'))
    expect(mirrored).toHaveLength(4)
    for (const call of mirrored) {
      const source = rig.calls.find((other) => other.url === call.url.replace('/dist/', '/src/'))
      expect(call.body).toEqual(source?.body ?? new Uint8Array([1]))
    }
    expect(text).toContain('served as they are')
  })

  it('pushes nothing and returns the log when the build fails', async () => {
    const rig = built()
    rig.processes.exitCode = 1

    const outcome = await invoke({}, rig.tool)

    expect(outcome.ok).toBe(false)
    expect(reasonOf(outcome)).toContain('install failed with exit code 1')
    expect(reasonOf(outcome)).toContain('==> install (exit 1)')
    expect(reasonOf(outcome)).toContain(`${LINKED} still serves the last version`)
    expect(rig.port.beginCalls).toHaveLength(0)
    expect(rig.calls).toHaveLength(0)
  })

  it('fails when outDir holds nothing after the build', async () => {
    const rig = rigOf({ spec: { subdomain: LINKED, build: BUILD } })

    const outcome = await invoke({}, rig.tool)

    expect(outcome.ok).toBe(false)
    expect(reasonOf(outcome)).toContain('build.outDir dist is missing or empty')
    expect(rig.port.beginCalls).toHaveLength(0)
  })

  it('tells the agent to pull, reapply and push again when a newer version is live', async () => {
    const rig = rigOf()
    rig.port.commitFailure = new ArtifactSuperseded('version 3 is older than live version 4')

    const outcome = await invoke({}, rig.tool)

    expect(outcome.ok).toBe(false)
    expect(reasonOf(outcome)).toContain('artifact_pull')
    expect(reasonOf(outcome)).toContain('push again')
  })
})
