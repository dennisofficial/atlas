import { describe, expect, it } from 'bun:test'
import { basename } from 'node:path'

import { ensureWorkspace } from '../workspace-setup'
import { RecordingProcessPort, StubFileSystemPort } from './workspace-fakes'

class OrderedFiles extends StubFileSystemPort {
  readonly order: string[] = []

  override async writeFile(args?: { path: string }): Promise<void> {
    if (args === undefined) return
    this.order.push(`write ${basename(args.path)}`)
    await Bun.sleep(10)
    this.order.push(`written ${basename(args.path)}`)
  }

  override async removeFile(args?: { path: string }): Promise<void> {
    if (args === undefined) return
    this.order.push(`remove ${basename(args.path)}`)
  }
}

describe('workspace clone ordering', () => {
  it('removes the github token only after the last sentinel is written', async () => {
    const files = new OrderedFiles()
    await ensureWorkspace({
      calls: { ackScope: () => Promise.resolve() },
      processes: new RecordingProcessPort(),
      files,
      workspace: {
        remoteUrl: 'https://github.com/owner/repo.git',
        baseBranch: null,
        additionalRepos: [],
        setupScript: '',
      },
      githubToken: 'ghp_order',
      launchDirectory: '/workspace/repo',
      sandboxName: 'sandbox-order',
    })

    const written = files.order.indexOf('written workspace-materialized')
    const removed = files.order.indexOf('remove github-token')
    expect(written).toBeGreaterThan(-1)
    expect(removed).toBeGreaterThan(written)
  })
})
