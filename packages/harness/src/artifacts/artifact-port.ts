import type { ArtifactSpec } from '@dltech/atlas-artifacts'
import type { ArtifactEntry, ArtifactSummary, ArtifactUpload } from '@dltech/atlas-wire'

export class ArtifactRefused extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ArtifactRefused'
  }
}

export class ArtifactUnavailable extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ArtifactUnavailable'
  }
}

export type ArtifactEntryInput = ArtifactEntry

export type ArtifactPublishBegun = {
  artifactId: string
  slug: string
  version: number
  uploads: ArtifactUpload[]
}

export type ArtifactPublishCommitted = {
  slug: string
  version: number
  url: string
  status: string
}

export type ArtifactSourceExport = { entries: { path: string; url: string }[] }

export abstract class ArtifactPort {
  abstract beginPublish(args: {
    slug?: string | undefined
    name?: string | undefined
    entries: ArtifactEntryInput[]
  }): Promise<ArtifactPublishBegun>

  abstract commitPublish(args: {
    artifactId: string
    version: number
    spec: ArtifactSpec
  }): Promise<ArtifactPublishCommitted>

  abstract list(): Promise<readonly ArtifactSummary[]>

  abstract sourceExport(args: { slug: string }): Promise<ArtifactSourceExport>

  abstract unpublish(args: { slug: string }): Promise<void>
}
