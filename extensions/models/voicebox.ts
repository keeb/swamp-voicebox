import { z } from "npm:zod@4";

const BASE_URL = "http://127.0.0.1:17493";

// --- Helpers ---

async function api(
  path: string,
  opts: RequestInit = {},
): Promise<Response> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...opts.headers,
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      `Voicebox API ${opts.method ?? "GET"} ${path} → ${res.status}: ${body}`,
    );
  }
  return res;
}

async function json(path: string, opts: RequestInit = {}) {
  const res = await api(path, opts);
  const text = await res.text();
  // Handle SSE responses (data: {...}\n)
  if (text.startsWith("data: ")) {
    // deno-lint-ignore no-explicit-any
    let last: Record<string, any> | null = null;
    for (const line of text.split("\n")) {
      if (line.startsWith("data: ")) {
        try {
          last = JSON.parse(line.slice(6));
        } catch { /* skip */ }
      }
    }
    if (last) return last;
  }
  return JSON.parse(text);
}

// --- Schemas ---

const HealthSchema = z.object({
  status: z.string(),
  modelLoaded: z.boolean(),
  gpuAvailable: z.boolean(),
  gpuType: z.string().nullable().optional(),
  vramUsedMb: z.number().nullable().optional(),
  backendType: z.string().nullable().optional(),
  backendVariant: z.string().nullable().optional(),
});

const ProfileSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable().optional(),
  language: z.string(),
  voiceType: z.string().optional(),
  defaultEngine: z.string().nullable().optional(),
  generationCount: z.number().optional(),
  sampleCount: z.number().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

const GenerationSchema = z.object({
  id: z.string(),
  profileId: z.string(),
  text: z.string(),
  language: z.string(),
  duration: z.number().nullable().optional(),
  seed: z.number().nullable().optional(),
  instruct: z.string().nullable().optional(),
  engine: z.string().nullable().optional(),
  modelSize: z.string().nullable().optional(),
  status: z.string(),
  error: z.string().nullable().optional(),
  createdAt: z.string().optional(),
});

const HistorySchema = z.object({
  generations: z.array(GenerationSchema),
  total: z.number(),
});

const ModelStatusSchema = z.object({
  models: z.array(z.object({
    name: z.string(),
    loaded: z.boolean(),
    downloaded: z.boolean().optional(),
    size: z.string().nullable().optional(),
  })),
});

const SampleSchema = z.object({
  id: z.string(),
  profileId: z.string(),
  filename: z.string(),
  duration: z.number().nullable().optional(),
  createdAt: z.string().optional(),
});

const GlobalArgsSchema = z.object({
  baseUrl: z.string().default("http://127.0.0.1:17493").describe(
    "Voicebox API base URL",
  ),
});

// --- Model ---

