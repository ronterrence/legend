export * from "./types.ts";
export * from "./adapter.ts";
export * from "./registry.ts";
export * from "./fixture.ts";
export { providerDefinitions } from "./definitions.ts";

import { providerDefinitions } from "./definitions.ts";
import { ProviderRegistry } from "./registry.ts";

export const providerRegistry = new ProviderRegistry(providerDefinitions);
