export interface SubtitleFontPreset {
  id: string;
  label: string;
  cssFamily: string;
  googleFont?: string;
  weight: string;
  uppercase?: boolean;
  color: string;
  highlightColor: string;
}

export const SUBTITLE_FONTS: SubtitleFontPreset[] = [
  { id: "default", label: "Default", cssFamily: "Arial, Helvetica, sans-serif", weight: "400", color: "#ffffff", highlightColor: "#ffd60a" },
  {
    id: "hormozi",
    label: "Hormozi",
    cssFamily: "'Archivo Black', Arial, sans-serif",
    googleFont: "Archivo+Black",
    weight: "900",
    uppercase: true,
    color: "#ffffff",
    highlightColor: "#ffd60a",
  },
  {
    id: "tiktok-pop",
    label: "TikTok Pop",
    cssFamily: "'Poppins', Arial, sans-serif",
    googleFont: "Poppins:wght@800",
    weight: "800",
    color: "#ffffff",
    highlightColor: "#25f4ee",
  },
  {
    id: "neon-glow",
    label: "Neon Glow",
    cssFamily: "'Russo One', Arial, sans-serif",
    googleFont: "Russo+One",
    weight: "400",
    color: "#00f0ff",
    highlightColor: "#ff00e6",
  },
  {
    id: "clean-minimal",
    label: "Clean Minimal",
    cssFamily: "'Inter', Arial, sans-serif",
    googleFont: "Inter:wght@500",
    weight: "500",
    color: "#ffffff",
    highlightColor: "#ffd60a",
  },
  {
    id: "comic-bang",
    label: "Comic Bang",
    cssFamily: "'Bangers', cursive",
    googleFont: "Bangers",
    weight: "400",
    uppercase: true,
    color: "#ffffff",
    highlightColor: "#ff3d3d",
  },
  {
    id: "sermon-elegan",
    label: "Sermon Elegan",
    cssFamily: "'Playfair Display', serif",
    googleFont: "Playfair+Display:wght@700",
    weight: "700",
    color: "#ffffff",
    highlightColor: "#e8c468",
  },
  {
    id: "gaming-energy",
    label: "Gaming Energy",
    cssFamily: "'Orbitron', sans-serif",
    googleFont: "Orbitron:wght@700",
    weight: "700",
    color: "#ffffff",
    highlightColor: "#39ff14",
  },
  {
    id: "typewriter",
    label: "Typewriter",
    cssFamily: "'Courier Prime', monospace",
    googleFont: "Courier+Prime",
    weight: "400",
    color: "#ffffff",
    highlightColor: "#ffd60a",
  },
];

export function getFontPreset(id: string | undefined): SubtitleFontPreset {
  return SUBTITLE_FONTS.find((preset) => preset.id === id) ?? SUBTITLE_FONTS[0]!;
}

let stylesheetInjected = false;

/** Injects a single Google Fonts stylesheet covering every preset, once per page load. */
async function ensureFontsInjected(): Promise<void> {
  if (stylesheetInjected || typeof document === "undefined") return;
  stylesheetInjected = true;

  const families = SUBTITLE_FONTS.filter((preset) => preset.googleFont)
    .map((preset) => `family=${preset.googleFont}`)
    .join("&");
  if (!families) return;

  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = `https://fonts.googleapis.com/css2?${families}&display=swap`;
  document.head.appendChild(link);

  await new Promise<void>((resolve) => {
    link.onload = () => resolve();
    link.onerror = () => resolve();
    setTimeout(resolve, 3000);
  });
}

/** Makes sure a preset's font is actually loaded before it's used on a canvas. */
export async function loadFontForCanvas(preset: SubtitleFontPreset): Promise<void> {
  if (typeof document === "undefined" || !("fonts" in document)) return;
  if (!preset.googleFont) return;
  await ensureFontsInjected();
  try {
    const family = preset.cssFamily.split(",")[0]?.replace(/'/g, "") ?? preset.cssFamily;
    await document.fonts.load(`${preset.weight} 48px "${family}"`);
  } catch {
    // Best-effort — canvas silently falls back to a default font if this fails.
  }
}
