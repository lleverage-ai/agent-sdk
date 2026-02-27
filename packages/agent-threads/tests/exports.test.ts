import { describe, expect, it } from "vitest";

describe("barrel exports", () => {
  it("root barrel exports stream layer symbols", async () => {
    const mod = await import("../src/index.js");
    expect(mod.Projector).toBeDefined();
    expect(mod.TypedEmitter).toBeDefined();
    expect(mod.InMemoryEventStore).toBeDefined();
    expect(mod.SQLiteEventStore).toBeDefined();
    expect(mod.PROTOCOL_VERSION).toBeDefined();
    expect(mod.PROTOCOL_ERRORS).toBeDefined();
    expect(mod.encodeMessage).toBeDefined();
    expect(mod.decodeMessage).toBeDefined();
    expect(mod.decodeClientMessage).toBeDefined();
    expect(mod.decodeServerMessage).toBeDefined();
    expect(mod.CORE_EVENT_KINDS).toBeDefined();
    expect(mod.EventKindRegistry).toBeDefined();
    expect(mod.WS_READY_STATE).toBeDefined();
    expect(mod.defaultLogger).toBeDefined();
  });

  it("root barrel exports ledger layer symbols", async () => {
    const mod = await import("../src/index.js");
    expect(mod.RunManager).toBeDefined();
    expect(mod.FullContextBuilder).toBeDefined();
    expect(mod.InMemoryLedgerStore).toBeDefined();
    expect(mod.SQLiteLedgerStore).toBeDefined();
    expect(mod.ulid).toBeDefined();
    expect(mod.createCounterIdGenerator).toBeDefined();
    expect(mod.createAccumulatorProjector).toBeDefined();
    expect(mod.accumulateEvents).toBeDefined();
    expect(mod.createAccumulatorProjectorConfig).toBeDefined();
    expect(mod.ACTIVE_RUN_STATUSES).toBeDefined();
    expect(mod.TERMINAL_RUN_STATUSES).toBeDefined();
    expect(mod.isActiveRunStatus).toBeDefined();
    expect(mod.isTerminalRunStatus).toBeDefined();
    expect(mod.DEFAULT_STALE_THRESHOLD_MS).toBeDefined();
    expect(mod.listStaleRuns).toBeDefined();
    expect(mod.recoverAllStaleRuns).toBeDefined();
  });

  it("stream sub-barrel exports all stream symbols", async () => {
    const mod = await import("../src/stream/index.js");
    expect(mod.Projector).toBeDefined();
    expect(mod.InMemoryEventStore).toBeDefined();
    expect(mod.SQLiteEventStore).toBeDefined();
    expect(mod.TypedEmitter).toBeDefined();
    expect(mod.PROTOCOL_VERSION).toBeDefined();
    expect(mod.PROTOCOL_ERRORS).toBeDefined();
    expect(mod.encodeMessage).toBeDefined();
    expect(mod.decodeMessage).toBeDefined();
    expect(mod.decodeClientMessage).toBeDefined();
    expect(mod.decodeServerMessage).toBeDefined();
    expect(mod.CORE_EVENT_KINDS).toBeDefined();
    expect(mod.EventKindRegistry).toBeDefined();
    expect(mod.WS_READY_STATE).toBeDefined();
    expect(mod.defaultLogger).toBeDefined();
  });

  it("ledger sub-barrel exports all ledger symbols", async () => {
    const mod = await import("../src/ledger/index.js");
    expect(mod.RunManager).toBeDefined();
    expect(mod.FullContextBuilder).toBeDefined();
    expect(mod.InMemoryLedgerStore).toBeDefined();
    expect(mod.SQLiteLedgerStore).toBeDefined();
    expect(mod.ulid).toBeDefined();
    expect(mod.createCounterIdGenerator).toBeDefined();
    expect(mod.createAccumulatorProjector).toBeDefined();
    expect(mod.accumulateEvents).toBeDefined();
    expect(mod.ACTIVE_RUN_STATUSES).toBeDefined();
    expect(mod.TERMINAL_RUN_STATUSES).toBeDefined();
    expect(mod.isActiveRunStatus).toBeDefined();
    expect(mod.isTerminalRunStatus).toBeDefined();
    expect(mod.DEFAULT_STALE_THRESHOLD_MS).toBeDefined();
    expect(mod.listStaleRuns).toBeDefined();
    expect(mod.recoverAllStaleRuns).toBeDefined();
  });

  it("server sub-barrel exports WsServer", async () => {
    const mod = await import("../src/stream/server/index.js");
    expect(mod.WsServer).toBeDefined();
  });

  it("client sub-barrel exports WsClient", async () => {
    const mod = await import("../src/stream/client/index.js");
    expect(mod.WsClient).toBeDefined();
  });
});
