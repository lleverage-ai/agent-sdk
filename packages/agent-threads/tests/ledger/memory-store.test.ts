import { InMemoryLedgerStore } from "../../src/ledger/stores/memory.js";
import { ledgerStoreConformanceTests } from "./conformance/ledger-store.conformance.js";

ledgerStoreConformanceTests("InMemoryLedgerStore", () => new InMemoryLedgerStore());
