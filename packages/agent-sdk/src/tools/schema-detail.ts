/**
 * Full, on-demand detail for one argument of a tool's input schema.
 *
 * `search_tools` prints each tool's parameters on one capped line, without
 * descriptions. This module renders the drill-down behind its `path` option:
 * one argument (or the whole input) with every key, type, enum value,
 * constraint and description, one key per line, to any depth, within
 * {@link MAX_DETAIL_BYTES}.
 *
 * @packageDocumentation
 */

/**
 * Maximum UTF-8 bytes for one drill-down result. Over it, the last lines are
 * left out and the result names narrower paths to ask for.
 * @internal
 */
export const MAX_DETAIL_BYTES = 4000;

/** Longest `pattern` printed; longer ones (generated date regexes) add nothing. */
const MAX_PATTERN_BYTES = 80;

/** Longest `const` or `default` literal printed in full. */
const MAX_LITERAL_BYTES = 80;

/** Spaces per nesting level. */
const INDENT = "  ";

const utf8 = new TextEncoder();

function byteLength(text: string): number {
  return utf8.encode(text).length;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Result of {@link formatSchemaDetail}: the rendered text, or why it failed. */
export type SchemaDetailResult = { ok: true; text: string } | { ok: false; error: string };

/**
 * Splits a dotted argument path (`filters.status`, `steps[].name`) into
 * segments. Array steps (`[]`, `[0]`, `0`, `items`) are kept as `[]`; empty
 * segments are dropped, so `""` and `"."` mean the whole input.
 * @internal
 */
export function parseArgumentPath(path: string): string[] {
  const segments: string[] = [];
  for (const raw of path.split(".")) {
    let part = raw.trim();
    const arraySteps: string[] = [];
    while (/\[\d*\]$/.test(part)) {
      part = part.replace(/\[\d*\]$/, "");
      arraySteps.push("[]");
    }
    if (part) segments.push(/^\d+$/.test(part) ? "[]" : part);
    segments.push(...arraySteps);
  }
  return segments;
}

interface Candidate {
  schema: unknown;
  required: boolean;
}

/**
 * Renders one argument of `inputSchema`, found by `path`, with its full shape
 * and descriptions. An empty path renders the whole input.
 *
 * @param toolName - Tool name, used in the heading
 * @param inputSchema - The tool's input JSON Schema
 * @param path - Dotted argument path, such as `filters` or `filters.status`
 * @internal
 */
export function formatSchemaDetail(
  toolName: string,
  inputSchema: unknown,
  path: string,
): SchemaDetailResult {
  const root = inputSchema;
  const segments = parseArgumentPath(path);
  const shown = segments.join(".").replace(/\.\[\]/g, "[]");

  let current: Candidate = { schema: root, required: true };
  const walked: string[] = [];
  for (const segment of segments) {
    const next =
      segment === "[]"
        ? arrayItems(root, current.schema)
        : propertyCandidates(root, current.schema, segment);
    if (next.length === 0) {
      const at =
        walked.length > 0 ? `"${walked.join(".").replace(/\.\[\]/g, "[]")}"` : "the top level";
      if (segment === "[]") {
        return { ok: false, error: `${at} in ${toolName} is not an array.` };
      }
      const keys = availableKeys(root, current.schema);
      return {
        ok: false,
        error:
          keys.length > 0
            ? `No argument "${segment}" at ${at} in ${toolName}. Keys there: ${keys.join(", ")}.`
            : `No argument "${segment}" at ${at} in ${toolName}: it has no named keys.`,
      };
    }
    current = mergeCandidates(next);
    walked.push(segment);
  }

  const lines: Line[] = [];
  if (segments.length === 0) {
    const node = deref(root, root).schema;
    if (!isRecord(node)) {
      return { ok: false, error: `${toolName} has no input schema to show.` };
    }
    renderChildren(root, node, 0, [], new Map(), lines);
    if (lines.length === 0) {
      return { ok: true, text: `${toolName} takes no arguments.` };
    }
    return { ok: true, text: capLines(`Arguments of ${toolName}:`, lines, "") };
  }

  const label = `${shown}${current.required ? "" : "?"}`;
  renderNode(root, current.schema, label, 0, segments, new Map(), lines);
  return { ok: true, text: capLines(`Schema of ${shown} in ${toolName}:`, lines, shown) };
}

interface Line {
  text: string;
  depth: number;
  path: string[];
}

/** Follows a local `$ref` (`#`, `#/$defs/X`, `#/definitions/X`). */
function deref(
  root: unknown,
  schema: unknown,
  seen = new Set<string>(),
): { schema: unknown; ref?: string } {
  let node = schema;
  let ref: string | undefined;
  while (isRecord(node) && typeof node.$ref === "string") {
    if (seen.has(node.$ref)) return { schema: {}, ref: node.$ref };
    seen.add(node.$ref);
    ref = node.$ref;
    node = resolvePointer(root, node.$ref);
  }
  return { schema: node, ref };
}

function resolvePointer(root: unknown, ref: string): unknown {
  if (!ref.startsWith("#")) return {};
  const parts = ref
    .slice(1)
    .split("/")
    .filter(Boolean)
    .map((part) => decodeURIComponent(part.replace(/~1/g, "/").replace(/~0/g, "~")));
  let node: unknown = root;
  for (const part of parts) {
    if (!isRecord(node)) return {};
    node = node[part];
  }
  return node ?? {};
}

function variantsOf(node: Record<string, unknown>): unknown[] {
  return [node.anyOf, node.oneOf, node.allOf].flatMap((list) => (Array.isArray(list) ? list : []));
}

function isNullSchema(schema: unknown): boolean {
  return isRecord(schema) && schema.type === "null";
}

function arrayItems(root: unknown, schema: unknown, seen = new Set<unknown>()): Candidate[] {
  const node = deref(root, schema).schema;
  if (!isRecord(node) || seen.has(node)) return [];
  seen.add(node);
  if (isRecord(node.items)) return [{ schema: node.items, required: true }];
  return variantsOf(node).flatMap((variant) => arrayItems(root, variant, seen));
}

/** Schemas a key can have at `schema`: in its properties, its array items, union members or record values. */
function propertyCandidates(
  root: unknown,
  schema: unknown,
  key: string,
  seen = new Set<unknown>(),
): Candidate[] {
  const node = deref(root, schema).schema;
  if (!isRecord(node) || seen.has(node)) return [];
  seen.add(node);
  const found: Candidate[] = [];
  if (isRecord(node.properties) && key in node.properties) {
    const required = Array.isArray(node.required) && node.required.includes(key);
    found.push({ schema: node.properties[key], required });
  }
  if (isRecord(node.items)) found.push(...propertyCandidates(root, node.items, key, seen));
  for (const variant of variantsOf(node))
    found.push(...propertyCandidates(root, variant, key, seen));
  if (found.length === 0 && isRecord(node.additionalProperties)) {
    found.push({ schema: node.additionalProperties, required: false });
  }
  return found;
}

function availableKeys(root: unknown, schema: unknown, seen = new Set<unknown>()): string[] {
  const node = deref(root, schema).schema;
  if (!isRecord(node) || seen.has(node)) return [];
  seen.add(node);
  const keys = isRecord(node.properties) ? Object.keys(node.properties) : [];
  if (isRecord(node.items)) keys.push(...availableKeys(root, node.items, seen));
  for (const variant of variantsOf(node)) keys.push(...availableKeys(root, variant, seen));
  return [...new Set(keys)];
}

function mergeCandidates(candidates: Candidate[]): Candidate {
  const distinct: Candidate[] = [];
  const keys = new Set<string>();
  for (const candidate of candidates) {
    const key = JSON.stringify(candidate.schema) ?? "";
    if (keys.has(key)) continue;
    keys.add(key);
    distinct.push(candidate);
  }
  if (distinct.length === 1) return distinct[0]!;
  return {
    schema: { anyOf: distinct.map((candidate) => candidate.schema) },
    required: distinct.every((candidate) => candidate.required),
  };
}

/** `label: head`, or `- head` for a union member. */
function headLine(label: string, head: string, depth: number): string {
  return label === "-" ? `${indent(depth)}- ${head}` : `${indent(depth)}${label}: ${head}`;
}

/** The `anyOf`/`oneOf` members of a node (not `allOf`, whose members merge). */
function unionOf(node: Record<string, unknown>): unknown[] {
  return [node.anyOf, node.oneOf].flatMap((list) => (Array.isArray(list) ? list : []));
}

/** `$ref`s being expanded, each with the argument path where it was first shown. */
type Refs = ReadonlyMap<string, string>;

function withRef(refs: Refs, ref: string | undefined, path: string[]): Refs {
  return ref && !refs.has(ref) ? new Map([...refs, [ref, displayPath(path)]]) : refs;
}

function displayPath(path: string[]): string {
  return path.filter((key) => key !== "*" && key !== "[]").join(".");
}

/** Points a recursive `$ref` back at the path that already shows its shape. */
function recursive(refs: Refs, ref: string): string {
  const at = refs.get(ref);
  return `same shape as ${at ? `"${at}"` : "the whole input"} (recursive)`;
}

/** Renders `label: <type> (constraints) — description`, then its keys one level deeper. */
function renderNode(
  root: unknown,
  schema: unknown,
  label: string,
  depth: number,
  path: string[],
  refs: Refs,
  lines: Line[],
): void {
  const { schema: node, ref } = deref(root, schema);
  if (ref && refs.has(ref)) {
    lines.push({ text: headLine(label, recursive(refs, ref), depth), depth, path });
    return;
  }
  let inner = withRef(refs, ref, path);
  if (!isRecord(node)) {
    lines.push({ text: headLine(label, "any", depth), depth, path });
    return;
  }

  const variants = unionOf(node);
  const members = variants.filter((variant) => !isNullSchema(variant));
  const nullable = members.length < variants.length;

  // A nullable (or one-member) union prints as its one member, `|null` added.
  if (variants.length > 0 && members.length === 1) {
    const only = deref(root, members[0]);
    if (only.ref && inner.has(only.ref)) {
      lines.push({ text: headLine(label, recursive(inner, only.ref), depth), depth, path });
      return;
    }
    if (isRecord(only.schema)) {
      inner = withRef(inner, only.ref, path);
      const merged = { ...only.schema, description: only.schema.description ?? node.description };
      const head = `${typeHead(root, merged)}${nullable ? "|null" : ""}${annotate(merged)}`;
      lines.push({ text: headLine(label, head, depth), depth, path });
      renderChildren(root, merged, depth + 1, path, inner, lines);
      return;
    }
  }

  // A union with keys lists each member under `one of`.
  if (members.some((member) => hasChildren(root, member))) {
    const head = `one of${nullable ? " (or null)" : ""}${annotate(node)}`;
    lines.push({ text: headLine(label, head, depth), depth, path });
    for (const member of members) renderNode(root, member, "-", depth + 1, path, inner, lines);
    return;
  }

  lines.push({
    text: headLine(label, `${typeHead(root, node)}${annotate(node)}`, depth),
    depth,
    path,
  });
  renderChildren(root, node, depth + 1, path, inner, lines);
}

/** Lists a node's keys (an array's are its items' keys) at `depth`. */
function renderChildren(
  root: unknown,
  node: Record<string, unknown>,
  depth: number,
  path: string[],
  refs: Refs,
  lines: Line[],
): void {
  let target = node;
  let inner = refs;
  while (isRecord(target.items)) {
    const items = deref(root, target.items);
    if (items.ref && inner.has(items.ref)) {
      lines.push({ text: `${indent(depth)}items: ${recursive(inner, items.ref)}`, depth, path });
      return;
    }
    inner = withRef(inner, items.ref, path);
    if (!isRecord(items.schema)) return;
    target = items.schema;
    const members = unionOf(target).filter((variant) => !isNullSchema(variant));
    if (members.length === 1) {
      const only = deref(root, members[0]);
      if (!isRecord(only.schema) || (only.ref && inner.has(only.ref))) return;
      inner = withRef(inner, only.ref, path);
      target = only.schema;
    } else if (members.some((member) => hasChildren(root, member))) {
      for (const member of members) renderNode(root, member, "-", depth, path, inner, lines);
      return;
    }
  }

  if (Array.isArray(target.allOf)) {
    for (const member of target.allOf) {
      const resolved = deref(root, member);
      if (!isRecord(resolved.schema) || (resolved.ref && inner.has(resolved.ref))) continue;
      renderChildren(root, resolved.schema, depth, path, withRef(inner, resolved.ref, path), lines);
    }
  }

  const required = new Set(
    Array.isArray(target.required)
      ? target.required.filter((key): key is string => typeof key === "string")
      : [],
  );
  if (isRecord(target.properties)) {
    for (const [key, child] of Object.entries(target.properties)) {
      const label = `${key}${required.has(key) ? "" : "?"}`;
      renderNode(root, child, label, depth, [...path, key], inner, lines);
    }
  }
  if (isRecord(target.additionalProperties)) {
    renderNode(
      root,
      target.additionalProperties,
      "[key: string]",
      depth,
      [...path, "*"],
      inner,
      lines,
    );
  }
}

/** True when a schema has keys (directly or through array items or union members) to list. */
function hasChildren(root: unknown, schema: unknown, seen = new Set<unknown>()): boolean {
  const node = deref(root, schema).schema;
  if (!isRecord(node) || seen.has(node)) return false;
  seen.add(node);
  if (isRecord(node.properties) && Object.keys(node.properties).length > 0) return true;
  if (isRecord(node.additionalProperties)) return true;
  if (isRecord(node.items)) return hasChildren(root, node.items, seen);
  return variantsOf(node).some((variant) => hasChildren(root, variant, seen));
}

/** One-line type: literals for enums and const, `T[]` for arrays, `object` for objects. */
function typeHead(root: unknown, node: Record<string, unknown>, seen = new Set<unknown>()): string {
  if (seen.has(node)) return "any";
  seen.add(node);
  if ("const" in node) return formatLiteral(node.const);
  if (Array.isArray(node.enum) && node.enum.length > 0) {
    return [...new Set(node.enum.map(formatLiteral))].join("|");
  }
  const variants = unionOf(node);
  if (variants.length > 0) {
    const heads = variants.map((variant) => {
      const resolved = deref(root, variant).schema;
      return isRecord(resolved) ? typeHead(root, resolved, seen) : "any";
    });
    return [...new Set(heads)].join("|");
  }
  const names =
    typeof node.type === "string"
      ? [node.type]
      : Array.isArray(node.type)
        ? node.type.filter((name): name is string => typeof name === "string")
        : [];
  if (names.length === 0) {
    if (isRecord(node.properties) || Array.isArray(node.allOf)) return "object";
    return "any";
  }
  return names
    .map((name) => {
      if (name !== "array") return name;
      const items = deref(root, node.items).schema;
      if (!isRecord(items)) return "array";
      const head = typeHead(root, items, seen);
      return head.includes("|") ? `(${head})[]` : `${head}[]`;
    })
    .join("|");
}

/** ` (constraints) — description` for a node, each part only when present. */
function annotate(node: Record<string, unknown>): string {
  const notes: string[] = [];
  const range = (min: unknown, max: unknown, unit: string) => {
    const lo = typeof min === "number" && min > 0 ? min : undefined;
    const hi = typeof max === "number" && max < Number.MAX_SAFE_INTEGER ? max : undefined;
    if (lo === undefined && hi === undefined) return;
    if (lo === 1 && hi === undefined) {
      notes.push("non-empty");
      return;
    }
    if (lo !== undefined && hi !== undefined)
      notes.push(lo === hi ? `${lo} ${unit}` : `${lo}–${hi} ${unit}`);
    else if (lo !== undefined) notes.push(`at least ${lo} ${unit}`);
    else notes.push(`at most ${hi} ${unit}`);
  };
  if (typeof node.format === "string") notes.push(node.format);
  range(node.minLength, node.maxLength, "chars");
  range(node.minItems, node.maxItems, "items");
  range(node.minProperties, node.maxProperties, "keys");
  // Zod's integer bounds (±MAX_SAFE_INTEGER) say nothing, so they are left out.
  const bound = (value: unknown, sign: string) => {
    if (typeof value === "number" && Math.abs(value) < Number.MAX_SAFE_INTEGER) {
      notes.push(`${sign} ${value}`);
    }
  };
  bound(node.minimum, ">=");
  bound(node.exclusiveMinimum, ">");
  bound(node.maximum, "<=");
  bound(node.exclusiveMaximum, "<");
  if (node.uniqueItems === true) notes.push("unique");
  if (
    typeof node.pattern === "string" &&
    typeof node.format !== "string" &&
    byteLength(node.pattern) <= MAX_PATTERN_BYTES
  ) {
    notes.push(`pattern ${node.pattern}`);
  }
  if ("default" in node) notes.push(`default ${formatLiteral(node.default)}`);

  let out = notes.length > 0 ? ` (${notes.join(", ")})` : "";
  if (typeof node.description === "string" && node.description.trim()) {
    out += ` — ${node.description.trim().replace(/\s*\n\s*/g, " ")}`;
  }
  return out;
}

function formatLiteral(value: unknown): string {
  const text = JSON.stringify(value) ?? "unknown";
  if (byteLength(text) <= MAX_LITERAL_BYTES) return text;
  return `${Array.from(text)
    .slice(0, MAX_LITERAL_BYTES - 1)
    .join("")}…`;
}

function indent(depth: number): string {
  return INDENT.repeat(depth);
}

/**
 * Joins the heading and lines within {@link MAX_DETAIL_BYTES}. When lines are
 * left out, the last line counts them and names the narrower paths to ask for.
 */
function capLines(heading: string, lines: Line[], requested: string): string {
  const all = [heading, ...lines.map((line) => line.text)].join("\n");
  if (byteLength(all) <= MAX_DETAIL_BYTES) return all;

  const footerRoom = 300;
  const kept: string[] = [heading];
  let size = byteLength(heading);
  let index = 0;
  for (; index < lines.length; index++) {
    const lineSize = byteLength(lines[index]!.text) + 1;
    if (size + lineSize > MAX_DETAIL_BYTES - footerRoom) break;
    kept.push(lines[index]!.text);
    size += lineSize;
  }
  const omitted = lines.slice(index);
  const minDepth = Math.min(...omitted.map((line) => line.depth));
  const narrower = [
    ...new Set(
      omitted
        .filter((line) => line.depth === minDepth && line.path.length > 0)
        .map((line) => line.path.filter((key) => key !== "*" && key !== "[]").join(".")),
    ),
  ]
    .filter((path) => path && path !== requested.replace(/\[\]/g, ""))
    .slice(0, 3);
  const hint =
    narrower.length > 0
      ? ` Ask for a narrower path, such as ${narrower.map((p) => `"${p}"`).join(", ")}.`
      : "";
  kept.push(
    `…${omitted.length} more line(s) left out to stay within ${MAX_DETAIL_BYTES} bytes.${hint}`,
  );
  return kept.join("\n");
}
