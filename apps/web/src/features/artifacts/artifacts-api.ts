import { api, cloudCall } from '@/lib/api-client'

export const ARTIFACTS_KEY = 'artifacts'

export const artifactKeyOf = (ref: string): string => `artifact:${ref}`

export const fetchArtifacts = () => cloudCall(api.artifacts.list.query())

export const fetchArtifact = (ref: string) => cloudCall(api.artifacts.get.query({ subdomain: ref }))

export const deleteArtifact = (ref: string) =>
  cloudCall(api.artifacts.unpublish.mutate({ subdomain: ref }))
