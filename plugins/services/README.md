# @dltech/atlas-plugin-services

Long-running services for a pod: a dev server, a database or a cache that keeps serving until it
stops. The API composes it as the `services` plugin, and a surface reads the `services` view for
its roster and its preview URLs.

## Owns

- The `service` tool, with the actions `start`, `stop`, `restart` and `list`.
- The declared services file `.atlas/services.yaml`: its names, its hashes and its start order.
- The `service-ready` plugin event and the `services` view.
- The public URL of a service port, through the control plane and the `previews.expose` call.
- The `services.lifecycle` prompt fragment, which also tells the agent to start a long-running
  process by its declared name, to add a declaration when the project has none, and never to hold a
  server alive from bash.

## Does not own

- A monitor that exits on its own. That is a background shell (`@dltech/atlas-plugin-shells`).
- The tunnel. The control plane exposes the port, and the pod starts `cloudflared`.

## Entry points

| Import                                  | Use it for                                                                            |
| --------------------------------------- | ------------------------------------------------------------------------------------- |
| `@dltech/atlas-plugin-services/core`    | `servicesCoreSlots`, the declaration parser, the `services` view and `service-ready`. |
| `@dltech/atlas-plugin-services/pod`     | `servicesPod`: the tool, the daemon hook, the reconcile and the prompt fragment.      |
| `@dltech/atlas-plugin-services/control` | `servicesControl`, an empty control slot.                                             |
| `@dltech/atlas-plugin-services/client`  | `servicesClient`, `servicesOfView` and `previewsOfView`.                              |

## Capabilities

### Read the declaration

- `DECLARED_SERVICES_FILE`: `['.atlas', 'services.yaml']`.
- `declaredServicesOf(content)`: the declarations and their hashes, or the reason to refuse the file.
- `declaredOrder({ declared, name })`: the dependencies of `name` in start order, then `name`. It refuses a cycle and an unknown name.
- `declaredNames(services)`: the names, sorted, for a message.

### Read the roster

- `SERVICES_VIEW`, `servicesView`, `foldServices`, `servicesOfEvents`: the rows and their fold.
- `servicesOfView(views)`: the rows of a view record.
- `previewsOfView(views)`: the running rows that have a port and a url, one for each port, sorted by port.

## Plugin contributions

### The tool the model sees

`service` takes one `action`:

| Action    | What it does                                                                                                                                                                                                                                 |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `start`   | Start a declared `name` or an ad-hoc `command`, never both. A `port` makes the call wait until the port answers, then publishes a URL. `exposePort: false` skips the exposure and returns no URL, so the service stays local to the sandbox. |
| `stop`    | Signal the service and its process group. It takes a `serviceId` or a `name`.                                                                                                                                                                |
| `restart` | Stop the service if it runs, then start it under a new id. A `name` re-reads the declaration.                                                                                                                                                |
| `list`    | Name each service with id, name, state and port. `runningOnly` leaves out ended services.                                                                                                                                                    |

### The core and client slots

`servicesCoreSlots` gives the `service-ready` event and the `services` view, and no commands.
`servicesClient` gives one hook, `services-roster`, which applies to the `service-*` events.

## Usage

```ts
import { definePlugin } from '@dltech/atlas-plugin-sdk'
import { servicesClient } from '@dltech/atlas-plugin-services/client'
import { servicesControl } from '@dltech/atlas-plugin-services/control'
import { servicesCoreSlots } from '@dltech/atlas-plugin-services/core'
import { servicesPod } from '@dltech/atlas-plugin-services/pod'

definePlugin({
  name: 'services',
  ...servicesCoreSlots,
  pod: servicesPod,
  control: servicesControl,
  client: servicesClient,
  transport: 'stream',
})
```

## Rules

- Declare a service under `services:` in `.atlas/services.yaml`. Each entry needs `command` and can take `cwd`, `port`, `health`, `env`, `setup`, `needs`, `portal`, `portals` and `type`.
- `start` takes a `name` or a `command`, never both.
- `restart` takes a `serviceId` or a `name`, exactly one.
- Import the pod tier in a pod only. It spawns processes on the host of the session.

## See also

- `docs/v2/architecture.md`
- `docs/decisions/0019-v2-package-map.md`
- `.atlas/services.yaml` in this repository for a real declaration.
