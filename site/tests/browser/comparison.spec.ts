import { test, expect } from "./fixtures/giscus";
import { readFile } from "node:fs/promises";
import catalog from "../../.generated/catalog.json";

const models = catalog
  .find((project) => project.id === "rainy-ramen")!
  .models.filter((model) => model.screenshot);

test("selection survives metadata filtering and can be removed while hidden", async ({
  page,
}) => {
  await page.goto("/en/projects/rainy-ramen/");
  const download = page.getByRole("button", {
    name: "Download comparison PNG",
  });
  await expect(download).toBeDisabled();
  for (const model of models.slice(0, 2))
    await page
      .getByRole("checkbox", {
        name: `Select for comparison: ${model.name}`,
        exact: true,
      })
      .check();
  await page.getByRole("searchbox").fill("no-such-model");
  await expect(page.locator(".model-card")).toHaveCount(0);
  await expect(page.getByRole("status")).toHaveText("2 selected");
  await expect(download).toBeEnabled();
  await page
    .getByRole("button", {
      name: `Remove selection: ${models[0].name}`,
      exact: true,
    })
    .click();
  await expect(download).toBeDisabled();
  await page.getByRole("button", { name: "Clear filters" }).click();
  await page.getByRole("searchbox").fill("OpenAI");
  await expect(page.locator(".model-card")).toHaveCount(1);
  await page.getByRole("searchbox").fill("xhigh");
  await expect(page.locator(".model-card")).toHaveCount(2);
  await page.getByRole("button", { name: "Clear selection" }).click();
  await expect(page.getByRole("status")).toHaveText("0 selected");
});

test("downloads the four actual captures in a 2400-square sheet", async ({
  page,
}, testInfo) => {
  await page.goto("/en/projects/rainy-ramen/");
  // Record the Canvas boundary as well as inspecting the actual encoded PNG.
  await page.evaluate(() => {
    const calls: { images: number[][]; labels: string[] } = {
      images: [],
      labels: [],
    };
    Object.assign(window, { comparisonCalls: calls });
    const draw = CanvasRenderingContext2D.prototype.drawImage;
    CanvasRenderingContext2D.prototype.drawImage = function (
      ...args: [CanvasImageSource, ...number[]]
    ) {
      const image = args[0] as HTMLImageElement;
      calls.images.push([
        image.naturalWidth,
        image.naturalHeight,
        ...(args.slice(1) as number[]),
      ]);
      return Reflect.apply(draw, this, args);
    };
    const text = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (
      ...args: Parameters<typeof text>
    ) {
      calls.labels.push(args[0]);
      return Reflect.apply(text, this, args);
    };
  });
  for (const model of [...models].reverse())
    await page
      .getByRole("checkbox", {
        name: `Select for comparison: ${model.name}`,
        exact: true,
      })
      .check();
  await page.getByRole("searchbox").fill("OpenAI");
  await expect(page.getByRole("status")).toHaveText("4 selected");
  await page.screenshot({
    path: testInfo.outputPath("comparison-page.png"),
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download comparison PNG" }).click();
  const download = await downloaded;
  expect(download.suggestedFilename()).toBe("rainy-ramen-comparison.png");
  await download.saveAs(testInfo.outputPath("comparison.png"));
  const bytes = await readFile(testInfo.outputPath("comparison.png"));
  expect(bytes.subarray(1, 4).toString()).toBe("PNG");
  expect(bytes.readUInt32BE(16)).toBe(2400);
  expect(bytes.readUInt32BE(20)).toBe(2400);
  const calls = await page.evaluate(
    () =>
      (
        window as unknown as {
          comparisonCalls: { images: number[][]; labels: string[] };
        }
      ).comparisonCalls,
  );
  expect(calls.images).toHaveLength(4);
  for (const [width, height, x, y, w, h] of calls.images) {
    expect(w / h).toBeCloseTo(width / height, 5);
    expect(w).toBeLessThanOrEqual(1136);
    expect(h).toBeLessThanOrEqual(830);
    expect(x).toBeGreaterThanOrEqual(48);
    expect(y).toBeGreaterThanOrEqual(400);
  }
  expect(calls.labels.filter(Boolean)).toEqual([
    "Variora",
    "DeepSeek V4.1 Flash",
    "GPT-6 Astra",
    "xhigh",
    "Grok 4.7",
    "xhigh",
    "SWE-2",
    "max",
    "variora.fog.moe",
  ]);
});

test("missing captures cannot be selected and failed loads abort the whole export", async ({
  page,
}) => {
  await page.goto("/en/projects/pelican-cycle/");
  for (const checkbox of await page.getByRole("checkbox").all())
    await expect(checkbox).toBeDisabled();
  await page.route(`**${models[0].screenshot}`, (route) => route.abort());
  await page.goto("/en/projects/rainy-ramen/");
  for (const model of models.slice(0, 2))
    await page
      .getByRole("checkbox", {
        name: `Select for comparison: ${model.name}`,
        exact: true,
      })
      .check();
  const downloads: string[] = [];
  page.on("download", (download) =>
    downloads.push(download.suggestedFilename()),
  );
  await page.getByRole("button", { name: "Download comparison PNG" }).click();
  await expect(page.locator(".implementations [role=alert]")).toContainText(
    models[0].name,
  );
  await expect(
    page.getByRole("button", { name: "Download comparison PNG" }),
  ).toBeEnabled();
  expect(downloads).toEqual([]);
  await page.unroute(`**${models[0].screenshot}`);
  const retried = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download comparison PNG" }).click();
  await retried;
  await expect(page.locator(".implementations [role=alert]")).toHaveCount(0);
});
