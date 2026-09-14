export function clean(value) {
  return String(value ?? "")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function chunkText(text, target = 2600, overlap = 350) {
  const lines = text.split("\n");
  const chunks = [];
  let buffer = "";
  let chapter = null;
  let section = null;
  let headingPath = [];

  const isHeading = (line) => {
    const s = line.trim();
    return /^#{1,6}\s+/.test(s)
      || /^(chapter|part|section)\s+\d+/i.test(s)
      || (/^\d+(\.\d+){0,3}\s+\S+/.test(s) && s.length < 140);
  };

  const normalizeHeading = (line) =>
    line.replace(/^#{1,6}\s+/, "").trim();

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
      const heading = normalizeHeading(line);
      if (/^(chapter|part)\b/i.test(heading)) {
        chapter = heading;
        section = null;
        headingPath = [heading];
      } else {
        section = heading;
        headingPath = chapter ? [chapter, heading] : [heading];
      }
    }

    const next = buffer ? buffer + "\n" + line : line;
    if (next.length > target && buffer.length > target * 0.55) flush();
    buffer += (buffer ? "\n" : "") + line;
  }

  flush();
  return chunks;
}

export async function sha256Hex(input) {
  const bytes = typeof input === "string"
    ? new TextEncoder().encode(input)
    : input;
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
