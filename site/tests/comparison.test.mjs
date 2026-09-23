import test from "node:test";
import assert from "node:assert/strict";
import { comparisonColumns, exportComparison } from "../lib/comparison.ts";

const TOKENS = { "--bg": "#000000", "--ink": "#ffffff", "--muted": "#999999" };

// Records every canvas; the exported one is whichever reaches toBlob.
function browser(t) {
  const saved = ["Image", "document", "getComputedStyle", "Path2D"].map(
    (key) => [key, globalThis[key]],
  );
  const canvases = [];
  let encoded = null;
  function createCanvas() {
    const calls = { captures: [], frames: [], texts: [], fills: [] };
    const context = {
      font: "",
      textAlign: "left",
      fillStyle: "",
      fillRect() {
        calls.fills.push(this.fillStyle);
      },
      drawImage(source, x, y, w, h) {
        ("naturalWidth" in source ? calls.captures : calls.frames).push({
          source,
          x,
          y,
          w,
          h,
        });
      },
      fillText(text, x) {
        const width = this.measureText(text).width;
        const left = this.textAlign === "right" ? x - width : x;
        calls.texts.push({ text, left, right: left + width, font: this.font });
      },
      measureText(text) {
        return {
          width: text.length * Number(this.font.match(/([\d.]+)px/)[1]) * 0.6,
        };
      },
    };
    for (const name of [
      "beginPath",
      "roundRect",
      "clip",
      "save",
      "restore",
      "stroke",
      "fill",
      "translate",
      "scale",
    ])
      context[name] = () => {};
    const canvas = {
      width: 0,
      height: 0,
      calls,
      getContext: () => context,
      toBlob(callback) {
        encoded = canvas;
        callback(new Blob(["png"], { type: "image/png" }));
      },
    };
    canvases.push(canvas);
    return canvas;
  }
  globalThis.document = {
    createElement: createCanvas,
    fonts: { load: async () => [] },
  };
  globalThis.getComputedStyle = () => ({
    getPropertyValue: (name) => TOKENS[name] ?? "#333333",
  });
  globalThis.Path2D = class {};
  globalThis.Image = class {
    naturalWidth = 0;
    naturalHeight = 0;
    set src(value) {
      if (!value) return;
      queueMicrotask(() => {
        if (value === "broken") return this.onerror?.();
        [this.naturalWidth, this.naturalHeight] = value
          .match(/(\d+)x(\d+)/)
          .slice(1)
          .map(Number);
        this.onload?.();
      });
    }
  };
  t.after(() => {
    for (const [key, value] of saved) globalThis[key] = value;
  });
  return { canvases, sheet: () => encoded };
}

const model = (name, extra = {}) => ({
  name,
  provider: "Provider",
  reasoning: "",
  screenshot: "capture-1600x1000.png",
  ...extra,
});
const sheet = (models) =>
  exportComparison({ title: "Rainy Ramen", subtitle: "Subtitle", models });

test("rejects unsupported selection sizes before touching the canvas", async (t) => {
  const b = browser(t);
  for (const count of [0, 1, 9])
    await assert.rejects(
      sheet(Array.from({ length: count }, (_, i) => model(`Model ${i}`))),
    );
  assert.equal(b.canvases.length, 0);
});

test("lays out equal 16:10 frames and centers a short last row", async (t) => {
  assert.deepEqual(
    [2, 3, 4, 5, 6, 7, 8].map(comparisonColumns),
    [2, 3, 2, 3, 3, 3, 3],
  );
  const b = browser(t);
  const sizes = ["1600x1000", "900x900", "390x844", "1440x810"];
  for (const count of [2, 3, 4, 5, 8]) {
    await sheet(
      Array.from({ length: count }, (_, i) =>
        model(`Model ${i}`, { screenshot: `capture-${sizes[i % 4]}.png` }),
      ),
    );
    const { width, calls } = b.sheet();
    assert.equal(width, 2400);
    assert.equal(calls.frames.length, count);
    assert.equal(calls.captures.length, count);
    const [{ w, h }] = calls.frames;
    assert.ok(Math.abs(w / h - 1.6) < 1e-9);
    calls.frames.forEach((frame, i) => {
      assert.deepEqual([frame.w, frame.h], [w, h]);
      assert.ok(frame.x >= 120 && frame.x + w <= 2280);
      const capture = calls.captures[i];
      const { naturalWidth, naturalHeight } = capture.source;
      assert.ok(
        Math.abs(capture.w / capture.h - naturalWidth / naturalHeight) < 1e-9,
      );
      assert.ok(capture.x >= frame.x - 1e-9 && capture.y >= frame.y - 1e-9);
      assert.ok(capture.x + capture.w <= frame.x + w + 1e-9);
      assert.ok(capture.y + capture.h <= frame.y + h + 1e-9);
    });
    const columns = comparisonColumns(count);
    const last = calls.frames.slice(
      Math.floor((count - 1) / columns) * columns,
    );
    const center = (last[0].x + last.at(-1).x + w) / 2;
    assert.ok(Math.abs(center - 1200) < 1e-9);
  }
  await sheet([model("A"), model("B"), model("C"), model("D")]);
  assert.equal(b.sheet().height, 2135);
});

test("follows the theme and prints the header", async (t) => {
  const b = browser(t);
  await sheet([model("A"), model("B")]);
  const { calls } = b.sheet();
  assert.equal(calls.fills[0], TOKENS["--bg"]);
  assert.deepEqual(
    calls.texts.slice(0, 4).map((text) => text.text),
    ["Variora", "variora.fog.moe", "Rainy Ramen", "Subtitle"],
  );
});

test("captions omit unknown reasoning and never overflow their frame", async (t) => {
  const b = browser(t);
  const long = "A very long model name ".repeat(6).trim();
  await sheet([
    model(long, { reasoning: "xhigh", provider: "Long provider" }),
    model("SWE-2", { reasoning: "Max", provider: "Cognition" }),
    model("Other", { reasoning: "Not specified" }),
    model("Blank", { reasoning: "unknown" }),
  ]);
  const { calls } = b.sheet();
  const texts = calls.texts.map((text) => text.text);
  assert.ok(!texts.some((text) => /unknown|not specified/i.test(text)));
  assert.ok(texts.includes("max") && !texts.includes("Max"));
  assert.ok(texts.includes("Cognition"));
  assert.ok(!texts.includes("Long provider"));
  const [frame] = calls.frames;
  const name = calls.texts.find((text) => text.text === long);
  const badge = calls.texts.find((text) => text.text === "xhigh");
  assert.ok(name.left >= frame.x && badge.right <= frame.x + frame.w);
  assert.ok(Number(name.font.match(/([\d.]+)px/)[1]) < 44);
});

test("a failed or missing screenshot prevents a partial download", async (t) => {
  const b = browser(t);
  for (const screenshot of [null, "broken"]) {
    await assert.rejects(
      sheet([model("Good"), model("Affected model", { screenshot })]),
      /Affected model/,
    );
    assert.equal(b.sheet(), null);
  }
});
