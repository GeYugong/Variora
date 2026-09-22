import test from "node:test";
import assert from "node:assert/strict";
import { exportComparison } from "../lib/comparison.ts";

function browser(t) {
  const originalImage = globalThis.Image;
  const originalDocument = globalThis.document;
  const labels = [],
    images = [];
  let encoded = false;
  const context = {
    font: "",
    fillRect() {},
    drawImage(...args) {
      images.push(args);
    },
    fillText(text, x) {
      labels.push({ text, x, width: this.measureText(text).width });
    },
    measureText(text) {
      return {
        width: text.length * Number(this.font.match(/([\d.]+)px/)[1]) * 0.6,
      };
    },
  };
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => context,
    toBlob(callback) {
      encoded = true;
      callback(new Blob(["encoded"], { type: "image/png" }));
    },
  };
  globalThis.document = { createElement: () => canvas };
  globalThis.Image = class {
    naturalWidth = 200;
    naturalHeight = 100;
    set src(value) {
      if (value)
        queueMicrotask(() =>
          value === "broken" ? this.onerror?.() : this.onload?.(),
        );
    }
  };
  t.after(() => {
    globalThis.Image = originalImage;
    globalThis.document = originalDocument;
  });
  return { canvas, labels, images, encoded: () => encoded };
}
const model = (name, reasoning = "unknown", screenshot = "capture.png") => ({
  name,
  reasoning,
  screenshot,
});

test("rejects unsupported selection sizes before allocating a canvas", async () => {
  for (const count of [0, 1, 9])
    await assert.rejects(
      exportComparison(Array.from({ length: count }, () => model("Model"))),
    );
});

test("odd and maximum selections retain every image in equal frames", async (t) => {
  const b = browser(t);
  for (const count of [3, 8]) {
    b.images.length = 0;
    await exportComparison(
      Array.from({ length: count }, (_, i) => model(`Model ${i}`)),
    );
    assert.equal(b.images.length, count);
    assert.equal(b.canvas.width, 2400);
    assert.equal(b.canvas.height, count === 3 ? 2400 : 4384);
    for (const [, x, y, w, h] of b.images) {
      assert.equal(w / h, 2);
      assert.ok(x >= 48 && x + w <= 2352);
      assert.ok(y >= 400 && y + h < b.canvas.height);
    }
  }
});

test("omits absent reasoning and fits long labels without truncation", async (t) => {
  const b = browser(t);
  const name = "A very long model name ".repeat(8);
  await exportComparison([model(name, "xhigh"), model("Other", "Unknown")]);
  const caption = b.labels.find((label) => label.text === name);
  assert.ok(caption);
  const effort = b.labels.find((label) => label.text === "xhigh");
  assert.ok(caption.x >= 48 && effort.x + effort.width <= 1184);
  assert.ok(!b.labels.some((label) => /unknown/i.test(label.text)));
});

test("a failed or missing screenshot prevents a partial download", async (t) => {
  const b = browser(t);
  for (const source of [null, "broken"]) {
    await assert.rejects(
      exportComparison([model("Good"), model("Affected model", "", source)]),
      /Affected model/,
    );
    assert.equal(b.encoded(), false);
  }
});
