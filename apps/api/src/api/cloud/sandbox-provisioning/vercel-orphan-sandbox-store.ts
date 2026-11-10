import { Sandbox } from '@vercel/sandbox'
import type { VercelCredentials } from '@dltech/atlas-wire'
import { isSandboxMissing } from '../../platform/sandboxes/vercel-sandbox.errors'
import type { OrphanSandbox, OrphanSandboxStore } from './orphan-sandbox-sweep'

/** Vercel's list endpoints reject a limit above 50. */
const LIST_PAGE_LIMIT = 50

const createdMsOf = (sandbox: { createdAt: number | string }): number =>
  typeof sandbox.createdAt === 'number' ? sandbox.createdAt : Date.parse(sandbox.createdAt)

export class VercelOrphanSandboxStore implements OrphanSandboxStore {
  constructor(private readonly credentials: VercelCredentials) {}

  async listSandboxes(): Promise<readonly OrphanSandbox[]> {
    const pages = await Sandbox.list({ ...this.credentials, limit: LIST_PAGE_LIMIT })
    const sandboxes = await pages.toArray()
    return sandboxes.map((sandbox) => ({
      name: sandbox.name,
      status: sandbox.status,
      createdAt: createdMsOf(sandbox),
    }))
  }

  async deleteSandbox(args: { name: string }): Promise<void> {
    try {
      const sandbox = await Sandbox.get({ ...this.credentials, name: args.name, resume: false })
      if (sandbox.status === 'running') return
      await sandbox.delete()
    } catch (failure) {
      if (isSandboxMissing(failure)) return
      throw failure
    }
  }
}
