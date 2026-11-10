import { Utils } from 'electrobun/main'

import { aboutLines, type IAboutApp, type IAboutInterface } from './about-plan'

export async function runAbout({
  app,
  iface,
}: {
  app: IAboutApp
  iface: IAboutInterface | undefined
}): Promise<void> {
  const [title, ...detail] = aboutLines({ app, iface })
  await Utils.showMessageBox({
    type: 'info',
    title: 'About Atlas',
    message: title ?? 'Atlas',
    detail: detail.join('\n'),
    buttons: ['OK'],
  })
}
