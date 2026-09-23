import type { Model } from "./catalog";

export const MAX_COMPARISON_MODELS = 8;

const FONT = '"DM Sans", Arial, "Noto Sans", sans-serif';
const WIDTH = 2400;
const MARGIN = 120;
const GUTTER = 56;
const FRAME_RATIO = 10 / 16;
const RADIUS = 20;
const MARK = ["m4 9 12 25h8L12 9H4Z", "m24 9-7 15 4 9L36 9H24Z"];
const UNKNOWN = /^(|unknown|unspecified|not specified|none|n\/a|-)$/i;

type Theme = { bg: string; ink: string; muted: string; line: string };
type Source = HTMLImageElement | HTMLCanvasElement;

// Exports follow the active site theme by reading the design tokens.
function siteTheme(): Theme {
  const css = getComputedStyle(document.documentElement);
  const token = (name: string) => css.getPropertyValue(name).trim();
  return {
    bg: token("--bg"),
    ink: token("--ink"),
    muted: token("--muted"),
    line: token("--line"),
  };
}

// 2 → 2×1, 3 → 3×1, 4 → 2×2, 5–8 → three columns with a centered last row.
export const comparisonColumns = (count: number) =>
  count === 3 || count > 4 ? 3 : 2;

function loadScreenshot(model: Model): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const timer = setTimeout(() => fail(), 15000);
    function fail() {
      clearTimeout(timer);
      image.onload = image.onerror = null;
      image.src = "";
      reject(new Error(model.name));
    }
    image.onload = () => {
      clearTimeout(timer);
      image.onload = image.onerror = null;
      if (!image.naturalWidth || !image.naturalHeight) fail();
      else resolve(image);
    };
    image.onerror = fail;
    if (!model.screenshot) fail();
    else image.src = model.screenshot;
  });
}

function setFont(
  ctx: CanvasRenderingContext2D,
  weight: number,
  size: number,
  tracking = 0,
) {
  ctx.font = `${weight} ${size}px ${FONT}`;
  ctx.letterSpacing = `${tracking * size}px`;
}

const sizeOf = (source: Source) =>
  "naturalWidth" in source
    ? [source.naturalWidth, source.naturalHeight]
    : [source.width, source.height];

function cover(source: Source, width: number, height: number) {
  const [sw, sh] = sizeOf(source);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  const scale = Math.max(canvas.width / sw, canvas.height / sh);
  ctx.drawImage(
    source,
    (canvas.width - sw * scale) / 2,
    (canvas.height - sh * scale) / 2,
    sw * scale,
    sh * scale,
  );
  return canvas;
}

// Stepped down- and up-sampling is a soft blur that works in every browser;
// CanvasRenderingContext2D.filter is not universally supported.
const blur = (image: HTMLImageElement, w: number, h: number) =>
  [256, 24, 96, w].reduce<Source>(
    (source, width) => cover(source, width, (width * h) / w),
    image,
  );

// A dimmed, blurred copy fills each frame so mixed aspect ratios read as equal
// tiles, while the capture itself is contained and never cropped.
function drawFrame(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  [x, y, w, h]: number[],
  theme: Theme,
) {
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, RADIUS);
  ctx.clip();
  ctx.drawImage(blur(image, w, h), x, y, w, h);
  ctx.fillStyle = "rgba(0, 0, 0, 0.45)";
  ctx.fillRect(x, y, w, h);
  const fit = Math.min(w / image.naturalWidth, h / image.naturalHeight);
  const iw = image.naturalWidth * fit;
  const ih = image.naturalHeight * fit;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(image, x + (w - iw) / 2, y + (h - ih) / 2, iw, ih);
  ctx.restore();
  ctx.strokeStyle = theme.line;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(x + 1, y + 1, w - 2, h - 2, RADIUS - 1);
  ctx.stroke();
}

