export enum ENativeEvent {
  DidNavigate = 'did-navigate',
  DidNavigateInPage = 'did-navigate-in-page',
  DomReady = 'dom-ready',
}

export type NativeEvent = { detail?: unknown }

export type NativeWebview = {
  on: (name: ENativeEvent, listener: (event: NativeEvent) => void) => void
  off: (name: ENativeEvent, listener: (event: NativeEvent) => void) => void
  loadURL: (url: string) => void
  reload: () => void
  goBack: () => void
  goForward: () => void
  canGoBack: () => Promise<boolean>
  canGoForward: () => Promise<boolean>
  toggleHidden: (hidden: boolean) => void
  addMaskSelector: (selector: string) => void
  removeMaskSelector: (selector: string) => void
  syncDimensions: (force?: boolean) => void
}

export function isNativeWebview(element: Element | null): element is HTMLElement & NativeWebview {
  return element !== null && 'loadURL' in element && typeof element.loadURL === 'function'
}
