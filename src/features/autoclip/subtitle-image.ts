import type { SubtitleStyle } from "./types";

/**
 * Renders one subtitle line onto a transparent PNG sized exactly to the output
 * video frame, with position/style baked in. The default ffmpeg.wasm core has
 * neither libass (`subtitles=`) nor libfreetype (`drawtext=`) compiled in, so
 * burning captions has to happen via plain image overlay instead — this is
 * the image that gets overlaid.
 */
export async function renderSubtitleFrame(
  text: string,
  style: SubtitleStyle,
  width: number,
  height: number,
): Promise<Uint8Array> {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context tidak tersedia di browser ini.");

  ctx.clearRect(0, 0, width, height);

  const fontSize = Math.max(12, Math.round((style.fontSize / 720) * height));
  const weight = style.bold ? "700" : "400";
  ctx.font = `${weight} ${fontSize}px Arial, Helvetica, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  const maxWidth = width * 0.86;
  const lines = wrapText(ctx, text, maxWidth);
  const lineHeight = fontSize * 1.25;
  const blockHeight = lines.length * lineHeight;

  const marginV = style.position === "center" ? 0 : Math.round(height * 0.08);
  let centerY: number;
  if (style.position === "top") centerY = marginV + blockHeight / 2;
  else if (style.position === "center") centerY = height / 2;
  else centerY = height - marginV - blockHeight / 2;

  const x = width / 2;
  lines.forEach((line, index) => {
    const y = centerY - blockHeight / 2 + lineHeight * (index + 0.5);

    if (style.background) {
      const metrics = ctx.measureText(line);
      const paddingX = fontSize * 0.35;
      const boxWidth = metrics.width + paddingX * 2;
      ctx.fillStyle = "rgba(0,0,0,0.5)";
      ctx.fillRect(x - boxWidth / 2, y - lineHeight / 2, boxWidth, lineHeight);
    }

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
      ctx.strokeText(line, x, y);
    }

    ctx.fillStyle = "#ffffff";
    ctx.fillText(line, x, y);
  });

  const blob: Blob = await new Promise((resolve, reject) => {
    canvas.toBlob((result) => {
      if (result) resolve(result);
      else reject(new Error("Gagal me-render subtitle jadi gambar."));
    }, "image/png");
  });

  return new Uint8Array(await blob.arrayBuffer());
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const trial = current ? `${current} ${word}` : word;
    if (ctx.measureText(trial).width > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = trial;
    }
  }
  if (current) lines.push(current);
  return lines.length > 0 ? lines : [text];
}
