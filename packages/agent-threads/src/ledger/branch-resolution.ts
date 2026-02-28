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

function getRunStatus(runStatusById: ReadonlyMap<string, RunStatus>, runId: string): RunStatus {
  const status = runStatusById.get(runId);
  if (!status) {
    throw new Error(`Missing run status for runId: ${runId}`);
  }
  return status;
}

/**
 * Active-branch heuristic: prefer the most recently inserted committed child.
 * If none are committed, fall back to the most recently inserted child.
 */
function chooseActiveChild(
  children: ThreadMessageRecord[],
  runStatusById: ReadonlyMap<string, RunStatus>,
): ThreadMessageRecord | undefined {
  if (children.length === 0) return undefined;
  if (children.length === 1) return children[0];

  const committedChildren = children.filter(
    (child) => getRunStatus(runStatusById, child.runId) === "committed",
  );
  if (committedChildren.length > 0) {
    return committedChildren[committedChildren.length - 1];
  }
  return children[children.length - 1];
}

function parseSelections(branch: GetTranscriptOptions["branch"]): BranchSelections | null {
  if (!branch || branch === "active" || branch === "all") {
    return null;
  }

  const raw = (branch as { selections?: unknown }).selections;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error("Invalid branch selector: expected { selections: Record<string, string> }");
  }

  const selections: BranchSelections = {};
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
      // Deliberate fallback contract: invalid/missing child selections at a fork
      // fall back to active-branch resolution instead of hard-failing.
    }
  }
  return chooseActiveChild(children, runStatusById);
}

/**
 * Resolves branch-aware transcript views from a thread message set.
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

  const walkFrom = (start: ThreadMessageRecord): void => {
    let current: ThreadMessageRecord | undefined = start;
    while (current && !visited.has(current.message.id)) {
      result.push(current);
      visited.add(current.message.id);

      const children = childrenByParent.get(current.message.id) ?? [];
      if (children.length === 0) break;

      const next = chooseChildForParent(current.message.id, children, runStatusById, selections);
      if (!next || visited.has(next.message.id)) break;
      current = next;
    }
  };

  const rootMessages = childrenByParent.get(null) ?? [];
  for (const root of rootMessages) {
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
    if (parentMessageId === null || children.length <= 1) continue;

    const active = chooseActiveChild(children, runStatusById);
    if (!active) continue;

    forkPointsWithOrder.push({
      forkMessageId: parentMessageId,
      children: children.map((child) => child.message.id),
      activeChildId: active.message.id,
      order: children[0]!.order,
    });
  }

  forkPointsWithOrder.sort((a, b) => a.order - b.order);
  const forkPoints: ForkPoint[] = forkPointsWithOrder.map(({ order: _order, ...forkPoint }) => ({
    ...forkPoint,
  }));

  return { nodes, forkPoints };
}
