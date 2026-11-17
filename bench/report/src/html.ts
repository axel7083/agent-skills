import type { PublishedTrial, Results } from "@podman-desktop/bench-contracts";

export const RESULTS_ELEMENT_ID = "bench-results";
export const TRIALS_ELEMENT_ID = "bench-trials";

/**
 * The page's policy: no inline script or style, so agent-controlled strings that end up in the
 * data can never execute. Vega runs with its expression interpreter, not `new Function`.
 */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

/** JSON that is safe inside a `<script type="application/json">` element: it can't close the element. */
export function jsonForScript(value: unknown): string {
  return JSON.stringify(value)
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("&", "\\u0026")
    .replaceAll(" ", "\\u2028")
    .replaceAll(" ", "\\u2029");
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export interface ReportPage {
  readonly results: Results;
  readonly trials: readonly PublishedTrial[];
  /** URLs of the bundled script and stylesheet, same origin. */
  readonly scriptUrl: string;
  readonly styleUrl: string;
  /** Shown as a banner: the mockup's data is invented. */
  readonly synthetic?: boolean;
}

/** The report's HTML shell. The data rides along as JSON islands; the bundled script renders everything. */
export function renderReportHtml(page: ReportPage): string {
  const title = `${page.results.skill} ${page.results.skillVersion} — skill benchmark`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${escapeHtml(CONTENT_SECURITY_POLICY)}">
<title>${escapeHtml(title)}</title>
<link rel="stylesheet" href="${escapeHtml(page.styleUrl)}">
<script type="module" src="${escapeHtml(page.scriptUrl)}"></script>
</head>
<body${page.synthetic === true ? " data-synthetic" : ""}>
<noscript>This report needs JavaScript. The same data is at the run's raw-data API.</noscript>
<main id="report"></main>
<script type="application/json" id="${RESULTS_ELEMENT_ID}">${jsonForScript(page.results)}</script>
<script type="application/json" id="${TRIALS_ELEMENT_ID}">${jsonForScript(page.trials)}</script>
</body>
</html>
`;
}
