// Đọc file .xlsx / .csv ngay trong trình duyệt, không cần thư viện ngoài và không
// phải tải file lên server trước khi rà soát. Trả về mảng hai chiều để backend
// tự nhận diện cột và kiểm tra dữ liệu.
// Dùng: NSHMSheet.readFile(file) → { sheets: [{ name, hidden, rows: string[][] }] }
(function (globalScope) {
  "use strict";

  const COLUMNS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

  function u16(view, offset) { return view.getUint16(offset, true); }
  function u32(view, offset) { return view.getUint32(offset, true); }

  async function inflate(bytes, method) {
    if (method === 0) return bytes;
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  async function unzip(arrayBuffer) {
    const bytes = new Uint8Array(arrayBuffer);
    const view = new DataView(arrayBuffer);
    let endOfCentralDirectory = -1;
    for (let index = bytes.length - 22; index >= 0; index -= 1) {
      if (bytes[index] === 0x50 && bytes[index + 1] === 0x4b && bytes[index + 2] === 0x05 && bytes[index + 3] === 0x06) {
        endOfCentralDirectory = index;
        break;
      }
    }
    if (endOfCentralDirectory < 0) throw new Error("File không phải .xlsx hợp lệ.");
    const directoryOffset = u32(view, endOfCentralDirectory + 16);
    const entryCount = u16(view, endOfCentralDirectory + 10);
    const decoder = new TextDecoder();
    const entries = {};
    let pointer = directoryOffset;
    for (let index = 0; index < entryCount; index += 1) {
      const nameLength = u16(view, pointer + 28);
      const extraLength = u16(view, pointer + 30);
      const commentLength = u16(view, pointer + 32);
      const compressedSize = u32(view, pointer + 20);
      const method = u16(view, pointer + 10);
      const localOffset = u32(view, pointer + 42);
      const name = decoder.decode(bytes.slice(pointer + 46, pointer + 46 + nameLength));
      const localNameLength = u16(view, localOffset + 26);
      const localExtraLength = u16(view, localOffset + 28);
      const start = localOffset + 30 + localNameLength + localExtraLength;
      entries[name] = { data: bytes.slice(start, start + compressedSize), method };
      pointer += 46 + nameLength + extraLength + commentLength;
    }
    const files = {};
    for (const [name, entry] of Object.entries(entries)) {
      files[name] = new TextDecoder().decode(await inflate(entry.data, entry.method));
    }
    return files;
  }

  function sharedStringsOf(xml) {
    if (!xml) return [];
    return (xml.match(/<si>[\s\S]*?<\/si>/g) || []).map((item) =>
      (item.match(/<t[^>]*>([\s\S]*?)<\/t>/g) || []).map((part) => part.replace(/<[^>]+>/g, "")).join(""));
  }

  function unescapeXml(value) {
    return String(value)
      .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'").replace(/_x000D_/g, "").replace(/&amp;/g, "&");
  }

  function columnIndexOf(reference) {
    let index = 0;
    for (const character of reference) index = index * 26 + (character.charCodeAt(0) - 64);
    return index - 1;
  }

  function parseSheet(xml, shared) {
    const rows = [];
    for (const rowXml of xml.match(/<row [^>]*r="(\d+)"[^>]*>[\s\S]*?<\/row>/g) || []) {
      const cellsXml = rowXml.match(/<c [^>]*?\/>|<c [^>]*?>[\s\S]*?<\/c>/g) || [];
      const cells = [];
      let filled = false;
      for (const cellXml of cellsXml) {
        const reference = (cellXml.match(/r="([A-Z]+)\d+"/) || [])[1];
        if (!reference) continue;
        const type = (cellXml.match(/ t="([^"]+)"/) || [])[1];
        const raw = (cellXml.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
        let value = raw;
        if (type === "s" && raw !== undefined) value = shared[Number.parseInt(raw, 10)];
        else if (type === "inlineStr") value = (cellXml.match(/<t[^>]*>([\s\S]*?)<\/t>/) || [])[1];
        if (value === undefined || value === "") continue;
        cells[columnIndexOf(reference)] = unescapeXml(String(value));
        filled = true;
      }
      if (!filled) continue;
      for (let index = 0; index < cells.length; index += 1) if (cells[index] === undefined) cells[index] = "";
      rows.push(cells);
    }
    return rows;
  }

  async function parseWorkbook(arrayBuffer) {
    const files = await unzip(arrayBuffer);
    const shared = sharedStringsOf(files["xl/sharedStrings.xml"]);
    const workbook = files["xl/workbook.xml"] || "";
    const relationships = files["xl/_rels/workbook.xml.rels"] || "";
    const relationMap = {};
    for (const item of relationships.match(/<Relationship[^>]+>/g) || []) {
      const id = (item.match(/Id="([^"]+)"/) || [])[1];
      const target = (item.match(/Target="([^"]+)"/) || [])[1];
      if (id && target) relationMap[id] = target.replace(/^\/?/, "").replace(/^xl\//, "");
    }
    const sheets = [];
    for (const sheetXml of workbook.match(/<sheet [^>]+>/g) || []) {
      const name = unescapeXml((sheetXml.match(/name="([^"]+)"/) || [])[1] || "Sheet");
      const relationId = (sheetXml.match(/r:id="([^"]+)"/) || [])[1];
      const hidden = /state="hidden"/.test(sheetXml);
      let target = relationMap[relationId] || "";
      if (target && !target.startsWith("xl/")) target = `xl/${target}`;
      const xml = files[target];
      if (!xml) continue;
      sheets.push({ name, hidden, rows: parseSheet(xml, shared) });
    }
    if (!sheets.length) throw new Error("Không đọc được sheet nào trong file.");
    return { sheets };
  }

  function parseCsv(text) {
    const source = text.replace(/^﻿/, "");
    const separator = (source.split("\n")[0].match(/;/g) || []).length > (source.split("\n")[0].match(/,/g) || []).length ? ";" : ",";
    const rows = [];
    let current = [];
    let value = "";
    let quoted = false;
    for (let index = 0; index < source.length; index += 1) {
      const character = source[index];
      if (quoted) {
        if (character === '"') {
          if (source[index + 1] === '"') { value += '"'; index += 1; }
          else quoted = false;
        } else value += character;
      } else if (character === '"') quoted = true;
      else if (character === separator) { current.push(value.trim()); value = ""; }
      else if (character === "\n" || character === "\r") {
        if (character === "\r" && source[index + 1] === "\n") index += 1;
        current.push(value.trim());
        if (current.some((cell) => cell !== "")) rows.push(current);
        current = [];
        value = "";
      } else value += character;
    }
    if (value !== "" || current.length) {
      current.push(value.trim());
      if (current.some((cell) => cell !== "")) rows.push(current);
    }
    return rows;
  }

  async function readFile(file) {
    const name = String(file.name || "").toLowerCase();
    if (name.endsWith(".csv") || name.endsWith(".txt")) {
      return { sheets: [{ name: file.name, hidden: false, rows: parseCsv(await file.text()) }] };
    }
    if (name.endsWith(".xls")) throw new Error("Định dạng .xls cũ chưa hỗ trợ. Hãy lưu lại thành .xlsx rồi thử lại.");
    return parseWorkbook(await file.arrayBuffer());
  }

  // Bỏ các dòng trống ở đầu, lấy dòng đầu tiên có từ 2 ô trở lên làm tiêu đề.
  function splitHeaderAndRows(rows) {
    const headerIndex = rows.findIndex((row) => row.filter((cell) => String(cell || "").trim()).length >= 2);
    if (headerIndex < 0) return { headers: [], rows: [] };
    const headers = rows[headerIndex].map((cell) => String(cell ?? "").trim());
    const width = headers.length;
    const body = rows.slice(headerIndex + 1)
      .map((row) => Array.from({ length: width }, (unused, index) => String(row[index] ?? "").trim()))
      .filter((row) => row.some((cell) => cell !== ""));
    return { headers, rows: body };
  }

  globalScope.NSHMSheet = { readFile, parseWorkbook, parseCsv, splitHeaderAndRows, COLUMNS };
})(window);
