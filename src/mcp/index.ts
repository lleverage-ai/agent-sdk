/**
 * MCP (Model Context Protocol) integration utilities.
 *
 * This module provides tools for working with MCP servers and plugins,
 * including virtual servers for inline plugin tools.
 *
 * @packageDocumentation
 */

// Environment utilities
export { expandEnvVars } from "./env.js";
export type { MCPManagerOptions } from "./manager.js";
// Manager
export { MCPManager } from "./manager.js";
// Types
export type {
  MCPToolLoadResult,
  MCPToolMetadata,
  MCPToolSource,
} from "./types.js";
export type { JsonSchemaToZodResult } from "./validation.js";

// Validation
export {
  isSchemaEmpty,
  jsonSchemaToZod,
  MCPInputValidationError,
  MCPInputValidator,
} from "./validation.js";
// Virtual Server
export { VirtualMCPServer } from "./virtual-server.js";
