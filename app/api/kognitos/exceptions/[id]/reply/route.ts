import { appendFile } from "node:fs/promises";
import { join } from "node:path";
import { NextResponse } from "next/server";

import {
  automationResourceStringFromExceptionRaw,
  runResourceStringFromExceptionRaw,
} from "@/lib/kognitos/exception-raw-resource-strings";
import {
  automationShortIdFromAutomationResourceName,
  exceptionShortIdFromExceptionResourceName,
  runShortIdFromRunResourceName,
} from "@/lib/kognitos/kognitos-resource-ids";
import { KognitosApiError } from "@/lib/kognitos/client-core";
import { mapCreateEventResponseToAck } from "@/lib/kognitos/exception-view-model";
import {
  getWorkspaceException,
  replyToWorkspaceException,
  resolveAgentIdForExceptionReply,
} from "@/lib/kognitos/workspace-exceptions-api";
async function appendDebugSessionLine(payload: Record<string, unknown>) {
  try {
    await appendFile(
      join(process.cwd(), ".cursor", "debug-b999a8.log"),
      `${JSON.stringify({
        sessionId: "b999a8",
        timestamp: Date.now(),
        ...payload,
      })}\n`,
    );
  } catch {
    /* ignore */
  }
}

function kognitosEnvReady(): boolean {
  return Boolean(
    process.env.KOGNITOS_BASE_URL?.trim() &&
      (process.env.KOGNITOS_API_KEY || process.env.KOGNITOS_PAT) &&
      (process.env.KOGNITOS_ORGANIZATION_ID || process.env.KOGNITOS_ORG_ID) &&
      process.env.KOGNITOS_WORKSPACE_ID?.trim(),
  );
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  if (!kognitosEnvReady()) {
    return NextResponse.json({ error: "kognitos_env_missing" }, { status: 503 });
  }

  const { id } = await context.params;
  const exceptionId = decodeURIComponent(id ?? "").trim();
  if (!exceptionId) {
    return NextResponse.json({ error: "missing_id" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const msg =
    typeof body === "object" &&
    body !== null &&
    typeof (body as { message?: unknown }).message === "string"
      ? (body as { message: string }).message.trim()
      : "";
  if (!msg) {
    return NextResponse.json({ error: "message_required" }, { status: 400 });
  }

  let excRaw: Record<string, unknown>;
  try {
    excRaw = await getWorkspaceException(exceptionId);
  } catch (e) {
    const err = e instanceof Error ? e.message : "kognitos_request_failed";
    return NextResponse.json({ error: err }, { status: 502 });
  }

  const runRes = runResourceStringFromExceptionRaw(excRaw) ?? "";
  const autoRes = automationResourceStringFromExceptionRaw(excRaw) ?? "";

  const runId = runRes ? runShortIdFromRunResourceName(runRes) : null;
  const automationId = autoRes
    ? automationShortIdFromAutomationResourceName(autoRes)
    : null;
  if (!runId || !automationId) {
    return NextResponse.json(
      { error: "exception_missing_run_or_automation" },
      { status: 422 },
    );
  }

  const exceptionRef =
    typeof excRaw.name === "string" && excRaw.name.trim()
      ? excRaw.name.trim()
      : exceptionId;
  const exceptionIdForReply =
    exceptionShortIdFromExceptionResourceName(exceptionRef) ?? exceptionId;

  // #region agent log
  fetch("http://127.0.0.1:7804/ingest/2ccf0569-63ad-4f5f-a128-4a22a784bde3", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Debug-Session-Id": "b0c4b9",
    },
    body: JSON.stringify({
      sessionId: "b0c4b9",
      hypothesisId: "H2_H5",
      location: "exceptions/[id]/reply/route.ts:preResolve",
      message: "reply_context",
      data: {
        exceptionIdForReplyLen: exceptionIdForReply.length,
        runIdLen: runId.length,
        automationIdLen: automationId.length,
        hasFullExceptionName: Boolean(
          typeof excRaw.name === "string" && excRaw.name.includes("/exceptions/"),
        ),
      },
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  // #endregion

  const agentId = await resolveAgentIdForExceptionReply({
    excRaw,
    automationId,
    runId,
    exceptionIdShort: exceptionIdForReply,
  });
  // #region agent log
  fetch("http://127.0.0.1:7804/ingest/2ccf0569-63ad-4f5f-a128-4a22a784bde3", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Debug-Session-Id": "b0c4b9",
    },
    body: JSON.stringify({
      sessionId: "b0c4b9",
      hypothesisId: "H1_H3_H4",
      location: "exceptions/[id]/reply/route.ts:postResolve",
      message: "agent_resolve_result",
      data: { resolved: Boolean(agentId), agentIdSuffixLen: agentId?.length ?? 0 },
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  // #endregion
  if (!agentId) {
    // #region agent log
    fetch("http://127.0.0.1:7804/ingest/2ccf0569-63ad-4f5f-a128-4a22a784bde3", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Debug-Session-Id": "b0c4b9",
      },
      body: JSON.stringify({
        sessionId: "b0c4b9",
        hypothesisId: "H1_H3",
        location: "exceptions/[id]/reply/route.ts:agent_unresolved",
        message: "early_exit_422",
        data: { code: "agent_id_unresolved" },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion
    return NextResponse.json(
      {
        error: "Could not determine agent for this exception thread",
        code: "agent_id_unresolved",
      },
      { status: 422 },
    );
  }

  const exceptionResourceName =
    typeof excRaw.name === "string" &&
    excRaw.name.trim() &&
    excRaw.name.includes("/exceptions/")
      ? excRaw.name.trim()
      : undefined;

  try {
    const createEventRaw = await replyToWorkspaceException({
      automationId,
      runId,
      agentId,
      message: msg,
      exceptionResourceName,
    });
    const ack = mapCreateEventResponseToAck(createEventRaw);
    await appendDebugSessionLine({
      location: "exceptions/[id]/reply/route.ts:success",
      message: "exception_reply_ok",
      data: { exceptionIdLen: exceptionId.length },
    });
    // #region agent log
    fetch("http://127.0.0.1:7804/ingest/2ccf0569-63ad-4f5f-a128-4a22a784bde3", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Debug-Session-Id": "b0c4b9",
      },
      body: JSON.stringify({
        sessionId: "b0c4b9",
        hypothesisId: "H4",
        location: "exceptions/[id]/reply/route.ts:create_event_ok",
        message: "reply_success",
        data: {},
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion
    return NextResponse.json({ ok: true, ack });
  } catch (e) {
    await appendDebugSessionLine({
      location: "exceptions/[id]/reply/route.ts:catch",
      message: "exception_reply_error",
      data: {
        errType: e instanceof KognitosApiError ? "KognitosApiError" : "Error",
        kognitosStatus: e instanceof KognitosApiError ? e.status : null,
        errPreview: (e instanceof Error ? e.message : String(e)).slice(0, 900),
        bodySnippet:
          e instanceof KognitosApiError
            ? e.bodySnippet?.slice(0, 600)
            : undefined,
      },
    });
    // #region agent log
    fetch("http://127.0.0.1:7804/ingest/2ccf0569-63ad-4f5f-a128-4a22a784bde3", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Debug-Session-Id": "b0c4b9",
      },
      body: JSON.stringify({
        sessionId: "b0c4b9",
        hypothesisId: "H4",
        location: "exceptions/[id]/reply/route.ts:create_event_fail",
        message: "reply_catch",
        data: {
          isKognitosApiError: e instanceof KognitosApiError,
          kognitosStatus: e instanceof KognitosApiError ? e.status : null,
        },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion
    if (e instanceof KognitosApiError) {
      const upstream = e.status;
      const clientStatus =
        upstream === 401 || upstream === 403
          ? 502
          : upstream >= 400 && upstream < 600
            ? upstream
            : 502;
      if (upstream === 403) {
        return NextResponse.json(
          {
            error: e.message,
            code: "kognitos_forbidden",
            kognitosStatus: upstream,
            bodySnippet: e.bodySnippet?.slice(0, 800),
            hint:
              "Kognitos returned 403 Forbidden on Create Event (POST …/agents/…/events) — the bearer token is not allowed. When KOGNITOS_PAT and KOGNITOS_API_KEY are both set and differ, the app retries once with the API key after a PAT 403. Use a credential that can post user messages to the run agent, unset KOGNITOS_PAT to use only the API key, or confirm org/workspace membership and roles.",
          },
          { status: clientStatus },
        );
      }
      return NextResponse.json(
        {
          error: e.message,
          code: "kognitos_api_error",
          kognitosStatus: upstream,
          bodySnippet: e.bodySnippet?.slice(0, 800),
        },
        { status: clientStatus },
      );
    }
    const err = e instanceof Error ? e.message : "reply_failed";
    return NextResponse.json({ error: err }, { status: 502 });
  }
}
