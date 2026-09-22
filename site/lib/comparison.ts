import type { Model } from "./catalog";

export const MAX_COMPARISON_MODELS = 8;

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

// Equal frames, letterboxed rather than cropped. Four selections use 2400².
export async function exportComparison(models: Model[]): Promise<Blob> {
  if (models.length < 2 || models.length > MAX_COMPARISON_MODELS)
    throw new Error();
  const images = await Promise.all(models.map(loadScreenshot));
  const columns = 2;
  const rows = Math.ceil(models.length / columns);
  const width = 2400,
    margin = 48,
    gap = 32,
    frameWidth = 1136;
  const frameHeight = 830,
    captionHeight = 130,
    top = 400;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height =
    top + rows * (frameHeight + captionHeight) + (rows - 1) * gap + 48;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error();
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, canvas.height);
  ctx.fillStyle = "#101010";
  ctx.textAlign = "center";
  ctx.font = "bold 300px Arial, sans-serif";
  ctx.fillText("Variora", width / 2, 305);
  images.forEach((image, index) => {
    const x = margin + (index % columns) * (frameWidth + gap);
    const y =
      top + Math.floor(index / columns) * (frameHeight + captionHeight + gap);
    const scale = Math.min(
      frameWidth / image.naturalWidth,
      frameHeight / image.naturalHeight,
    );
    const w = image.naturalWidth * scale,
      h = image.naturalHeight * scale;
    ctx.drawImage(
      image,
      x + (frameWidth - w) / 2,
      y + (frameHeight - h) / 2,
      w,
      h,
    );
    const model = models[index];
    const name =
      (
        {
          "gpt-6-astra": "GPT-6 Astra",
          "deepseek-v4.1-flash": "DeepSeek V4.1 Flash",
        } as Record<string, string>
      )[model.name] ?? model.name;
    const effort = /^(unknown|unspecified|not specified|none|n\/a|-)$/i.test(
      model.reasoning.trim(),
    )
      ? ""
      : model.reasoning.trim().toLowerCase();
    // Measure the complete caption and scale both fonts together to avoid clipping.
    let size = 64;
    const measure = () => {
      ctx.font = `bold ${size}px Arial, sans-serif`;
      const nameWidth = ctx.measureText(name).width;
      ctx.font = `${size * 0.75}px Arial, sans-serif`;
      return {
        name: nameWidth,
        total: nameWidth + (effort ? 27 + ctx.measureText(effort).width : 0),
      };
    };
    let label = measure();
    if (label.total > frameWidth - 32) {
      size *=
        (frameWidth - 32 - (effort ? 27 : 0)) /
        (label.total - (effort ? 27 : 0));
      label = measure();
    }
    const left = x + (frameWidth - label.total) / 2;
    ctx.textAlign = "left";
    ctx.fillStyle = "#141414";
    ctx.font = `bold ${size}px Arial, sans-serif`;
    ctx.fillText(name, left, y + frameHeight + 83);
    ctx.fillStyle = "#646464";
    ctx.font = `${size * 0.75}px Arial, sans-serif`;
    ctx.fillText(effort, left + label.name + 27, y + frameHeight + 83);
  });
  ctx.textAlign = "center";
  ctx.font = "36px Arial, sans-serif";
  ctx.fillStyle = "#777777";
  ctx.fillText("variora.fog.moe", width / 2, canvas.height - 18);
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error())),
      "image/png",
    ),
  );
}
