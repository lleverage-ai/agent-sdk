/**
 * Full, on-demand detail for one argument of a tool's input schema.
 *
 * `search_tools` prints each tool's parameters on one capped line, without
 * descriptions. This module renders the drill-down behind its `path` option:
 * one argument (or the whole input) with every key, type, enum value,
 * constraint and description, one key per line, to any depth, within
 * {@link MAX_DETAIL_BYTES}.
 *
 * Schemas come from plugins and external MCP servers, so every walk is
 * bounded: helpers are memoised per schema node and rendering stops at
 * {@link MAX_RENDER_STEPS} nodes, even when shared `$ref`s describe
 * exponentially many paths.
 *
 * @packageDocumentation
 */

/**
 * Maximum UTF-8 bytes for one drill-down result, heading and footer
 * included. Rendering stops when the next line would not fit, and the result
 * says so and names a narrower path to ask for. Lines and literals are never
 * cut short: a line is shown whole or not at all.
 * @internal
 */
export const MAX_DETAIL_BYTES = 4000;

/**
 * Maximum schema nodes rendered for one drill-down. Shared `$ref`s can
 * describe exponentially many paths, so rendering stops here even when the
 * output is still short.
 * @internal
 */
export const MAX_RENDER_STEPS = 2000;

/** Bytes kept free for the footer while lines are added. */
const FOOTER_RESERVE = 300;

/** Longest `pattern` printed; longer ones (generated date regexes) add nothing. */
const MAX_PATTERN_BYTES = 80;

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
  const doc = createDoc(inputSchema);
  const segments = parseArgumentPath(path);
  const shown = showPath(segments);

  let current: Candidate = { schema: inputSchema, required: true };
  const walked: string[] = [];
  for (const segment of segments) {
    const next =
      segment === "[]"
        ? resolveItems(doc, current.schema, new Map())
        : resolveKey(doc, current.schema, segment, new Map(), new Map());
    if (!next) {
      const at = walked.length > 0 ? `"${showPath(walked)}"` : "the top level";
      if (segment === "[]") {
        return { ok: false, error: `${at} in ${toolName} is not an array.` };
      }
      const keys = availableKeys(doc, current.schema, new Set());
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
    const node = deref(doc, inputSchema).schema;
    if (!isRecord(node)) {
      return { ok: false, error: `${toolName} has no input schema to show.` };
    }
    const ctx = createContext(`Arguments of ${toolName}:`, segments, "the whole input");
    renderChildren(doc, node, 0, [], new Map(), ctx);
    if (ctx.lines.length === 0 && !ctx.cut) {
      return { ok: true, text: `${toolName} takes no arguments.` };
    }
    return { ok: true, text: finish(ctx) };
  }

  const ctx = createContext(`Schema of ${shown} in ${toolName}:`, segments, `"${shown}"`);
  const label = `${shown}${current.required ? "" : "?"}`;
  renderNode(doc, current.schema, label, 0, segments, new Map(), ctx);
  return { ok: true, text: finish(ctx) };
}

// ---------------------------------------------------------------------------
// Schema helpers, memoised per schema node

/** One input schema with the caches its walks share. */
interface Doc {
  root: unknown;
  heads: Map<object, string>;
  children: Map<object, boolean>;
  annotated: Map<object, boolean>;
}

function createDoc(root: unknown): Doc {
  return { root, heads: new Map(), children: new Map(), annotated: new Map() };
}

/**
 * Runs `compute` once per schema node. While it runs, the node answers
 * `pending`, which also ends a cycle.
 */
function memo<T>(cache: Map<object, T>, node: object, pending: T, compute: () => T): T {
  if (cache.has(node)) return cache.get(node) as T;
  cache.set(node, pending);
  const value = compute();
  cache.set(node, value);
  return value;
}

