declare const ATLAS_DAEMON_VERSION: string | undefined

// The api's daemon bundle is identified by its sha256, which the sandbox's boot loop passes in; a
// daemon started any other way (local dev, the test suite) falls back to the build-time version.
const bundleVersion = process.env.ATLAS_DAEMON_BUNDLE_VERSION

export const DAEMON_VERSION: string =
  bundleVersion !== undefined && bundleVersion !== ''
    ? bundleVersion
    : typeof ATLAS_DAEMON_VERSION === 'undefined'
      ? 'dev'
      : ATLAS_DAEMON_VERSION
