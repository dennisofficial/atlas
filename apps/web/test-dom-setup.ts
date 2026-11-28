import { GlobalRegistrator } from '@happy-dom/global-registrator'

GlobalRegistrator.register()
await import('react-dom/client')
await import('@dltech/atlas-ui/components/autocomplete')
await GlobalRegistrator.unregister()
