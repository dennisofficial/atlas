import type { NoticeStamp } from './notice-stage'

export enum EArtifactBuildOutcome {
  Ready = 'ready',
  Failed = 'failed',
  Superseded = 'superseded',
}

export type ArtifactBuildEventBody = {
  type: 'artifact-build-event'
  subdomain: string
  version: number
  url?: string | undefined
  outcome: EArtifactBuildOutcome
  failure?: string | undefined
  log?: string | undefined
  durationMs?: number | undefined
  supersededBy?: number | undefined
  eventId?: string | undefined
  notice?: NoticeStamp | undefined
}
