import { createServerFn } from "@tanstack/react-start";
import type { AiHighlightSuggestion, AiTranscribeResult, SubtitleCue } from "./types";

// These calls run on the server only (inside .handler), so the key never
// reaches the browser. Set GROQ_API_KEY in your hosting provider's env vars.
const GROQ_BASE = "https://api.groq.com/openai/v1";
const TRANSCRIBE_MODEL = "whisper-large-v3-turbo";
const SCORE_MODEL = "openai/gpt-oss-120b";
const MAX_AUDIO_BYTES = 24 * 1024 * 1024; // Groq free-tier file size limit is 25MB

function requireApiKey(): string {
  const key = process.env.GROQ_API_KEY;
  if (!key) {
    throw new Error(
      "GROQ_API_KEY belum di-set di environment variables server. Tambahin di dashboard hosting (Vercel/Cloudflare) → Settings → Environment Variables, lalu redeploy.",
    );
  }
  return key;
}

/** Sends a short/compressed audio file to Groq Whisper and returns timed cues. */
export const transcribeAudioAi = createServerFn({ method: "POST" })
  .validator((data: FormData) => data)
  .handler(async ({ data }): Promise<AiTranscribeResult> => {
    const apiKey = requireApiKey();
    const file = data.get("audio");
    if (!(file instanceof Blob)) {
      throw new Error("File audio tidak ditemukan di request.");
    }
    if (file.size > MAX_AUDIO_BYTES) {
      throw new Error(
        `Audio ${(file.size / (1024 * 1024)).toFixed(1)}MB, kelebihan dari batas ~24MB. Potong videonya jadi lebih pendek atau upload subtitle manual.`,
      );
    }
    const languageHint = data.get("language");

    const upstream = new FormData();
    upstream.append("file", file, "audio.ogg");
    upstream.append("model", TRANSCRIBE_MODEL);
    upstream.append("response_format", "verbose_json");
    upstream.append("timestamp_granularities[]", "segment");
    if (typeof languageHint === "string" && languageHint) {
      upstream.append("language", languageHint);
    }

    const response = await fetch(`${GROQ_BASE}/audio/transcriptions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: upstream,
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`Groq transcription gagal (${response.status}): ${detail.slice(0, 200)}`);
    }

    const json = (await response.json()) as {
      language?: string;
      segments?: Array<{ start: number; end: number; text: string }>;
    };

    const cues: SubtitleCue[] = (json.segments ?? [])
      .map((segment) => ({
        start: segment.start,
        end: segment.end,
        text: segment.text.trim(),
      }))
      .filter((cue) => cue.text.length > 0);

    return { cues, language: json.language ?? null };
  });

export interface AiScoreInput {
  cues: SubtitleCue[];
  duration: number;
  clipLength: number;
  clipCount: number;
  /** Language the transcript is in (from Whisper's detection), so the AI's
   * reasoning is written in that language instead of always Indonesian. */
  language?: string | null;
}

/** Asks an LLM to read the transcript and pick the most "viral" windows. */
export const scoreHighlightsAi = createServerFn({ method: "POST" })
  .validator((data: AiScoreInput) => data)
  .handler(async ({ data }): Promise<AiHighlightSuggestion[]> => {
    const apiKey = requireApiKey();
    const { cues, duration, clipLength, clipCount, language } = data;
    if (cues.length === 0) return [];

    const transcript = buildTranscriptSample(cues, 5200);
    const reasonLanguage = language ? languageName(language) : "bahasa yang sama dengan transkrip di atas";

    const prompt = [
      `Ini transkrip video berdurasi ${Math.round(duration)} detik, dengan timestamp per baris (sebagian baris di-sample merata biar muat, tapi mewakili seluruh durasi video):`,
      transcript,
      "",
      `Pilih ${clipCount} rentang waktu paling berpotensi VIRAL untuk dijadikan short clip (durasi tiap klip sekitar ${clipLength} detik, boleh sedikit meleset).`,
      "Prioritaskan: hook kuat di awal, momen emosional/lucu/mengejutkan, kutipan yang berdiri sendiri tanpa butuh konteks tambahan, curiosity gap.",
      "Klip tidak boleh saling tumpang tindih dan waktunya harus ada di dalam durasi video.",
      "Balas HANYA JSON array (tanpa markdown, tanpa teks lain) dengan format persis:",
      `[{"start": <detik>, "end": <detik>, "score": <0-100>, "reason": "<alasan singkat 1 kalimat, ditulis dalam ${reasonLanguage}>"}]`,
    ].join("\n");

    const response = await fetch(`${GROQ_BASE}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: SCORE_MODEL,
        temperature: 0.3,
        max_completion_tokens: 1500,
        messages: [
          {
            role: "system",
            content:
              "Kamu editor video short-form profesional yang ahli menentukan momen paling viral dari transkrip panjang. Selalu balas JSON valid saja, tanpa penjelasan tambahan.",
          },
          { role: "user", content: prompt },
        ],
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`Groq scoring gagal (${response.status}): ${detail.slice(0, 200)}`);
    }

    const json = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = json.choices?.[0]?.message?.content ?? "[]";

    return parseSuggestions(content)
      .filter((item) => item.end > item.start && item.start >= 0 && item.end <= duration + 1)
      .slice(0, clipCount);
  });

