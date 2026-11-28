import { createProviderSignIn, type ProviderSignInControl } from '@dltech/atlas-client/settings'
import type { EOauthProvider } from '@dltech/atlas-wire/web'
import * as WebBrowser from 'expo-web-browser'
import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import { useAuth } from '../../auth/auth-provider'

export const openProviderBrowser = (url: string) => {
  void WebBrowser.openBrowserAsync(url)
}

export function useProviderSignIn(args: {
  provider: EOauthProvider
  onChanged: () => void
}): ProviderSignInControl {
  const { api } = useAuth()
  const changed = useRef(args.onChanged)
  changed.current = args.onChanged
  const controller = useMemo(
    () =>
      createProviderSignIn({
        provider: args.provider,
        begin: (provider) => {
          if (api === undefined) return Promise.reject(new Error('Sign in to Atlas first'))
          return api.providerSignIn.begin.mutate({ provider })
        },
        complete: (input) => {
          if (api === undefined) return Promise.reject(new Error('Sign in to Atlas first'))
          return api.providerSignIn.complete.mutate(input)
        },
        poll: (attemptId) => {
          if (api === undefined) return Promise.reject(new Error('Sign in to Atlas first'))
          return api.providerSignIn.poll.mutate({ attemptId })
        },
        open: openProviderBrowser,
        onChanged: () => changed.current(),
        now: Date.now,
        wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      }),
    [api, args.provider],
  )
  useEffect(() => () => controller.cancel(), [controller])
  const flow = useSyncExternalStore(controller.subscribe, controller.getState, controller.getState)
  return {
    flow,
    start: controller.start,
    cancel: controller.cancel,
    submitCode: controller.submitCode,
  }
}
