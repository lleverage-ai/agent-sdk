# Plugin Loading UX Improvements

## Summary

Fixed plugin loading behavior to be more intuitive and eliminated the two-step tool discovery process.

## Changes

### 1. **Default Eager Loading is Now Respected**

**Before:**
- `pluginLoading` defaults to "eager"
- BUT auto threshold (>20 tools) silently overrides this
- Result: Tools not available even with "eager" default

**After:**
- `pluginLoading: "eager"` is always respected (default behavior)
- Auto threshold only affects `search_tools` creation, not loading
- Tools are available immediately by default

**Example:**
```typescript
// Before: >20 tools → tools not loaded (confusing!)
const agent = createAgent({
  model,
  plugins: [pluginWith25Tools],
});

// After: >20 tools → tools loaded eagerly (expected!)
const agent = createAgent({
  model,
  plugins: [pluginWith25Tools],
});
```

### 2. **search_tools Only Created When Needed**

**Before:**
- `search_tools` created even when all tools eagerly loaded
- Clutters toolset with unnecessary meta-tool

**After:**
- `search_tools` created only when:
  - Deferred loading is active (`toolSearch.enabled: "always"`), OR
  - Auto threshold exceeded (many tools available for discovery), OR
  - External MCP servers exist

**Example:**
```typescript
// Few tools, all loaded → no search_tools
const agent = createAgent({
  model,
  plugins: [smallPlugin], // 5 tools
});
// activeTools: tool1, tool2, tool3, tool4, tool5 ✅
// (no search_tools) ✅

// Many tools, all loaded → search_tools for discovery
const agent = createAgent({
  model,
  plugins: [largePlugin], // 50 tools
});
// activeTools: tool1...tool50, search_tools ✅
// (tools loaded, but search_tools helps discover them)
```

### 3. **Auto-Load Tools After Search**

**Before:**
- Agent must call `search_tools({ query: "file", load: true })`
- Two-step process: search then manually load
- Easy to forget `load: true`

**After:**
- Agent calls `search_tools({ query: "file" })`
- Tools automatically loaded and ready to use
- Seamless one-step discovery

**Example:**
```typescript
// Before:
search_tools({ query: "file operations" })
// → Returns: "Found 3 tools: read, write, edit"
// → Tools NOT loaded yet! ❌

search_tools({ query: "file operations", load: true })
// → Returns: "Loaded 3 tools: read, write, edit"
// → Now tools available ✅

// After:
search_tools({ query: "file operations" })
// → Returns: "Found and loaded 3 tools: read, write, edit"
// → Tools automatically available ✅
```

## Behavior Matrix

### Default Behavior (pluginLoading not set)

| Tool Count | toolSearch    | Result                        |
|------------|---------------|-------------------------------|
| ≤20 tools  | auto (default)| Load eager, no search_tools   |
| >20 tools  | auto (default)| Load eager, create search_tools |

### Explicit Configurations

| pluginLoading | toolSearch     | Result                        |
|---------------|----------------|-------------------------------|
| "eager"       | any            | Always load immediately       |
| "lazy"        | any            | use_tools for on-demand       |
| "explicit"    | any            | No auto-registration          |
| (default)     | "never"        | Load eager, no search_tools   |
| (default)     | "always"       | Defer loading, create search_tools |

## Migration Guide

### If You Were Using the Workaround

**Before (workaround):**
```typescript
const agent = createAgent({
  model,
  plugins: [myPlugin],
  pluginLoading: "eager",       // Force eager
  toolSearch: { enabled: "never" }, // Disable search_tools
});
```

**After (natural default):**
```typescript
// Just this! Default behavior now matches expectations
const agent = createAgent({
  model,
  plugins: [myPlugin],
});
```

### If You Want Explicit Deferred Loading

**Use case:** Very large plugin sets (100+ tools)

```typescript
const agent = createAgent({
  model,
  plugins: [plugin1, plugin2, ...many more],
  toolSearch: { enabled: "always" }, // Explicit deferred loading
});
```

### If You Want Custom Threshold

```typescript
const agent = createAgent({
  model,
  plugins: [myPlugins],
  toolSearch: {
    enabled: "auto",
    threshold: 50, // Create search_tools when >50 tools
  },
});
// Tools still loaded eagerly, but search_tools helps discovery
```

## Benefits

1. **Intuitive defaults**: Tools "just work" without configuration
2. **No silent overrides**: Explicit settings are always respected
3. **Seamless discovery**: One-step tool search and load
4. **Clean toolsets**: search_tools only when needed
5. **Better agent UX**: Eliminates bootstrapping problem

## Breaking Changes

### Auto Threshold Behavior

**Old:** Auto threshold triggered deferred loading (tools not loaded)
**New:** Auto threshold only creates search_tools (tools still loaded)

**Impact:** If you relied on auto threshold to defer loading, explicitly set:
```typescript
toolSearch: { enabled: "always" }
```

### search_tools Interface

**Old:** Required `load: true` parameter to load tools
**New:** Auto-loads by default (cleaner interface)

**Impact:** Minimal - old `load: true` still works, just optional now

## Testing

All 13 plugin loading tests updated and passing:
- ✅ Default eager behavior with many tools
- ✅ Explicit eager overrides auto threshold
- ✅ search_tools creation logic
- ✅ Auto-load after search
- ✅ Lazy and explicit modes unchanged
- ✅ Preload plugins work correctly
