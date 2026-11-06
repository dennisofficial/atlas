import { describe, expect, it } from 'bun:test'

import { ensureWorkspace } from '../workspace-setup'
import { RecordingProcessPort, StubFileSystemPort } from './workspace-fakes'

describe('workspace setup command', () => {
  it('runs the setup script through sh -c with the inherited env, as v1 does', async () => {
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
    })

    const setup = processes.spawned.find((call) => call.cmd.includes('bun install'))
    expect(setup?.cmd).toEqual(['sh', '-c', 'bun install'])
    expect(setup?.env).toBeUndefined()
  })
})
