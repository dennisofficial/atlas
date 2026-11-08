export interface PluginEventBodies {
  readonly __none?: never
}

export type PluginEventBody = NonNullable<
  PluginEventBodies[keyof Omit<PluginEventBodies, '__none'>]
>
