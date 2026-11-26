import { ERepoTracking } from '@dltech/atlas-core'
import type { RepoTracking } from './github-repo-coverage'

export class TransportSelector {
  private sources: Promise<RepoTracking> | undefined

  constructor(private readonly read: () => Promise<RepoTracking>) {}

  async transportOf(repoFullName: string): Promise<ERepoTracking> {
    this.sources ??= this.read()
    return (await this.sources).trackingOf(repoFullName)
  }

  async polls(repoFullName: string): Promise<boolean> {
    return (await this.transportOf(repoFullName)) === ERepoTracking.Polled
  }
}
