# @keeb/voicebox

[Swamp](https://github.com/systeminit/swamp) extension for Voicebox TTS API — voice profile management and speech generation.

## Models

### `@voicebox/api`

Manage voice profiles and generate speech using Voicebox.

| Method | Description |
|--------|-------------|
| `health` | Check server health and GPU status |
| `load-model` | Load a TTS model into GPU memory |
| `list-profiles` | List all voice profiles |
| `create-profile` | Create a new voice profile |
| `delete-profile` | Delete a voice profile |
| `generate` | Generate speech from text (polls to completion, saves audio) |
| `history` | List generation history |
| `seed-presets` | Seed preset voice profiles for an engine |
| `add-sample` | Upload an audio sample to a profile |
| `model-status` | Get status of all loaded TTS models |

**Global arguments:** `baseUrl`

## Install

```bash
swamp extension pull @keeb/voicebox
```

## License

MIT
