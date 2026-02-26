import { InMemoryEventStore } from "../src/stores/memory.js";
import { eventStoreConformanceTests } from "./conformance/event-store.conformance.js";

eventStoreConformanceTests("InMemoryEventStore", () => new InMemoryEventStore());
