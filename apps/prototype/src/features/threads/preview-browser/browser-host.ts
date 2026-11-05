import { useSearchParams } from 'next/navigation'

import { parseControls } from '@/proto/use-prototype'

import { enumValueOf } from '../enum-value'
import { THREAD_CONTROLS } from '../thread-tweaks'

export enum EBrowserHost {
  Web = 'web',
  Mac = 'mac',
}

export function useBrowserHost(): EBrowserHost {
  const values = parseControls({ controls: THREAD_CONTROLS, params: useSearchParams() })
  return enumValueOf({
    options: Object.values(EBrowserHost),
    value: values.browser,
    fallback: EBrowserHost.Web,
  })
}
