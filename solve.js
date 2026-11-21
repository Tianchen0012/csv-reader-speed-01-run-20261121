// Fast csv-reader 1.0.0-compatible CSV reader.
//
// run(input) returns exactly what csv-reader 1.0.0's readCsv returns for
// {text, header}: {columns, rows, errors}. Same broken-row policy, field for
// field: a leading U+FEFF is dropped; records end at LF or CRLF; a line left
// with no characters is no record; outside quotes a CR not followed by LF is
// dropped (stray_cr); a field that opens with a quote runs to the next quote
// that is not doubled ("" inside it is one quote, each CRLF or lone CR
// inside it reads as LF); text after the closing quote, up to the next comma
// or line break, is appended as it stands (quote_junk when the field ends);
// a quote that never closes is a literal character and the text after it is
// re-read as unquoted (unterminated_quote); a quote inside an unquoted field
// is a literal character; fields stay strings, never trimmed or converted;
// columns is the first record when header is true, else null; rows are
// padded with empty strings (short_row, with fields: its field count) or cut
// (long_row, with extra: the cut fields) to the first record's width; each
// error is {code, line, row} in the order met, a record's short_row or
// long_row when it ends; line is the 1-based line its record starts on,
// counting every LF, CRLF and lone CR inside quotes.
//
// Speed comes from never building a field one character at a time: a record
// with no quote and no stray CR in its line is split on commas in one go,
// a quoted field is found with indexOf and sliced, and an unquoted field is
// sliced between its delimiters (only a field holding a stray CR is built
// from pieces). No result object is built per field either: the readers
// return the value alone and share one `ended` flag, and the unquoted scan
// tests one delimiter table instead of three comparisons a character. No
// regex runs in the hot loop; the two regexes below run at most once per
// quoted field that holds a line break or a doubled quote.

/** How a field ended: at a comma, at a line break, or at the end of the text. */
const COMMA = 0;
const LINE_BREAK = 1;
const END = 2;

/** 1 at a character that ends an unquoted field: comma, LF, CR. */
const DELIM = new Uint8Array(128);
DELIM[44] = 1;
DELIM[10] = 1;
DELIM[13] = 1;

/** csv-reader 1.0.0's answer for one case's input, {text, header}. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  const n = text.length;
  let pos = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  let line = 1;
  // The record being read: the line it starts on, and its index in rows (null: the header).
  let recordLine = 1;
  let recordRow = null;
  // How the last field read ended (readUnquoted and readQuoted set it, and
  // return the field's value alone, so no result object is built per field).
  let ended = END;

  function pushErr(code) {
    errors.push({ code, line: recordLine, row: recordRow });
  }

  // Joins an unquoted field's pieces once it ends (a field with no stray CR
  // is one slice). `end` is the field's last character, before its delimiter.
  function joinField(value, start, end, pieces) {
    if (pieces === null) {
      return start < end ? (value === '' ? text.slice(start, end) : value + text.slice(start, end)) : value;
    }
    pieces.push(text.slice(start, end));
    return value + pieces.join('');
  }

  // Reads unquoted characters onto `value` up to the next comma or line
  // break: a CR not followed by LF is dropped (stray_cr). Returns the field;
  // `ended` says how it ended.
  function readUnquoted(value) {
    let start = pos;
    let pieces = null;
    while (pos < n && !DELIM[text.charCodeAt(pos)]) pos++;
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 44) {
        pos++;
        ended = COMMA;
        return joinField(value, start, pos - 1, pieces);
      }
      if (c === 10) {
        pos++;
        line++;
        ended = LINE_BREAK;
        return joinField(value, start, pos - 1, pieces);
      }
      // CR: CRLF ends the field, a lone CR is dropped and the field goes on.
      if (text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line++;
        ended = LINE_BREAK;
        return joinField(value, start, pos - 2, pieces);
      }
      pushErr('stray_cr');
      if (pieces === null) pieces = [];
      pieces.push(text.slice(start, pos));
      pos++;
      start = pos;
      while (pos < n && !DELIM[text.charCodeAt(pos)]) pos++;
    }
    ended = END;
    return joinField(value, start, pos, pieces);
  }

  // Reads a quoted field whose opening quote is at pos. Returns the field;
  // `ended` says how it ended.
  function readQuoted() {
    const open = pos;
    const openLine = line;
    pos++;
    // The closing quote is the first quote not doubled by the next one.
    let q = text.indexOf('"', pos);
    let doubled = false;
    while (q !== -1 && text.charCodeAt(q + 1) === 34) {
      doubled = true;
      q = text.indexOf('"', q + 2);
    }
    if (q === -1) {
      // The quote never closes: it is a literal character, and the text
      // after it is read again as unquoted.
      pos = open + 1;
      line = openLine;
      pushErr('unterminated_quote');
      return readUnquoted('"');
    }
    let value = text.slice(open + 1, q);
    // Line breaks inside the quotes each read as LF; count them for `line`.
    if (value.indexOf('\n') !== -1 || value.indexOf('\r') !== -1) {
      const parts = value.split(/\r\n|\r|\n/);
      line += parts.length - 1;
      value = parts.join('\n');
    }
    if (doubled) value = value.split('""').join('"');
    pos = q + 1;
    if (pos >= n) {
      ended = END;
      return value;
    }
    const c = text.charCodeAt(pos);
    if (c === 44) {
      pos++;
      ended = COMMA;
      return value;
    }
    if (c === 10) {
      pos++;
      line++;
      ended = LINE_BREAK;
      return value;
    }
    if (c === 13 && text.charCodeAt(pos + 1) === 10) {
      pos += 2;
      line++;
      ended = LINE_BREAK;
      return value;
    }
    // What follows the closing quote is appended as it stands, up to the
    // next comma or line break.
    const before = value.length;
    const junk = readUnquoted(value);
    if (junk.length > before) pushErr('quote_junk');
    return junk;
  }

  // A record's fields, once read: the header, or a row at the first
  // record's width, with its short_row or long_row error when it ends.
  function assemble(fields) {
    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      return;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }

  while (true) {
    // Lines with no characters are no records.
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos++;
        line++;
      } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line++;
      } else {
        break;
      }
    }
    if (pos >= n) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;

    // Fast path: a record with no quote and no stray CR in its line is
    // split on commas in one go. A CR that only ends the line is the CRLF
    // of its line break, not a stray one; any other CR takes the slow path.
    const nl = text.indexOf('\n', pos);
    const segEnd = nl === -1 ? n : nl;
    const qPos = text.indexOf('"', pos);
    const crPos = text.indexOf('\r', pos);
    const hasQuote = qPos !== -1 && qPos < segEnd;
    const crlfOnly = nl !== -1 && crPos === segEnd - 1;
    const hasStrayCR = crPos !== -1 && crPos < segEnd && !crlfOnly;
    if (!hasQuote && !hasStrayCR) {
      const seg = crlfOnly ? text.slice(pos, segEnd - 1) : text.slice(pos, segEnd);
      const fields = seg.split(',');
      pos = nl === -1 ? n : nl + 1;
      if (nl !== -1) line++;
      assemble(fields);
      continue;
    }

    const fields = [];
    let lastQuoted = false;
    do {
      lastQuoted = text.charCodeAt(pos) === 34;
      fields.push(lastQuoted ? readQuoted() : readUnquoted(''));
    } while (ended === COMMA);

    // A line that held only stray CRs is left with no characters: no record
    // (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !lastQuoted) continue;
    assemble(fields);
  }

  return { columns: header ? (columns ?? []) : null, rows, errors };
}
