/**
 * Composite backend that routes operations to different backends based on path prefixes.
 *
 * CompositeBackend allows you to combine multiple backends, routing operations to
 * the appropriate backend based on the file path. This enables scenarios like:
 * - Memory files from a StateBackend
 * - Persistent files from a PersistentBackend
 * - Real filesystem access for specific directories
 *
 * @example
 * ```typescript
 * const state = createAgentState();
 * const backend = new CompositeBackend(
 *   new StateBackend(state),  // Default for unmatched paths
 *   {
 *     '/memories/': new PersistentBackend({ store }),
 *     '/workspace/': new FilesystemBackend({ rootDir: './workspace' }),
 *   }
 * );
 *
 * // Routes to PersistentBackend
 * await backend.write('/memories/user-prefs.json', '{}');
 *
 * // Routes to FilesystemBackend
 * await backend.read('/workspace/src/index.ts');
 *
 * // Routes to StateBackend (default)
 * await backend.write('/scratch/notes.txt', 'temp notes');
 * ```
 *
 * @packageDocumentation
 */

import type {
  BackendProtocol,
  EditResult,
  FileData,
  FileInfo,
  GrepMatch,
  WriteResult,
} from "../backend.js";

// =============================================================================
// Types
// =============================================================================

/**
 * Configuration for routing paths to backends.
 *
 * Keys are path prefixes (should start with '/' and optionally end with '/').
 * Values are the backends that handle those paths.
 *
 * @example
 * ```typescript
 * const routes: RouteConfig = {
 *   '/memories/': persistentBackend,
 *   '/cache/': stateBackend,
 *   '/project/': filesystemBackend,
 * };
 * ```
 *
 * @category Backend
 */
export type RouteConfig = Record<string, BackendProtocol>;

/**
 * Options for creating a CompositeBackend.
 *
 * @category Backend
 */
export interface CompositeBackendOptions {
  /**
   * The default backend for paths that don't match any route.
   */
  defaultBackend: BackendProtocol;

  /**
   * Route configuration mapping path prefixes to backends.
   */
  routes: RouteConfig;
}

// =============================================================================
// Composite Backend Implementation
// =============================================================================

/**
 * A backend that routes operations to different backends based on path prefixes.
 *
 * Routes are matched by longest-prefix first. For example, if you have routes for
 * `/memories/` and `/memories/archived/`, a path like `/memories/archived/old.txt`
 * will route to the `/memories/archived/` backend.
 *
 * For aggregate operations (glob, grep), results are collected from all backends
 * and merged together.
 *
 * @example
 * ```typescript
 * const backend = new CompositeBackend(
 *   new StateBackend(state),
 *   {
 *     '/memories/': new PersistentBackend({ store }),
 *     '/project/': new FilesystemBackend({ rootDir: './project' }),
 *   }
 * );
 *
 * // Write to different backends based on path
 * await backend.write('/memories/notes.md', '# Notes');  // PersistentBackend
 * await backend.write('/project/src/app.ts', '...');     // FilesystemBackend
 * await backend.write('/temp/scratch.txt', '...');       // StateBackend (default)
 *
 * // Glob across all backends
 * const allFiles = await backend.globInfo('**\/*.ts');
 * ```
 *
 * @category Backend
 */
export class CompositeBackend implements BackendProtocol {
  private readonly defaultBackend: BackendProtocol;
  private readonly routes: Array<{ prefix: string; backend: BackendProtocol }>;

  /**
   * Create a new CompositeBackend.
   *
   * @param defaultBackend - Backend for paths that don't match any route
   * @param routes - Map of path prefixes to backends
   */
  constructor(defaultBackend: BackendProtocol, routes: RouteConfig) {
    this.defaultBackend = defaultBackend;

    // Sort routes by prefix length descending for longest-prefix matching
    this.routes = Object.entries(routes)
      .map(([prefix, backend]) => ({
        prefix: this.normalizePrefix(prefix),
        backend,
      }))
      .sort((a, b) => b.prefix.length - a.prefix.length);
  }

