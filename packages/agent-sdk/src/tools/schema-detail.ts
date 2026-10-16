/**
 * Full, on-demand detail for one argument of a tool's input schema.
 *
 * `search_tools` prints each tool's parameters on one capped line, without
 * descriptions. This module renders the drill-down behind its `path` option:
 * one argument (or the whole input) with every key, type, enum value,
 * constraint and description, one key per line, to any depth, within
 * {@link MAX_DETAIL_BYTES}.
 *
 * Every node renders through one view ({@link gather}): what applies to the
 * value at once (the node, its `allOf` members of the same type and a
 * nullable wrapper's one member) is folded into one line and one body, so
 * their constraints, descriptions, keys and alternatives all appear; only
 * alternatives and restrictions that the line's type can't show are listed.
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
 * included. A result that fits uses all of it. Otherwise rendering stops at
 * the first line that doesn't fit, lines are dropped from the end until the
 * footer fits too, and the footer names a narrower path to ask for. Lines and
 * literals are never cut short: a line is shown whole or not at all.
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
    const { schema: node, ref } = deref(doc, inputSchema);
    if (!isRecord(node)) {
      return { ok: false, error: `${toolName} has no input schema to show.` };
    }
    const ctx = createContext(`Arguments of ${toolName}:`, segments, "the whole input");
    const refs = withRef(new Map([["#", { at: "" }]]), ref, []);
    renderBody(doc, gather(doc, node, refs, [], [], ctx), 0, [], ctx, false);
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
  nulls: Map<object, boolean>;
  /** A `$ref` node with sibling keywords, as one node: see {@link withSiblings}. */
  merged: Map<object, Record<string, unknown>>;
  /** Target parts of merged nodes that carry their `$ref`, with that `$ref` and the target copied. */
  parts: Map<object, { ref: string; source: object }>;
  /** The target part made from a target, per `$ref` and replaced keys: one copy each, so cycles end. */
  copies: Map<object, Map<string, Record<string, unknown>>>;
}

