import "server-only";

import { agentIdFromExceptionResolverRaw } from "./exception-raw-resource-strings";
import {
  getRunRaw,
  KognitosApiError,
  kognitosFetchJson,
  kognitosFetchJsonWithBearerToken,
  kognitosFetchJsonWithPat403Retry,
} from "./client-core";
import {
  agentIdFromEventResourceName,
  guessAgentIdFromJsonBlob,
} from "./kognitos-resource-ids";

function requireOrg(): string {
  const id =
    process.env.KOGNITOS_ORGANIZATION_ID?.trim() ||
    process.env.KOGNITOS_ORG_ID?.trim() ||
    "";
  if (!id) throw new Error("Set KOGNITOS_ORGANIZATION_ID or KOGNITOS_ORG_ID");
  return id;
}

function requireWorkspace(): string {
  const id = process.env.KOGNITOS_WORKSPACE_ID?.trim();
  if (!id) throw new Error("Set KOGNITOS_WORKSPACE_ID");
  return id;
}

function agentIdFromListedEventItem(item: unknown): string | null {
  if (!item || typeof item !== "object") return null;
  const r = item as Record<string, unknown>;
  for (const key of ["name", "resourceName", "resource_name"] as const) {
    const v = r[key];
    if (typeof v === "string") {
      const a = agentIdFromEventResourceName(v);
      if (a) return a;
    }
  }
  return guessAgentIdFromJsonBlob(item, 8);
}

export type WorkspaceExceptionStateFilter =
  | "pending"
  | "archived"
  | "resolved"
  | "non_resolved";

export function listExceptionsFilterExpression(
  state: WorkspaceExceptionStateFilter,
): string {
  switch (state) {
    case "pending":
      return 'state = "PENDING"';
    case "archived":
      return 'state = "ARCHIVED"';
    case "resolved":
      return 'state = "RESOLVED"';
    case "non_resolved":
      return 'NOT state = "RESOLVED"';
    default:
      return 'state = "PENDING"';
  }
}

export async function listWorkspaceExceptions(options: {
  state: WorkspaceExceptionStateFilter;
  pageSize?: number;
  pageToken?: string | null;
}): Promise<Record<string, unknown>> {
  const org = requireOrg();
  const ws = requireWorkspace();
  const pageSize = Math.min(Math.max(options.pageSize ?? 50, 1), 100);
  const params = new URLSearchParams();
  params.set("filter", listExceptionsFilterExpression(options.state));
  params.set("page_size", String(pageSize));
  if (options.pageToken) params.set("page_token", options.pageToken);
  const path = `/api/v1/organizations/${encodeURIComponent(org)}/workspaces/${encodeURIComponent(ws)}/exceptions?${params}`;
  return kognitosFetchJson<Record<string, unknown>>(path);
}

export async function getWorkspaceException(
  exceptionId: string,
): Promise<Record<string, unknown>> {
  const org = requireOrg();
  const ws = requireWorkspace();
  const id = exceptionId.trim();
  if (!id) throw new Error("exceptionId required");
  const path = `/api/v1/organizations/${encodeURIComponent(org)}/workspaces/${encodeURIComponent(ws)}/exceptions/${encodeURIComponent(id)}`;
  return kognitosFetchJson<Record<string, unknown>>(path);
}

/**
 * Resolution thread — Kognitos plugin `exceptions-api.md`:
 * `GET …/automations/{auto}/runs/{run}/exceptions/{exception_id}/events`
 */
