// Models, smaller and local ones most, send well-meant arguments in shapes a schema refuses: a list as a JSON string, a
// number or a yes/no as text, one item where a list goes (query for queries), null for an unused optional field, a
// camelCase name for a snake_case one, an enum value in the wrong case. Each repair here keeps the value's meaning exactly; anything else
// (a number where text goes included) is left for the schema to refuse. Callers keep a repair only when the repaired
// arguments then validate, so a server still only ever receives arguments its schema accepts.

type Json = Record<string, unknown>;
const record = (value: unknown): value is Json => value !== null && typeof value === "object" && !Array.isArray(value);

export interface ArgumentRepair {
  args: Json;
  /** One line per change, in the field's own words ("queries: a JSON string read as a list"). */
  repairs: string[];
}

function types(schema: Json): string[] {
  const declared = schema.type;
  if (typeof declared === "string") return [declared];
  if (Array.isArray(declared)) return declared.filter((type): type is string => typeof type === "string");
  if (record(schema.properties)) return ["object"];
  if (record(schema.items)) return ["array"];
  return [];
}

function accepts(schema: unknown, value: unknown): boolean {
  if (!record(schema)) return false;
  const allowed = types(schema);
  if (!allowed.length) return false;
  const kind = value === null ? "null" : Array.isArray(value) ? "array" : typeof value === "number" ? (Number.isInteger(value) ? "integer" : "number") : typeof value;
  return allowed.includes(kind) || (kind === "integer" && allowed.includes("number"));
}

