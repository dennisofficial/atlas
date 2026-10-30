export const AUTOCLOSE_ENV = {
  ELECTROBUN_INSTALLER_UI_AUTOCLOSE: '1',
} as const

export type AutocloseDecision =
  | { kind: 'skip'; reason: string }
  | { kind: 'edit'; plistPath: string; cmd: string[] }

export function planWrapperAutoclose({
  os,
  wrapperPath,
  plutilPath,
}: {
  os: string | undefined
  wrapperPath: string | undefined
  plutilPath: string | null
}): AutocloseDecision {
  if (os !== 'macos')
    return {
      kind: 'skip',
      reason: `ELECTROBUN_OS is ${os ?? 'unset'}, not macos`,
    }
  if (!wrapperPath) return { kind: 'skip', reason: 'ELECTROBUN_WRAPPER_BUNDLE_PATH is unset' }
  if (!plutilPath) return { kind: 'skip', reason: 'plutil not found' }
  const plistPath = `${wrapperPath.replace(/\/+$/, '')}/Contents/Info.plist`
  return {
    kind: 'edit',
    plistPath,
    cmd: [
      plutilPath,
      '-replace',
      'LSEnvironment',
      '-json',
      JSON.stringify(AUTOCLOSE_ENV),
      plistPath,
    ],
  }
}
