import { getDocument, GlobalWorkerOptions } from "https://cdn.jsdelivr.net/npm/pdfjs-dist@5.4.149/build/pdf.mjs";
import { clean } from "./ingest-utils.js";

GlobalWorkerOptions.workerSrc =
  "https://cdn.jsdelivr.net/npm/pdfjs-dist@5.4.149/build/pdf.worker.min.mjs";

export async function extractPdf(file, onProgress) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const pdf = await getDocument({ data: bytes }).promise;
  const parts = [];

  for (let pageNo = 1; pageNo <= pdf.numPages; pageNo++) {
    onProgress?.("استخراج PDF — صفحه " + pageNo + " از " + pdf.numPages);
    const page = await pdf.getPage(pageNo);
    const content = await page.getTextContent();
    const text = content.items
      .map((item) => ("str" in item ? item.str : ""))
      .join(" ");
    parts.push("\n\n## Page " + pageNo + "\n\n" + clean(text));
  }

  return { bytes, text: clean(parts.join("")) };
}
