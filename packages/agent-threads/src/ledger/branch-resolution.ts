import type {
  BranchSelections,
  CanonicalMessage,
  ForkPoint,
  GetTranscriptOptions,
  RunStatus,
  ThreadTree,
  ThreadTreeNode,
} from "./types.js";

/**
 * Internal message representation used for branch resolution.
 *
 * @internal
 */
export interface ThreadMessageRecord {
  message: CanonicalMessage;
  runId: string;
  order: number;
}

function isCarrier(record: ThreadMessageRecord): boolean {
  return record.message.metadata.isCompactionCarrier === true;
}

function buildChildrenByParent(
  records: ThreadMessageRecord[],
): Map<string | null, ThreadMessageRecord[]> {
  const byParent = new Map<string | null, ThreadMessageRecord[]>();
  for (const record of records) {
    const key = record.message.parentMessageId;
    const children = byParent.get(key) ?? [];
    children.push(record);
    byParent.set(key, children);
  }
  return byParent;
}

/**
 * Looks up the run status for a message's producing run.
 *
 * @throws {Error} If the run status map is missing the given run ID
 */
function getRunStatus(runStatusById: ReadonlyMap<string, RunStatus>, runId: string): RunStatus {
  const status = runStatusById.get(runId);
  if (!status) {
    throw new Error(`Missing run status for runId: ${runId}`);
  }
  return status;
}

/**
 * Active-branch heuristic: prefer the most recently inserted committed
 * non-carrier child. Carriers are annotations, not branches, so they never
 * compete for the active slot. If no conversation children exist, returns
 * `undefined` even if carriers are attached.
 */
function chooseActiveChild(
  children: ThreadMessageRecord[],
  runStatusById: ReadonlyMap<string, RunStatus>,
): ThreadMessageRecord | undefined {
  const conversationChildren = children.filter((child) => !isCarrier(child));
  if (conversationChildren.length === 0) return undefined;
  if (conversationChildren.length === 1) return conversationChildren[0];

  const committedChildren = conversationChildren.filter(
    (child) => getRunStatus(runStatusById, child.runId) === "committed",
  );
  if (committedChildren.length > 0) {
    return committedChildren[committedChildren.length - 1];
  }
  return conversationChildren[conversationChildren.length - 1];
}

/**
 * Validates and normalizes branch selection input.
 */
function parseSelections(branch: GetTranscriptOptions["branch"]): BranchSelections | null {
  if (!branch || branch === "active" || branch === "all") {
    return null;
  }

  const raw = (branch as { selections?: unknown }).selections;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error("Invalid branch selector: expected { selections: Record<string, string> }");
  }

  const selections: Record<string, string> = {};
  for (const [forkMessageId, childMessageId] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof childMessageId !== "string") {
      throw new Error(
        `Invalid branch selector: selection value for "${forkMessageId}" must be a string`,
      );
    }
    selections[forkMessageId] = childMessageId;
  }
  return selections;
}

function chooseChildForParent(
  parentMessageId: string,
  children: ThreadMessageRecord[],
  runStatusById: ReadonlyMap<string, RunStatus>,
  selections: BranchSelections | null,
): ThreadMessageRecord | undefined {
  if (selections) {
    const selectedChildId = selections[parentMessageId];
    if (selectedChildId) {
      const explicit = children.find((child) => child.message.id === selectedChildId);
      if (explicit) return explicit;
      // Deliberate demotion: explicit selection could not be honored, so this
      // fork falls back to standard active-branch selection (no hard failure).
    }
  }
  return chooseActiveChild(children, runStatusById);
}

/**
 * Resolves branch-aware transcript views from a thread message set.
 *
 * Resolution behavior:
 * - `"all"` returns all messages in insertion order
 * - `"active"` returns a single path that prefers committed children at forks
 * - `{ selections }` applies explicit fork choices, then falls back to active
 *
 * Carrier messages (`metadata.isCompactionCarrier === true`) are emitted as
 * annotations on the active path: every visited message has its carrier
 * children appended immediately after it in tree-document order. Carriers
 * never participate in active-child selection or fork detection — they sit
 * alongside the conversation rather than competing with it.
 *
 * Messages whose parent ID is missing from the thread are treated as orphan
 * branch roots and are still traversed to preserve recoverable history.
 *
 * @internal
 */
