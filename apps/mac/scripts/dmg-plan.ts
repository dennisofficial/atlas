export type SigningEnv = {
  identity: string
  apiKeyPath: string
  apiKeyId: string
  apiIssuer: string
}

export function readSigningEnv({
  env,
}: {
  env: Record<string, string | undefined>
}): SigningEnv | null {
  if (env.ATLAS_MAC_UNSIGNED === '1') return null
  const identity = env.ELECTROBUN_DEVELOPER_ID
  const apiKeyPath = env.ELECTROBUN_APPLEAPIKEYPATH
  const apiKeyId = env.ELECTROBUN_APPLEAPIKEY
  const apiIssuer = env.ELECTROBUN_APPLEAPIISSUER
  if (!identity || !apiKeyPath || !apiKeyId || !apiIssuer) return null
  return { identity, apiKeyPath, apiKeyId, apiIssuer }
}

export const WINDOW = { width: 660, height: 400 } as const
export const APP_ICON_POSITION = { x: 180, y: 200 } as const
export const APPLICATIONS_POSITION = { x: 480, y: 200 } as const

export function buildCreateDmgArgs(params: {
  appName: string
  volumeName: string
  volumeIcon: string
  background: string
  outputPath: string
  sourceDir: string
}): string[] {
  const { appName, volumeName, volumeIcon, background, outputPath, sourceDir } = params
  return [
    '--volname',
    volumeName,
    '--volicon',
    volumeIcon,
    '--background',
    background,
    '--window-pos',
    '200',
    '120',
    '--window-size',
    String(WINDOW.width),
    String(WINDOW.height),
    '--icon-size',
    '100',
    '--text-size',
    '13',
    '--icon',
    appName,
    String(APP_ICON_POSITION.x),
    String(APP_ICON_POSITION.y),
    '--hide-extension',
    appName,
    '--app-drop-link',
    String(APPLICATIONS_POSITION.x),
    String(APPLICATIONS_POSITION.y),
    '--no-internet-enable',
    outputPath,
    sourceDir,
  ]
}

function dmgPartsOf({ channelDir, bundleName }: { channelDir: string; bundleName: string }) {
  const [channel, ...platform] = channelDir.split('-')
  const prefix = channel === 'stable' ? '' : `${channel}-`
  return { prefix, platform: platform.join('-') }
}

// The unversioned name is what the app's download button links to, and GitHub's /releases/latest/download/ needs it to be stable.
export function dmgNameFor({
  channelDir,
  bundleName,
}: {
  channelDir: string
  bundleName: string
}): string {
  const { prefix, platform } = dmgPartsOf({ channelDir, bundleName })
  return `${prefix}${platform}-${bundleName}.dmg`
}

export function dmgArtifactNameFor({
  channelDir,
  bundleName,
  version,
}: {
  channelDir: string
  bundleName: string
  version: string
}): string {
  const { prefix, platform } = dmgPartsOf({ channelDir, bundleName })
  return `${prefix}${platform}-${bundleName}-${version}.dmg`
}
