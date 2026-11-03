declare const ATLAS_SERVE_VERSION: string | undefined

export const SERVE_BUILD_VERSION =
  typeof ATLAS_SERVE_VERSION === 'undefined' ? 'dev' : ATLAS_SERVE_VERSION

export const serveClientVersionOf = (args: {
  requested: string | undefined
  build?: string | undefined
}): string => args.requested ?? args.build ?? SERVE_BUILD_VERSION
