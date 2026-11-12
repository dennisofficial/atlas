import { describe, expect, it } from 'bun:test'

import { ensureWorkspace } from '../workspace-setup'
import { RecordingProcessPort, StubFileSystemPort } from './workspace-fakes'

const setupOf = async (env?: Record<string, string>) => {
  const processes = new RecordingProcessPort()

  await ensureWorkspace({
    calls: { ackScope: () => Promise.resolve() },
    processes,
    files: new StubFileSystemPort(),
    workspace: {
      remoteUrl: null,
      baseBranch: null,
      additionalRepos: [],
      setupScript: 'bun install',
    },
    githubToken: null,
    launchDirectory: '/workspace/repo',
    sandboxName: 'sandbox-a',
    ...(env === undefined ? {} : { env }),
  })

  return processes.spawned.find((call) => call.cmd.includes('bun install'))
}

describe('workspace setup command', () => {
  it('runs the setup script through sh -c with the session env, so setup sees the cloud secrets', async () => {
    const setup = await setupOf({ API_KEY: 'project-secret' })

    expect(setup?.cmd).toEqual(['sh', '-c', 'bun install'])
    expect(setup?.env).toEqual({ API_KEY: 'project-secret' })
  })

  it('leaves the env off the spawn when the session has none', async () => {
    expect((await setupOf())?.env).toBeUndefined()
  })
})
