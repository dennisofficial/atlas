export const ARTIFACTS_PATH = '/artifacts'

export const artifactHrefOf = (ref: string): string =>
  `${ARTIFACTS_PATH}/${encodeURIComponent(ref)}`