  /**
   * List files and directories at the given path.
   *
   * Routes to the appropriate backend based on path prefix.
   *
   * @param path - Directory path to list
   * @returns Array of file/directory info
   */
  async lsInfo(path: string): Promise<FileInfo[]> {
    const { backend, relativePath } = this.resolveBackend(path);
    const results = await backend.lsInfo(relativePath);

    // Map paths back to composite paths
    const route = this.findMatchingRoute(path);
    if (route) {
      return results.map((info) => ({
        ...info,
        path: this.toCompositePath(info.path, route.prefix),
      }));
    }

    return results;
  }

  /**
   * Read file content with optional line numbers.
   *
   * @param filePath - Path to the file to read
   * @param offset - Starting line offset (0-indexed)
   * @param limit - Maximum number of lines to read
   * @returns Formatted content with line numbers
   */
  async read(filePath: string, offset?: number, limit?: number): Promise<string> {
    const { backend, relativePath } = this.resolveBackend(filePath);
    return backend.read(relativePath, offset, limit);
  }

  /**
   * Read raw file content as FileData.
   *
   * @param filePath - Path to the file to read
   * @returns Raw file data with content and timestamps
   */
  async readRaw(filePath: string): Promise<FileData> {
    const { backend, relativePath } = this.resolveBackend(filePath);
    return backend.readRaw(relativePath);
  }

  /**
   * Search for pattern matches using regex across all backends.
   *
   * Results are aggregated from all backends. Each backend's grep
   * is limited to its own path scope.
   *
   * @param pattern - Regular expression pattern to search for
   * @param path - Directory to search in (defaults to root)
   * @param glob - Glob pattern to filter files
   * @returns Array of matches from all backends
   */
  async grepRaw(pattern: string, path?: string | null, glob?: string | null): Promise<GrepMatch[]> {
    const searchPath = path ?? "/";

    // Collect results from all relevant backends
    const allMatches: GrepMatch[] = [];

    // Check if path targets a specific backend
    const route = this.findMatchingRoute(searchPath);
    if (route) {
      // Single backend search
      const relativePath = this.toRelativePath(searchPath, route.prefix);
      const results = await route.backend.grepRaw(pattern, relativePath, glob);
      const matches = typeof results === "string" ? [] : results;
      allMatches.push(
        ...matches.map((m) => ({
          ...m,
          path: this.toCompositePath(m.path, route.prefix),
        })),
      );
    } else {
      // Search across all backends
      const searchPromises: Promise<GrepMatch[]>[] = [];

      // Search default backend
      searchPromises.push(
        Promise.resolve(this.defaultBackend.grepRaw(pattern, searchPath, glob))
          .then((results) => (typeof results === "string" ? [] : results))
          .catch(() => []),
      );

      // Search each routed backend if the search path is a parent of the route
      for (const { prefix, backend } of this.routes) {
        if (this.isParentPath(searchPath, prefix)) {
          const relativePath = searchPath === "/" ? "/" : this.toRelativePath(prefix, searchPath);
          searchPromises.push(
            Promise.resolve(backend.grepRaw(pattern, relativePath, glob))
              .then((results) => (typeof results === "string" ? [] : results))
              .then((matches) =>
                matches.map((m) => ({
                  ...m,
                  path: this.toCompositePath(m.path, prefix),
                })),
              )
              .catch(() => []),
          );
        }
      }

      const allResults = await Promise.all(searchPromises);
      for (const results of allResults) {
        allMatches.push(...results);
      }
    }

    return allMatches;
  }

