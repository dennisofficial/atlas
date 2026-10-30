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

export function pickDmgName({ files }: { files: string[] }): string | null {
  return files.find((file) => /^(stable-)?macos-[a-z0-9]+-.*\.dmg$/.test(file)) ?? null
}