export function resolveTranscript(
  records: ThreadMessageRecord[],
  runStatusById: ReadonlyMap<string, RunStatus>,
  branch: GetTranscriptOptions["branch"],
): CanonicalMessage[] {
  if (branch === "all") {
    const sortedRecords = [...records].sort((a, b) => a.order - b.order);
    return sortedRecords.map((record) => record.message);
  }

  const selections = parseSelections(branch);
  if (records.length === 0) return [];

  const sortedRecords = [...records].sort((a, b) => a.order - b.order);
  const childrenByParent = buildChildrenByParent(sortedRecords);
  const messageById = new Map(sortedRecords.map((record) => [record.message.id, record] as const));

  const result: ThreadMessageRecord[] = [];
  const visited = new Set<string>();

  const emitCarrierAnnotations = (parentId: string): void => {
    const children = childrenByParent.get(parentId) ?? [];
    const carriers = children
      .filter((child) => isCarrier(child) && !visited.has(child.message.id))
      .sort((a, b) => a.order - b.order);
    for (const carrier of carriers) {
      result.push(carrier);
      visited.add(carrier.message.id);
    }
  };

  const walkFrom = (start: ThreadMessageRecord): void => {
    let current: ThreadMessageRecord | undefined = start;
    while (current && !visited.has(current.message.id)) {
      result.push(current);
      visited.add(current.message.id);

      // Carriers attached to this message travel with the active path.
      emitCarrierAnnotations(current.message.id);

      const children = childrenByParent.get(current.message.id) ?? [];
      if (children.length === 0) break;

      const next = chooseChildForParent(current.message.id, children, runStatusById, selections);
      if (!next || visited.has(next.message.id)) break;
      current = next;
    }
  };

  const rootMessages = childrenByParent.get(null) ?? [];
  // Conversation roots first; carrier roots (extremely unusual) attach as annotations.
  for (const root of rootMessages) {
    if (isCarrier(root)) continue;
    walkFrom(root);
  }

  const orphanParentIds = [...childrenByParent.keys()]
    .filter((parentId): parentId is string => parentId !== null && !messageById.has(parentId))
    .sort((a, b) => {
      const aChildren = childrenByParent.get(a);
      const bChildren = childrenByParent.get(b);
      const aOrder = aChildren?.[0]?.order ?? Number.MAX_SAFE_INTEGER;
      const bOrder = bChildren?.[0]?.order ?? Number.MAX_SAFE_INTEGER;
      return aOrder - bOrder;
    });

  for (const orphanParentId of orphanParentIds) {
    const children = childrenByParent.get(orphanParentId) ?? [];
    const start = chooseChildForParent(orphanParentId, children, runStatusById, selections);
    if (start) {
      walkFrom(start);
    }
  }

  return result.map((record) => record.message);
}

/**
 * Builds lightweight thread tree metadata from thread message records.
 *
 * Fork points are emitted only for non-root parent messages with at least
 * two non-carrier children. Carrier messages do not count toward the
 * branching factor, so a parent whose only "extra" children are summary
 * carriers is not reported as a fork.
 *
 * @internal
 */
export function buildThreadTree(
  records: ThreadMessageRecord[],
  runStatusById: ReadonlyMap<string, RunStatus>,
): ThreadTree {
  if (records.length === 0) {
    return { nodes: [], forkPoints: [] };
  }

  const sortedRecords = [...records].sort((a, b) => a.order - b.order);
  const childrenByParent = buildChildrenByParent(sortedRecords);

  const nodes: ThreadTreeNode[] = sortedRecords.map((record) => ({
    messageId: record.message.id,
    parentMessageId: record.message.parentMessageId,
    role: record.message.role,
    runId: record.runId,
    runStatus: getRunStatus(runStatusById, record.runId),
  }));

  const forkPointsWithOrder: Array<ForkPoint & { order: number }> = [];
  for (const [parentKey, children] of childrenByParent.entries()) {
    const parentMessageId = parentKey;
    if (parentMessageId === null) continue;

    const conversationChildren = children.filter((child) => !isCarrier(child));
    if (conversationChildren.length <= 1) continue;

    const active = chooseActiveChild(conversationChildren, runStatusById);
    if (!active) continue;

    const childIds = conversationChildren.map((child) => child.message.id) as [
      string,
      string,
      ...string[],
    ];
    forkPointsWithOrder.push({
      forkMessageId: parentMessageId,
      children: childIds,
      activeChildId: active.message.id,
      order: conversationChildren[0]!.order,
    });
  }

  forkPointsWithOrder.sort((a, b) => a.order - b.order);
  const forkPoints: ForkPoint[] = forkPointsWithOrder.map(({ order: _order, ...forkPoint }) => ({
    ...forkPoint,
  }));

  return { nodes, forkPoints };
}
