import { createInMemoryStore } from "../../src/store/in-memory.js";
import { runStoreContract } from "../../src/testing/contract.js";

runStoreContract("InMemoryStore", () => createInMemoryStore());
