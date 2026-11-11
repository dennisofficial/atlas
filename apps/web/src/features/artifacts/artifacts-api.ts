import { api, cloudCall } from '@/lib/api-client'

export const ARTIFACTS_KEY = 'artifacts'

export const artifactKeyOf = (slug: string): string => `artifact:${slug}`

export const fetchArtifacts = () => cloudCall(api.artifacts.list.query())

export const fetchArtifact = (slug: string) => cloudCall(api.artifacts.get.query({ slug }))

export const rollbackArtifact = (args: { slug: string; version: number }) =>
  cloudCall(api.artifacts.rollback.mutate({ slug: args.slug, version: args.version }))

export const unpublishArtifact = (slug: string) =>
  cloudCall(api.artifacts.unpublish.mutate({ slug }))
