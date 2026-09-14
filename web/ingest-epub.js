import { unzipSync, strFromU8 } from "https://cdn.jsdelivr.net/npm/fflate@0.8.2/esm/browser.js";
import { clean } from "./ingest-utils.js";

function resolvePath(baseFile, href) {
  const parts = baseFile.split("/");
  parts.pop();

  for (const piece of href.split("#")[0].split("/")) {
    if (!piece || piece === ".") continue;
    if (piece === "..") parts.pop();
    else parts.push(piece);
  }

  return parts.join("/");
}

function htmlToText(html) {
  const doc = new DOMParser().parseFromString(html, "application/xhtml+xml");
  if (!doc?.documentElement) return "";

  for (const node of doc.querySelectorAll("script,style,nav")) node.remove();

  for (const heading of doc.querySelectorAll("h1,h2,h3,h4,h5,h6")) {
    const level = Number(heading.tagName.slice(1)) || 2;
    heading.textContent =
      "\n\n" + "#".repeat(level) + " " + heading.textContent.trim() + "\n\n";
  }

  for (const node of doc.querySelectorAll("p,div,section,article,li,br")) {
    node.append("\n");
  }

  return clean(doc.documentElement.textContent || "");
}

export async function extractEpub(file, onProgress) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const files = unzipSync(bytes);

  const container = files["META-INF/container.xml"];
  if (!container) throw new Error("EPUB معتبر نیست.");

  const containerXml = strFromU8(container);
  const match = containerXml.match(/full-path=["']([^"']+)["']/i);
  if (!match) throw new Error("فایل OPF پیدا نشد.");

  const opfPath = match[1];
  const opfBytes = files[opfPath];
  if (!opfBytes) throw new Error("فایل OPF در EPUB پیدا نشد.");

  const opfDoc = new DOMParser().parseFromString(
    strFromU8(opfBytes),
    "application/xml"
  );

  const manifest = new Map();
  for (const item of opfDoc.querySelectorAll("manifest > item")) {
    const id = item.getAttribute("id");
    const href = item.getAttribute("href");
    if (id && href) manifest.set(id, resolvePath(opfPath, href));
  }

  const ordered = [];
  for (const ref of opfDoc.querySelectorAll("spine > itemref")) {
    const idref = ref.getAttribute("idref");
    const filePath = idref ? manifest.get(idref) : null;
    if (filePath) ordered.push(filePath);
  }

  const names = ordered.length
    ? ordered
    : Object.keys(files).filter((name) => name.endsWith(".xhtml") || name.endsWith(".html"));

  const parts = [];
  names.forEach((name, index) => {
    onProgress?.("استخراج EPUB — بخش " + (index + 1) + " از " + names.length);
    const item = files[name];
    if (!item) return;
    const text = htmlToText(strFromU8(item));
    if (text) parts.push(text);
  });

  return { bytes, text: clean(parts.join("\n\n")) };
}
