/** Small ASCII PDFs for blank-page, text, panoramic and internal-link checks. */
export function pdfFixture({ pages = 40, width = 600, height = 20, link = false, fill = false, blank = false, readingText = false } = {}) {
  if (!Number.isInteger(pages) || pages < 1 || !Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0
    || (link && pages < 3)) throw new Error("Invalid PDF fixture dimensions or link destination");
  const objects = ["", "<< /Type /Catalog /Pages 2 0 R >>", "", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"];
  const refs = [];
  for (let page = 1; page <= pages; page++) {
    const object = objects.length;
    refs.push(object);
    const lines = readingText
      ? Array.from({ length: 20 }, (_, index) => `BT /F1 12 Tf 70 ${height - 100 - index * 18} Td (Reader fixture page ${page}. Searchable text for navigation.) Tj ET`).join("\n")
      : `BT /F1 6 Tf 8 ${Math.max(4, height - 10)} Td (Fixture page ${page}) Tj ET`;
    const content = `${fill ? `0.2 0.4 0.6 rg 0 0 ${width} ${height} re f\n` : ""}0 g ${blank ? "" : lines}`;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /Font << /F1 3 0 R >> >> /Contents ${object + 1} 0 R ${link && page === 1 ? `/Annots [${object + 2} 0 R]` : ""} >>`);
    objects.push(`<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`);
    if (link && page === 1) objects.push("LINK");
  }
  objects[2] = `<< /Type /Pages /Count ${pages} /Kids [${refs.map((ref) => `${ref} 0 R`).join(" ")}] >>`;
  if (link) objects[6] = `<< /Type /Annot /Subtype /Link /Rect [6 ${height - 18} 130 ${height - 3}] /Border [0 0 0] /Contents (Jump to page 3) /Dest [${refs[2]} 0 R /Fit] >>`;
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (let i = 1; i < objects.length; i++) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${i} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(pdf);
  return `${pdf}xref\n0 ${objects.length}\n0000000000 65535 f \n${offsets.slice(1).map((n) => `${String(n).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
}
