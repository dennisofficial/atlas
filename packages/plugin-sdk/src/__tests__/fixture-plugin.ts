import { z } from 'zod'

import { definePlugin, type ViewFold } from '..'

export type FixtureObserved = { type: 'fixture-observed'; label: string }

declare module '@dltech/atlas-core' {
  interface PluginEventBodies {
    'fixture-observed': FixtureObserved
  }
}

export const fixtureObservedSchema: z.ZodType<FixtureObserved> = z.object({
  type: z.literal('fixture-observed'),
  label: z.string().min(1),
})

export const fixtureLabelsView: ViewFold<readonly string[]> = {
  name: 'fixture-labels',
  initial: [],
  fold: (state, event) => (event.type === 'fixture-observed' ? [...state, event.label] : state),
}

export const fixturePlugin = definePlugin({
  name: 'fixture',
  events: [fixtureObservedSchema],
  views: [fixtureLabelsView as ViewFold],
  commands: [{ name: 'fixture-observe', summary: 'record a fixture observation' }],
  pod: { handlers: [{ eventType: 'fixture-observed', handle: async () => {} }] },
  control: {
    hooks: [{ name: 'fixture-control', appliesTo: (e) => e.type === 'fixture-observed' }],
  },
  client: { hooks: [{ name: 'fixture-client', appliesTo: (e) => e.type === 'fixture-observed' }] },
  transport: 'stream',
})
