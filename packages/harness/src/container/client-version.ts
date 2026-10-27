import type { DependencyContainer } from './injection'
import { ClientVersionToken } from './tokens'

export const clientVersionOf = (resolver: DependencyContainer): string =>
  resolver.isRegistered(ClientVersionToken, true) ? resolver.resolve(ClientVersionToken) : 'dev'
