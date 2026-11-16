import type {
  ArtifactBuildStatusOutput,
  ArtifactEntry,
  ArtifactSummary,
  ArtifactUpload,
} from '@dltech/atlas-wire'

export class ArtifactRefused extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ArtifactRefused'
  }
}

export class ArtifactNotFound extends ArtifactRefused {
  constructor(message: string) {
    super(message)
    this.name = 'ArtifactNotFound'
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
  subdomain: string
  version: number
  uploads: ArtifactUpload[]
}

export type ArtifactPublishCommitted = {
  subdomain: string
  version: number
  url: string
  status: string
}

export type ArtifactBuildStatus = ArtifactBuildStatusOutput

export type ArtifactSourceExport = { entries: { path: string; url: string }[] }

export abstract class ArtifactPort {
  abstract beginPublish(args: {
    subdomain?: string | undefined
    name?: string | undefined
    entries: ArtifactEntryInput[]
  }): Promise<ArtifactPublishBegun>

  abstract commitPublish(args: {
    artifactId: string
    version: number
  }): Promise<ArtifactPublishCommitted>

  abstract buildStatus(args: { subdomain: string; version: number }): Promise<ArtifactBuildStatus>

  abstract list(): Promise<readonly ArtifactSummary[]>

  abstract sourceExport(args: { subdomain: string }): Promise<ArtifactSourceExport>

  abstract unpublish(args: { subdomain: string }): Promise<void>
}
