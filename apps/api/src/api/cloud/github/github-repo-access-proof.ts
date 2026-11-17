import type { RepoAccessProof } from './github-request-coordinator.types'

export const accessProofKey = (args: {
  userId: string
  fingerprint: string
  repo: string
}): string => `${args.userId}:${args.repo}:${args.fingerprint}`
export const accessProofAllows = (state: RepoAccessProof | undefined): boolean =>
  state !== undefined && state.deniedUntil <= Date.now() && state.authorizedUntil > Date.now()
