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
 * Maximum UTF-8 bytes for one drill-down result, heading and footer
 * included. Rendering stops when the next line would not fit, and the result
 * names a narrower path to ask for.
 * @internal
 */
export const MAX_DETAIL_BYTES = 4000;

/**
 * Maximum schema nodes visited for one drill-down. Shared `$ref`s can
 * describe exponentially many paths, so rendering stops here even when the
 * output is still short.
 * @internal
 */
export const MAX_RENDER_STEPS = 2000;

/** Bytes kept free for the footer while lines are added. */
const FOOTER_RESERVE = 300;

/** Longest single line; a longer description or enum is cut with `…`. */
const MAX_LINE_BYTES = 1000;

/** Longest `pattern` printed; longer ones (generated date regexes) add nothing. */
const MAX_PATTERN_BYTES = 80;

/** Longest `const` or `default` literal printed in full. */
const MAX_LITERAL_BYTES = 80;

/** Longest path named in the footer. */
const MAX_HINT_BYTES = 150;

/** Spaces per nesting level. */
const INDENT = "  ";

const utf8 = new TextEncoder();

function byteLength(text: string): number {
  return utf8.encode(text).length;
}

/** Cut `text` to at most `max` UTF-8 bytes, ending in `…` when cut. */
function truncateBytes(text: string, max: number): string {
  if (byteLength(text) <= max) return text;
  const ellipsis = "…";
  let out = "";
  let size = byteLength(ellipsis);
  for (const char of text) {
    const charSize = byteLength(char);
    if (size + charSize > max) break;
    out += char;
    size += charSize;
  }
  return out + ellipsis;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Result of {@link formatSchemaDetail}: the rendered text, or why it failed. */
export type SchemaDetailResult = { ok: true; text: string } | { ok: false; error: string };

/**
 * Splits a dotted argument path (`filters.status`, `steps[].name`) into
 * segments. Array steps (`[]`, `[0]`, `0`) are kept as `[]`; empty segments
 * are dropped, so `""` and `"."` mean the whole input.
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
  const shown = showPath(segments);

  let current: Candidate | undefined = { schema: root, required: true };
  const walked: string[] = [];
  for (const segment of segments) {
    const next: Candidate | undefined =
      segment === "[]"
        ? resolveItems(root, current.schema, new Map())
        : resolveKey(root, current.schema, segment, new Map());
    if (!next) {
      const at = walked.length > 0 ? `"${showPath(walked)}"` : "the top level";
      if (segment === "[]") {
        return { ok: false, error: `${at} in ${toolName} is not an array.` };
      }
      const keys = availableKeys(root, current.schema, new Set());
      return {
        ok: false,
        error:
          keys.length > 0
            ? `No argument "${segment}" at ${at} in ${toolName}. Keys there: ${keys.join(", ")}.`
            : `No argument "${segment}" at ${at} in ${toolName}: it has no named keys.`,
      };
    }
    current = next;
    walked.push(segment);
  }

  if (segments.length === 0) {
    const heading = `Arguments of ${toolName}:`;
    const node = deref(root, root).schema;
    if (!isRecord(node)) {
      return { ok: false, error: `${toolName} has no input schema to show.` };
    }
    const ctx = createContext(heading, segments);
    renderChildren(root, node, 0, [], new Map(), ctx);
    if (ctx.lines.length === 0 && !ctx.cut) {
      return { ok: true, text: `${toolName} takes no arguments.` };
    }
    return { ok: true, text: finish(ctx) };
  }

  const ctx = createContext(`Schema of ${shown} in ${toolName}:`, segments);
  const label = `${shown}${current.required ? "" : "?"}`;
  renderNode(root, current.schema, label, 0, segments, new Map(), ctx);
  return { ok: true, text: finish(ctx) };
}

// ---------------------------------------------------------------------------
// Schema helpers

/** Follows a local `$ref` (`#`, `#/$defs/X`, `#/definitions/X`). */
function deref(root: unknown, schema: unknown): { schema: unknown; ref?: string } {
  const seen = new Set<string>();
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

/** The `anyOf`/`oneOf` members of a node: alternatives. */
function unionOf(node: Record<string, unknown>): unknown[] {
  return [node.anyOf, node.oneOf].flatMap((list) => (Array.isArray(list) ? list : []));
}

/** The `allOf` members of a node: restrictions that all apply. */
function allOf(node: Record<string, unknown>): unknown[] {
  return Array.isArray(node.allOf) ? node.allOf : [];
}

function isNullSchema(root: unknown, schema: unknown): boolean {
  const node = deref(root, schema).schema;
  return isRecord(node) && node.type === "null";
}

/** True when the node itself names keys (properties or a record value schema). */
function hasOwnKeys(node: Record<string, unknown>): boolean {
  return (
    (isRecord(node.properties) && Object.keys(node.properties).length > 0) ||
    isRecord(node.additionalProperties)
  );
}

/** True when a schema has keys (directly or through array items or members) to list. */
function hasChildren(root: unknown, schema: unknown, seen: Set<unknown> = new Set()): boolean {
  const node = deref(root, schema).schema;
  if (!isRecord(node) || seen.has(node)) return false;
  seen.add(node);
  if (hasOwnKeys(node)) return true;
  if (isRecord(node.items)) return hasChildren(root, node.items, seen);
  return [...unionOf(node), ...allOf(node)].some((member) => hasChildren(root, member, seen));
}

/** True when a schema carries constraints or a description of its own. */
function hasAnnotations(root: unknown, schema: unknown): boolean {
  const node = deref(root, schema).schema;
  return isRecord(node) && annotate(node) !== "";
}

// ---------------------------------------------------------------------------
// Path resolution

interface Candidate {
  schema: unknown;
  required: boolean;
}

/**
 * Results per schema node, so shared `$ref`s are resolved once (`null` while
 * in progress, which also ends a cycle).
 */
type Memo = Map<object, Candidate | null | undefined>;

function memoised(
  root: unknown,
  schema: unknown,
  memo: Memo,
  resolve: (node: Record<string, unknown>) => Candidate | undefined,
): Candidate | undefined {
  const node = deref(root, schema).schema;
  if (!isRecord(node)) return undefined;
  if (memo.has(node)) return memo.get(node) ?? undefined;
  memo.set(node, null);
  const result = resolve(node);
  memo.set(node, result);
  return result;
}

/**
 * The schema a key has at `schema`. Matches in `allOf` members (and the node's
 * own properties) all apply, so they combine as `allOf` and the key is
 * required if any of them requires it. Matches in `anyOf`/`oneOf` members are
 * alternatives: they combine as `anyOf`, required only if every member
 * requires it. Arrays are walked through to their items.
 */
function resolveKey(
  root: unknown,
  schema: unknown,
  key: string,
  memo: Memo,
): Candidate | undefined {
  return memoised(root, schema, memo, (node) => resolveKeyIn(root, node, key, memo));
}

function resolveKeyIn(
  root: unknown,
  node: Record<string, unknown>,
  key: string,
  memo: Memo,
): Candidate | undefined {
  const conjuncts: Candidate[] = [];
  if (isRecord(node.properties) && Object.hasOwn(node.properties, key)) {
    const required = Array.isArray(node.required) && node.required.includes(key);
    conjuncts.push({ schema: node.properties[key], required });
  }
  if (isRecord(node.items)) {
    const fromItems = resolveKey(root, node.items, key, memo);
    if (fromItems) conjuncts.push(fromItems);
  }
  for (const member of allOf(node)) {
    const fromMember = resolveKey(root, member, key, memo);
    if (fromMember) conjuncts.push(fromMember);
  }
  const members = unionOf(node).filter((member) => !isNullSchema(root, member));
  const alternatives = members
    .map((member) => resolveKey(root, member, key, memo))
    .filter((candidate): candidate is Candidate => candidate !== undefined);
  if (alternatives.length > 0) {
    const combined = combine(alternatives, "anyOf");
    if (alternatives.length < members.length) combined.required = false;
    conjuncts.push(combined);
  }
  if (conjuncts.length === 0 && isRecord(node.additionalProperties)) {
    conjuncts.push({ schema: node.additionalProperties, required: false });
  }
  return conjuncts.length > 0 ? combine(conjuncts, "allOf") : undefined;
}

/** The item schema of an array at `schema`, combined across members as for keys. */
function resolveItems(root: unknown, schema: unknown, memo: Memo): Candidate | undefined {
  return memoised(root, schema, memo, (node) => resolveItemsIn(root, node, memo));
}

function resolveItemsIn(
  root: unknown,
  node: Record<string, unknown>,
  memo: Memo,
): Candidate | undefined {
  const conjuncts: Candidate[] = [];
  if (isRecord(node.items)) conjuncts.push({ schema: node.items, required: true });
  for (const member of allOf(node)) {
    const fromMember = resolveItems(root, member, memo);
    if (fromMember) conjuncts.push(fromMember);
  }
  const alternatives = unionOf(node)
    .map((member) => resolveItems(root, member, memo))
    .filter((candidate): candidate is Candidate => candidate !== undefined);
  if (alternatives.length > 0) conjuncts.push(combine(alternatives, "anyOf"));
  return conjuncts.length > 0 ? combine(conjuncts, "allOf") : undefined;
}

function combine(candidates: Candidate[], operator: "allOf" | "anyOf"): Candidate {
  const distinct: Candidate[] = [];
  const keys = new Set<string>();
  for (const candidate of candidates) {
    const key = JSON.stringify(candidate.schema) ?? "";
    if (keys.has(key)) {
      // The same schema twice: in allOf any requirement holds, in anyOf all must.
      const twin = distinct.find((d) => (JSON.stringify(d.schema) ?? "") === key);
      if (twin) {
        twin.required =
          operator === "allOf"
            ? twin.required || candidate.required
            : twin.required && candidate.required;
      }
      continue;
    }
    keys.add(key);
    distinct.push({ ...candidate });
  }
  if (distinct.length === 1) return distinct[0] as Candidate;
  const required =
    operator === "allOf"
      ? distinct.some((candidate) => candidate.required)
      : distinct.every((candidate) => candidate.required);
  return { schema: { [operator]: distinct.map((candidate) => candidate.schema) }, required };
}

function availableKeys(root: unknown, schema: unknown, seen: Set<unknown>): string[] {
  const node = deref(root, schema).schema;
  if (!isRecord(node) || seen.has(node)) return [];
  seen.add(node);
  const keys = isRecord(node.properties) ? Object.keys(node.properties) : [];
  if (isRecord(node.items)) keys.push(...availableKeys(root, node.items, seen));
  for (const member of [...unionOf(node), ...allOf(node)]) {
    keys.push(...availableKeys(root, member, seen));
  }
  return [...new Set(keys)];
}

// ---------------------------------------------------------------------------
// Rendering

interface RenderContext {
  heading: string;
  /** The requested path's segments, for the footer's narrower-path hint. */
  requested: string[];
  lines: string[];
  bytes: number;
  steps: number;
  /** Where rendering stopped, when it did. */
  cut?: string[];
}

function createContext(heading: string, requested: string[]): RenderContext {
  return { heading, requested, lines: [], bytes: byteLength(heading), steps: 0 };
}

/** Counts one rendering step; false (and the cut recorded) once a budget is spent. */
function step(ctx: RenderContext, path: string[]): boolean {
  if (ctx.cut) return false;
  ctx.steps += 1;
  if (ctx.steps > MAX_RENDER_STEPS) {
    ctx.cut = path;
    return false;
  }
  return true;
}

/** Adds a line if it fits the output budget; otherwise records the cut. */
function emit(ctx: RenderContext, text: string, path: string[]): boolean {
  if (ctx.cut) return false;
  const line = truncateBytes(text, MAX_LINE_BYTES);
  const size = byteLength(line) + 1;
  if (ctx.bytes + size > MAX_DETAIL_BYTES - FOOTER_RESERVE) {
    ctx.cut = path;
    return false;
  }
  ctx.lines.push(line);
  ctx.bytes += size;
  return true;
}

/** `$ref`s being expanded, each with the argument path where it was first shown. */
type Refs = ReadonlyMap<string, string>;

function withRef(refs: Refs, ref: string | undefined, path: string[]): Refs {
  return ref && !refs.has(ref) ? new Map([...refs, [ref, showPath(path)]]) : refs;
}

/** A path as the model would type it back: `filters.advanced`, `steps[]`. */
function showPath(path: string[]): string {
  return path
    .filter((key) => key !== "*")
    .join(".")
    .replace(/\.\[\]/g, "[]");
}

/** Points a recursive `$ref` back at the path that already shows its shape. */
function recursive(refs: Refs, ref: string): string {
  const at = refs.get(ref);
  return `same shape as ${at ? `"${at}"` : "the whole input"} (recursive)`;
}

/** `label: head`, or `- head` for a member of `one of` / `all of`. */
function headLine(label: string, head: string, depth: number): string {
  return label === "-" ? `${indent(depth)}- ${head}` : `${indent(depth)}${label}: ${head}`;
}

/**
 * Renders `label: <type> (constraints) — description`, then what is inside
 * it one level deeper: keys, union members that differ in shape or
 * annotations, or the restrictions of an `allOf`.
 */
function renderNode(
  root: unknown,
  schema: unknown,
  label: string,
  depth: number,
  path: string[],
  refs: Refs,
  ctx: RenderContext,
): void {
  if (!step(ctx, path)) return;
  const { schema: node, ref } = deref(root, schema);
  if (ref && refs.has(ref)) {
    emit(ctx, headLine(label, recursive(refs, ref), depth), path);
    return;
  }
  let inner = withRef(refs, ref, path);
  if (!isRecord(node)) {
    emit(ctx, headLine(label, "any", depth), path);
    return;
  }

  if (!hasOwnKeys(node)) {
    const variants = unionOf(node);
    const members = variants.filter((variant) => !isNullSchema(root, variant));
    const nullable = members.length < variants.length;

    // A nullable (or one-member) union prints as its one member, `|null` added.
    if (variants.length > 0 && members.length === 1) {
      const only = deref(root, members[0]);
      if (only.ref && inner.has(only.ref)) {
        emit(ctx, headLine(label, recursive(inner, only.ref), depth), path);
        return;
      }
      if (isRecord(only.schema)) {
        inner = withRef(inner, only.ref, path);
        const merged = {
          ...only.schema,
          description: only.schema.description ?? node.description,
        };
        const head = `${typeHead(root, merged)}${nullable ? "|null" : ""}${annotate(merged)}`;
        if (!emit(ctx, headLine(label, head, depth), path)) return;
        renderChildren(root, merged, depth + 1, path, inner, ctx);
        return;
      }
    }

    // Members that differ in more than their type are listed one by one.
    if (
      members.length > 1 &&
      members.some((member) => hasChildren(root, member) || hasAnnotations(root, member))
    ) {
      const head = `one of${nullable ? " (or null)" : ""}${annotate(node)}`;
      if (!emit(ctx, headLine(label, head, depth), path)) return;
      for (const member of members) renderNode(root, member, "-", depth + 1, path, inner, ctx);
      return;
    }

    // Restrictions that all apply, when some are not plain objects with keys.
    const conjuncts = allOf(node);
    if (
      conjuncts.length > 0 &&
      conjuncts.some((member) => !hasChildren(root, member) || hasAnnotations(root, member))
    ) {
      const head = `all of${annotate(node)}`;
      if (!emit(ctx, headLine(label, head, depth), path)) return;
      for (const member of conjuncts) renderNode(root, member, "-", depth + 1, path, inner, ctx);
      return;
    }
  }

  const head = `${typeHead(root, node)}${annotate(node)}`;
  if (!emit(ctx, headLine(label, head, depth), path)) return;
  renderChildren(root, node, depth + 1, path, inner, ctx);
}

/**
 * Lists what is inside a node at `depth`: an array's items (their keys, or an
 * `items:` line when the items carry annotations of their own), the keys of
 * the node and its `allOf` members, and union members that have keys.
 */
function renderChildren(
  root: unknown,
  node: Record<string, unknown>,
  depth: number,
  path: string[],
  refs: Refs,
  ctx: RenderContext,
): void {
  if (!step(ctx, path)) return;
  let target = node;
  let inner = refs;
  while (isRecord(target.items)) {
    const items = deref(root, target.items);
    if (items.ref && inner.has(items.ref)) {
      emit(ctx, `${indent(depth)}items: ${recursive(inner, items.ref)}`, path);
      return;
    }
    if (!isRecord(items.schema)) return;
    const members = unionOf(items.schema).filter((member) => !isNullSchema(root, member));
    const listsMembers =
      !hasOwnKeys(items.schema) &&
      members.length > 1 &&
      members.some((member) => hasChildren(root, member));
    // Annotated items get their own line, so their constraints aren't lost.
    if (hasAnnotations(root, items.schema) || (allOf(items.schema).length > 0 && !listsMembers)) {
      renderNode(root, target.items, "items", depth, path, inner, ctx);
      return;
    }
    inner = withRef(inner, items.ref, path);
    target = items.schema;
    if (listsMembers) {
      for (const member of members) renderNode(root, member, "-", depth, path, inner, ctx);
      return;
    }
    if (!hasOwnKeys(target) && members.length === 1) {
      const only = deref(root, members[0]);
      if (!isRecord(only.schema)) return;
      if (only.ref && inner.has(only.ref)) {
        emit(ctx, `${indent(depth)}items: ${recursive(inner, only.ref)}`, path);
        return;
      }
      inner = withRef(inner, only.ref, path);
      target = only.schema;
    }
    if (!hasChildren(root, target) && !isRecord(target.items)) return;
  }

  // Object members of an allOf all apply: their keys are listed together.
  for (const member of allOf(target)) {
    const resolved = deref(root, member);
    if (!isRecord(resolved.schema) || (resolved.ref && inner.has(resolved.ref))) continue;
    if (!hasOwnKeys(resolved.schema)) continue;
    renderChildren(root, resolved.schema, depth, path, withRef(inner, resolved.ref, path), ctx);
  }

  const required = new Set(
    Array.isArray(target.required)
      ? target.required.filter((key): key is string => typeof key === "string")
      : [],
  );
  if (isRecord(target.properties)) {
    for (const [key, child] of Object.entries(target.properties)) {
      const label = `${key}${required.has(key) ? "" : "?"}`;
      renderNode(root, child, label, depth, [...path, key], inner, ctx);
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
      ctx,
    );
  }

  // Alternatives next to the node's own keys (or of a whole input) with keys of their own.
  const members = unionOf(target).filter((member) => !isNullSchema(root, member));
  if (members.some((member) => hasChildren(root, member))) {
    if (!emit(ctx, `${indent(depth)}one of:`, path)) return;
    for (const member of members) renderNode(root, member, "-", depth + 1, path, inner, ctx);
  }
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
  if (variants.length > 0 && !hasOwnKeys(node)) {
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
    if (hasOwnKeys(node) || allOf(node).length > 0 || variants.length > 0) return "object";
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
    if (lo !== undefined && hi !== undefined) {
      notes.push(lo === hi ? `${lo} ${unit}` : `${lo}–${hi} ${unit}`);
    } else if (lo !== undefined) notes.push(`at least ${lo} ${unit}`);
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
  return truncateBytes(JSON.stringify(value) ?? "unknown", MAX_LITERAL_BYTES);
}

function indent(depth: number): string {
  return INDENT.repeat(depth);
}

/**
 * Joins the heading and lines. When rendering stopped early, adds a footer
 * naming the narrower path where it stopped, and checks the whole result
 * against {@link MAX_DETAIL_BYTES}, dropping lines from the end if needed.
 */
function finish(ctx: RenderContext): string {
  if (!ctx.cut) return [ctx.heading, ...ctx.lines].join("\n");

  // The key just below the requested path that holds the cut.
  const rest = ctx.cut.slice(ctx.requested.length).filter((key) => key !== "*");
  const narrower = rest.length > 0 ? showPath([...ctx.requested, rest[0] as string]) : "";
  const hint = narrower
    ? ` Ask for a narrower path, such as "${truncateBytes(narrower, MAX_HINT_BYTES)}".`
    : "";
  const footer = `…cut here to stay within ${MAX_DETAIL_BYTES} bytes.${hint}`;

  const lines = [...ctx.lines];
  let text = [ctx.heading, ...lines, footer].join("\n");
  while (byteLength(text) > MAX_DETAIL_BYTES && lines.length > 0) {
    lines.pop();
    text = [ctx.heading, ...lines, footer].join("\n");
  }
  return truncateBytes(text, MAX_DETAIL_BYTES);
}
