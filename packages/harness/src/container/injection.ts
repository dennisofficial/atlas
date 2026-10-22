// tsyringe throws from its own module body when `Reflect.getMetadata` is absent, so the polyfill
// must evaluate first, and Bun needs a different import for each way it loads tsyringe. The bundler
// takes tsyringe's ESM build and hoists ESM initializers above CommonJS requires, so the compiled
// binary needs the ESM wrapper (tui-v1.119.0 shipped without it). `bun test` under
// NODE_ENV=development takes tsyringe's CJS build and needs the direct import. Neither is redundant.
import './reflect-polyfill'
import 'reflect-metadata'

import { container, type DependencyContainer, type InjectionToken } from 'tsyringe'

import type { RegisteredPort } from '@dltech/atlas-core'

export { instanceCachingFactory } from 'tsyringe'
export type { DependencyContainer, InjectionToken } from 'tsyringe'

export type PortConstructor<T> = abstract new (...args: never[]) => T

// tsyringe 4.10 defines `InjectionToken<T>` over `{ new (...args: any[]): T }`, which an abstract
// constructor is not assignable to, so a port cannot be handed to `register`/`resolve`/`inject`
// unaided. https://github.com/microsoft/tsyringe/blob/master/src/providers/injection-token.ts
export const portToken = <T>(port: PortConstructor<T>): InjectionToken<T> =>
  port as InjectionToken<T>

/**
 * The token a session port resolves through. Only contracts the core port registry names produce
 * one — an unregistered port cannot reach a composition site through this seam, which is what
 * makes the registry the only way a port exists. Multi-binding extension points (hooks,
 * ToolDefinition, PromptFragment, NativePlugin, Disposable) are not registry ports and keep
 * `portToken`.
 */
export const registeredPortToken = <P extends RegisteredPort>(
  port: P,
): InjectionToken<InstanceType<P>> => port as InjectionToken<InstanceType<P>>

export const createIsolatedContainer = (): DependencyContainer => container.createChildContainer()

// tsyringe's `resolveAll` guards unregistered tokens only when `isNormalToken` holds, and that is
// string-or-symbol only — a class token with no registrations falls through to `construct(token)`.
// `abstract` is erased at runtime, so that yields one phantom instance rather than an empty array,
// and `{ isOptional: true }` does not help. Verified against tsyringe 4.10.0.
// https://github.com/microsoft/tsyringe/blob/master/src/dependency-container.ts
export const resolveSet = <T>(args: {
  container: DependencyContainer
  token: InjectionToken<T>
}): readonly T[] =>
  args.container.isRegistered(args.token, true) ? args.container.resolveAll(args.token) : []

// `isRegistered` answers only that a registration exists, not that its factory can run: a
// factory that resolves another token can throw from inside the factory rather than on the
// token itself.
export const resolveIfPossible = <T>(args: {
  container: DependencyContainer
  token: InjectionToken<T>
}): T | undefined => {
  if (!args.container.isRegistered(args.token, true)) return undefined
  try {
    return args.container.resolve(args.token)
  } catch {
    return undefined
  }
}
