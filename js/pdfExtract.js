/* ============================================================
   pdfExtract.js
   Real text extraction from an uploaded PDF using pdf.js,
   running entirely in the browser. This mirrors the
   "pdfplumber" step in the original architecture — no text
   is invented, only what pdf.js actually reads from the file.
   ============================================================ */
pdfjsLib.GlobalWorkerOptions.workerSrc = 'js/vendor/pdf.worker.min.js';

async function extractTextFromPdf(file, onProgress) {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  let fullText = '';

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const content = await page.getTextContent();
    const pageText = content.items.map(item => item.str).join(' ');
    fullText += `\n\n--- Page ${pageNum} ---\n${pageText}`;
    if (onProgress) onProgress(pageNum, pdf.numPages);
  }

  return { text: fullText.trim(), numPages: pdf.numPages };
}
