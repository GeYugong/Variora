import { test } from "node:test";
import assert from "node:assert/strict";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  symlink,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildCatalog } from "../scripts/catalog.mjs";

async function fixture(t, files) {
  const root = await mkdtemp(path.join(tmpdir(), "variora-catalog-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const [name, content] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, name)), { recursive: true });
    await writeFile(path.join(root, name), content);
  }
  return {
    root,
    projects: path.join(root, "projects"),
    public: path.join(root, "public"),
  };
}
const base = {
  "projects/example/PROMPT.md": "# Example\n\nMake a scene.",
  "projects/example/README.md": "# Example project",
};
test("discovers projects without implementations and uses the prompt as fallback", async (t) => {
  const f = await fixture(t, base);
  const [project] = await buildCatalog(f.projects, f.public);
  assert.equal(project.title, "Example project");
  assert.equal(project.description, "Make a scene.");
  assert.deepEqual(project.models, []);
});

test("chooses representative screenshots deterministically and copies original bytes", async (t) => {
  const f = await fixture(t, {
    ...base,
    "projects/example/models/demo/screenshots/desktop.png": "desktop",
    "projects/example/models/demo/screenshots/illustration.png":
      "original capture",
    "projects/example/models/demo/screenshots/scene.png": "scene",
  });
  const [project] = await buildCatalog(f.projects, f.public);
  assert.equal(
    project.models[0].screenshot,
    "/previews/_comparisons/example/demo/screenshot.png",
  );
  assert.equal(
    await readFile(path.join(f.public, project.models[0].screenshot), "utf8"),
    "original capture",
  );
});

test("supports explicit screenshot choices and disabling automatic selection", async (t) => {
  const f = await fixture(t, {
    ...base,
    "projects/example/models/demo/comparison.json":
      '{"screenshot":"captures/a b.webp"}',
    "projects/example/models/demo/captures/a b.webp": "chosen",
    "projects/example/models/disabled/comparison.json": '{"screenshot":null}',
    "projects/example/models/disabled/screenshots/preview.png": "disabled",
  });
  const [project] = await buildCatalog(f.projects, f.public);
  assert.equal(
    project.models[0].screenshot,
    "/previews/_comparisons/example/demo/screenshot.webp",
  );
  assert.equal(project.models[1].screenshot, null);
});

for (const screenshot of [
  "../../PROMPT.md",
  "screenshots/active.svg",
  "screenshots/missing.png",
  "screenshots",
  42,
  undefined,
]) {
  test(`rejects invalid comparison image: ${screenshot}`, async (t) => {
    const f = await fixture(t, {
      ...base,
      "projects/example/models/demo/comparison.json": JSON.stringify({
        screenshot,
      }),
      "projects/example/models/demo/screenshots/active.svg": "<svg/>",
    });
    await assert.rejects(buildCatalog(f.projects, f.public));
  });
}

test("rejects screenshot symlinks outside the submitting model", async (t) => {
  const f = await fixture(t, {
    ...base,
    "projects/example/models/demo/README.md": "# Demo",
    "outside/scene.png": "outside",
  });
  await symlink(
    path.join(f.root, "outside"),
    path.join(f.projects, "example/models/demo/screenshots"),
    "junction",
  );
  await assert.rejects(buildCatalog(f.projects, f.public), /symlink escapes/);
});
test("copies relative assets, parses model records, and excludes local config", async (t) => {
  const f = await fixture(t, {
    ...base,
    "projects/example/models/demo/README.md":
      "# Demo\n| Model | **model-1** |\n| Provider | [Vendor](https://example.com) |\n| Reasoning effort | `Max` |\n| Harness | CLI |",
    "projects/example/models/demo/app/index.html":
      '<script src="assets/main.js"></script>',
    "projects/example/models/demo/app/assets/main.js": "console.log('works')",
    "projects/example/models/demo/app/.env": "SECRET=private",
    "projects/example/models/demo/app/node_modules/package/index.js":
      "not shipped",
  });
  const [project] = await buildCatalog(f.projects, f.public);
  assert.deepEqual(project.models[0], {
    id: "demo",
    name: "model-1",
    provider: "Vendor",
    reasoning: "Max",
    harness: "CLI",
    firstCommittedAt: null,
    author: null,
    commit: null,
    preview: "/previews/example/demo/index.html",
    screenshot: null,
  });
  assert.match(
    await readFile(
      path.join(f.public, "previews/example/demo/assets/main.js"),
      "utf8",
    ),
    /works/,
  );
  await assert.rejects(
    access(path.join(f.public, "previews/example/demo/.env")),
  );
  await assert.rejects(
    access(path.join(f.public, "previews/example/demo/node_modules")),
  );
});
test("keeps source-only models visible when no static entry exists", async (t) => {
  const f = await fixture(t, {
    ...base,
    "projects/example/models/demo/README.md": "# Source model",
  });
  const [project] = await buildCatalog(f.projects, f.public);
  assert.equal(project.models[0].name, "Source model");
  assert.equal(project.models[0].preview, null);
  assert.equal(project.models[0].reasoning, "");
});
test("supports an explicit prebuilt directory and nested entry", async (t) => {
  const f = await fixture(t, {
    ...base,
    "projects/example/models/demo/preview.json":
      '{"directory":"app/dist","entry":"nested/start.html"}',
    "projects/example/models/demo/app/dist/nested/start.html": "<h1>Ready</h1>",
  });
  const [project] = await buildCatalog(f.projects, f.public);
  assert.equal(
    project.models[0].preview,
    "/previews/example/demo/nested/start.html",
  );
});
for (const config of [
  { directory: "../../..", entry: "index.html" },
  { directory: "app", entry: "../../README.md" },
]) {
  test(`rejects escaped preview paths: ${JSON.stringify(config)}`, async (t) => {
    const f = await fixture(t, {
      ...base,
      "projects/example/models/demo/preview.json": JSON.stringify(config),
      "projects/example/models/demo/app/index.html": "ok",
    });
    await assert.rejects(buildCatalog(f.projects, f.public), /escapes/);
  });
}
test("explicit invalid entries fail the build and stale assets are removed", async (t) => {
  const f = await fixture(t, {
    ...base,
    "projects/example/models/demo/preview.json":
      '{"directory":"app","entry":"missing.html"}',
    "projects/example/models/demo/app/index.html": "ok",
    "public/previews/old/index.html": "stale",
  });
  await assert.rejects(buildCatalog(f.projects, f.public), /ENOENT/);
  await assert.rejects(access(path.join(f.public, "previews/old/index.html")));
});
test("rejects entries that the publishing allowlist would exclude", async (t) => {
  const f = await fixture(t, {
    ...base,
    "projects/example/models/demo/preview.json":
      '{"directory":"app","entry":".private/index.html"}',
    "projects/example/models/demo/app/.private/index.html": "private",
  });
  await assert.rejects(
    buildCatalog(f.projects, f.public),
    /excluded by the asset rules/,
  );
});