  /**
   * Find files matching a glob pattern across all backends.
   *
   * Results are aggregated from all backends that could contain
   * matching files.
   *
   * @param pattern - Glob pattern
   * @param path - Base directory for the search
   * @returns Array of matching file info from all backends
   */
  async globInfo(pattern: string, path?: string): Promise<FileInfo[]> {
    const searchPath = path ?? "/";

    // Collect results from all relevant backends
    const allFiles: FileInfo[] = [];

    // Check if path targets a specific backend
    const route = this.findMatchingRoute(searchPath);
    if (route) {
      // Single backend search
      const relativePath = this.toRelativePath(searchPath, route.prefix);
      const results = await route.backend.globInfo(pattern, relativePath);
      allFiles.push(
        ...results.map((f) => ({
          ...f,
          path: this.toCompositePath(f.path, route.prefix),
        })),
      );
    } else {
      // Search across all backends
      const searchPromises: Promise<FileInfo[]>[] = [];

      // Search default backend
      searchPromises.push(
        Promise.resolve(this.defaultBackend.globInfo(pattern, searchPath)).catch(() => []),
      );

      // Search each routed backend if the search path is a parent of the route
      for (const { prefix, backend } of this.routes) {
        if (this.isParentPath(searchPath, prefix)) {
          searchPromises.push(
            Promise.resolve(backend.globInfo(pattern, "/"))
              .then((files) =>
                files.map((f) => ({
                  ...f,
                  path: this.toCompositePath(f.path, prefix),
                })),
              )
              .catch(() => []),
          );
        }
      }

      const allResults = await Promise.all(searchPromises);
      for (const results of allResults) {
        allFiles.push(...results);
      }
    }

    return allFiles;
  }

  /**
   * Create or overwrite a file.
   *
   * Routes to the appropriate backend based on path prefix.
   *
   * @param filePath - Path for the new file
   * @param content - Content to write
   * @returns Result indicating success or failure
   */
  async write(filePath: string, content: string): Promise<WriteResult> {
    const { backend, relativePath } = this.resolveBackend(filePath);
    const result = await backend.write(relativePath, content);

    // Map the path back if needed
    if (result.path) {
      const route = this.findMatchingRoute(filePath);
      if (route) {
        result.path = this.toCompositePath(result.path, route.prefix);
      }
    }

    return result;
  }

  /**
   * Edit a file by replacing text.
   *
   * Routes to the appropriate backend based on path prefix.
   *
   * @param filePath - Path to the file to edit
   * @param oldString - Text to find and replace
   * @param newString - Replacement text
   * @param replaceAll - If true, replace all occurrences
   * @returns Result indicating success or failure
   */
  async edit(
    filePath: string,
    oldString: string,
    newString: string,
    replaceAll?: boolean,
  ): Promise<EditResult> {
    const { backend, relativePath } = this.resolveBackend(filePath);
    const result = await backend.edit(relativePath, oldString, newString, replaceAll);

    // Map the path back if needed
    if (result.path) {
      const route = this.findMatchingRoute(filePath);
      if (route) {
        result.path = this.toCompositePath(result.path, route.prefix);
      }
    }

    return result;
  }

  // ===========================================================================
  // Public Utility Methods
  // ===========================================================================

  /**
   * Get the backend that handles a specific path.
   *
   * Useful for debugging or when you need direct access to a specific backend.
   *
   * @param path - Path to check
   * @returns The backend that handles this path
   */
  getBackendForPath(path: string): BackendProtocol {
    return this.resolveBackend(path).backend;
  }

  /**
   * Get all configured routes.
   *
   * @returns Array of route configurations sorted by prefix length (longest first)
   */
  getRoutes(): Array<{ prefix: string; backend: BackendProtocol }> {
    return [...this.routes];
  }

  /**
   * Get the default backend.
   *
   * @returns The default backend for unmatched paths
   */
  getDefaultBackend(): BackendProtocol {
    return this.defaultBackend;
  }

  // ===========================================================================
  // Private Helpers
  // ===========================================================================

