import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { unzipSync, strFromU8 } from "fflate";
import * as cheerio from "cheerio";

function arg(name) {
  const i = process.argv.indexOf("--" + name);
  return i >= 0 ? process.argv[i + 1] : null;
}

const input = arg("file");
const sourceId = arg("source");
const versionId = arg("version") || "v" + Date.now();

if (!input || !sourceId) {
  console.error("Usage: node scripts/prepare-source.mjs --file <book.pdf|book.epub> --source BOOK-001 [--version v1]");
  process.exit(2);
}

const bytes = await fs.readFile(input);
const ext = path.extname(input).toLowerCase();
const checksum = crypto.createHash("sha256").update(bytes).digest("hex");

function clean(s) {
  return s
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function pdfToMarkdown(buffer) {
  const doc = await getDocument({ data: new Uint8Array(buffer), disableWorker: true }).promise;
  const parts = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    const text = tc.items.map((x) => ("str" in x ? x.str : "")).join(" ");
    parts.push("\n\n## Page " + p + "\n\n" + clean(text));
  }
  return parts.join("");
}

function resolveZipPath(baseFile, href) {
  const base = path.posix.dirname(baseFile);
  return path.posix.normalize(path.posix.join(base, href.split("#")[0]));
}

function htmlToMarkdownLite(html) {
  const $ = cheerio.load(html, { xmlMode: true });
  $("script,style,nav").remove();
  $("h1,h2,h3,h4,h5,h6").each((_, el) => {
    const level = Number(el.tagName.slice(1));
    $(el).replaceWith("\n\n" + "#".repeat(level) + " " + $(el).text().trim() + "\n\n");
  });
  $("p,div,section,article,li,br").each((_, el) => {
    $(el).append("\n");
  });
  return clean($.root().text());
}

function epubToMarkdown(buffer) {
  const files = unzipSync(new Uint8Array(buffer));
  const container = files["META-INF/container.xml"];
  if (!container) throw new Error("Invalid EPUB: missing META-INF/container.xml");

  const containerXml = strFromU8(container);
  const rootMatch = containerXml.match(/full-path=["']([^"']+)["']/i);
  if (!rootMatch) throw new Error("Invalid EPUB: package document not found");

  const opfPath = rootMatch[1];
  const opfBytes = files[opfPath];
  if (!opfBytes) throw new Error("Invalid EPUB: OPF not found");
  const opf = strFromU8(opfBytes);
  const $ = cheerio.load(opf, { xmlMode: true });

  const manifest = new Map();
  $("manifest > item").each((_, el) => {
    const id = $(el).attr("id");
    const href = $(el).attr("href");
    if (id && href) manifest.set(id, resolveZipPath(opfPath, href));
  });

  const ordered = [];
  $("spine > itemref").each((_, el) => {
    const idref = $(el).attr("idref");
    const filePath = idref ? manifest.get(idref) : null;
    if (filePath) ordered.push(filePath);
  });

  if (!ordered.length) {
    for (const name of Object.keys(files).sort()) {
      if (/\.(xhtml|html|htm)$/i.test(name)) ordered.push(name);
    }
  }

  const parts = [];
  for (const name of ordered) {
    const item = files[name];
    if (!item) continue;
    const md = htmlToMarkdownLite(strFromU8(item));
    if (md) parts.push(md);
  }
  return clean(parts.join("\n\n"));
}

const markdown = ext === ".pdf"
  ? await pdfToMarkdown(bytes)
  : ext === ".epub"
    ? epubToMarkdown(bytes)
    : (() => { throw new Error("Only PDF and EPUB are supported"); })();

function isHeading(line) {
  const s = line.trim();
  if (/^#{1,6}\s+/.test(s)) return true;
  if (/^(chapter|part|section)\s+\d+/i.test(s)) return true;
  if (/^\d+(\.\d+){0,3}\s+\S+/.test(s) && s.length < 140) return true;
  return false;
}

function normalizeHeading(line) {
  return line.replace(/^#{1,6}\s+/, "").trim();
}

function chunkText(text, target = 2600, overlap = 350) {
  const lines = text.split("\n");
  const chunks = [];
  let buffer = "";
  let headingPath = [];
  let chapter = null;
  let section = null;

  const flush = () => {
    const body = clean(buffer);
    if (!body) return;
    chunks.push({
      text: body,
      chapter,
      section,
      heading_path: [...headingPath]
    });
    buffer = body.slice(Math.max(0, body.length - overlap));
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      buffer += "\n";
      continue;
    }

    if (isHeading(line)) {
      const h = normalizeHeading(line);
      if (/^(chapter|part)\b/i.test(h)) {
        chapter = h;
        section = null;
        headingPath = [h];
      } else {
        section = h;
        headingPath = chapter ? [chapter, h] : [h];
      }
    }

    const next = buffer ? buffer + "\n" + line : line;
    if (next.length > target && buffer.length > target * 0.55) flush();
    buffer += (buffer ? "\n" : "") + line;
  }
  flush();
  return chunks;
}

const rawChunks = chunkText(markdown);
const chunks = rawChunks.map((c, i) => {
  const contentHash = crypto.createHash("sha256").update(c.text).digest("hex");
  return {
    chunk_id: sourceId + "-" + versionId + "-C" + String(i + 1).padStart(5, "0"),
    index: i,
    chapter: c.chapter,
    section: c.section,
    heading_path: c.heading_path,
    content_hash: contentHash,
    token_count: Math.ceil(c.text.length / 4),
    text: c.text
  };
});

const outDir = path.join("prepared");
await fs.mkdir(outDir, { recursive: true });
const out = path.join(outDir, sourceId + "-" + versionId + ".json");

await fs.writeFile(out, JSON.stringify({
  schema_version: "1.0",
  source_id: sourceId,
  version_id: versionId,
  filename: path.basename(input),
  mime_type: ext === ".pdf" ? "application/pdf" : "application/epub+zip",
  checksum,
  extracted_chars: markdown.length,
  chunk_count: chunks.length,
  chunks
}, null, 2));

console.log(JSON.stringify({
  prepared_file: out,
  source_id: sourceId,
  version_id: versionId,
  checksum,
  extracted_chars: markdown.length,
  chunks: chunks.length
}, null, 2));
