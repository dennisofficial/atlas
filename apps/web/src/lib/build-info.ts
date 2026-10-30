const SHORT_SHA_LENGTH = 7

export interface IWebBuild {
  commit: string
  version: string
}

export function webBuild(): IWebBuild {
  return {
    commit: process.env.ATLAS_WEB_COMMIT ?? '',
    version: process.env.ATLAS_WEB_VERSION ?? '',
  }
}

export function versionLine({
  web,
  desktopVersion,
}: {
  web: IWebBuild
  desktopVersion: string | null
}): string | null {
  const parts: string[] = []
  if (desktopVersion !== null && desktopVersion.length > 0) {
    parts.push(`Atlas for Mac ${desktopVersion}`)
  }
  const webParts = [
    web.version.length > 0 ? `v${web.version}` : '',
    web.commit.slice(0, SHORT_SHA_LENGTH),
  ].filter((part) => part.length > 0)
  if (webParts.length > 0) parts.push(`web ${webParts.join(' ')}`)
  return parts.length === 0 ? null : parts.join(' · ')
}