export const model = {
  type: "@keeb/voicebox",
  version: "2026.03.24.1",
  globalArguments: GlobalArgsSchema,
  files: {
    audio: {
      description: "Generated audio file",
      contentType: "audio/wav",
      lifetime: "infinite" as const,
      garbageCollection: 50,
    },
  },
  resources: {
    health: {
      description: "Voicebox server health status",
      schema: HealthSchema,
      lifetime: "1h" as const,
      garbageCollection: 5,
    },
    profile: {
      description: "Voice profile",
      schema: ProfileSchema,
      lifetime: "infinite" as const,
      garbageCollection: 20,
    },
    generation: {
      description: "TTS generation result",
      schema: GenerationSchema,
      lifetime: "infinite" as const,
      garbageCollection: 50,
    },
    history: {
      description: "Generation history snapshot",
      schema: HistorySchema,
      lifetime: "1h" as const,
      garbageCollection: 5,
    },
    models: {
      description: "Loaded model status",
      schema: ModelStatusSchema,
      lifetime: "1h" as const,
      garbageCollection: 5,
    },
    sample: {
      description: "Voice profile sample",
      schema: SampleSchema,
      lifetime: "infinite" as const,
      garbageCollection: 50,
    },
  },
  methods: {
    health: {
      description: "Check Voicebox server health and GPU status",
      arguments: z.object({}),
      execute: async (_args, context) => {
        const data = await json("/health");
        const handle = await context.writeResource("health", "current", {
          status: data.status,
          modelLoaded: data.model_loaded,
          gpuAvailable: data.gpu_available,
          gpuType: data.gpu_type,
          vramUsedMb: data.vram_used_mb,
          backendType: data.backend_type,
          backendVariant: data.backend_variant,
        });
        return { dataHandles: [handle] };
      },
    },

    "load-model": {
      description: "Load a TTS model into GPU memory",
      arguments: z.object({
        engine: z.enum([
          "qwen",
          "luxtts",
          "chatterbox",
          "chatterbox_turbo",
          "tada",
          "kokoro",
        ]).default("qwen")
          .describe("TTS engine to load"),
        modelSize: z.enum(["0.6B", "1B", "1.7B", "3B"]).default("1.7B")
          .describe("Model size (Qwen only)"),
      }),
      execute: async (args, context) => {
        await json("/models/load", {
          method: "POST",
          body: JSON.stringify({
            engine: args.engine,
            model_size: args.modelSize,
          }),
        });
        const handle = await context.writeResource("models", "loaded", {
          models: [{
            name: `${args.engine}/${args.modelSize}`,
            loaded: true,
            size: args.modelSize,
          }],
        });
        return { dataHandles: [handle] };
      },
    },

    "list-profiles": {
      description: "List all voice profiles",
      arguments: z.object({}),
      execute: async (_args, context) => {
        const profiles = await json("/profiles");
        const handles = [];
        for (const p of profiles) {
          const handle = await context.writeResource("profile", p.id, {
            id: p.id,
            name: p.name,
            description: p.description,
            language: p.language,
            voiceType: p.voice_type,
            defaultEngine: p.default_engine,
            generationCount: p.generation_count,
            sampleCount: p.sample_count,
            createdAt: p.created_at,
            updatedAt: p.updated_at,
          });
          handles.push(handle);
        }
        return { dataHandles: handles };
      },
    },

    "create-profile": {
      description: "Create a new voice profile for TTS generation",
      arguments: z.object({
        name: z.string().describe("Profile name"),
        description: z.string().optional().describe("Profile description"),
        language: z.enum([
          "en",
          "zh",
          "ja",
          "ko",
          "de",
          "fr",
          "ru",
          "pt",
          "es",
          "it",
          "he",
          "ar",
        ]).default("en"),
        voiceType: z.enum(["cloned", "preset", "designed"]).default("cloned"),
        defaultEngine: z.enum([
          "qwen",
          "luxtts",
          "chatterbox",
          "chatterbox_turbo",
          "tada",
          "kokoro",
        ]).optional(),
      }),
      execute: async (args, context) => {
        const data = await json("/profiles", {
          method: "POST",
          body: JSON.stringify({
            name: args.name,
            description: args.description,
            language: args.language,
            voice_type: args.voiceType,
            default_engine: args.defaultEngine,
          }),
        });
        const handle = await context.writeResource("profile", data.id, {
          id: data.id,
          name: data.name,
          description: data.description,
          language: data.language,
          voiceType: data.voice_type,
          defaultEngine: data.default_engine,
          generationCount: data.generation_count,
          sampleCount: data.sample_count,
          createdAt: data.created_at,
          updatedAt: data.updated_at,
        });
        return { dataHandles: [handle] };
      },
    },

    "delete-profile": {
      description: "Delete a voice profile",
      arguments: z.object({
        profileId: z.string().describe("Profile ID to delete"),
      }),
      execute: async (args, _context) => {
        await api(`/profiles/${args.profileId}`, { method: "DELETE" });
        return { dataHandles: [] };
      },
    },

    generate: {
      description:
        "Generate speech from text using a voice profile — polls to completion and saves audio",
      arguments: z.object({
        profileId: z.string().describe("Voice profile ID"),
        text: z.string().describe("Text to synthesize"),
        language: z.enum([
          "en",
          "zh",
          "ja",
          "ko",
          "de",
          "fr",
          "ru",
          "pt",
          "es",
          "it",
          "he",
          "ar",
        ]).default("en"),
        engine: z.enum([
          "qwen",
          "luxtts",
          "chatterbox",
          "chatterbox_turbo",
          "tada",
          "kokoro",
        ]).default("qwen"),
        modelSize: z.enum(["0.6B", "1B", "1.7B", "3B"]).default("1.7B"),
        instruct: z.string().optional().describe(
          "Voice style instruction (e.g. 'speak slowly and softly')",
        ),
        seed: z.number().optional().describe("Random seed for reproducibility"),
      }),
      execute: async (args, context) => {
        // Submit generation — API may return SSE stream
        const genRes = await fetch(`${BASE_URL}/generate`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Accept": "application/json",
          },
          body: JSON.stringify({
            profile_id: args.profileId,
            text: args.text,
            language: args.language,
            engine: args.engine,
            model_size: args.modelSize,
            instruct: args.instruct,
            seed: args.seed,
          }),
        });
        if (!genRes.ok) {
          const body = await genRes.text();
          throw new Error(`Generate failed: ${genRes.status}: ${body}`);
        }

        // Parse response — handle both SSE and plain JSON
        const rawBody = await genRes.text();
        // deno-lint-ignore no-explicit-any
        let data: Record<string, any> | null = null;
        if (rawBody.startsWith("data: ")) {
          for (const line of rawBody.split("\n")) {
            if (line.startsWith("data: ")) {
              try {
                data = JSON.parse(line.slice(6));
              } catch { /* skip */ }
            }
          }
        } else {
          data = JSON.parse(rawBody);
        }
        if (!data?.id) {
          throw new Error(
            `No generation ID in response: ${rawBody.slice(0, 200)}`,
          );
        }

        const genId = data.id;
        context.logger.info(`Generation ${genId} submitted, polling...`);

        // Poll until completed or failed
        let result = data;
        const maxAttempts = 120;
        for (let i = 0; i < maxAttempts; i++) {
          if (result.status === "completed" || result.status === "failed") {
            break;
          }
          await new Promise((r) => setTimeout(r, 3000));
          result = await json(`/generate/${genId}/status`);
          context.logger.info(`Poll ${i + 1}: ${result.status}`);
        }

        if (result.status === "failed") {
          throw new Error(
            `Generation failed: ${result.error ?? "unknown error"}`,
          );
        }
        if (result.status !== "completed") {
          throw new Error(
            `Generation timed out after ${
              maxAttempts * 5
            }s, status: ${result.status}`,
          );
        }

        // Download the audio
        context.logger.info(`Downloading audio for generation ${genId}...`);
        const audioRes = await fetch(`${BASE_URL}/audio/${genId}`);
        if (!audioRes.ok) {
          throw new Error(`Failed to download audio: ${audioRes.status}`);
        }

        // Save audio as file artifact
        const audioWriter = context.createFileWriter("audio", `gen-${genId}`, {
          contentType: audioRes.headers.get("content-type") ?? "audio/wav",
        });
        const audioHandle = await audioWriter.writeStream(audioRes.body);

        // Save metadata as resource
        const metaHandle = await context.writeResource("generation", genId, {
          id: genId,
          profileId: result.profile_id,
          text: result.text,
          language: result.language,
          duration: result.duration,
          seed: result.seed,
          instruct: result.instruct,
          engine: result.engine,
          modelSize: result.model_size,
          status: result.status,
          error: result.error,
          createdAt: result.created_at,
        });

        context.logger.info(`Done — ${result.duration}s audio saved`);
        return { dataHandles: [audioHandle, metaHandle] };
      },
    },

    history: {
      description: "List generation history",
      arguments: z.object({
        limit: z.number().default(20).describe("Max results to return"),
        offset: z.number().default(0).describe("Offset for pagination"),
      }),
      execute: async (args, context) => {
        const data = await json(
          `/history?limit=${args.limit}&offset=${args.offset}`,
        );
        const handle = await context.writeResource("history", "latest", {
          generations: (data.generations ?? data).map((g) => ({
            id: g.id,
            profileId: g.profile_id,
            text: g.text,
            language: g.language,
            duration: g.duration,
            seed: g.seed,
            instruct: g.instruct,
            engine: g.engine,
            modelSize: g.model_size,
            status: g.status,
            error: g.error,
            createdAt: g.created_at,
          })),
          total: data.total ?? (data.generations ?? data).length,
        });
        return { dataHandles: [handle] };
      },
    },

    "seed-presets": {
      description: "Seed preset voice profiles for an engine",
      arguments: z.object({
        engine: z.enum([
          "qwen",
          "luxtts",
          "chatterbox",
          "chatterbox_turbo",
          "tada",
          "kokoro",
        ]).default("qwen"),
      }),
      execute: async (args, context) => {
        const data = await json(`/profiles/presets/${args.engine}/seed`, {
          method: "POST",
        });
        const handles = [];
        for (const p of (data.profiles ?? data ?? [])) {
          const handle = await context.writeResource("profile", p.id, {
            id: p.id,
            name: p.name,
            description: p.description,
            language: p.language,
            voiceType: p.voice_type ?? "preset",
            defaultEngine: p.default_engine ?? args.engine,
            generationCount: p.generation_count ?? 0,
            sampleCount: p.sample_count ?? 0,
            createdAt: p.created_at,
            updatedAt: p.updated_at,
          });
          handles.push(handle);
        }
        return { dataHandles: handles };
      },
    },

    "add-sample": {
      description:
        "Upload an audio file as a voice sample to a profile (transcribes first if no reference text)",
      arguments: z.object({
        profileId: z.string().describe("Voice profile ID"),
        filePath: z.string().describe(
          "Absolute path to audio file (ogg, wav, mp3, etc)",
        ),
        referenceText: z.string().optional().describe(
          "Transcript of audio — auto-transcribed if omitted",
        ),
      }),
      execute: async (args, context) => {
        const fileData = await Deno.readFile(args.filePath);
        const filename = args.filePath.split("/").pop() ?? "sample.ogg";
        const ext = filename.split(".").pop()?.toLowerCase() ?? "ogg";
        const mimeMap: Record<string, string> = {
          ogg: "audio/ogg",
          wav: "audio/wav",
          mp3: "audio/mpeg",
          m4a: "audio/mp4",
          webm: "audio/webm",
          flac: "audio/flac",
        };
        const contentType = mimeMap[ext] ?? "audio/ogg";
        const blob = new Blob([fileData], { type: contentType });

        let refText = args.referenceText;
        if (!refText) {
          context.logger.info(`Transcribing ${filename}...`);
          const txForm = new FormData();
          txForm.append("file", blob, filename);
          const txRes = await fetch(`${BASE_URL}/transcribe`, {
            method: "POST",
            body: txForm,
          });
          if (!txRes.ok) {
            const body = await txRes.text();
            throw new Error(`Transcribe failed: ${txRes.status}: ${body}`);
          }
          const txData = await txRes.json();
          refText = txData.text;
          context.logger.info(`Transcription: "${refText}"`);
        }

        const formData = new FormData();
        formData.append("file", blob, filename);
        formData.append("reference_text", refText);

        const res = await fetch(
          `${BASE_URL}/profiles/${args.profileId}/samples`,
          {
            method: "POST",
            body: formData,
          },
        );
        if (!res.ok) {
          const body = await res.text();
          throw new Error(`Upload sample failed: ${res.status}: ${body}`);
        }
        const data = await res.json();
        const handle = await context.writeResource("sample", data.id, {
          id: data.id,
          profileId: args.profileId,
          filename: filename,
          duration: data.duration,
          createdAt: data.created_at,
        });
        return { dataHandles: [handle] };
      },
    },

    "model-status": {
      description: "Get status of all loaded TTS models",
      arguments: z.object({}),
      execute: async (_args, context) => {
        const data = await json("/models/status");
        const handle = await context.writeResource("models", "status", {
          models: (data.models ?? []).map((m) => ({
            name: m.name,
            loaded: m.loaded,
            downloaded: m.downloaded,
            size: m.size,
          })),
        });
        return { dataHandles: [handle] };
      },
    },
  },
};