  /**
   * Normalize a route prefix.
   * @internal
   */
  private normalizePrefix(prefix: string): string {
    let normalized = prefix.startsWith("/") ? prefix : `/${prefix}`;
    if (!normalized.endsWith("/")) {
      normalized += "/";
    }
    return normalized;
  }

  /**
   * Normalize a path.
   * @internal
   */
  private normalizePath(path: string): string {
    let normalized = path.startsWith("/") ? path : `/${path}`;
    // Collapse multiple slashes
    normalized = normalized.replace(/\/+/g, "/");
    return normalized;
  }

  /**
   * Find the matching route for a path using longest-prefix matching.
   * @internal
   */
  private findMatchingRoute(
    path: string,
  ): { prefix: string; backend: BackendProtocol } | undefined {
    const normalizedPath = this.normalizePath(path);
    // Ensure we match with trailing slash for prefix matching
    const pathWithSlash = normalizedPath.endsWith("/") ? normalizedPath : `${normalizedPath}/`;

    // Routes are already sorted by length descending
    for (const route of this.routes) {
      if (pathWithSlash.startsWith(route.prefix) || normalizedPath === route.prefix.slice(0, -1)) {
        return route;
      }
    }

    return undefined;
  }

  /**
   * Resolve which backend handles a path and return the relative path.
   * @internal
   */
  private resolveBackend(path: string): {
    backend: BackendProtocol;
    relativePath: string;
  } {
    const route = this.findMatchingRoute(path);

    if (route) {
      return {
        backend: route.backend,
        relativePath: this.toRelativePath(path, route.prefix),
      };
    }

    return {
      backend: this.defaultBackend,
      relativePath: this.normalizePath(path),
    };
  }

  /**
   * Convert a composite path to a relative path for the backend.
   * @internal
   */
  private toRelativePath(compositePath: string, prefix: string): string {
    const normalizedPath = this.normalizePath(compositePath);

    // If path equals prefix (without trailing slash), return root
    if (normalizedPath === prefix.slice(0, -1)) {
      return "/";
    }

    // Remove the prefix
    if (normalizedPath.startsWith(prefix)) {
      const relative = normalizedPath.slice(prefix.length);
      return relative.startsWith("/") ? relative : `/${relative}`;
    }

    // Path doesn't start with prefix, return as-is
    return normalizedPath;
  }

  /**
   * Convert a backend-relative path to a composite path.
   * @internal
   */
  private toCompositePath(relativePath: string, prefix: string): string {
    const normalizedRelative = this.normalizePath(relativePath);

    // If relative path is root, return prefix without trailing slash
    if (normalizedRelative === "/") {
      return prefix.slice(0, -1);
    }

    // Combine prefix and relative path
    const combined = prefix + normalizedRelative.slice(1);
    return combined;
  }

  /**
   * Check if parentPath is a parent of (or equal to) childPath.
   * @internal
   */
  private isParentPath(parentPath: string, childPath: string): boolean {
    const normalizedParent = this.normalizePath(parentPath);
    const normalizedChild = this.normalizePath(childPath);

    // Root is parent of everything
    if (normalizedParent === "/") {
      return true;
    }

    // Check if child starts with parent
    const parentWithSlash = normalizedParent.endsWith("/")
      ? normalizedParent
      : `${normalizedParent}/`;

    return normalizedChild.startsWith(parentWithSlash) || normalizedChild === normalizedParent;
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a CompositeBackend from options.
 *
 * @param options - Configuration options
 * @returns A new CompositeBackend
 *
 * @example
 * ```typescript
 * const backend = createCompositeBackend({
 *   defaultBackend: new StateBackend(state),
 *   routes: {
 *     '/memories/': persistentBackend,
 *     '/workspace/': filesystemBackend,
 *   },
 * });
 * ```
 *
 * @category Backend
 */
export function createCompositeBackend(options: CompositeBackendOptions): CompositeBackend {
  return new CompositeBackend(options.defaultBackend, options.routes);
}
