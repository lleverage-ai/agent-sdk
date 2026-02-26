import { InMemoryLedgerStore } from "../src/stores/memory.js";
import { ledgerStoreConformanceTests } from "./conformance/ledger-store.conformance.js";

ledgerStoreConformanceTests("InMemoryLedgerStore", () => new InMemoryLedgerStore());
