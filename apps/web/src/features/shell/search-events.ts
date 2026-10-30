import { useEffect } from 'react'

const OPEN_SEARCH_EVENT = 'atlas:open-search'

export const requestOpenSearch = (): void => {
  window.dispatchEvent(new Event(OPEN_SEARCH_EVENT))
}

export function useOpenSearchRequests(onOpen: () => void) {
  useEffect(() => {
    window.addEventListener(OPEN_SEARCH_EVENT, onOpen)
    return () => window.removeEventListener(OPEN_SEARCH_EVENT, onOpen)
  }, [onOpen])
}
