import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const index = read("web/index.html");
const styles = read("web/styles.css");
const home = read("web/home.css");
const answer = read("web/answer.css");
const discovery = read("web/discovery.css");
const library = read("web/library.css");

const checks = [
  ["fa + RTL document", index.includes('<html lang="fa" dir="rtl">')],
  ["mobile viewport", index.includes('name="viewport"') && index.includes("width=device-width")],
  ["skip link", index.includes('class="skip-link"')],
  ["tablet breakpoint", home.includes("@media (max-width: 860px)")],
  ["mobile breakpoint", home.includes("@media (max-width: 680px)")],
  ["small mobile breakpoint", home.includes("@media (max-width: 520px)")],
  ["narrow mobile breakpoint", home.includes("@media (max-width: 380px)")],
  ["mobile navigation remains scrollable", home.includes("overflow-x: auto") && home.includes(".main-nav")],
  ["search stacks on small mobile", home.includes(".ask-form { grid-template-columns: 1fr; }")],
  ["question and stats grids collapse", home.includes(".questions-grid,\n  .stats-strip { grid-template-columns: 1fr; }")],
  ["answer sources collapse", answer.includes(".sources {\n    grid-template-columns: 1fr;")],
  ["feedback becomes full width", answer.includes(".feedback button {\n    width: 100%;")],
  ["system state becomes one column", answer.includes(".system-state {\n    grid-template-columns: 1fr;")],
  ["discovery collapses", discovery.includes(".learning-paths,\n  .topic-groups { grid-template-columns: 1fr; }")],
  ["library collapses", library.includes(".library-overview,\n  .featured-books { grid-template-columns: 1fr; }")],
  ["mobile controls use 48px token", styles.includes("--control-height: 48px")],
  ["mobile home touch targets", home.includes(".question-list button") && home.includes("min-height: 48px")],
  ["long mixed-direction text wraps", styles.includes("overflow-wrap: anywhere")],
  ["reduced motion supported", styles.includes("prefers-reduced-motion: reduce")]
];

const failed = checks.filter(([, ok]) => !ok);
for (const [name, ok] of checks) {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
}

if (failed.length) {
  console.error(`\nMobile UI audit failed: ${failed.map(([name]) => name).join(", ")}`);
  process.exit(1);
}

console.log(`\nMobile UI audit passed (${checks.length}/${checks.length}).`);
