---
name: voicebox
description: Generate text-to-speech audio, manage voice profiles, and control TTS engines via the @keeb/voicebox swamp extension. Use when the user wants to synthesize speech, clone voices, upload voice samples, load TTS models (qwen, luxtts, chatterbox, chatterbox_turbo, tada, kokoro), seed preset profiles, check Voicebox server health or GPU status, or list generation history. Triggers on "TTS", "text to speech", "speech generation", "synthesize voice", "voice profile", "voice cloning", "generate audio", "Voicebox", "load TTS model", "voice sample".
---

# voicebox

Swamp extension wrapping the Voicebox TTS HTTP API for voice profile management
and speech synthesis.

## Model

### `@keeb/voicebox`

Single model that talks to a local Voicebox server (default
`http://127.0.0.1:17493`).

**Global arguments:**

- `baseUrl` (string, default `http://127.0.0.1:17493`) — Voicebox API base URL.

**Methods:**

| Method           | Arguments                                                                    | Purpose                                                     |
| ---------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `health`         | none                                                                         | Check server health, GPU availability, VRAM, backend.       |
| `load-model`     | `engine`, `modelSize`                                                        | Load a TTS engine into GPU memory.                          |
| `list-profiles`  | none                                                                         | List all voice profiles.                                    |
| `create-profile` | `name`, `description?`, `language`, `voiceType`, `defaultEngine?`            | Create a voice profile.                                     |
| `delete-profile` | `profileId`                                                                  | Delete a voice profile.                                     |
| `generate`       | `profileId`, `text`, `language`, `engine`, `modelSize`, `instruct?`, `seed?` | Generate speech, poll to completion, save audio + metadata. |
| `history`        | `limit`, `offset`                                                            | List generation history.                                    |
| `seed-presets`   | `engine`                                                                     | Seed preset voice profiles for an engine.                   |
| `add-sample`     | `profileId`, `filePath`, `referenceText?`                                    | Upload an audio sample (auto-transcribes if no reference).  |
| `model-status`   | none                                                                         | Status of all loaded/downloaded TTS models.                 |

**Engines:** `qwen` (default), `luxtts`, `chatterbox`, `chatterbox_turbo`,
`tada`, `kokoro`.

**Qwen model sizes:** `0.6B`, `1B`, `1.7B` (default), `3B`. Other engines ignore
`modelSize`.

**Languages:** `en` (default), `zh`, `ja`, `ko`, `de`, `fr`, `ru`, `pt`, `es`,
`it`, `he`, `ar`.

**Voice types:** `cloned` (default), `preset`, `designed`.

## Resources

| Resource     | Lifetime | Notes                                          |
| ------------ | -------- | ---------------------------------------------- |
| `health`     | 1h       | Server health snapshot keyed `current`.        |
| `profile`    | infinite | One per voice profile (keyed by profile id).   |
| `generation` | infinite | TTS metadata keyed by generation id.           |
| `history`    | 1h       | History snapshot keyed `latest`.               |
| `models`     | 1h       | Loaded model status (keys `loaded`, `status`). |
| `sample`     | infinite | Per-sample metadata.                           |

## File artifacts

- `audio` (`audio/wav`, infinite lifetime, GC retains 50) — written by
  `generate` as `gen-<generationId>`.

## Common patterns

### Define an input

```yaml
kind: voicebox
type: "@keeb/voicebox"
name: my-voicebox
arguments:
  baseUrl: "http://127.0.0.1:17493"
```

### Generate speech in a workflow step

```yaml
- name: synthesize
  input: my-voicebox
  method: generate
  arguments:
    profileId: "${{ steps.create-voice.outputs.profile.id }}"
    text: "Hello from swamp."
    language: en
    engine: qwen
    modelSize: "1.7B"
    instruct: "speak slowly and warmly"
```

`generate` polls the Voicebox server every 3s for up to 120 attempts (~6
minutes) before failing with a timeout. The audio file lands as the `audio`
artifact (`gen-<id>`); the matching `generation` resource holds the metadata.

### Clone a voice from a sample

```yaml
- name: create-profile
  input: my-voicebox
  method: create-profile
  arguments:
    name: "alice"
    language: en
    voiceType: cloned
    defaultEngine: qwen

- name: add-sample
  input: my-voicebox
  method: add-sample
  arguments:
    profileId: "${{ steps.create-profile.outputs.profile.id }}"
    filePath: "/absolute/path/to/sample.ogg"
```

`add-sample` reads the file from the local filesystem with `Deno.readFile`, so
`filePath` MUST be an absolute path readable by the swamp process. If
`referenceText` is omitted, Voicebox transcribes the audio first via
`/transcribe`.

### Bootstrap presets for a fresh server

```yaml
- name: load-engine
  input: my-voicebox
  method: load-model
  arguments:
    engine: chatterbox

- name: seed
  input: my-voicebox
  method: seed-presets
  arguments:
    engine: chatterbox
```

## Querying generated data

Use `swamp data` and CEL predicates against the resources written above:

```bash
swamp data list --type "@keeb/voicebox/generation"
swamp data query --type "@keeb/voicebox/profile" \
  --where 'data.language == "en" && data.voiceType == "cloned"'
```

## Gotchas

- **Local server required.** The default `baseUrl` is `127.0.0.1:17493`. Set
  `baseUrl` in the input arguments to point at a remote Voicebox instance.
- **GPU must be ready.** Run `health` first to confirm `gpuAvailable` and check
  `backendType` before issuing `generate`. `load-model` must be called for the
  desired engine before generation will succeed.
- **`generate` is long-running.** It blocks while polling — total wait may
  exceed 6 minutes for long inputs. Workflows that fan out generations should
  expect step duration in minutes, not seconds.
- **SSE responses.** `/generate` and a few other endpoints may return
  `text/event-stream` style bodies (`data: {...}\n`). The model already handles
  both SSE and plain JSON, so consumers do not need to special-case it.
- **`modelSize` only matters for `qwen`.** It is accepted by `load-model` and
  `generate` for all engines but ignored server-side by non-Qwen backends.
- **Audio MIME inference.** `add-sample` infers content type from the file
  extension (`ogg`, `wav`, `mp3`, `m4a`, `webm`, `flac`); unknown extensions
  default to `audio/ogg`.
- **No vault dependency.** Voicebox currently has no auth layer, so no vault
  credentials are wired up. If you front the API with auth, add a vault and
  inject the secret via `globalArguments` in a fork.
- **No cross-extension dependencies.** Voicebox stands alone — it does not
  consume resources from other extensions.
