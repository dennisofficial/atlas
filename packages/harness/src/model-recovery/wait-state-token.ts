import type { InjectionToken } from '../container/injection'
import type { ModelWaitState } from './wait-state'

export const ModelWaitStateToken: InjectionToken<ModelWaitState> = Symbol('atlas.ModelWaitState')
