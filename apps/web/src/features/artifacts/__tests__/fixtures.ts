import type { ArtifactBuild, ArtifactSummary } from '@dltech/atlas-wire/web'

export const artifactSummary = (over: Partial<ArtifactSummary> = {}): ArtifactSummary => ({
  subdomain: 'ab12cd34ef56',
  name: 'Demo',
  url: 'https://ab12cd34ef56.artifacts.example',
  status: 'ready',
  updatedAt: '2026-11-10T10:00:00.000Z',
  ...over,
})

export const buildSummary = (over: Partial<ArtifactBuild> = {}): ArtifactBuild => ({
  status: 'ready',
  log: null,
  failure: null,
  durationMs: 4200,
  updatedAt: '2026-11-10T10:00:00.000Z',
  ...over,
})
