// Ghi file .xlsx tối giản, không cần thư viện ngoài — đủ để làm BIỂU MẪU TRỐNG cho các
// màn nhập Excel: hàng tiêu đề, độ rộng cột, cố định hàng tiêu đề, định dạng chữ cho
// cột mã/số điện thoại, ô chọn thả xuống và lời nhắc hiện ra khi bấm vào ô.
//
// Vì sao tự ghi thay vì thêm thư viện: dự án cố ý không có bước build và giữ số phụ
// thuộc tối thiểu trên máy chủ của trường; một biểu mẫu trống chỉ cần vài phần XML.
//
// Chỉ ghi hàng tiêu đề (và các hàng hướng dẫn nếu có), KHÔNG ghi hàng trống đã định
// dạng: định dạng chữ và ô chọn gắn theo cột/vùng. Hàng trống có định dạng là thứ bộ
// đọc public/sheet-reader.js không cần gặp.
import { crc32, deflateRawSync } from "node:zlib";

const escapeXml = (value) => String(value ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** A, B, …, Z, AA, AB, … */
export function tenCot(index) {
  let ten = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) ten = String.fromCharCode(65 + ((n - 1) % 26)) + ten;
  return ten;
}

/* ------------------------------------------------------------------ zip */

function dosTime(date) {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const day = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, day };
}

function zip(files, date = new Date()) {
  const { time, day } = dosTime(date);
  const local = [];
  const central = [];
  let offset = 0;
  for (const [name, content] of files) {
    const data = Buffer.from(content, "utf8");
    const compressed = deflateRawSync(data);
    const nameBytes = Buffer.from(name, "utf8");
    const crc = crc32(data) >>> 0;

    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x0800, 6); // tên tệp UTF-8
    header.writeUInt16LE(8, 8);      // deflate
    header.writeUInt16LE(time, 10);
    header.writeUInt16LE(day, 12);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(compressed.length, 18);
    header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(nameBytes.length, 26);
    header.writeUInt16LE(0, 28);
    local.push(header, nameBytes, compressed);

    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(0x0800, 8);
    entry.writeUInt16LE(8, 10);
    entry.writeUInt16LE(time, 12);
    entry.writeUInt16LE(day, 14);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(compressed.length, 20);
    entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(nameBytes.length, 28);
    entry.writeUInt32LE(offset, 42);
    central.push(entry, nameBytes);

    offset += header.length + nameBytes.length + compressed.length;
  }
  const centralSize = central.reduce((sum, part) => sum + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, ...central, end]);
}

/* ------------------------------------------------------------- workbook */

// Kiểu ô: 0 mặc định · 1 tiêu đề · 2 chữ (định dạng @) · 3 tiêu đề hướng dẫn · 4 chữ xuống dòng · 5 tiêu đề cột bắt buộc
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="4">
<font><sz val="11"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="13"/><color rgb="FF12264A"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/><family val="2"/></font>
</fonts>
<fills count="4">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FF12264A"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFD21235"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="2">
<border><left/><right/><top/><bottom/><diagonal/></border>
<border><left style="thin"><color rgb="FFE2E6EE"/></left><right style="thin"><color rgb="FFE2E6EE"/></right><top style="thin"><color rgb="FFE2E6EE"/></top><bottom style="thin"><color rgb="FFE2E6EE"/></bottom><diagonal/></border>
</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="6">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="49" fontId="1" fillId="2" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="49" fontId="3" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

function dataValidationXml(validation, sqref) {
  const nhac = validation.prompt
    ? ` showInputMessage="1" promptTitle="${escapeXml(validation.prompt.title.slice(0, 32))}" prompt="${escapeXml(validation.prompt.text.slice(0, 255))}"`
    : "";
  if (validation.type === "list") {
    const danhSach = validation.values.join(",");
    if (danhSach.length > 255 || validation.values.some((item) => item.includes(","))) {
      throw new Error(`Danh sách chọn quá dài hoặc có dấu phẩy: ${danhSach}`);
    }
    return `<dataValidation type="list" allowBlank="1" showErrorMessage="1" errorStyle="${validation.strict === false ? "warning" : "stop"}" errorTitle="Giá trị không hợp lệ" error="${escapeXml(`Hãy chọn một giá trị trong danh sách: ${danhSach}`.slice(0, 255))}"${nhac} sqref="${sqref}"><formula1>"${escapeXml(danhSach)}"</formula1></dataValidation>`;
  }
  if (validation.type === "listRange") {
    const nguon = `'${validation.sheet.replace(/'/g, "''")}'!${validation.range}`;
    return `<dataValidation type="list" allowBlank="1" showErrorMessage="1" errorStyle="${validation.strict === false ? "warning" : "stop"}" errorTitle="Không có trong danh sách" error="Giá trị này không có trong danh sách. Chắc chắn muốn giữ?"${nhac} sqref="${sqref}"><formula1>${escapeXml(nguon)}</formula1></dataValidation>`;
  }
  if (validation.type === "whole" || validation.type === "decimal") {
    return `<dataValidation type="${validation.type}" operator="between" allowBlank="1" showErrorMessage="1" errorTitle="Giá trị không hợp lệ" error="${escapeXml(`Hãy nhập số từ ${validation.min} đến ${validation.max}.`)}"${nhac} sqref="${sqref}"><formula1>${validation.min}</formula1><formula2>${validation.max}</formula2></dataValidation>`;
  }
  return `<dataValidation allowBlank="1"${nhac} sqref="${sqref}"/>`;
}

