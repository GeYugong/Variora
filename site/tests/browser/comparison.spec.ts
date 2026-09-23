import { test, expect } from "./fixtures/giscus";
import type { Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import catalog from "../../.generated/catalog.json";

const projectModels = catalog.find(
  (project) => project.id === "rainy-ramen",
)!.models;
// Exercise the reference set without assuming future contributions keep the
// project at four captures or leave other projects without screenshots.
const models = projectModels.filter((model) =>
  [
    "deepseek-v4.1-flash",
    "gpt-6-astra-xhigh",
    "grok-4-7-xhigh",
    "swe-2-max",
  ].includes(model.id),
);
const matching = (query: string) =>
  projectModels.filter((model) =>
    [model.name, model.provider, model.reasoning, model.harness]
      .join(" ")
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
const toggle = (page: Page, name: string) =>
  page.getByRole("checkbox", { name: `Compare: ${name}`, exact: true });

type Calls = {
  captures: number[][];
  sheets: string[];
  labels: string[];
};
// Record the Canvas boundary as well as inspecting the actual encoded PNG.
async function recordCanvas(page: Page) {
  await page.evaluate(() => {
    const calls: Calls = { captures: [], sheets: [], labels: [] };
    Object.assign(window, { comparisonCalls: calls });
    const proto = CanvasRenderingContext2D.prototype;
    const draw = proto.drawImage;
    // Only draws onto the exported sheet; blur steps use smaller canvases.
    proto.drawImage = function (...args: [CanvasImageSource, ...number[]]) {
      if (args[0] instanceof HTMLImageElement && this.canvas.width === 2400)
        calls.captures.push([
          args[0].naturalWidth,
          args[0].naturalHeight,
          ...(args.slice(1) as number[]),
        ]);
      return Reflect.apply(draw, this, args);
    };
    const fill = proto.fillRect;
    proto.fillRect = function (...args: Parameters<typeof fill>) {
      if (this.canvas.width === 2400 && !calls.sheets.length)
        calls.sheets.push(String(this.fillStyle));
      return Reflect.apply(fill, this, args);
    };
    const text = proto.fillText;
    proto.fillText = function (...args: Parameters<typeof text>) {
      calls.labels.push(args[0]);
      return Reflect.apply(text, this, args);
    };
  });
}
const readCalls = (page: Page) =>
  page.evaluate(
    () => (window as unknown as { comparisonCalls: Calls }).comparisonCalls,
  );

test("selection survives filtering and reports hidden selections", async ({
  page,
}) => {
  await page.goto("/en/projects/rainy-ramen/");
  const bar = page.locator(".compare-bar");
  await expect(bar).toHaveCount(0);
  await toggle(page, models[0].name).check();
  await expect(bar.getByRole("status")).toHaveText(
    "1 selected · pick 2–8 to export",
  );
  const download = bar.getByRole("button", { name: "Download PNG" });
  await expect(download).toBeDisabled();
  await toggle(page, models[1].name).check();
  await expect(download).toBeEnabled();
  await expect(
    page.locator(".model-card[data-selected]").first(),
  ).toContainText(models[0].name);

  await page.getByRole("searchbox").fill("no-such-model");
  await expect(page.locator(".model-card")).toHaveCount(0);
  await expect(bar.getByRole("status")).toHaveText(
    "2 selected · 2 hidden by search",
  );
  await expect(download).toBeEnabled();
  await page.getByRole("button", { name: "Clear filters" }).click();
  for (const query of ["OpenAI", "xhigh"]) {
    await page.getByRole("searchbox").fill(query);
    await expect(page.locator(".model-card")).toHaveCount(
      matching(query).length,
    );
  }
  await toggle(page, models[1].name).uncheck();
  await expect(download).toBeDisabled();
  await bar.getByRole("button", { name: "Clear" }).click();
  await expect(bar).toHaveCount(0);
});

test("downloads the four actual captures as a theme-aware sheet", async ({
  page,
}, testInfo) => {
  await page.goto("/en/projects/rainy-ramen/");
  await recordCanvas(page);
  for (const model of [...models].reverse())
    await toggle(page, model.name).check();
  await page.getByRole("searchbox").fill("OpenAI");
  await expect(page.locator(".compare-bar [role=status]")).toHaveText(
    `4 selected · ${4 - models.filter((model) => matching("OpenAI").includes(model)).length} hidden by search`,
  );
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
  await page.getByRole("button", { name: "Download PNG" }).click();
  const download = await downloaded;
  expect(download.suggestedFilename()).toBe("rainy-ramen-comparison.png");
  await download.saveAs(testInfo.outputPath("comparison.png"));
  const bytes = await readFile(testInfo.outputPath("comparison.png"));
  expect(bytes.subarray(1, 4).toString()).toBe("PNG");
  expect(bytes.readUInt32BE(16)).toBe(2400);
  expect(bytes.readUInt32BE(20)).toBe(2135);
  const calls = await readCalls(page);
  expect(calls.sheets).toEqual(["#ffffff"]);
  expect(calls.captures).toHaveLength(4);
  for (const [width, height, x, y, w, h] of calls.captures) {
    expect(w / h).toBeCloseTo(width / height, 5);
    expect(w).toBeLessThanOrEqual(1052);
    expect(h).toBeLessThanOrEqual(657.5);
    expect(x).toBeGreaterThanOrEqual(120);
    expect(y).toBeGreaterThanOrEqual(498);
  }
  expect(calls.labels.filter(Boolean)).toEqual([
    "Variora",
    "variora.fog.moe",
    "Rainy Ramen",
    "4 models · one prompt",
    ...models.flatMap((model) =>
      [model.name, model.reasoning.toLowerCase(), model.provider].filter(
        Boolean,
      ),
    ),
  ]);
});

test("exports follow the dark theme", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("variora-theme", "dark"));
  await page.goto("/en/projects/rainy-ramen/");
  await recordCanvas(page);
  for (const model of models.slice(0, 2))
    await toggle(page, model.name).check();
  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download PNG" }).click();
  await downloaded;
  expect((await readCalls(page)).sheets).toEqual(["#000000"]);
});

test("projects without two captures hide the comparison controls", async ({
  page,
}) => {
  const bare = catalog.find(
    (project) =>
      project.models.length > 0 &&
      project.models.filter((model) => model.screenshot).length < 2,
  );
  test.skip(!bare, "every project currently has at least two captures");
  await page.goto(`/en/projects/${bare!.id}/`);
  await expect(page.locator(".model-card").first()).toBeVisible();
  await expect(page.locator(".compare-toggle")).toHaveCount(0);
});

test("missing captures cannot be selected and failed loads abort the whole export", async ({
  page,
}) => {
  await page.route(`**${models[0].screenshot}`, (route) => route.abort());
  await page.goto("/en/projects/rainy-ramen/");
  await expect(
    page
      .locator(".model-card")
      .filter({ hasText: "E2E fixture" })
      .locator(".compare-toggle"),
  ).toHaveCount(0);
  for (const model of models.slice(0, 2))
    await toggle(page, model.name).check();
  const downloads: string[] = [];
  page.on("download", (download) =>
    downloads.push(download.suggestedFilename()),
  );
  const button = page.getByRole("button", { name: "Download PNG" });
  await button.click();
  await expect(page.locator(".implementations [role=alert]")).toContainText(
    models[0].name,
  );
  await expect(button).toBeEnabled();
  expect(downloads).toEqual([]);
  await page.unroute(`**${models[0].screenshot}`);
  const retried = page.waitForEvent("download");
  await button.click();
  await retried;
  await expect(page.locator(".implementations [role=alert]")).toHaveCount(0);
});
