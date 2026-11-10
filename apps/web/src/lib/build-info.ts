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

export function versionLines({
  web,
  desktopVersion,
}: {
  web: IWebBuild
  desktopVersion: string | null
}): string[] {
  const lines: string[] = []
  if (desktopVersion !== null && desktopVersion.length > 0) {
    lines.push(`App ${desktopVersion}`)
  }
  const interfaceParts = [
    web.version.length > 0 ? web.version : '',
    web.commit.slice(0, SHORT_SHA_LENGTH),
  ].filter((part) => part.length > 0)
  if (interfaceParts.length > 0) lines.push(`Interface ${interfaceParts.join(' · ')}`)
  return lines
}
