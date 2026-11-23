import type { RepoAccessProof } from './github-request-coordinator.types'

export const accessProofKey = (args: { credentialFingerprint: string; repo: string }): string =>
  `${args.credentialFingerprint}:${args.repo}`
export const accessProofPrefix = (credentialFingerprint: string): string =>
  `${credentialFingerprint}:`
export const accessProofAllows = (state: RepoAccessProof | undefined): boolean =>
  state?.granted === true && state.deniedUntil <= Date.now()