function parseSuggestions(content: string): AiHighlightSuggestion[] {
  const cleaned = content
    .trim()
    .replace(/^```(json)?/i, "")
    .replace(/```$/, "")
    .trim();
  try {
    const raw = JSON.parse(cleaned) as unknown;
    const list = Array.isArray(raw)
      ? raw
      : ((raw as { clips?: unknown; highlights?: unknown }).clips ??
        (raw as { clips?: unknown; highlights?: unknown }).highlights);
    if (!Array.isArray(list)) return [];
    return list
      .map((item) => {
        const record = item as Record<string, unknown>;
        return {
          start: Number(record.start),
          end: Number(record.end),
          score: clampScore(Number(record.score)),
          reason: typeof record.reason === "string" ? record.reason : "",
        };
      })
      .filter((item) => Number.isFinite(item.start) && Number.isFinite(item.end));
  } catch {
    return [];
  }
}

function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

function buildTranscriptSample(cues: SubtitleCue[], maxChars: number): string {
  const lines = cues.map((cue) => `[${formatTime(cue.start)}-${formatTime(cue.end)}] ${cue.text}`);
  const joined = lines.join("\n");
  if (joined.length <= maxChars) return joined;

  // Free-tier Groq caps tokens per request. Instead of truncating from the start
  // (which would blind the AI to the second half of the video), sample lines
  // evenly across the whole timeline so it still sees the beginning, middle, and end.
  const avgLineLen = joined.length / lines.length;
  const targetCount = Math.max(20, Math.floor(maxChars / (avgLineLen + 1)));
  const stride = lines.length / targetCount;
  const sampled: string[] = [];
  for (let i = 0; i < targetCount; i++) {
    const idx = Math.min(lines.length - 1, Math.floor(i * stride));
    sampled.push(lines[idx]);
  }
  return sampled.join("\n");
}

const LANGUAGE_NAMES: Record<string, string> = {
  id: "Bahasa Indonesia",
  en: "English",
  ja: "Japanese (日本語)",
  ko: "Korean (한국어)",
  zh: "Chinese (中文)",
  es: "Spanish",
  fr: "French",
  de: "German",
  ar: "Arabic",
  hi: "Hindi",
  pt: "Portuguese",
  ru: "Russian",
  vi: "Vietnamese",
  th: "Thai",
  tr: "Turkish",
  ms: "Malay",
  fil: "Filipino",
  nl: "Dutch",
  it: "Italian",
};

function languageName(code: string): string {
  const key = code.toLowerCase();
  return LANGUAGE_NAMES[key] ?? code;
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}
