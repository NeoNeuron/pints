// A leading =, +, -, @, tab, or CR makes Excel and Sheets treat the cell as a
// formula. Prefixing an apostrophe forces it back to text. Without this, a
// display name of `=cmd|'/c calc'` becomes a live formula in the organizers'
// spreadsheet the moment they open the export.
const FORMULA_START = /^[=+\-@\t\r]/;
const NEEDS_QUOTES = /[",\n\r]/;

export function csvCell(value) {
  let text = value === null || value === undefined ? "" : String(value);
  if (FORMULA_START.test(text)) text = `'${text}`;
  if (NEEDS_QUOTES.test(text)) text = `"${text.replace(/"/g, '""')}"`;
  return text;
}

/** `columns` is [{key, label}]. Always emits a header and CRLF endings. */
export function toCsv(rows, columns) {
  const lines = [columns.map((c) => csvCell(c.label)).join(",")];
  for (const row of rows) lines.push(columns.map((c) => csvCell(row[c.key])).join(","));
  return `${lines.join("\r\n")}\r\n`;
}
