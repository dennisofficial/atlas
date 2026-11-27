import { GlobalRegistrator } from '@happy-dom/global-registrator'

type DetachedWindowAPI = { abort: () => Promise<void> }

const detachedWindow = (): DetachedWindowAPI | null =>
  (globalThis as unknown as { happyDOM?: DetachedWindowAPI }).happyDOM ?? null

export const registerDom = (url?: string): void => {
  GlobalRegistrator.register(url === undefined ? undefined : { url })
}

// unregister() deletes the happy-dom globals before it closes the frame, so a fetch still in
// flight aborts afterwards with no window (happy-dom@21 lib/fetch/Fetch.js:545).
export const unregisterDom = async (): Promise<void> => {
  await detachedWindow()?.abort()
  await GlobalRegistrator.unregister()
}
