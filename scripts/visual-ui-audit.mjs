import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const admin = read("web/admin.html");
const ingest = read("web/ingest.html");
const privacy = read("web/privacy.html");
const management = read("web/management.css");
const adminJs = read("web/admin.js");
const worker = read("src/index.ts");

const pages = [
  ["admin", admin],
  ["ingest", ingest],
  ["privacy", privacy]
];

const checks = [
  ["admin uses shared management stylesheet", admin.includes('href="/management.css"')],
  ["ingest uses shared management stylesheet", ingest.includes('href="/management.css"')],
  ["privacy uses shared management stylesheet", privacy.includes('href="/management.css"')],
  ["privacy follows Persian RTL shell", privacy.includes('<html lang="fa" dir="rtl">')],
  ["management pages use warm theme color", pages.every(([, html]) => html.includes('content="#fbfaf7"'))],
  ["management HTML has no inline style attributes", pages.every(([, html]) => !/\sstyle\s*=/.test(html))],
  ["admin JS has no dynamic inline styling", !adminJs.includes(".style.")],
  ["shared controls exist", management.includes(".form-control") && management.includes(".management-link")],
  ["management mobile breakpoint exists", management.includes("@media (max-width: 720px)")],
  ["worker proxies management stylesheet", worker.includes('"/management.css"')],
  ["worker proxies privacy route", worker.includes('"/privacy"') && worker.includes('"/privacy.html"')],
  ["legacy dark control colors removed from management HTML", pages.every(([, html]) => !html.includes("#081220") && !html.includes("#26364c"))]
];

const failed = checks.filter(([, ok]) => !ok);
for (const [name, ok] of checks) {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
}

if (failed.length) {
  console.error(`\nVisual UI audit failed: ${failed.map(([name]) => name).join(", ")}`);
  process.exit(1);
}

console.log(`\nVisual UI audit passed (${checks.length}/${checks.length}).`);
