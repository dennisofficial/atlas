import { systemNotice } from '../../context/envelope'
import { EArtifactBuildOutcome } from '../../events/artifact-build-body'
import type { DraftOfType } from '../../events/envelope'

type ArtifactBuildEvent = DraftOfType<'artifact-build-event'>

const MS_PER_SECOND = 1000

const secondsOf = (durationMs: number): string => `${Math.round(durationMs / MS_PER_SECOND)}s`

const readySentence = (event: ArtifactBuildEvent): string => {
  const took = event.durationMs === undefined ? '' : ` (${secondsOf(event.durationMs)})`
  if (event.url === undefined)
    return `Artifact ${event.subdomain} version ${event.version} built${took}.`
  return `Artifact ${event.subdomain} version ${event.version} built and is live at ${event.url}${took}.`
}

const keptSourceSentence = (event: ArtifactBuildEvent): string =>
  event.url === undefined
    ? ''
    : ` The pushed source is stored; ${event.url} still serves the last good build.`

const failedSentence = (event: ArtifactBuildEvent): string => {
  const failure = event.failure === undefined ? 'unknown failure' : event.failure
  const lead = `Artifact ${event.subdomain} version ${event.version} failed to build: ${failure}.`
  const tail = event.log === undefined ? '' : ` Build log tail:\n${event.log}`
  return `${lead}${keptSourceSentence(event)}${tail}`
}

const supersededSentence = (event: ArtifactBuildEvent): string => {
  const by = event.supersededBy === undefined ? 'a newer push' : `version ${event.supersededBy}`
  return `Artifact ${event.subdomain} version ${event.version} was superseded by ${by}; its result arrives on that version's subscription.`
}

export function artifactBuildEventContent(event: ArtifactBuildEvent): string {
  if (event.outcome === EArtifactBuildOutcome.Ready) return readySentence(event)
  if (event.outcome === EArtifactBuildOutcome.Failed) return failedSentence(event)
  return supersededSentence(event)
}

export function artifactBuildEventBlock(event: ArtifactBuildEvent): string {
  return systemNotice({ kind: 'artifact-build-event', content: artifactBuildEventContent(event) })
}
