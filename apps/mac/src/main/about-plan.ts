export interface IAboutApp {
  version: string
  channel: string
  chromium: boolean
}

export interface IAboutInterface {
  version: string
}

export function aboutLines({
  app,
  iface,
}: {
  app: IAboutApp
  iface: IAboutInterface | undefined
}): string[] {
  return [
    `Atlas for Mac ${app.version} (${app.channel})`,
    iface === undefined
      ? 'Interface: the copy bundled with this app'
      : `Interface ${iface.version}`,
    `Chromium pane: ${app.chromium ? 'included' : 'not included'}`,
  ]
}
