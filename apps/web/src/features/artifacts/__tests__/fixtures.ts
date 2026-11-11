import type { ArtifactEntry, ArtifactSummary, ArtifactVersionSummary } from '@dltech/atlas-wire/web'

export const artifactSummary = (over: Partial<ArtifactSummary> = {}): ArtifactSummary => ({
  slug: 'demo',
  name: 'Demo',
  url: 'https://abc123-demo.artifacts.example',
  currentVersion: 2,
  status: 'ready',
  bytes: 2048,
  fileCount: 3,
  createdAt: '2026-11-08T09:00:00.000Z',
  updatedAt: '2026-11-10T10:00:00.000Z',
  sourceHash: 'b'.repeat(64),
  specHash: 'c'.repeat(64),
  ...over,
})

export const versionSummary = (
  over: Partial<ArtifactVersionSummary> = {},
): ArtifactVersionSummary => ({
  version: 1,
  status: 'ready',
  createdAt: '2026-11-09T09:00:00.000Z',
  bytes: 1024,
  fileCount: 2,
  failure: null,
  durationMs: null,
  log: null,
  ...over,
})

export const manifestEntry = (over: Partial<ArtifactEntry> & { path: string }): ArtifactEntry => ({
  tree: 'dist',
  sha256: 'a'.repeat(64),
  size: 512,
  type: 'text/html',
  ...over,
})