// Name and reasoning badge on the left, provider on the right. The provider is
// dropped first when space runs out, then the name shrinks; nothing is clipped.
function drawCaption(
  ctx: CanvasRenderingContext2D,
  model: Model,
  [x, top, w]: number[],
  s: number,
  theme: Theme,
) {
  const effort = UNKNOWN.test(model.reasoning.trim())
    ? ""
    : model.reasoning.trim().toLowerCase();
  const badge = { size: 26 * s, pad: 16 * s, height: 44 * s, gap: 20 * s };
  setFont(ctx, 500, badge.size);
  const badgeWidth = effort ? ctx.measureText(effort).width + badge.pad * 2 : 0;
  setFont(ctx, 400, 30 * s);
  const providerWidth = model.provider
    ? ctx.measureText(model.provider).width
    : 0;
  let size = 44 * s;
  setFont(ctx, 600, size, -0.02);
  let nameWidth = ctx.measureText(model.name).width;
  const extra = effort ? badge.gap + badgeWidth : 0;
  const showProvider =
    providerWidth > 0 && nameWidth + extra + 32 * s + providerWidth <= w;
  if (nameWidth + extra > w) {
    size *= (w - extra) / nameWidth;
    setFont(ctx, 600, size, -0.02);
    nameWidth = ctx.measureText(model.name).width;
  }
  const baseline = top + 28 * s + 44 * s * 0.78;
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  ctx.fillStyle = theme.ink;
  ctx.fillText(model.name, x, baseline);
  if (effort) {
    const bx = x + nameWidth + badge.gap;
    const by = baseline - 44 * s * 0.36 - badge.height / 2;
    ctx.strokeStyle = theme.line;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(bx + 1, by + 1, badgeWidth - 2, badge.height - 2, 10 * s);
    ctx.stroke();
    setFont(ctx, 500, badge.size);
    ctx.fillStyle = theme.muted;
    ctx.textBaseline = "middle";
    ctx.fillText(effort, bx + badge.pad, by + badge.height / 2 + 1);
    ctx.textBaseline = "alphabetic";
  }
  if (showProvider) {
    setFont(ctx, 400, 30 * s);
    ctx.fillStyle = theme.muted;
    ctx.textAlign = "right";
    ctx.fillText(model.provider, x + w, baseline);
    ctx.textAlign = "left";
  }
}

function drawMark(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  color: string,
) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size / 40, size / 40);
  ctx.fillStyle = color;
  ctx.fill(new Path2D(MARK[0]));
  ctx.globalAlpha = 0.5;
  ctx.fill(new Path2D(MARK[1]));
  ctx.restore();
}

export async function exportComparison({
  title,
  subtitle,
  models,
}: {
  title: string;
  subtitle: string;
  models: Model[];
}): Promise<Blob> {
  if (models.length < 2 || models.length > MAX_COMPARISON_MODELS)
    throw new Error();
  await Promise.all(
    [400, 500, 600].map((weight) =>
      document.fonts.load(`${weight} 48px "DM Sans"`),
    ),
  );
  const images = await Promise.all(models.map(loadScreenshot));
  const theme = siteTheme();

  const columns = comparisonColumns(models.length);
  const rows = Math.ceil(models.length / columns);
  const frameW = (WIDTH - MARGIN * 2 - GUTTER * (columns - 1)) / columns;
  const frameH = frameW * FRAME_RATIO;
  const s = frameW / ((WIDTH - MARGIN * 2 - GUTTER) / 2);
  const captionH = 88 * s;
  const rowGap = 56 * s;
  const barH = 56;
  const ruleY = MARGIN + barH + 36;
  const titleBaseline = ruleY + 84 + 98;
  const gridTop = titleBaseline + 104;
  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = Math.round(
    gridTop + rows * (frameH + captionH) + (rows - 1) * rowGap + MARGIN * 0.75,
  );
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error();
  ctx.fillStyle = theme.bg;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  drawMark(ctx, MARGIN, MARGIN, barH, theme.ink);
  ctx.textBaseline = "middle";
  setFont(ctx, 600, 46, -0.04);
  ctx.fillStyle = theme.ink;
  ctx.fillText("Variora", MARGIN + barH + 14, MARGIN + barH / 2 + 2);
  setFont(ctx, 400, 30);
  ctx.fillStyle = theme.muted;
  ctx.textAlign = "right";
  ctx.fillText("variora.fog.moe", WIDTH - MARGIN, MARGIN + barH / 2 + 2);
  ctx.textAlign = "left";
  ctx.fillStyle = theme.line;
  ctx.fillRect(MARGIN, ruleY, WIDTH - MARGIN * 2, 2);

  ctx.textBaseline = "alphabetic";
  setFont(ctx, 400, 36);
  const subtitleWidth = ctx.measureText(subtitle).width;
  const room = WIDTH - MARGIN * 2 - subtitleWidth - 64;
  setFont(ctx, 600, 136, -0.045);
  const titleWidth = ctx.measureText(title).width;
  if (titleWidth > room) setFont(ctx, 600, (136 * room) / titleWidth, -0.045);
  ctx.fillStyle = theme.ink;
  ctx.fillText(title, MARGIN, titleBaseline);
  setFont(ctx, 400, 36);
  ctx.fillStyle = theme.muted;
  ctx.textAlign = "right";
  ctx.fillText(subtitle, WIDTH - MARGIN, titleBaseline);
  ctx.textAlign = "left";

  models.forEach((model, index) => {
    const row = Math.floor(index / columns);
    const inRow = Math.min(columns, models.length - row * columns);
    const offset = (WIDTH - inRow * frameW - (inRow - 1) * GUTTER) / 2;
    const x = offset + (index % columns) * (frameW + GUTTER);
    const y = gridTop + row * (frameH + captionH + rowGap);
    drawFrame(ctx, images[index], [x, y, frameW, frameH], theme);
    drawCaption(ctx, model, [x, y + frameH, frameW], s, theme);
  });
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error())),
      "image/png",
    ),
  );
}
