export const BLOB_PREFIX = 'blobs/'
export const ROUTES_PREFIX = 'routes/'

export const blobPathOf = (sha256: string): string => `${BLOB_PREFIX}${sha256}`

export const routePathOf = (args: { token: string; slug: string }): string =>
  `${ROUTES_PREFIX}${args.token}-${args.slug}.json`
