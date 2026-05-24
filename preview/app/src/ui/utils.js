export function parseHexColor(hex) {
  if (typeof hex !== "string") return null;
  const raw = hex.trim().replace("#", "");
  const value =
    raw.length === 3
      ? raw
          .split("")
          .map((c) => c + c)
          .join("")
      : raw;
  if (!/^[0-9a-fA-F]{6}$/.test(value)) return null;
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return { r, g, b };
}

export function toHex({ r, g, b }) {
  const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));
  return `#${[clamp(r), clamp(g), clamp(b)]
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("")}`;
}

export function getDealerPalette(color) {
  const rgb = parseHexColor(color);
  const forcedText =
    typeof document !== "undefined"
      ? getComputedStyle(document.documentElement)
          .getPropertyValue("--player-name-color")
          .trim()
      : "";
  if (!rgb) {
    return {
      bg: "#d9c79f",
      border: "#c5af7d",
      text: forcedText || "#2f1b12",
    };
  }
  const luminance = (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255;
  const text = forcedText || (luminance > 0.62 ? "#2f1b12" : "#ffffff");
  const border = toHex({
    r: rgb.r * 0.7,
    g: rgb.g * 0.7,
    b: rgb.b * 0.7,
  });
  return { bg: color, border, text };
}

export function darkenHexColor(color, factor = 0.75) {
  const rgb = parseHexColor(color);
  if (!rgb) return color;
  return toHex({
    r: rgb.r * factor,
    g: rgb.g * factor,
    b: rgb.b * factor,
  });
}
