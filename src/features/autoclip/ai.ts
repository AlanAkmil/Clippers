import { getEngine } from "./engine";
import { scoreHighlightsAi, transcribeAudioAi, translateCuesAi } from "./ai.server";
import type { AiHighlightSuggestion, AiTranscribeResult, SubtitleCue } from "./types";

const MAX_AUDIO_BYTES = 24 * 1024 * 1024;
const TRANSLATE_BATCH_SIZE = 15;
const RATE_LIMIT_WAIT_MS = 21_000;
const MAX_RETRIES = 4;

export interface AiTranscribeCallbacks {
  onStage?: (label: string) => void;
}

/**
 * Extracts a small, compressed audio track from the source video (client-side,
 * via ffmpeg.wasm) and sends only that to Groq Whisper for a transcript.
 * The video itself never leaves the device — only the compressed audio does.
 */
export async function generateAiTranscript(
  file: Blob,
  callbacks: AiTranscribeCallbacks = {},
  languageHint?: string,
): Promise<AiTranscribeResult> {
  callbacks.onStage?.("Menyiapkan engine video…");
  const engine = await getEngine();

  const inputName = "ai-source.input";
  const outputName = "ai-audio.ogg";
  const bytes = new Uint8Array(await file.arrayBuffer());
  await engine.writeFile(inputName, bytes);

  callbacks.onStage?.("Mengompres audio buat AI…");
  await engine.exec(["-i", inputName, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "libvorbis", "-b:a", "32k", outputName]);

  const data = (await engine.readFile(outputName)) as Uint8Array;
  const copy = new Uint8Array(data.length);
  copy.set(data);
  const audioBlob = new Blob([copy], { type: "audio/ogg" });

  await engine.deleteFile(inputName).catch(() => undefined);
  await engine.deleteFile(outputName).catch(() => undefined);

  if (audioBlob.size > MAX_AUDIO_BYTES) {
    throw new Error(
      `Audio hasil kompresi ${(audioBlob.size / (1024 * 1024)).toFixed(1)}MB, kelebihan dari batas ~24MB Groq. Coba video yang lebih pendek, atau upload subtitle .srt/.vtt manual.`,
    );
  }

  callbacks.onStage?.("Mengirim ke AI buat transkrip…");
  const form = new FormData();
  form.append("audio", audioBlob, "audio.ogg");
  if (languageHint) form.append("language", languageHint);
  return transcribeAudioAi({ data: form });
}

/** Asks the AI to pick the most viral time windows from an existing transcript. */
export async function generateAiHighlights(
  cues: AiTranscribeResult["cues"],
  duration: number,
  clipLength: number,
  clipCount: number,
  language?: string | null,
): Promise<AiHighlightSuggestion[]> {
  return scoreHighlightsAi({ data: { cues, duration, clipLength, clipCount, language } });
}

/**
 * Translates every cue's text to `targetLanguage`, batched to stay under
 * Groq's free-tier tokens-per-minute limit. Timing is untouched — only text changes.
 * Automatically waits & retries if a batch hits the rate limit.
 */
export async function translateCues(
  cues: SubtitleCue[],
  targetLanguage: string,
  onProgress?: (done: number, total: number) => void,
): Promise<SubtitleCue[]> {
  const results: SubtitleCue[] = [];
  for (let i = 0; i < cues.length; i += TRANSLATE_BATCH_SIZE) {
    const batch = cues.slice(i, i + TRANSLATE_BATCH_SIZE);

    let translated: SubtitleCue[] | null = null;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
      try {
        translated = await translateCuesAi({ data: { cues: batch, targetLanguage } });
        break;
      } catch (error) {
        const isRateLimit = error instanceof Error && /429|rate limit/i.test(error.message);
        if (isRateLimit && attempt < MAX_RETRIES) {
          onProgress?.(results.length, cues.length);
          await sleep(RATE_LIMIT_WAIT_MS);
          continue;
        }
        throw error;
      }
    }

    results.push(...(translated ?? batch));
    onProgress?.(results.length, cues.length);
    if (i + TRANSLATE_BATCH_SIZE < cues.length) {
      await sleep(800);
    }
  }
  return results;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
