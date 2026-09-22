"use client";
import Link from "next/link";
import { useState } from "react";
import { type Project, modelSource, repository } from "@/lib/catalog";
import { messages, type Locale } from "@/lib/i18n";
import { MAX_COMPARISON_MODELS, exportComparison } from "@/lib/comparison";
import { Arrow } from "./icons";

export function Implementations({
  project,
  locale,
}: {
  project: Project;
  locale: Locale;
}) {
  const t = messages[locale];
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const filtered = project.models.filter((model) =>
    [model.name, model.provider, model.reasoning, model.harness]
      .join(" ")
      .toLocaleLowerCase(locale)
      .includes(search.trim().toLocaleLowerCase(locale)),
  );
  // Catalog order is stable regardless of selection clicks or current filtering.
  const chosen = project.models.filter((model) => selected.includes(model.id));
  async function download() {
    setBusy(true);
    setError("");
    try {
      const blob = await exportComparison(chosen);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${project.id}-comparison.png`;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (failure) {
      setError(
        `${t.exportError} ${failure instanceof Error ? failure.message : ""}`,
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="comparison-controls">
        <label className="search">
          <span className="sr-only">{t.searchModels}</span>
          <input
            type="search"
            placeholder={t.searchModels}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <p role="status">
          {t.selectedCount.replace("{count}", String(selected.length))}
        </p>
        <button
          className="button"
          disabled={busy || selected.length === 0}
          onClick={() => {
            setSelected([]);
            setError("");
          }}
        >
          {t.clearSelection}
        </button>
        <button
          className="button primary"
          disabled={busy || selected.length < 2}
          onClick={download}
        >
          {busy ? t.exporting : t.downloadComparison}
        </button>
      </div>
      <p className="comparison-hint">{t.comparisonHint}</p>
      {chosen.length > 0 && (
        <ul className="comparison-chosen" aria-label={t.selectedModels}>
          {chosen.map((model) => (
            <li key={model.id}>
              <button
                className="button"
                disabled={busy}
                onClick={() => {
                  setSelected((current) =>
                    current.filter((id) => id !== model.id),
                  );
                  setError("");
                }}
                aria-label={`${t.removeSelection}: ${model.name}`}
              >
                {model.name} ×
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && <p role="alert">{error}</p>}
      {filtered.length === 0 && (
        <div className="empty-state">
          <h3>{t.noModels}</h3>
          <button className="button" onClick={() => setSearch("")}>
            {t.reset}
          </button>
        </div>
      )}
      <div className="model-grid">
        {filtered.map((model) => (
          <article key={model.id} className="model-card">
            <h3>{model.name}</h3>
            {model.screenshot && (
              <img
                className="comparison-thumbnail"
                src={model.screenshot}
                alt={model.name}
                loading="lazy"
              />
            )}
            <label className="comparison-select">
              <input
                type="checkbox"
                aria-label={`${model.screenshot ? t.selectComparison : t.noScreenshot}: ${model.name}`}
                checked={selected.includes(model.id)}
                disabled={
                  busy ||
                  !model.screenshot ||
                  (!selected.includes(model.id) &&
                    selected.length >= MAX_COMPARISON_MODELS)
                }
                onChange={() => {
                  setError("");
                  setSelected((current) =>
                    current.includes(model.id)
                      ? current.filter((id) => id !== model.id)
                      : [...current, model.id],
                  );
                }}
              />
              {model.screenshot ? t.selectComparison : t.noScreenshot}
            </label>
            <dl>
              <div>
                <dt>{t.provider}</dt>
                <dd>{model.provider || t.unspecified}</dd>
              </div>
              <div>
                <dt>{t.reasoning}</dt>
                <dd>{model.reasoning || t.unspecified}</dd>
              </div>
              <div>
                <dt>{t.harness}</dt>
                <dd>{model.harness || t.unspecified}</dd>
              </div>
              <div>
                <dt>{t.firstCommitted}</dt>
                <dd>
                  {model.firstCommittedAt && model.commit ? (
                    <a
                      href={`${repository}/commit/${model.commit}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <time dateTime={model.firstCommittedAt}>
                        {model.firstCommittedAt.slice(0, 10)}
                      </time>
                    </a>
                  ) : (
                    t.unspecified
                  )}
                </dd>
              </div>
              <div>
                <dt>{t.author}</dt>
                <dd>
                  {model.author?.login ? (
                    <a
                      href={`https://github.com/${model.author.login}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      @{model.author.login}
                    </a>
                  ) : (
                    model.author?.name || t.unspecified
                  )}
                </dd>
              </div>
            </dl>
            <div className="model-actions">
              {model.preview && (
                <Link
                  className="button primary"
                  href={`/${locale}/preview/?project=${encodeURIComponent(project.id)}&model=${encodeURIComponent(model.id)}`}
                >
                  {t.preview}
                  <Arrow />
                </Link>
              )}
              <a
                className="text-link"
                href={modelSource(project, model)}
                target="_blank"
                rel="noreferrer"
              >
                {t.record}
                <Arrow diagonal />
              </a>
            </div>
          </article>
        ))}
      </div>
    </>
  );
}