/** Follows a local `$ref` (`#`, `#/$defs/X`, `#/definitions/X`). */
function deref(doc: Doc, schema: unknown): { schema: unknown; ref?: string } {
  const seen = new Set<string>();
  let node = schema;
  let ref: string | undefined;
  while (isRecord(node) && typeof node.$ref === "string") {
    if (seen.has(node.$ref)) return { schema: {}, ref: node.$ref };
    seen.add(node.$ref);
    ref = node.$ref;
    node = resolvePointer(doc.root, node.$ref);
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

function isNullSchema(doc: Doc, schema: unknown): boolean {
  const node = deref(doc, schema).schema;
  return isRecord(node) && node.type === "null";
}

function nonNullMembers(doc: Doc, node: Record<string, unknown>): unknown[] {
  return unionOf(node).filter((member) => !isNullSchema(doc, member));
}

/** True when the node itself names keys (properties or a record value schema). */
function hasOwnKeys(node: Record<string, unknown>): boolean {
  return (
    (isRecord(node.properties) && Object.keys(node.properties).length > 0) ||
    isRecord(node.additionalProperties)
  );
}

/** True when a schema has keys (directly or through array items or members) to list. */
function hasChildren(doc: Doc, schema: unknown): boolean {
  const node = deref(doc, schema).schema;
  if (!isRecord(node)) return false;
  return memo(
    doc.children,
    node,
    false,
    () =>
      hasOwnKeys(node) ||
      (isRecord(node.items) && hasChildren(doc, node.items)) ||
      [...unionOf(node), ...allOf(node)].some((member) => hasChildren(doc, member)),
  );
}

/**
 * True when a schema, or anything it is composed of (union and `allOf`
 * members, array items), carries constraints or a description. Keys are not
 * looked into: they get lines of their own.
 */
function hasDeepAnnotations(doc: Doc, schema: unknown): boolean {
  const node = deref(doc, schema).schema;
  if (!isRecord(node)) return false;
  return memo(
    doc.annotated,
    node,
    false,
    () =>
      annotate(node) !== "" ||
      (isRecord(node.items) && hasDeepAnnotations(doc, node.items)) ||
      [...unionOf(node), ...allOf(node)].some((member) => hasDeepAnnotations(doc, member)),
  );
}

// ---------------------------------------------------------------------------
// Path resolution

interface Candidate {
  schema: unknown;
  required: boolean;
}

/** Results per schema node (`null` while in progress, which ends a cycle). */
type Memo = Map<object, Candidate | null | undefined>;

function memoised(
  doc: Doc,
  schema: unknown,
  cache: Memo,
  resolve: (node: Record<string, unknown>) => Candidate | undefined,
): Candidate | undefined {
  const node = deref(doc, schema).schema;
  if (!isRecord(node)) return undefined;
  return memo(cache, node, null, () => resolve(node)) ?? undefined;
}

/**
 * The schema a key has at `schema`. Its declarations in the node's own
 * properties, array items and `allOf` members all apply, so they combine as
 * `allOf`; declarations in `anyOf`/`oneOf` members are alternatives and
 * combine as `anyOf`. Whether the key is required is worked out separately,
 * since `required` can sit in a different member from the declaration.
 */
function resolveKey(
  doc: Doc,
  schema: unknown,
  key: string,
  cache: Memo,
  requiredCache: Map<object, boolean>,
): Candidate | undefined {
  return memoised(doc, schema, cache, (node) => {
    const conjuncts: Candidate[] = [];
    if (isRecord(node.properties) && Object.hasOwn(node.properties, key)) {
      conjuncts.push({ schema: node.properties[key], required: false });
    }
    if (isRecord(node.items)) {
      const fromItems = resolveKey(doc, node.items, key, cache, requiredCache);
      if (fromItems) conjuncts.push(fromItems);
    }
    for (const member of allOf(node)) {
      const fromMember = resolveKey(doc, member, key, cache, requiredCache);
      if (fromMember) conjuncts.push(fromMember);
    }
    const members = nonNullMembers(doc, node);
    const alternatives = members
      .map((member) => resolveKey(doc, member, key, cache, requiredCache))
      .filter((candidate): candidate is Candidate => candidate !== undefined);
    if (alternatives.length > 0) {
      const combined = combine(alternatives, "anyOf");
      if (alternatives.length < members.length) combined.required = false;
      conjuncts.push(combined);
    }
    if (conjuncts.length === 0 && isRecord(node.additionalProperties)) {
      conjuncts.push({ schema: node.additionalProperties, required: false });
    }
    if (conjuncts.length === 0) return undefined;
    const combined = combine(conjuncts, "allOf");
    combined.required ||= requiresKey(doc, node, key, requiredCache);
    return combined;
  });
}

/**
 * True when an object schema requires `key`: in its own `required`, in any
 * `allOf` member's, or in every one of its union members'.
 */
function requiresKey(doc: Doc, schema: unknown, key: string, cache: Map<object, boolean>): boolean {
  const node = deref(doc, schema).schema;
  if (!isRecord(node)) return false;
  return memo(cache, node, false, () => {
    if (Array.isArray(node.required) && node.required.includes(key)) return true;
    if (allOf(node).some((member) => requiresKey(doc, member, key, cache))) return true;
    const members = nonNullMembers(doc, node);
    return members.length > 0 && members.every((member) => requiresKey(doc, member, key, cache));
  });
}

/** The item schema of an array at `schema`, combined across members as for keys. */
function resolveItems(doc: Doc, schema: unknown, cache: Memo): Candidate | undefined {
  return memoised(doc, schema, cache, (node) => {
    const conjuncts: Candidate[] = [];
    if (isRecord(node.items)) conjuncts.push({ schema: node.items, required: true });
    for (const member of allOf(node)) {
      const fromMember = resolveItems(doc, member, cache);
      if (fromMember) conjuncts.push(fromMember);
    }
    const alternatives = nonNullMembers(doc, node)
      .map((member) => resolveItems(doc, member, cache))
      .filter((candidate): candidate is Candidate => candidate !== undefined);
    if (alternatives.length > 0) conjuncts.push(combine(alternatives, "anyOf"));
    return conjuncts.length > 0 ? combine(conjuncts, "allOf") : undefined;
  });
}

/**
 * Combines candidates under one operator, merging the same schema object
 * (shared through memoisation or a `$ref`) instead of comparing serialised
 * schemas, which could expand a shared graph exponentially.
 */
function combine(candidates: Candidate[], operator: "allOf" | "anyOf"): Candidate {
  const bySchema = new Map<unknown, Candidate>();
  for (const candidate of candidates) {
    const twin = bySchema.get(candidate.schema);
    if (!twin) {
      bySchema.set(candidate.schema, { ...candidate });
    } else if (operator === "allOf") {
      twin.required ||= candidate.required;
    } else {
      twin.required &&= candidate.required;
    }
  }
  const distinct = [...bySchema.values()];
  if (distinct.length === 1) return distinct[0] as Candidate;
  const required =
    operator === "allOf"
      ? distinct.some((candidate) => candidate.required)
      : distinct.every((candidate) => candidate.required);
  return { schema: { [operator]: distinct.map((candidate) => candidate.schema) }, required };
}

function availableKeys(doc: Doc, schema: unknown, seen: Set<unknown>): string[] {
  const node = deref(doc, schema).schema;
  if (!isRecord(node) || seen.has(node)) return [];
  seen.add(node);
  const keys = isRecord(node.properties) ? Object.keys(node.properties) : [];
  if (isRecord(node.items)) keys.push(...availableKeys(doc, node.items, seen));
  for (const member of [...unionOf(node), ...allOf(node)]) {
    keys.push(...availableKeys(doc, member, seen));
  }
  return [...new Set(keys)];
}

// ---------------------------------------------------------------------------
// Rendering

interface RenderContext {
  heading: string;
  /** The requested path's segments, for the footer's narrower-path hint. */
  requested: string[];
  /** The requested argument as the footer names it. */
  subject: string;
  lines: string[];
  bytes: number;
  steps: number;
  /** Where rendering stopped, when it did. */
  cut?: string[];
}

function createContext(heading: string, requested: string[], subject: string): RenderContext {
  return { heading, requested, subject, lines: [], bytes: byteLength(heading), steps: 0 };
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

/** Adds a whole line if it fits the output budget; otherwise records the cut. */
function emit(ctx: RenderContext, line: string, path: string[]): boolean {
  if (ctx.cut) return false;
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

/** How a nullable or one-member union wrapper passes itself on to its member. */
interface Wrapper {
  nullable: boolean;
  description?: unknown;
}

/**
 * Renders `label: <type> (constraints) — description`, then what is inside
 * it one level deeper: keys, union members that differ in shape or
 * annotations, or the restrictions of an `allOf`.
 */
function renderNode(
  doc: Doc,
  schema: unknown,
  label: string,
  depth: number,
  path: string[],
  refs: Refs,
  ctx: RenderContext,
  wrapper?: Wrapper,
): void {
  if (!step(ctx, path)) return;
  const { schema: node, ref } = deref(doc, schema);
  if (ref && refs.has(ref)) {
    emit(ctx, headLine(label, recursive(refs, ref), depth), path);
    return;
  }
  const inner = withRef(refs, ref, path);
  if (!isRecord(node)) {
    emit(ctx, headLine(label, wrapper?.nullable ? "any|null" : "any", depth), path);
    return;
  }
  const notes = annotate(node, wrapper?.description);

  if (!hasOwnKeys(node)) {
    const variants = unionOf(node);
    const members = nonNullMembers(doc, node);
    const nullable = Boolean(wrapper?.nullable) || members.length < variants.length;

    // A nullable (or one-member) union renders as its one member, marked nullable.
    if (variants.length > 0 && members.length === 1) {
      const description = node.description ?? wrapper?.description;
      renderNode(doc, members[0], label, depth, path, inner, ctx, { nullable, description });
      return;
    }

    // Members that differ in more than their type are listed one by one.
    if (
      members.length > 1 &&
      members.some((member) => hasChildren(doc, member) || hasDeepAnnotations(doc, member))
    ) {
      const head = `one of${nullable ? " (or null)" : ""}${notes}`;
      if (!emit(ctx, headLine(label, head, depth), path)) return;
      for (const member of members) renderNode(doc, member, "-", depth + 1, path, inner, ctx);
      return;
    }

    // Restrictions that all apply, unless they are plain objects whose keys merge.
    const conjuncts = allOf(node);
    if (
      conjuncts.length > 0 &&
      conjuncts.some((member) => !hasChildren(doc, member) || hasDeepAnnotations(doc, member))
    ) {
      const head = `all of${nullable ? " (or null)" : ""}${notes}`;
      if (!emit(ctx, headLine(label, head, depth), path)) return;
      for (const member of conjuncts) renderNode(doc, member, "-", depth + 1, path, inner, ctx);
      return;
    }
  }

  const head = `${typeHead(doc, node)}${wrapper?.nullable ? "|null" : ""}${notes}`;
  if (!emit(ctx, headLine(label, head, depth), path)) return;
  renderChildren(doc, node, depth + 1, path, inner, ctx);
}

/**
 * Lists what is inside a node at `depth`: an array's items (their keys, or
 * an `items:` line when the items are composed or annotated), the keys of the
 * node and of its object `allOf` members, and union members that have keys.
 */
function renderChildren(
  doc: Doc,
  node: Record<string, unknown>,
  depth: number,
  path: string[],
  refs: Refs,
  ctx: RenderContext,
  owners: readonly unknown[] = [],
): void {
  if (!step(ctx, path)) return;
  let target = node;
  let inner = refs;
  while (isRecord(target.items)) {
    const items = deref(doc, target.items);
    if (items.ref && inner.has(items.ref)) {
      emit(ctx, `${indent(depth)}items: ${recursive(inner, items.ref)}`, path);
      return;
    }
    const itemNode = items.schema;
    if (!isRecord(itemNode)) return;
    if (!hasOwnKeys(itemNode)) {
      const members = nonNullMembers(doc, itemNode);
      const plain = !hasDeepAnnotations(doc, itemNode) && allOf(itemNode).length === 0;
      // Plain object alternatives (a discriminated union) list straight under the array.
      if (plain && members.length > 1 && members.some((member) => hasChildren(doc, member))) {
        inner = withRef(inner, items.ref, path);
        for (const member of members) renderNode(doc, member, "-", depth, path, inner, ctx);
        return;
      }
      // Composed or annotated items get their own line, so nothing in them is lost.
      if (!plain || members.length > 0) {
        renderNode(doc, target.items, "items", depth, path, inner, ctx);
        return;
      }
    } else if (hasDeepAnnotations(doc, itemNode)) {
      renderNode(doc, target.items, "items", depth, path, inner, ctx);
      return;
    }
    inner = withRef(inner, items.ref, path);
    target = itemNode;
  }

  // Object members of an allOf all apply: their keys are listed together, and
  // a key is required when this node or any enclosing allOf requires it.
  const scope = [...owners, target];
  for (const member of allOf(target)) {
    const resolved = deref(doc, member);
    if (!isRecord(resolved.schema) || (resolved.ref && inner.has(resolved.ref))) continue;
    if (!hasOwnKeys(resolved.schema)) continue;
    const memberRefs = withRef(inner, resolved.ref, path);
    renderChildren(doc, resolved.schema, depth, path, memberRefs, ctx, scope);
  }

  if (isRecord(target.properties)) {
    for (const [key, child] of Object.entries(target.properties)) {
      const required = scope.some((owner) => requiresKey(doc, owner, key, new Map()));
      const label = `${key}${required ? "" : "?"}`;
      renderNode(doc, child, label, depth, [...path, key], inner, ctx);
    }
  }
  if (isRecord(target.additionalProperties)) {
    const valuePath = [...path, "*"];
    renderNode(doc, target.additionalProperties, "[key: string]", depth, valuePath, inner, ctx);
  }

  // Alternatives next to the node's own keys (or of a whole input) with keys of their own.
  const members = nonNullMembers(doc, target);
  if (members.some((member) => hasChildren(doc, member))) {
    if (!emit(ctx, `${indent(depth)}one of:`, path)) return;
    for (const member of members) renderNode(doc, member, "-", depth + 1, path, inner, ctx);
  }
}

/**
 * One-line type: literals for enums and const, `T[]` for arrays, `object`
 * for objects. Memoised per node, so a definition shared by sibling branches
 * prints the same everywhere; only a node still being worked out (a cycle)
 * prints `any`. Capped at {@link MAX_DETAIL_BYTES}, which no line can exceed.
 */
function typeHead(doc: Doc, node: Record<string, unknown>): string {
  return memo(doc.heads, node, "any", () =>
    truncateBytes(computeTypeHead(doc, node), MAX_DETAIL_BYTES),
  );
}

function computeTypeHead(doc: Doc, node: Record<string, unknown>): string {
  if ("const" in node) return formatLiteral(node.const);
  if (Array.isArray(node.enum) && node.enum.length > 0) {
    return [...new Set(node.enum.map(formatLiteral))].join("|");
  }
  const variants = unionOf(node);
  if (variants.length > 0 && !hasOwnKeys(node)) {
    const heads = variants.map((variant) => {
      const resolved = deref(doc, variant).schema;
      return isRecord(resolved) ? typeHead(doc, resolved) : "any";
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
      const items = deref(doc, node.items).schema;
      if (!isRecord(items)) return "array";
      const head = typeHead(doc, items);
      return head.includes("|") ? `(${head})[]` : `${head}[]`;
    })
    .join("|");
}

/**
 * ` (constraints) — description` for a node, each part only when present.
 * `fallbackDescription` is a wrapper's description, used when the node has none.
 */
function annotate(node: Record<string, unknown>, fallbackDescription?: unknown): string {
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
  const description =
    typeof node.description === "string" && node.description.trim()
      ? node.description
      : fallbackDescription;
  if (typeof description === "string" && description.trim()) {
    out += ` — ${description.trim().replace(/\s*\n\s*/g, " ")}`;
  }
  return out;
}

function formatLiteral(value: unknown): string {
  return JSON.stringify(value) ?? "unknown";
}

function indent(depth: number): string {
  return INDENT.repeat(depth);
}

/**
 * Joins the heading and lines. When rendering stopped early, adds a footer
 * that says so and names the narrower path where it stopped, and checks the
 * whole result against {@link MAX_DETAIL_BYTES}, dropping lines from the end
 * if needed.
 */
function finish(ctx: RenderContext): string {
  if (!ctx.cut) return [ctx.heading, ...ctx.lines].join("\n");

  let footer: string;
  if (ctx.lines.length === 0) {
    footer = `…${ctx.subject} is too long to show within ${MAX_DETAIL_BYTES} bytes.`;
  } else {
    // The key just below the requested path that holds the cut.
    const rest = ctx.cut.slice(ctx.requested.length).filter((key) => key !== "*");
    const narrower = rest.length > 0 ? showPath([...ctx.requested, rest[0] as string]) : "";
    const hint = narrower
      ? ` Ask for a narrower path, such as "${truncateBytes(narrower, MAX_HINT_BYTES)}".`
      : "";
    footer = `…cut here to stay within ${MAX_DETAIL_BYTES} bytes.${hint}`;
  }

  const lines = [...ctx.lines];
  let text = [ctx.heading, ...lines, footer].join("\n");
  while (byteLength(text) > MAX_DETAIL_BYTES && lines.length > 0) {
    lines.pop();
    text = [ctx.heading, ...lines, footer].join("\n");
  }
  return truncateBytes(text, MAX_DETAIL_BYTES);
}