function sheetXml(sheet, shared) {
  const soHang = sheet.soHangNhap || 1000;
  const chiSo = (text) => {
    if (!shared.map.has(text)) { shared.map.set(text, shared.list.length); shared.list.push(text); }
    return shared.map.get(text);
  };
  const oChu = (ref, text, style) => `<c r="${ref}" s="${style}" t="s"><v>${chiSo(text)}</v></c>`;

  const rows = [];
  const validations = [];
  if (sheet.columns) {
    const cells = sheet.columns.map((col, index) => oChu(`${tenCot(index)}1`, col.header, col.required ? 5 : 1)).join("");
    rows.push(`<row r="1" ht="36" customHeight="1">${cells}</row>`);
    sheet.columns.forEach((col, index) => {
      const cot = tenCot(index);
      if (col.validation || col.prompt) {
        validations.push(dataValidationXml({ ...(col.validation || {}), prompt: col.prompt }, `${cot}2:${cot}${soHang + 1}`));
      }
      // Bấm vào ô tiêu đề cũng thấy hướng dẫn của cột, kể cả khi chưa có dòng nào.
      if (col.prompt) validations.push(dataValidationXml({ prompt: col.prompt }, `${cot}1`));
    });
  }
  (sheet.lines || []).forEach((line, index) => {
    if (!line.text) return; // dòng trống: không ghi phần tử <row>
    const style = line.kieu === "tieuDe" ? 3 : 4;
    rows.push(`<row r="${index + 1}">${oChu(`A${index + 1}`, line.text, style)}</row>`);
  });
  if (sheet.bang) {
    rows.push(`<row r="1" ht="30" customHeight="1">${sheet.bang.headers.map((text, index) => oChu(`${tenCot(index)}1`, text, 1)).join("")}</row>`);
    sheet.bang.rows.forEach((row, rowIndex) => {
      const cells = row.map((text, index) => (text === "" ? "" : oChu(`${tenCot(index)}${rowIndex + 2}`, text, 2))).join("");
      rows.push(`<row r="${rowIndex + 2}">${cells}</row>`);
    });
  }

  const cols = sheet.columns
    ? sheet.columns.map((col, index) => `<col min="${index + 1}" max="${index + 1}" width="${col.width || 18}" style="${col.text === false ? 0 : 2}" customWidth="1"/>`).join("")
    : sheet.bang
      ? sheet.bang.headers.map((text, index) => `<col min="${index + 1}" max="${index + 1}" width="${sheet.bang.widths?.[index] || 20}" style="2" customWidth="1"/>`).join("")
      : `<col min="1" max="1" width="${sheet.rongCotHuongDan || 120}" style="4" customWidth="1"/>`;
  const pane = sheet.columns || sheet.bang
    ? `<sheetView workbookViewId="0"${sheet.chon ? ' tabSelected="1"' : ""}><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/></sheetView>`
    : `<sheetView workbookViewId="0"/>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheetViews>${pane}</sheetViews>
<sheetFormatPr defaultRowHeight="15"/>
<cols>${cols}</cols>
<sheetData>${rows.join("")}</sheetData>
${sheet.columns ? `<autoFilter ref="A1:${tenCot(sheet.columns.length - 1)}1"/>` : ""}
${validations.length ? `<dataValidations count="${validations.length}">${validations.join("")}</dataValidations>` : ""}
<pageMargins left="0.5" right="0.5" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>
</worksheet>`;
}

/**
 * @param {{ sheets: Array<{ name: string, columns?: Array<{ header: string, width?: number, required?: boolean,
 *   text?: boolean, validation?: { type: "list"|"whole"|"decimal", values?: string[], min?: number, max?: number, strict?: boolean },
 *   prompt?: { title: string, text: string } }>, lines?: Array<{ text: string, kieu?: "tieuDe" }>, soHangNhap?: number }> }} workbook
 * @returns {Buffer}
 */
export function taoXlsx({ sheets }) {
  const shared = { list: [], map: new Map() };
  const sheetFiles = sheets.map((sheet, index) => [`xl/worksheets/sheet${index + 1}.xml`, sheetXml({ ...sheet, chon: index === 0 }, shared)]);
  const autoFilterNames = sheets
    .map((sheet, index) => (sheet.columns
      ? `<definedName name="_xlnm._FilterDatabase" localSheetId="${index}" hidden="1">'${sheet.name.replace(/'/g, "''")}'!$A$1:$${tenCot(sheet.columns.length - 1)}$1</definedName>`
      : ""))
    .join("");
  const files = [
    ["[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
${sheets.map((sheet, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`],
    ["_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`],
    ["docProps/core.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<dc:title>${escapeXml(sheets[0]?.name || "Biểu mẫu")}</dc:title><dc:creator>NSHM Clubs</dc:creator>
</cp:coreProperties>`],
    ["docProps/app.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>NSHM Clubs</Application></Properties>`],
    ["xl/workbook.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<bookViews><workbookView activeTab="0"/></bookViews>
<sheets>${sheets.map((sheet, index) => `<sheet name="${escapeXml(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join("")}</sheets>
${autoFilterNames ? `<definedNames>${autoFilterNames}</definedNames>` : ""}
</workbook>`],
    ["xl/_rels/workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${sheets.map((sheet, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join("")}
<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
<Relationship Id="rId${sheets.length + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>
</Relationships>`],
    ["xl/styles.xml", STYLES],
    ...sheetFiles,
  ];
  // sharedStrings phải ghi SAU khi mọi sheet đã đăng ký chuỗi của mình.
  files.push(["xl/sharedStrings.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${shared.list.length}" uniqueCount="${shared.list.length}">${shared.list.map((text) => `<si><t xml:space="preserve">${escapeXml(text)}</t></si>`).join("")}</sst>`]);
  return zip(files);
}