export async function listExceptionResolutionEvents(options: {
  automationId: string;
  runId: string;
  exceptionIdShort: string;
  pageSize?: number;
}): Promise<{ raw: Record<string, unknown>; agentIdUsed: string | null }> {
  const org = requireOrg();
  const ws = requireWorkspace();
  const auto = options.automationId.trim();
  const run = options.runId.trim();
  const exc = options.exceptionIdShort.trim();
  if (!auto || !run || !exc) throw new Error("automationId, runId, and exceptionId required");

  const pageSize = Math.min(Math.max(options.pageSize ?? 50, 1), 100);
  const params = new URLSearchParams();
  params.set("page_size", String(pageSize));
  const path = `/api/v1/organizations/${encodeURIComponent(org)}/workspaces/${encodeURIComponent(ws)}/automations/${encodeURIComponent(auto)}/runs/${encodeURIComponent(run)}/exceptions/${encodeURIComponent(exc)}/events?${params}`;
  const raw = await kognitosFetchJsonWithPat403Retry<Record<string, unknown>>(path);
  const ev = raw.events ?? raw.run_events ?? raw.runEvents;
  const normalized =
    Array.isArray(ev) && raw.events === undefined
      ? { ...raw, events: ev }
      : raw;
  const list = (normalized as { events?: unknown[] }).events ?? [];
  let agentIdUsed: string | null = null;
  for (const item of list) {
    const aid = agentIdFromListedEventItem(item);
    if (aid) {
      agentIdUsed = aid;
      break;
    }
  }
  return { raw: normalized as Record<string, unknown>, agentIdUsed };
}

/**
 * OpenAPI: only `user_message` may be set on create; use full exception name when available.
 * @see CreateEvent — POST …/runs/{run_id}/agents/{agent_id}/events
 */
