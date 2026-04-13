/**
 * In-memory vector similarity index using cosine similarity with
 * precomputed L2 norms for fast search.
 *
 * @module
 */

import type { MemoryPath } from "../store/types.js";
import type { MemoryScope } from "../types.js";
import type { VectorIndex, VectorSearchOptions, VectorSearchResult } from "./types.js";

// ---------------------------------------------------------------------------
// Internal entry
// ---------------------------------------------------------------------------

type VectorEntry = {
  embedding: Float32Array;
  norm: number;
  metadata: {
    title: string;
    description: string;
    scope?: MemoryScope;
    projectSlug?: string;
    agentId?: string;
  };
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function computeNorm(v: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < v.length; i++) {
    sum += v[i]! * v[i]!;
  }
  return Math.sqrt(sum);
}

function dotProduct(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    sum += a[i]! * b[i]!;
  }
  return sum;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createInMemoryVectorIndex(): VectorIndex {
  const entries = new Map<string, VectorEntry>();

  return {
    async upsert(
      path: MemoryPath,
      embedding: number[],
      metadata?: {
        title?: string;
        description?: string;
        scope?: MemoryScope;
        projectSlug?: string;
        agentId?: string;
      },
    ): Promise<void> {
      const vec = new Float32Array(embedding);
      const norm = computeNorm(vec);

      entries.set(path, {
        embedding: vec,
        norm,
        metadata: {
          title: metadata?.title ?? "",
          description: metadata?.description ?? "",
          scope: metadata?.scope,
          projectSlug: metadata?.projectSlug,
          agentId: metadata?.agentId,
        },
      });
    },

    async remove(paths: MemoryPath[]): Promise<void> {
      for (const p of paths) {
        entries.delete(p);
      }
    },

    async search(
      queryEmbedding: number[],
      options?: VectorSearchOptions,
    ): Promise<VectorSearchResult[]> {
      const limit = options?.limit ?? 20;
      const minScore = options?.minScore ?? 0;

      const queryVec = new Float32Array(queryEmbedding);
      const queryNorm = computeNorm(queryVec);

      if (queryNorm === 0) {
        return [];
      }

      const results: VectorSearchResult[] = [];

      for (const [path, entry] of entries) {
        // Scope filtering
        if (options?.scope !== undefined && entry.metadata.scope !== options.scope) {
          continue;
        }
        if (
          options?.projectSlug !== undefined &&
          entry.metadata.projectSlug !== options.projectSlug
        ) {
          continue;
        }
        if (options?.agentId !== undefined && entry.metadata.agentId !== options.agentId) {
          continue;
        }

        // Skip zero-norm entries
        if (entry.norm === 0) {
          continue;
        }

        const similarity = dotProduct(queryVec, entry.embedding) / (queryNorm * entry.norm);

        if (similarity >= minScore) {
          results.push({
            path: path as MemoryPath,
            score: similarity,
            title: entry.metadata.title,
            description: entry.metadata.description,
          });
        }
      }

      results.sort((a, b) => b.score - a.score);

      return results.slice(0, limit);
    },
  };
}
