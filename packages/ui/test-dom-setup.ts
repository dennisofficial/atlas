import { GlobalRegistrator } from '@happy-dom/global-registrator'

GlobalRegistrator.register()
await import('#components/dropdown-menu')
await GlobalRegistrator.unregister()
