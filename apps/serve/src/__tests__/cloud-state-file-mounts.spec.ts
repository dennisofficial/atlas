import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'bun:test'

import { createCloudStateRefresh } from '../cloud-state-refresh'
import { EServeEvent, type ServeLogLine } from '../serve-log'
import { SERVE_TOKEN } from './cloud-state-fixture'
import { cleanupCloudState, cloudWith, tempHome } from './cloud-state-harness'

const dirs: string[] = []
afterEach(async () => {
  await cleanupCloudState()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const checkout = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'atlas-mount-boot-'))
  dirs.push(dir)
  execFileSync('git', ['init', '-q'], { cwd: dir })
  return dir
}

const config = (fileMounts: unknown) => ({
  settings: {},
  secrets: [],
  harnessSecrets: [],
  mcpServers: [],
  provenance: {},
  fileMounts,
})

const SECRET_CONTENTS = 'HUNTER2-CONTENTS'

const refreshFor = (args: { cloud: ReturnType<typeof cloudWith>; repositoryDir: string }) => {
  const lines: ServeLogLine[] = []
  const home = tempHome()
  const refresh = createCloudStateRefresh({
    atlasHome: home,
    controlPlaneUrl: args.cloud.url,
    token: SERVE_TOKEN,
    clientVersion: '0.0.0-test',
    fetchFn: fetch,
    log: (line) => lines.push(line),
    sleep: async () => undefined,
    fileMountRoots: { repositoryDir: args.repositoryDir, homeDir: tempHome() },
  })
  return { refresh, lines }
}

describe('file mounts at boot', () => {
  it('mounts on boot, logs a count without contents, and reports outcomes', async () => {
    const repositoryDir = checkout()
    const cloud = cloudWith({
      config: config([{ path: 'local.env', contents: SECRET_CONTENTS, mode: 0o600 }]),
    })
    const { refresh, lines } = refreshFor({ cloud, repositoryDir })

    const report = await refresh.boot()

    expect(readFileSync(join(repositoryDir, 'local.env'), 'utf8')).toBe(SECRET_CONTENTS)
    expect(report?.outcomes).toHaveLength(1)
    expect(lines.find((line) => line.event === EServeEvent.CloudStateReady)).toMatchObject({
      filesMounted: 1,
    })
    expect(lines.find((line) => line.event === EServeEvent.FileMountSkipped)).toBeUndefined()
    expect(JSON.stringify(lines)).not.toContain(SECRET_CONTENTS)
  })

  it('logs skipped outcomes by path and state only', async () => {
    const cloud = cloudWith({
      config: config([{ path: 'x.env', contents: SECRET_CONTENTS, mode: 0o600 }]),
    })
    const lines: ServeLogLine[] = []
    const refresh = createCloudStateRefresh({
      atlasHome: tempHome(),
      controlPlaneUrl: cloud.url,
      token: SERVE_TOKEN,
      clientVersion: '0.0.0-test',
      fetchFn: fetch,
      log: (line) => lines.push(line),
      sleep: async () => undefined,
      fileMountRoots: { repositoryDir: null, homeDir: tempHome() },
    })
    await refresh.boot()
    expect(lines.find((line) => line.event === EServeEvent.FileMountSkipped)).toMatchObject({
      path: 'x.env',
      state: 'skipped-no-repository',
    })
    expect(JSON.stringify(lines)).not.toContain(SECRET_CONTENTS)
  })

  it('does not write mounts on refresh', async () => {
    const repositoryDir = checkout()
    const cloud = cloudWith({
      config: config([{ path: 'local.env', contents: SECRET_CONTENTS, mode: 0o600 }]),
    })
    const { refresh } = refreshFor({ cloud, repositoryDir })

    await refresh.refresh()

    expect(existsSync(join(repositoryDir, 'local.env'))).toBe(false)
  })
})
