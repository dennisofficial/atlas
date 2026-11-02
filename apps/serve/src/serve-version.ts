declare const ATLAS_SERVE_VERSION: string | undefined

export const SERVE_BUILD_VERSION =
  typeof ATLAS_SERVE_VERSION === 'undefined' ? 'dev' : ATLAS_SERVE_VERSION
