import manifest from '../../../package.json'

/** The running API build. There is no build stamp yet, so a deploy may pin one through env. */
export const apiVersion = (): string => process.env.ATLAS_APP_VERSION ?? manifest.version
