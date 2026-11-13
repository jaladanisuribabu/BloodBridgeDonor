export type DonorImportRow = {
  name: string;
  phone: string;
  bloodGroup: string;
  latitude: number;
  longitude: number;
};

const requiredColumns = ["name", "phone", "bloodgroup", "latitude", "longitude"];

function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let closedQuote = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
        closedQuote = true;
      } else {
        field += character;
      }
    } else if (closedQuote && character !== "," && character !== "\n" && character !== "\r") {
      throw new Error("CSV contains unexpected characters after a quoted field.");
    } else if (character === '"' && field.length === 0) {
      quoted = true;
    } else if (character === ",") {
      row.push(field.trim());
      field = "";
      closedQuote = false;
    } else if (character === "\n" || character === "\r") {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      row.push(field.trim());
      if (row.some((cell) => cell.length > 0)) rows.push(row);
      row = [];
      field = "";
      closedQuote = false;
    } else {
      if (character === '"') throw new Error("CSV contains a quote inside an unquoted field.");
      field += character;
    }
  }

  if (quoted) throw new Error("CSV contains an unclosed quoted field.");
  row.push(field.trim());
  if (row.some((cell) => cell.length > 0)) rows.push(row);
  return rows;
}

export function parseDonorCsv(text: string): DonorImportRow[] {
  const rows = parseCsvRows(text.replace(/^\uFEFF/, ""));
  if (rows.length < 2) throw new Error("CSV must include a header and at least one donor.");

  const headers = rows[0].map((header) => header.trim().toLowerCase());
  if (
    headers.length !== requiredColumns.length ||
    requiredColumns.some((column, index) => headers[index] !== column)
  ) {
    throw new Error(
      "Use the template columns in this order: Name, Phone, BloodGroup, Latitude, Longitude.",
    );
  }
  if (rows.length - 1 > 150) {
    throw new Error("Import up to 150 donors per CSV file.");
  }

  const donors = rows.slice(1).map((cells, index) => {
    if (cells.length !== requiredColumns.length) {
      throw new Error(`CSV row ${index + 2} must contain exactly five columns.`);
    }
    const [name, phone, bloodGroup, latitudeText, longitudeText] = cells;
    const latitude = Number(latitudeText);
    const longitude = Number(longitudeText);
    if (!name || !phone || !bloodGroup || !latitudeText || !longitudeText) {
      throw new Error(`Complete every field in CSV row ${index + 2}.`);
    }
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      throw new Error(`CSV row ${index + 2} must have numeric coordinates.`);
    }
    return {
      name,
      phone,
      bloodGroup: bloodGroup.toUpperCase(),
      latitude,
      longitude,
    };
  });

  if (new Set(donors.map((donor) => donor.phone)).size !== donors.length) {
    throw new Error("CSV contains duplicate phone numbers.");
  }
  return donors;
}
