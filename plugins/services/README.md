# @dltech/atlas-plugin-services

Long-running services for a pod: a dev server, a database or a cache that keeps serving until it
stops. The API composes it as the `services` plugin, and a surface reads the `services` view for
its roster and its preview URLs.

## Owns

- The `service` tool, with the actions `start`, `stop`, `restart` and `list`.
- The declared services file `.atlas/services.yaml`: its names, its hashes and its start order.
- The `service-ready` plugin event and the `services` view.
- The public URL of a service port: the control plane mints the hostname and the token, and the pod
  ensures its one tunnel runs (`previews.ensure`).
- The resume of declared services after the daemon restarts the pod.
- The `services.lifecycle` prompt fragment, which also tells the agent to start a long-running
  process by its declared name, to add a declaration when the project has none, and never to hold a
  server alive from bash.

## Does not own

- A monitor that exits on its own. That is a background shell (`@dltech/atlas-plugin-shells`).
- The tunnel. The daemon supervises one `cloudflared` per pod from boot; a publish only ensures it
  runs. A service stopping never stops the tunnel.

## Entry points

| Import                                  | Use it for                                                                                          |
| --------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `@dltech/atlas-plugin-services/core`    | `servicesCoreSlots`, the declaration parser, the `services` view, `ServiceRow` and `service-ready`. |
| `@dltech/atlas-plugin-services/pod`     | `servicesPod`: the tool, the daemon hook, the reconcile, the resume and the prompt fragment.        |
| `@dltech/atlas-plugin-services/control` | `servicesControl`, an empty control slot.                                                           |
| `@dltech/atlas-plugin-services/client`  | `servicesClient`, `servicesOfView`, `previewsOfView` and the `PreviewItem` type.                    |

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

`start` also takes a `description` and a `workdir` for an ad-hoc `command`, and a `readyTimeoutMs` in either form.

### The core and client slots

`servicesCoreSlots` gives the `service-ready` event, the `services` view and one command:

| Command    | Arguments              | What it does                                                                     |
| ---------- | ---------------------- | -------------------------------------------------------------------------------- |
| `/service` | `<stop\|restart> <id>` | Stop or restart a service by id. Runs in the host, never in a session catalogue. |

`serviceHandlerOf(ctx)` in `src/pod/commands.ts` calls the same `stopServiceAction` and
`restartService` the `service` tool calls, so a service stopped from a drawer and one stopped by
the model take one code path. It appends one `command-applied` row naming its inbox id once it has
acted, so a holder that takes the session over does not run the command again. It takes no `start` action: a declared-but-stopped service has no
row, so the operator has nothing to act on. It refuses a line with no service id, and a refused
stop or restart carries the daemon's own sentence. `servicesClient` gives one hook,
`services-roster`, which applies to the `service-*` events.

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
- A declared service runs in the checkout the thread stands in. In a worktree, its `.atlas/services.yaml` is read, a relative `cwd` resolves inside the worktree, and its `setup` runs once for that worktree.
- One declared name runs once per checkout. Two worktrees run the same name at once: the second gets a port of its own (derived from the name and the checkout) when another service already runs on the declared port, so its preview URL differs too. The command must listen on `$PORT`.
- A process outside the services that holds the declared port does not move the service. A container published on that port answers the ready check, and a real clash fails loudly with the port in use.
- `${services.<name>.url|port|publicUrl}` in `env` resolves against the services of the same checkout, and starts them first.
- `stop`, `restart` and the stale mark of a `name` act on the service of the current checkout. A list row names the worktree branch.
- `start` takes a `name` or a `command`, never both.
- When the daemon restarts, or a host reattaches after one, each declared service that was running
  is stopped in the sandbox, ended in the transcript with cause `SandboxStopped` and started again in
  declaration order, on the same port and behind the same URL. A pid the record cannot prove was
  that service is left running, and may still hold the port. An ad-hoc `command`
  service stays ended: its env and its setup exist only in the call that started it.
- `restart` takes a `serviceId` or a `name`, exactly one.
- Import the pod tier in a pod only. It spawns processes on the host of the session.

## See also

- `docs/architecture.md`
- `docs/decisions/0019-v2-package-map.md`
- `.atlas/services.yaml` in this repository for a real declaration.