function createDoc(root: unknown): Doc {
  return {
    root,
    heads: new Map(),
    children: new Map(),
    annotated: new Map(),
    nulls: new Map(),
    merged: new Map(),
    parts: new Map(),
    copies: new Map(),
  };
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

/**
 * Follows a local `$ref` (`#`, `#/$defs/X`, `#/definitions/X`). A `$ref`
 * with sibling keywords resolves to its {@link withSiblings} node. When the
 * siblings declare structure of their own, that structure isn't part of the
 * target, so the `$ref` is reported by the target part alone: the siblings'
 * keys aren't marked recursive, and a recursive target becomes an `all of`
 * restriction beside them. A node whose `$ref` points at itself is the
 * exception: its siblings are part of the target, so it reports the `$ref`.
 */
function deref(doc: Doc, schema: unknown): { schema: unknown; ref?: string; siblings?: true } {
  const seen = new Set<string>();
  let node = schema;
  let ref = isRecord(schema) ? doc.parts.get(schema)?.ref : undefined;
  while (isRecord(node) && typeof node.$ref === "string") {
    if (seen.has(node.$ref)) return { schema: {}, ref: node.$ref };
    seen.add(node.$ref);
    const target = resolvePointer(doc.root, node.$ref);
    if (hasSiblings(node)) {
      const shaped = hasShape(node);
      const merged = withSiblings(doc, node, target, shaped);
      const own = target === (doc.parts.get(node)?.source ?? node);
      return { schema: merged, ref: shaped && !own ? ref : node.$ref, siblings: true };
    }
    ref = node.$ref;
    node = target;
  }
  return { schema: node, ref };
}

/** True when a node declares keys, items or members of its own. */
function hasShape(node: Record<string, unknown>): boolean {
  return hasOwnKeys(node) || "items" in node || unionOf(node).length > 0 || allOf(node).length > 0;
}

/** Keywords beside a `$ref` that don't describe the value. */
const REF_METADATA = new Set(["$ref", "$schema", "$id", "$defs", "definitions", "$comment"]);

function hasSiblings(node: Record<string, unknown>): boolean {
  return Object.keys(node).some((key) => !REF_METADATA.has(key));
}

/**
 * A `$ref` node with sibling keywords (`{ description, $ref }`, as Zod v4
 * emits), as one node: since draft 2019-09 the siblings apply alongside the
 * target, so the target becomes one more `allOf` part. The sibling
 * `description` and `default` replace the target's, as Zod's own `.describe()`
 * and `.default()` do. Built once per node, so memoisation still holds.
 * When `shaped`, the target part is a copy that carries the `$ref`.
 */
function withSiblings(
  doc: Doc,
  node: Record<string, unknown>,
  target: unknown,
  shaped: boolean,
): Record<string, unknown> {
  const cached = doc.merged.get(node);
  if (cached) return cached;
  const { $ref: ref, ...siblings } = node;
  let part = target;
  if (isRecord(target)) {
    const replaced = ["description", "default"].filter((key) => key in siblings && key in target);
    if (replaced.length > 0 || shaped) {
      part = targetCopy(doc, target, shaped ? (ref as string) : "", replaced);
    }
  }
  const merged = { ...siblings, allOf: [...allOf(node), part] };
  doc.merged.set(node, merged);
  return merged;
}

/**
 * A copy of `target` without the `replaced` keys, carrying `ref` when it is
 * set. The same target always gives the same copy, so dereferencing a copy
 * whose own `$ref` has structural siblings reaches nodes already seen, and the
 * per-node caches end the cycle.
 */
function targetCopy(
  doc: Doc,
  target: Record<string, unknown>,
  ref: string,
  replaced: string[],
): Record<string, unknown> {
  const key = `${ref} ${replaced.join(",")}`;
  const byKey = doc.copies.get(target) ?? new Map<string, Record<string, unknown>>();
  doc.copies.set(target, byKey);
  const cached = byKey.get(key);
  if (cached) return cached;
  const copy = Object.fromEntries(Object.entries(target).filter(([k]) => !replaced.includes(k)));
  if (ref) doc.parts.set(copy, { ref, source: target });
  byKey.set(key, copy);
  return copy;
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

/**
 * True for `{ type: "null" }`, and for an untyped wrapper whose union members
 * are all null (`{ anyOf: [{ type: "null", … }] }`), which is null too.
 * Memoised per node, so a shared definition is classified once; a cycle
 * counts as not null.
 */
function isNullSchema(doc: Doc, schema: unknown): boolean {
  const node = deref(doc, schema).schema;
  if (!isRecord(node)) return false;
  return memo(doc.nulls, node, false, () => {
    if (node.type === "null") return true;
    if (hasOwnType(node) || hasOwnKeys(node)) return false;
    const members = unionOf(node);
    if (members.length > 0 && members.every((member) => isNullSchema(doc, member))) return true;
    // A described `$ref` to null (see withSiblings) is null too.
    return allOf(node).some((member) => isNullSchema(doc, member));
  });
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
      hasNotes(annotations(node)) ||
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

/** One rendered line, with the argument path it belongs to. */
interface Line {
  text: string;
  path: string[];
}

interface RenderContext {
  heading: string;
  /** The requested path's segments, for the footer's narrower-path hint. */
  requested: string[];
  /** The requested argument as the footer names it. */
  subject: string;
  lines: Line[];
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

/**
 * Adds a whole line if it fits the output budget; otherwise records the cut.
 * The whole budget is available: room for a footer is only made in
 * {@link finish}, and only when something was cut.
 */
function emit(ctx: RenderContext, text: string, path: string[]): boolean {
  if (ctx.cut) return false;
  const size = byteLength(text) + 1;
  if (ctx.bytes + size > MAX_DETAIL_BYTES) {
    ctx.cut = path;
    return false;
  }
  ctx.lines.push({ text, path });
  ctx.bytes += size;
  return true;
}

/**
 * Where a `$ref` being expanded is shown: the argument path, and whether it is
 * only part of the value there (an `allOf` member folded into it).
 */
interface Shown {
  at: string;
  part?: boolean;
}

/**
 * The `$ref`s on the current branch's expansion ancestry. Each branch carries
 * its own: a `$ref` folded into one `allOf` member is an ancestor of what that
 * member declares, not of the value's other keys.
 */
type Refs = ReadonlyMap<string, Shown>;

function withRef(refs: Refs, ref: string | undefined, path: string[], part?: boolean): Refs {
  if (!ref || refs.has(ref)) return refs;
  return new Map([...refs, [ref, { at: showPath(path), ...(part ? { part } : {}) }]]);
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
  const shown = refs.get(ref);
  const where = shown?.at ? `"${shown.at}"` : "the whole input";
  if (!shown?.part) return `same shape as ${where} (recursive)`;
  const name = ref.split("/").pop() || ref;
  return `same shape as ${name}, part of ${where} (recursive)`;
}

/** `label: head`, or `- head` for a member of `one of` / `all of`. */
function headLine(label: string, head: string, depth: number): string {
  return label === "-" ? `${indent(depth)}- ${head}` : `${indent(depth)}${label}: ${head}`;
}

/**
 * Everything that applies to one value, gathered from a schema node and the
 * parts of it that fold into the node's line: `allOf` members whose type is
 * the node's own (or that have none), and the one member of a nullable or
 * one-member union. Their constraints and descriptions join the line; their
 * keys, array items, alternatives and remaining restrictions join the body.
 * Nothing a folded part carries is dropped, which is what keeps every
 * annotation visible whatever wraps it.
 *
 * Everything in the body keeps the `$ref` ancestry of the part it came from,
 * so a `$ref` folded in through one member never makes another part look
 * recursive.
 */
interface View {
  root: Record<string, unknown>;
  /**
   * Roots of the enclosing values this one is a restriction or alternative
   * of: their `required` applies to this value's keys too.
   */
  scope: Record<string, unknown>[];
  /** The root's one-line type. */
  head: string;
  nullable: boolean;
  /**
   * True when the line's type says something the body doesn't: the root or a
   * folded part has a type, enum or const, or a union of literals is shown
   * only in the type.
   */
  typed: boolean;
  constraints: string[];
  descriptions: string[];
  /** Nodes whose keys are listed in the body. */
  keyed: Part<Record<string, unknown>>[];
  /** Item schemas of the array, from every folded part. */
  items: Part<unknown>[];
  /** Union alternatives the line's type can't show, one list per union. */
  groups: Part<unknown[]>[];
  /** `allOf` members of another type, or recursive, listed under `all of`. */
  restrictions: Part<unknown>[];
}

/** Something listed in a view's body, with the `$ref` ancestry it came from. */
interface Part<T> {
  value: T;
  refs: Refs;
}

function gather(
  doc: Doc,
  root: Record<string, unknown>,
  refs: Refs,
  scope: Record<string, unknown>[],
  path: string[],
  ctx: RenderContext,
): View {
  const view: View = {
    root,
    scope,
    head: typeHead(doc, root),
    nullable: false,
    typed: false,
    constraints: [],
    descriptions: [],
    keyed: [],
    items: [],
    groups: [],
    restrictions: [],
  };
  // Each node folds once, so a shared definition reached twice costs nothing.
  const folded = new Set<object>();
  const fold = (node: Record<string, unknown>, refs: Refs): void => {
    if (folded.has(node) || !step(ctx, path)) return;
    folded.add(node);
    if (hasOwnType(node)) view.typed = true;
    const notes = annotations(node);
    addUnique(view.constraints, notes.constraints);
    addUnique(view.descriptions, notes.descriptions);
    if (hasOwnKeys(node)) view.keyed.push({ value: node, refs });
    if (isRecord(node.items)) view.items.push({ value: node.items, refs });

    const head = typeHead(doc, node);
    const variants = unionOf(node);
    const members = nonNullMembers(doc, node);
    if (members.length < variants.length) view.nullable = true;
    // What a null alternative means ("clears the value") is said on the line.
    for (const variant of variants) {
      if (!isNullSchema(doc, variant)) continue;
      const note = nullNote(doc, variant);
      if (note) addUnique(view.descriptions, [note]);
    }
    if (members.length === 1) {
      // One alternative besides null applies whenever the value isn't null.
      const ownHead = hasOwnType(node) ? stripNull(head) : undefined;
      const inner = foldable(doc, members[0], refs, ownHead);
      if (inner) fold(inner.schema, withRef(refs, inner.ref, path));
      else view.groups.push({ value: members, refs });
    } else if (members.length > 1) {
      if (listsAlternatives(doc, node, members)) view.groups.push({ value: members, refs });
      // Otherwise the line's type is the only place the alternatives show.
      else view.typed = true;
    }

    for (const member of allOf(node)) {
      if (!isRecord(deref(doc, member).schema)) continue;
      const inner = foldable(doc, member, refs, head);
      if (inner) fold(inner.schema, withRef(refs, inner.ref, path, true));
      else view.restrictions.push({ value: member, refs });
    }
  };
  fold(root, refs);
  return view;
}

/**
 * What a `null` alternative says about itself, as one note for the line:
 * `null (default null): Clears the due date`. Its own constraints and
 * description and those of its `allOf` parts and union members all count (a
 * union inside a null member can only narrow null), so nothing a null member
 * carries is dropped. Undefined when it carries nothing.
 */
function nullNote(doc: Doc, member: unknown): string | undefined {
  const notes = { constraints: [] as string[], descriptions: [] as string[] };
  const seen = new Set<object>();
  const collect = (schema: unknown): void => {
    const node = deref(doc, schema).schema;
    if (!isRecord(node) || seen.has(node)) return;
    seen.add(node);
    const own = annotations(node);
    addUnique(notes.constraints, own.constraints);
    addUnique(notes.descriptions, own.descriptions);
    for (const part of [...allOf(node), ...unionOf(node)]) collect(part);
  };
  collect(member);
  if (!hasNotes(notes)) return undefined;
  let note = "null";
  if (notes.constraints.length > 0) note += ` (${notes.constraints.join(", ")})`;
  if (notes.descriptions.length > 0) note += `: ${notes.descriptions.join("; ")}`;
  return note;
}

/**
 * A member that folds into its owner's line: not a recursive reference, and
 * with no type of its own or the type `head` already shows. With `head`
 * undefined, any type folds (the owner's type is the member's).
 */
function foldable(
  doc: Doc,
  member: unknown,
  refs: Refs,
  head: string | undefined,
): { schema: Record<string, unknown>; ref?: string } | undefined {
  const { schema, ref } = deref(doc, member);
  if (!isRecord(schema) || (ref && refs.has(ref))) return undefined;
  if (head !== undefined) {
    const own = typeHead(doc, schema);
    if (own !== "any" && own !== head) return undefined;
  }
  return { schema, ref };
}

/**
 * True when a union's members carry more than the line's type shows: keys,
 * constraints or descriptions, or literals a typed owner's type hides.
 */
function listsAlternatives(doc: Doc, node: Record<string, unknown>, members: unknown[]): boolean {
  if (members.some((member) => hasChildren(doc, member) || hasDeepAnnotations(doc, member))) {
    return true;
  }
  if (!hasOwnType(node)) return false;
  const alternatives = stripNull(unionHead(doc, node));
  return alternatives !== "any" && alternatives !== stripNull(typeHead(doc, node));
}

/**
 * Lists the alternatives or restrictions directly under the line when they
 * are all there is to the value, so the line can say `one of` / `all of`
 * instead of a type. Not when the value has a type of its own, which the
 * line must keep showing.
 */
function compactForm(view: View): "one of" | "all of" | undefined {
  if (view.typed || view.keyed.length > 0 || view.items.length > 0) return undefined;
  if (view.groups.length === 1 && view.restrictions.length === 0) return "one of";
  if (view.groups.length === 0 && view.restrictions.length > 0) return "all of";
  return undefined;
}

function hasNotes(notes: { constraints: string[]; descriptions: string[] }): boolean {
  return notes.constraints.length > 0 || notes.descriptions.length > 0;
}

function addUnique(target: string[], values: string[]): void {
  for (const value of values) if (!target.includes(value)) target.push(value);
}

/**
 * Renders a schema node: its line, then its body one level deeper. `scope`
 * holds the enclosing values it is a restriction or alternative of.
 */
function renderNode(
  doc: Doc,
  schema: unknown,
  label: string,
  depth: number,
  path: string[],
  refs: Refs,
  ctx: RenderContext,
  scope: Record<string, unknown>[] = [],
): void {
  if (!step(ctx, path)) return;
  const { schema: node, ref, siblings } = deref(doc, schema);
  if (ref && refs.has(ref)) {
    const notes = siblings ? ownNotes(node) : "";
    emit(ctx, headLine(label, `${recursive(refs, ref)}${notes}`, depth), path);
    return;
  }
  if (!isRecord(node)) {
    emit(ctx, headLine(label, "any", depth), path);
    return;
  }
  const view = gather(doc, node, withRef(refs, ref, path), scope, path, ctx);
  renderView(doc, view, label, depth, path, ctx);
}

/** `label: <type> (constraints) — descriptions`, then the body. */
function renderView(
  doc: Doc,
  view: View,
  label: string,
  depth: number,
  path: string[],
  ctx: RenderContext,
): void {
  const compact = compactForm(view);
  const head = compact ? `${compact}${view.nullable ? " (or null)" : ""}` : lineHead(view);
  if (!emit(ctx, headLine(label, `${head}${formatNotes(view)}`, depth), path)) return;
  renderBody(doc, view, depth + 1, path, ctx, compact !== undefined);
}

/**
 * What is inside a value, at `depth`: its array items, its keys, the
 * alternatives the line's type can't show (`one of`) and restrictions of
 * another type (`all of`). When `compact`, the line already says `one of` or
 * `all of`, and the members list without a heading of their own.
 */
function renderBody(
  doc: Doc,
  view: View,
  depth: number,
  path: string[],
  ctx: RenderContext,
  compact: boolean,
): void {
  const owners = [...view.scope, view.root];
  for (const items of view.items) renderItems(doc, items.value, depth, path, items.refs, ctx);
  for (const owner of view.keyed) {
    renderKeys(doc, owners, owner.value, depth, path, owner.refs, ctx);
  }
  for (const group of view.groups) {
    renderList(doc, "one of:", [group], depth, path, owners, ctx, compact);
  }
  if (view.restrictions.length > 0) {
    const members = view.restrictions.map((part) => ({ value: [part.value], refs: part.refs }));
    renderList(doc, "all of:", members, depth, path, owners, ctx, compact);
  }
}

/**
 * Lists members under `title`. They are alternatives or restrictions of the
 * same value, so the requirements of `owners` apply to their keys too.
 */
function renderList(
  doc: Doc,
  title: string,
  parts: Part<unknown[]>[],
  depth: number,
  path: string[],
  owners: Record<string, unknown>[],
  ctx: RenderContext,
  compact: boolean,
): void {
  if (!compact && !emit(ctx, `${indent(depth)}${title}`, path)) return;
  const at = compact ? depth : depth + 1;
  for (const part of parts) {
    for (const member of part.value) {
      renderNode(doc, member, "-", at, path, part.refs, ctx, owners);
    }
  }
}

/**
 * Lists an array's items at `depth`. The array's `T[]` already shows their
 * type, so their keys list straight under it, and so do the members of a
 * union of objects (a discriminated union). Items that carry constraints or
 * descriptions, or are only scalar alternatives or restrictions, get an
 * `items:` line of their own.
 */
function renderItems(
  doc: Doc,
  items: unknown,
  depth: number,
  path: string[],
  refs: Refs,
  ctx: RenderContext,
): void {
  if (!step(ctx, path)) return;
  const { schema: node, ref, siblings } = deref(doc, items);
  if (ref && refs.has(ref)) {
    const notes = siblings ? ownNotes(node) : "";
    emit(ctx, `${indent(depth)}items: ${recursive(refs, ref)}${notes}`, path);
    return;
  }
  if (!isRecord(node)) return;
  const view = gather(doc, node, withRef(refs, ref, path), [], path, ctx);
  const compact = compactForm(view);
  const objects =
    compact === "one of" &&
    view.groups.every((group) => group.value.every((member) => hasChildren(doc, member)));
  if (hasNotes(view) || (compact !== undefined && !objects)) {
    renderView(doc, view, "items", depth, path, ctx);
    return;
  }
  renderBody(doc, view, depth, path, ctx, objects);
}

/**
 * Lists the keys `owner` declares. A key is required when the value's root
 * or an enclosing value it restricts (`owners`) requires it: in its own
 * `required`, in any `allOf` member's, or in every alternative's.
 */
function renderKeys(
  doc: Doc,
  owners: Record<string, unknown>[],
  owner: Record<string, unknown>,
  depth: number,
  path: string[],
  refs: Refs,
  ctx: RenderContext,
): void {
  if (isRecord(owner.properties)) {
    for (const [key, child] of Object.entries(owner.properties)) {
      const required = owners.some((root) => requiresKey(doc, root, key, new Map()));
      renderNode(doc, child, `${key}${required ? "" : "?"}`, depth, [...path, key], refs, ctx);
    }
  }
  if (isRecord(owner.additionalProperties)) {
    const valuePath = [...path, "*"];
    renderNode(doc, owner.additionalProperties, "[key: string]", depth, valuePath, refs, ctx);
  }
}

/** The line's type, marked `|null` when a folded union allows null. */
function lineHead(view: View): string {
  const head = view.head;
  if (!view.nullable || /(^|\|)null(\||$)/.test(head)) return head;
  return head.includes("&") ? `(${head})|null` : `${head}|null`;
}

function hasOwnType(node: Record<string, unknown>): boolean {
  return (
    "const" in node ||
    Array.isArray(node.enum) ||
    typeof node.type === "string" ||
    Array.isArray(node.type)
  );
}

/** A type without its `null` alternative. */
function stripNull(head: string): string {
  const parts = head.split("|").filter((part) => part !== "null");
  return parts.length > 0 ? parts.join("|") : head;
}

/**
 * One-line type: literals for enums and const, the `type` keyword (`T[]` for
 * arrays), the alternatives of a union, the shared type of `allOf` members
 * (`A&B` when they differ), `object` for keys. Memoised per node, so a
 * definition shared by sibling branches prints the same everywhere; only a
 * node still being worked out (a cycle) prints `any`. Capped at
 * {@link MAX_DETAIL_BYTES}, which no line can exceed.
 */
function typeHead(doc: Doc, node: Record<string, unknown>): string {
  return memo(doc.heads, node, "any", () =>
    truncateBytes(computeTypeHead(doc, node), MAX_DETAIL_BYTES),
  );
}

function headOf(doc: Doc, schema: unknown): string {
  const node = deref(doc, schema).schema;
  return isRecord(node) ? typeHead(doc, node) : "any";
}

/** The distinct types of a node's union members, joined with `|`. */
function unionHead(doc: Doc, node: Record<string, unknown>): string {
  return [...new Set(unionOf(node).map((member) => headOf(doc, member)))].join("|");
}

function computeTypeHead(doc: Doc, node: Record<string, unknown>): string {
  if ("const" in node) return formatLiteral(node.const);
  if (Array.isArray(node.enum) && node.enum.length > 0) {
    return [...new Set(node.enum.map(formatLiteral))].join("|");
  }
  const names =
    typeof node.type === "string"
      ? [node.type]
      : Array.isArray(node.type)
        ? node.type.filter((name): name is string => typeof name === "string")
        : [];
  if (names.length > 0) {
    return names
      .map((name) => {
        if (name !== "array") return name;
        const items = deref(doc, node.items).schema;
        if (!isRecord(items)) return "array";
        const head = typeHead(doc, items);
        return /[|&]/.test(head) ? `(${head})[]` : `${head}[]`;
      })
      .join("|");
  }
  if (hasOwnKeys(node)) return "object";
  if (unionOf(node).length > 0) return unionHead(doc, node);
  const conjuncts = [...new Set(allOf(node).map((member) => headOf(doc, member)))].filter(
    (head) => head !== "any",
  );
  if (conjuncts.length === 1) return conjuncts[0] as string;
  if (conjuncts.length > 1) {
    return conjuncts.map((head) => (head.includes("|") ? `(${head})` : head)).join("&");
  }
  return "any";
}

/** A node's own constraints and description, each only when present. */
function annotations(node: Record<string, unknown>): {
  constraints: string[];
  descriptions: string[];
} {
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

  const descriptions =
    typeof node.description === "string" && node.description.trim()
      ? [node.description.trim().replace(/\s*\n\s*/g, " ")]
      : [];
  return { constraints: notes, descriptions };
}

/** ` (constraints) — descriptions`, each part only when present. */
function formatNotes(notes: { constraints: string[]; descriptions: string[] }): string {
  let out = notes.constraints.length > 0 ? ` (${notes.constraints.join(", ")})` : "";
  if (notes.descriptions.length > 0) out += ` — ${notes.descriptions.join("; ")}`;
  return out;
}

/**
 * The notes a recursive `$ref`'s own sibling keywords add to its line,
 * including the keys it requires and the literals it allows, which the line
 * has no body to show.
 */
function ownNotes(node: unknown): string {
  if (!isRecord(node)) return "";
  const notes = annotations(node);
  if (Array.isArray(node.required) && node.required.length > 0) {
    notes.constraints.push(`requires ${node.required.join(", ")}`);
  }
  if ("const" in node) notes.constraints.push(`= ${formatLiteral(node.const)}`);
  else if (Array.isArray(node.enum) && node.enum.length > 0) {
    notes.constraints.push(`one of ${[...new Set(node.enum.map(formatLiteral))].join("|")}`);
  }
  return formatNotes(notes);
}

function formatLiteral(value: unknown): string {
  return JSON.stringify(value) ?? "unknown";
}

function indent(depth: number): string {
  return INDENT.repeat(depth);
}

/**
 * Joins the heading and lines. When rendering stopped early, adds a footer
 * that says so and names a narrower path, dropping lines from the end until
 * the whole result, footer included, fits {@link MAX_DETAIL_BYTES}. The hint
 * follows the first line left out.
 */
function finish(ctx: RenderContext): string {
  const join = (lines: Line[], footer?: string) =>
    [ctx.heading, ...lines.map((line) => line.text), ...(footer ? [footer] : [])].join("\n");
  if (!ctx.cut) return join(ctx.lines);

  const lines = [...ctx.lines];
  let cut = ctx.cut;
  for (;;) {
    const text = join(lines, footer(ctx, cut, lines.length === 0));
    if (byteLength(text) <= MAX_DETAIL_BYTES || lines.length === 0) {
      return truncateBytes(text, MAX_DETAIL_BYTES);
    }
    cut = (lines.pop() as Line).path;
  }
}

function footer(ctx: RenderContext, cut: string[], empty: boolean): string {
  if (empty) return `…${ctx.subject} is too long to show within ${MAX_DETAIL_BYTES} bytes.`;
  // The key just below the requested path that holds the cut.
  const rest = cut.slice(ctx.requested.length).filter((key) => key !== "*");
  const narrower = rest.length > 0 ? showPath([...ctx.requested, rest[0] as string]) : "";
  const hint = narrower
    ? ` Ask for a narrower path, such as "${truncateBytes(narrower, MAX_HINT_BYTES)}".`
    : "";
  return `…cut here to stay within ${MAX_DETAIL_BYTES} bytes.${hint}`;
}
