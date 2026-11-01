/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as _shared_auth from "../_shared/auth.js";
import type * as _shared_endpoint from "../_shared/endpoint.js";
import type * as _shared_mcp_rules from "../_shared/mcp_rules.js";
import type * as _shared_mcp_transport from "../_shared/mcp_transport.js";
import type * as automations from "../automations.js";
import type * as chat from "../chat.js";
import type * as credentials from "../credentials.js";
import type * as crypto from "../crypto.js";
import type * as decisions from "../decisions.js";
import type * as deployment_probe from "../deployment_probe.js";
import type * as devices from "../devices.js";
import type * as mcp from "../mcp.js";
import type * as memories from "../memories.js";
import type * as projects from "../projects.js";
import type * as providers from "../providers.js";
import type * as starter from "../starter.js";
import type * as threads from "../threads.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  "_shared/auth": typeof _shared_auth;
  "_shared/endpoint": typeof _shared_endpoint;
  "_shared/mcp_rules": typeof _shared_mcp_rules;
  "_shared/mcp_transport": typeof _shared_mcp_transport;
  automations: typeof automations;
  chat: typeof chat;
  credentials: typeof credentials;
  crypto: typeof crypto;
  decisions: typeof decisions;
  deployment_probe: typeof deployment_probe;
  devices: typeof devices;
  mcp: typeof mcp;
  memories: typeof memories;
  projects: typeof projects;
  providers: typeof providers;
  starter: typeof starter;
  threads: typeof threads;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