function parsedJson(text: string): unknown {
  const trimmed = text.trim();
  if (!/^[[{]/.test(trimmed)) return undefined;
  try { return JSON.parse(trimmed); } catch { return undefined; }
}

const NUMERIC = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;
const snake = (name: string) => name.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
const camel = (name: string) => name.replace(/_([a-z0-9])/g, (_, letter: string) => letter.toUpperCase());

function repairValue(schema: unknown, value: unknown, at: string, repairs: string[]): unknown {
  if (!record(schema) || value === undefined) return value;
  const allowed = types(schema);
  if (typeof value === "string") {
    if (!allowed.includes("string") && (allowed.includes("array") || allowed.includes("object"))) {
      const parsed = parsedJson(value);
      if (parsed !== undefined && ((Array.isArray(parsed) && allowed.includes("array")) || (record(parsed) && allowed.includes("object")))) {
        repairs.push(`${at}: a JSON string read as ${Array.isArray(parsed) ? "a list" : "an object"}`);
        return repairValue(schema, parsed, at, repairs);
      }
    }
    if (!allowed.includes("string")) {
      if ((allowed.includes("integer") || allowed.includes("number")) && NUMERIC.test(value.trim())) {
        const number = Number(value.trim());
        if (allowed.includes("number") || Number.isInteger(number)) {
          repairs.push(`${at}: "${value}" read as a number`);
          return number;
        }
      }
      if (allowed.includes("boolean") && /^(?:true|false)$/i.test(value.trim())) {
        repairs.push(`${at}: "${value}" read as ${value.trim().toLowerCase()}`);
        return value.trim().toLowerCase() === "true";
      }
      if (allowed.includes("array") && accepts(schema.items, value)) {
        repairs.push(`${at}: one value read as a list of one`);
        return [repairValue(schema.items, value, `${at}[0]`, repairs)];
      }
    }
    if (Array.isArray(schema.enum) && !schema.enum.includes(value)) {
      const matches = schema.enum.filter((option): option is string => typeof option === "string" && option.toLowerCase() === value.trim().toLowerCase());
      if (matches.length === 1) {
        repairs.push(`${at}: "${value}" read as "${matches[0]}"`);
        return matches[0];
      }
    }
    return value;
  }
  if ((typeof value === "number" || typeof value === "boolean") && !accepts(schema, value)) {
    if (allowed.includes("array") && accepts(schema.items, value)) {
      repairs.push(`${at}: one value read as a list of one`);
      return [value];
    }
    return value;
  }
  if (Array.isArray(value)) {
    if (!allowed.includes("array")) return value;
    return value.map((item, index) => repairValue(schema.items, item, `${at}[${index}]`, repairs));
  }
  if (record(value) && allowed.includes("object")) {
    if (allowed.includes("array") || !record(schema.properties)) return value;
    return repairObject(schema, value, at, repairs);
  }
  return value;
}

function repairObject(schema: Json, value: Json, at: string, repairs: string[]): Json {
  const properties = record(schema.properties) ? schema.properties : {};
  const required = new Set(Array.isArray(schema.required) ? schema.required.filter((name): name is string => typeof name === "string") : []);
  const closed = schema.additionalProperties === false;
  const out: Json = {};
  const where = (name: string) => (at ? `${at}.${name}` : name);
  for (const [key, child] of Object.entries(value)) {
    let name = key;
    if (!Object.hasOwn(properties, key) && closed) {
      const plurals = [`${key}s`, `${key}es`, key.replace(/y$/, "ies")].filter((plural) => record(properties[plural]) && types(properties[plural] as Json).includes("array"));
      const renamed = [snake(key), camel(key), ...plurals].find((candidate) => candidate !== key && Object.hasOwn(properties, candidate) && !Object.hasOwn(value, candidate));
      if (renamed) {
        repairs.push(`${where(key)}: read as ${renamed}`);
        name = renamed;
      }
    }
    const fieldSchema = Object.hasOwn(properties, name) ? properties[name] : undefined;
    if (child === null && !required.has(name) && record(fieldSchema) && !types(fieldSchema).includes("null")) {
      repairs.push(`${where(name)}: null left out`);
      continue;
    }
    out[name] = fieldSchema === undefined ? child : repairValue(fieldSchema, child, where(name), repairs);
  }
  return out;
}

/** The arguments with every meaning-keeping repair `schema` allows, and what changed. Unchanged arguments come back as
 * they were, with no repairs. */
export function repairToolArguments(schema: unknown, args: unknown): ArgumentRepair | undefined {
  const repairs: string[] = [];
  let value = args;
  if (typeof value === "string") {
    const parsed = parsedJson(value);
    if (!record(parsed)) return undefined;
    repairs.push("arguments: a JSON string read as an object");
    value = parsed;
  }
  if (!record(value)) return undefined;
  if (!record(schema)) return { args: value, repairs };
  return { args: repairObject(schema, value, "", repairs), repairs };
}

const OUTLINE_FIELDS = 12;
const OUTLINE_ENUM = 8;

function typeWords(schema: Json): string {
  const allowed = types(schema);
  if (Array.isArray(schema.enum)) {
    const options = schema.enum.slice(0, OUTLINE_ENUM).map((option) => JSON.stringify(option)).join(" | ");
    return `one of ${options}${schema.enum.length > OUTLINE_ENUM ? " | …" : ""}`;
  }
  if (allowed.includes("array") && record(schema.items)) {
    const item = types(schema.items)[0];
    return item ? `list of ${item}s` : "list";
  }
  return allowed.join(" or ") || "any";
}

/** The fields a tool takes, one short line, for an error that has to say what a correct call looks like. */
export function argumentOutline(schema: unknown): string {
  if (!record(schema) || !record(schema.properties)) return "";
  const required = new Set(Array.isArray(schema.required) ? schema.required : []);
  const entries = Object.entries(schema.properties).filter((entry): entry is [string, Json] => record(entry[1]));
  const ordered = [...entries.filter(([name]) => required.has(name)), ...entries.filter(([name]) => !required.has(name))];
  const shown = ordered.slice(0, OUTLINE_FIELDS).map(([name, field]) => `${name}${required.has(name) ? "" : "?"}: ${typeWords(field)}`);
  const more = ordered.length > OUTLINE_FIELDS ? `, and ${ordered.length - OUTLINE_FIELDS} more` : "";
  const optional = ordered.some(([name]) => !required.has(name)) ? " (? = optional)" : "";
  return shown.length ? `It takes { ${shown.join(", ")}${more} }${optional}.` : "It takes no arguments: send {}.";
}
