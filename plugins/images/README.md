# @dltech/atlas-plugin-images

One tool that generates or edits an image through the Vercel AI Gateway: `image_generate`. The
image is written under the session directory and returned inline, so web and TUI show it in the
thread. The API composes it as the `images` plugin.

## Owns

- `image_generate`, which calls the gateway, saves one image under the session directory and
  returns it as an inline image part.
- The routing between the two gateway shapes: `google/` image ids run as language models, and
  every other id runs as an image model.
- The Zero Data Retention refusal, and the list of models that support it.

## Does not own

- The gateway API key. `ctx.control.gateway.apiKey()` supplies the key of the session owner's
  Atlas "Vercel AI Gateway" account.
- The chosen image model. `ctx.control.gateway.imageModel()` answers the operator's Settings
  choice, and the tool falls back to `google/gemini-3.1-flash-image`.
- How a client draws an image part. Web and TUI own their renderers.

## Entry points

| Import                                | Use it for                                                    |
| ------------------------------------- | ------------------------------------------------------------- |
| `@dltech/atlas-plugin-images/core`    | `imagesCoreSlots`: no events, views or commands.              |
| `@dltech/atlas-plugin-images/pod`     | `imagesPod`: the tool, and the gateway helpers `generate.ts`. |
| `@dltech/atlas-plugin-images/control` | `imagesControl`, an empty control slot.                       |
| `@dltech/atlas-plugin-images/client`  | `imagesClient`, an empty client slot.                         |

## Capabilities

### Generate an image

- `generateWithGateway(args)`: one image from a prompt, and optional input images that it edits.
  It answers `{ ok: true, bytes, mediaType }` or `{ ok: false, refusal, reason }`.
- `EGenerateRefusal`: `failed`, or `zero-data-retention` when the gateway refuses for ZDR.
- `routeOf(model)`: `text` for a `google/` id, `image` for every other id.
- `GenerateSdk`: the two SDK calls, so a caller can supply its own.

### Find the models that support Zero Data Retention

- `zdrImageModelsIn(payload)`: the image model ids the gateway lists with `zdr` other than `none`.
- `zdrImageModels(signal)`: reads `GATEWAY_MODELS_URL`, and answers `ZDR_FALLBACK_MODELS` when the
  lookup fails.

## Plugin contributions

### The tool the model sees

| Tool             | What it does                                                                                                                                                                          |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `image_generate` | `prompt`, optional `images` (up to 8 absolute sandbox paths to edit), optional `model` (falls back to the operator's chosen image model, `google/gemini-3.1-flash-image` by default). |

The tool writes one file to `<session>/generated-images/` and returns the path, the media type,
the byte length, the width and the height. A picture past the inline limit comes back as text with
the reason. When the gateway refuses a model for Zero Data Retention, the reason lists the models
that support it.

The tool description also tells the model how to write the prompt. The image model never sees the
conversation, so the prompt names what to change, the target finish, and the nearby things that
must stay as they are, one instruction per sentence.

## Usage

```ts
import { definePlugin } from '@dltech/atlas-plugin-sdk'
import { imagesClient } from '@dltech/atlas-plugin-images/client'
import { imagesControl } from '@dltech/atlas-plugin-images/control'
import { imagesCoreSlots } from '@dltech/atlas-plugin-images/core'
import { imagesPod } from '@dltech/atlas-plugin-images/pod'

export const imagesPlugin = definePlugin({
  name: 'images',
  ...imagesCoreSlots,
  pod: imagesPod,
  control: imagesControl,
  client: imagesClient,
  transport: 'none',
})
```

## Rules

- Use the tool in the pod only. It calls the daemon for the session directory and the files.
- Do not hard-code a model list. Read `zdrImageModels` when a refusal names Zero Data Retention.
