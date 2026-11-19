import { MAC_LINK_PATH } from '@dltech/atlas-protocol/mac-link'

export const macLinkUrlOf = (apiOrigin: string): string =>
  `${apiOrigin.replace(/^http/, 'ws').replace(/\/+$/, '')}${MAC_LINK_PATH}`
