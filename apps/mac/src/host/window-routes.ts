export interface IDesktopWindowPort {
  titlebarDoubleClick: () => void
}

export const TITLEBAR_DOUBLE_CLICK_PATH = '/desktop/window/titlebar-double-click'

export function createWindowHandler({
  window,
}: {
  window: IDesktopWindowPort
}): (request: Request, pathname: string) => Response | undefined {
  return (request, pathname) => {
    if (pathname !== TITLEBAR_DOUBLE_CLICK_PATH) return undefined
    if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 })
    window.titlebarDoubleClick()
    return new Response(null, { status: 204 })
  }
}
