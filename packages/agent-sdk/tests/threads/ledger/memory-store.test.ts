import { InMemoryLedgerStore } from "../../../src/threads/ledger/stores/memory.js";
import { ledgerStoreConformanceTests } from "./conformance/ledger-store.conformance.js";

ledgerStoreConformanceTests("InMemoryLedgerStore", () => new InMemoryLedgerStore());