export async function resolveAgentIdForExceptionReply(options: {
  excRaw: Record<string, unknown>;
  automationId: string;
  runId: string;
  exceptionIdShort: string;
}): Promise<string | null> {
  const override = process.env.KOGNITOS_EXCEPTION_AGENT_ID?.trim();
  if (override) return override;

  const resolverRaw = options.excRaw.resolver;
  const resolverKind =
    typeof resolverRaw === "string"
      ? resolverRaw.startsWith("agents/")
        ? "agents_prefix"
        : resolverRaw.startsWith("users/")
          ? "users_prefix"
          : "string_other"
      : "none";
  // #region agent log
  fetch("http://127.0.0.1:7804/ingest/2ccf0569-63ad-4f5f-a128-4a22a784bde3", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Debug-Session-Id": "b0c4b9",
    },
    body: JSON.stringify({
      sessionId: "b0c4b9",
      hypothesisId: "H3",
      location: "workspace-exceptions-api.ts:resolveAgentId:entry",
      message: "resolver_shape",
      data: { resolverKind, exceptionIdShortLen: options.exceptionIdShort.length },
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  // #endregion

  const fromResolver = agentIdFromExceptionResolverRaw(options.excRaw);
  if (fromResolver) return fromResolver;
  const guessed = guessAgentIdFromJsonBlob(options.excRaw, 8);
  if (guessed) return guessed;
  try {
    const { raw, agentIdUsed } = await listExceptionResolutionEvents({
      automationId: options.automationId,
      runId: options.runId,
      exceptionIdShort: options.exceptionIdShort,
      pageSize: 50,
    });
    const list = (raw.events as unknown[]) ?? [];
    const firstName =
      list[0] &&
      typeof list[0] === "object" &&
      typeof (list[0] as { name?: unknown }).name === "string";
    // #region agent log
    fetch("http://127.0.0.1:7804/ingest/2ccf0569-63ad-4f5f-a128-4a22a784bde3", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Debug-Session-Id": "b0c4b9",
      },
      body: JSON.stringify({
        sessionId: "b0c4b9",
        hypothesisId: "H1_H2",
        location: "workspace-exceptions-api.ts:resolveAgentId:afterListExceptionEvents",
        message: "exception_thread_list_result",
        data: {
          eventCount: list.length,
          agentIdUsedFromListFn: Boolean(agentIdUsed),
          firstEventHasStringName: Boolean(firstName),
        },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion
    if (agentIdUsed) return agentIdUsed;
    for (const item of list) {
      const aid = agentIdFromListedEventItem(item);
      if (aid) return aid;
    }
  } catch (e) {
    // #region agent log
    fetch("http://127.0.0.1:7804/ingest/2ccf0569-63ad-4f5f-a128-4a22a784bde3", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Debug-Session-Id": "b0c4b9",
      },
      body: JSON.stringify({
        sessionId: "b0c4b9",
        hypothesisId: "H1_H2",
        location: "workspace-exceptions-api.ts:resolveAgentId:listExceptionEventsCatch",
        message: "exception_thread_list_error",
        data: {
          isKognitosApiError: e instanceof KognitosApiError,
          kognitosStatus: e instanceof KognitosApiError ? e.status : null,
        },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion
    /* list may 404 if thread empty — caller treats unresolved agent */
  }
  try {
    const runRaw = await getRunRaw(options.runId, options.automationId);
    if (runRaw) {
      const fromRun = guessAgentIdFromJsonBlob(runRaw, 10);
      if (fromRun) return fromRun;
    }
  } catch {
    /* ignore */
  }
  try {
    const org = requireOrg();
    const ws = requireWorkspace();
    const auto = options.automationId.trim();
    const run = options.runId.trim();
    const params = new URLSearchParams();
    params.set("page_size", "100");
    const path = `/api/v1/organizations/${encodeURIComponent(org)}/workspaces/${encodeURIComponent(ws)}/automations/${encodeURIComponent(auto)}/runs/${encodeURIComponent(run)}/events?${params}`;
    const raw = await kognitosFetchJsonWithPat403Retry<Record<string, unknown>>(path);
    const runEvents =
      (raw.run_events as unknown[]) ??
      (raw.runEvents as unknown[]) ??
      [];
    for (const item of runEvents) {
      const aid = guessAgentIdFromJsonBlob(item, 10);
      if (aid) return aid;
    }
  } catch {
    /* ignore */
  }
  // #region agent log
  fetch("http://127.0.0.1:7804/ingest/2ccf0569-63ad-4f5f-a128-4a22a784bde3", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Debug-Session-Id": "b0c4b9",
    },
    body: JSON.stringify({
      sessionId: "b0c4b9",
      hypothesisId: "H1_H3_H5",
      location: "workspace-exceptions-api.ts:resolveAgentId:returnNull",
      message: "all_resolution_steps_exhausted",
      data: {},
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  // #endregion
  return null;
}

/**
 * Reply — OpenAPI Create Event:
 * `POST …/automations/{auto}/runs/{run}/agents/{agent}/events`
 * body `{ user_message: { content }, exception? }`.
 */
export async function replyToWorkspaceException(options: {
  automationId: string;
  runId: string;
  agentId: string;
  message: string;
  /** Full resource name `organizations/.../exceptions/{id}` when known (GET exception `name`). */
  exceptionResourceName?: string;
}): Promise<Record<string, unknown>> {
  const org = requireOrg();
  const ws = requireWorkspace();
  const auto = options.automationId.trim();
  const run = options.runId.trim();
  const agent = options.agentId.trim();
  const msg = options.message.trim();
  if (!auto || !run || !agent || !msg) {
    throw new Error("automationId, runId, agentId, and non-empty message required");
  }

  const body: Record<string, unknown> = {
    user_message: { content: msg },
  };
  const exName = options.exceptionResourceName?.trim();
  if (exName) body.exception = exName;

  const path = `/api/v1/organizations/${encodeURIComponent(org)}/workspaces/${encodeURIComponent(ws)}/automations/${encodeURIComponent(auto)}/runs/${encodeURIComponent(run)}/agents/${encodeURIComponent(agent)}/events`;
  const init: RequestInit = {
    method: "POST",
    body: JSON.stringify(body),
  };

  const pat = process.env.KOGNITOS_PAT?.trim();
  const apiKey = process.env.KOGNITOS_API_KEY?.trim();

  try {
    return await kognitosFetchJson<Record<string, unknown>>(path, init);
  } catch (e) {
    if (
      e instanceof KognitosApiError &&
      e.status === 403 &&
      pat &&
      apiKey &&
      pat !== apiKey
    ) {
      return await kognitosFetchJsonWithBearerToken<Record<string, unknown>>(
        path,
        apiKey,
        init,
      );
    }
    throw e;
  }
}
