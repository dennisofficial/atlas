export const ARTIFACTS_PATH = '/artifacts'

export const artifactHrefOf = (slug: string): string =>
  `${ARTIFACTS_PATH}/${encodeURIComponent(slug)}`
