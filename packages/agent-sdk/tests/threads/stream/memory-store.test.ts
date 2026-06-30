import { InMemoryEventStore } from "../../../src/threads/stream/stores/memory.js";
import { eventStoreConformanceTests } from "./conformance/event-store.conformance.js";

eventStoreConformanceTests("InMemoryEventStore", () => new InMemoryEventStore());
