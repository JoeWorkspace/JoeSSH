const FORMULA_INJECTION_PREFIX = /^[ \t]*(?:[=+\-@]|\t)/u;
export function isUnsafeCsvCell(value) {
  return typeof value === "string" && FORMULA_INJECTION_PREFIX.test(value);
}

export function hasDisallowedCsvControl(value) {
  if (typeof value !== "string") return false;
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (
      (codePoint >= 0x00 && codePoint <= 0x1f) ||
      (codePoint >= 0x7f && codePoint <= 0x9f) ||
      (codePoint >= 0x202a && codePoint <= 0x202e) ||
      (codePoint >= 0x2066 && codePoint <= 0x2069) ||
      codePoint === 0xfeff
    ) {
      return true;
    }
  }
  return false;
}

export function csvCell(value, label = "CSV cell") {
  const text = value == null ? "" : String(value);
  if (isUnsafeCsvCell(text)) {
    throw new Error(`${label} starts with a formula-injection prefix`);
  }
  return `"${text.replace(/"/gu, '""')}"`;
}

export function parseCsv(
  text,
  { allowBom = false, allowCellLineBreaks = false } = {},
) {
  if (typeof text !== "string") {
    throw new TypeError("CSV input must be a UTF-8 string");
  }
  if (text.startsWith("\ufeff")) {
    if (!allowBom) throw new Error("CSV input must not contain a BOM");
    text = text.slice(1);
  }

  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;
  let fieldStarted = false;
  let afterClosingQuote = false;

  const pushCell = () => {
    const safetyValue = allowCellLineBreaks
      ? cell.replace(/[\r\n]/gu, "")
      : cell;
    if (hasDisallowedCsvControl(safetyValue)) {
      throw new Error("CSV cell contains a disallowed control character");
    }
    if (isUnsafeCsvCell(cell)) {
      throw new Error("CSV cell starts with a formula-injection prefix");
    }
    row.push(cell);
    cell = "";
    fieldStarted = false;
    afterClosingQuote = false;
  };

  const pushRow = () => {
    pushCell();
    rows.push(row);
    row = [];
  };

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (inQuotes) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          inQuotes = false;
          afterClosingQuote = true;
        }
      } else {
        cell += character;
      }
      continue;
    }

    if (afterClosingQuote) {
      if (character === ",") {
        pushCell();
      } else if (character === "\r") {
        if (text[index + 1] === "\n") index += 1;
        pushRow();
      } else if (character === "\n") {
        pushRow();
      } else {
        throw new Error("CSV has characters after a closing quote");
      }
      continue;
    }

    if (!fieldStarted && character === '"') {
      inQuotes = true;
      fieldStarted = true;
    } else if (character === ",") {
      pushCell();
    } else if (character === "\r") {
      if (text[index + 1] === "\n") index += 1;
      pushRow();
    } else if (character === "\n") {
      pushRow();
    } else if (character === '"') {
      throw new Error("CSV quote must start a quoted field");
    } else {
      cell += character;
      fieldStarted = true;
    }
  }

  if (inQuotes) {
    throw new Error("CSV has an unterminated quoted field");
  }
  if (fieldStarted || row.length > 0 || cell.length > 0) {
    pushCell();
    rows.push(row);
  }
  return rows;
}
