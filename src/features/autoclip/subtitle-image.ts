import type { SubtitleStyle } from "./types";
import { getFontPreset, loadFontForCanvas } from "./fonts";

/**
 * Renders one subtitle frame onto a transparent PNG sized exactly to the output
 * video frame, with position/style baked in. The default ffmpeg.wasm core has
 * neither libass (`subtitles=`) nor libfreetype (`drawtext=`) compiled in, so
 * burning captions has to happen via plain image overlay instead — this is
 * the image that gets overlaid.
 *
 * When `activeWordIndex` is given, that word (from `words`) is drawn in an
 * accent color while the rest stay white — the classic karaoke-caption look.
 * Without word data, the whole line renders plain white (original behaviour).
 */
export async function renderSubtitleFrame(
  text: string,
  style: SubtitleStyle,
  width: number,
  height: number,
  words?: string[],
  activeWordIndex?: number,
): Promise<Uint8Array> {
  const preset = getFontPreset(style.fontFamily);
  await loadFontForCanvas(preset);
  const toDisplay = (value: string) => (preset.uppercase ? value.toUpperCase() : value);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context tidak tersedia di browser ini.");

  ctx.clearRect(0, 0, width, height);

  const fontSize = Math.max(12, Math.round((style.fontSize / 720) * height));
  const weight = style.bold ? "700" : preset.weight;
  ctx.font = `${weight} ${fontSize}px ${preset.cssFamily}`;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";

  const maxWidth = width * 0.86;
  const rawTokens = words && words.length > 0 ? words : text.split(/\s+/).filter(Boolean);
  const tokens = rawTokens.map(toDisplay);
  const lines = wrapTokens(ctx, tokens, maxWidth);
  const lineHeight = fontSize * 1.25;
  const blockHeight = lines.length * lineHeight;

  const marginV = style.position === "center" ? 0 : Math.round(height * 0.08);
  let centerY: number;
  if (style.position === "top") centerY = marginV + blockHeight / 2;
  else if (style.position === "center") centerY = height / 2;
  else centerY = height - marginV - blockHeight / 2;

  const cx = width / 2;
  const spaceWidth = ctx.measureText(" ").width;

  let tokenCursor = 0;
  lines.forEach((line, lineIndex) => {
    const y = centerY - blockHeight / 2 + lineHeight * (lineIndex + 0.5);
    const lineWidth = line.reduce((sum, word, i) => sum + ctx.measureText(word).width + (i > 0 ? spaceWidth : 0), 0);
    let x = cx - lineWidth / 2;

    if (style.background) {
      const paddingX = fontSize * 0.35;
      ctx.fillStyle = "rgba(0,0,0,0.5)";
      ctx.fillRect(x - paddingX, y - lineHeight / 2, lineWidth + paddingX * 2, lineHeight);
    }

    line.forEach((word) => {
      const isActive = activeWordIndex !== undefined && tokenCursor === activeWordIndex;

      if (style.shadow) {
        ctx.shadowColor = "rgba(0,0,0,0.85)";
        ctx.shadowBlur = fontSize * 0.15;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = fontSize * 0.05;
      } else {
        ctx.shadowColor = "transparent";
        ctx.shadowBlur = 0;
      }

      if (style.stroke > 0) {
        ctx.lineWidth = Math.max(1, style.stroke * (fontSize / 32));
        ctx.strokeStyle = "rgba(0,0,0,0.9)";
        ctx.lineJoin = "round";
        ctx.miterLimit = 2;
        ctx.strokeText(word, x, y);
      }

      ctx.fillStyle = isActive ? preset.highlightColor : preset.color;
      ctx.fillText(word, x, y);

      x += ctx.measureText(word).width + spaceWidth;
      tokenCursor += 1;
    });
  });

  const blob: Blob = await new Promise((resolve, reject) => {
    canvas.toBlob((result) => {
      if (result) resolve(result);
      else reject(new Error("Gagal me-render subtitle jadi gambar."));
    }, "image/png");
  });

  return new Uint8Array(await blob.arrayBuffer());
}

function wrapTokens(ctx: CanvasRenderingContext2D, tokens: string[], maxWidth: number): string[][] {
  const spaceWidth = ctx.measureText(" ").width;
  const lines: string[][] = [];
  let current: string[] = [];
  let currentWidth = 0;

  for (const token of tokens) {
    const tokenWidth = ctx.measureText(token).width;
    const trialWidth = currentWidth + (current.length > 0 ? spaceWidth : 0) + tokenWidth;
    if (trialWidth > maxWidth && current.length > 0) {
      lines.push(current);
      current = [token];
      currentWidth = tokenWidth;
    } else {
      current.push(token);
      currentWidth = trialWidth;
    }
  }
  if (current.length > 0) lines.push(current);
  return lines.length > 0 ? lines : [tokens];
}
