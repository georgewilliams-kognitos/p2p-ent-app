/**
 * Parse Kognitos resource name segments from API `name` / `run` / `automation` fields.
 */

export function runShortIdFromRunResourceName(runName: string): string | null {
  const parts = runName.split("/").filter(Boolean);
  const i = parts.indexOf("runs");
  if (i >= 0 && i + 1 < parts.length) return parts[i + 1] ?? null;
  return null;
}

export function automationShortIdFromAutomationResourceName(
  automationName: string,
): string | null {
  const trimmed = automationName.trim();
  if (!trimmed) return null;
  const parts = trimmed.split("/").filter(Boolean);
  const i = parts.indexOf("automations");
  if (i >= 0 && i + 1 < parts.length) return parts[i + 1] ?? null;
  // Workspace GET exception can return `automation` as bare short id (no path segments).
  if (parts.length === 1) return parts[0] ?? null;
  return null;
}

/** Last path segment of `organizations/.../exceptions/{id}`. */
export function exceptionShortIdFromExceptionResourceName(
  exceptionName: string,
): string | null {
  const parts = exceptionName.split("/").filter(Boolean);
  const i = parts.indexOf("exceptions");
  if (i >= 0 && i + 1 < parts.length) return parts[i + 1] ?? null;
  return null;
}

/**
 * Conversation event `name` per OpenAPI:
 * `.../runs/{run}/agents/{agent}/events/{event_id}` — some responses omit `events` or vary casing.
 */
export function agentIdFromEventResourceName(name: string): string | null {
  const t = name.trim();
  if (!t) return null;
  const runAgent = t.match(/\/runs\/[^/]+\/agents\/([^/\s?#]+)(?:\/|$)/);
  if (runAgent?.[1]?.trim()) return runAgent[1].trim();
  const parts = t.split("/").filter(Boolean);
  const i = parts.indexOf("agents");
  if (i >= 0 && i + 1 < parts.length) {
    const id = parts[i + 1]?.trim();
    if (!id) return null;
    if (i + 2 < parts.length && parts[i + 2] === "events") return id;
    if (i >= 1 && parts[i - 1] === "runs") return id;
  }
  const loose = t.match(/\/agents\/([^/\s?#]+)(?:\/|$)/);
  if (loose?.[1]?.trim()) return loose[1].trim();
  return agentIdFromAgentsResourceString(t);
}

/** `agents/{agentId}` (short resource reference from v1Exception.resolver, etc.). */
export function agentIdFromAgentsResourceString(s: string): string | null {
  const t = s.trim();
  if (!t) return null;
  const lower = t.toLowerCase();
  if (!lower.startsWith("agents/")) return null;
  const rest = t.slice("agents/".length).split("/")[0]?.trim();
  return rest || null;
}

/** Best-effort: find `.../agents/{agentId}` in strings (with or without trailing path segment). */
export function guessAgentIdFromJsonBlob(root: unknown, maxDepth = 5): string | null {
  const seen = new Set<unknown>();
  function agentIdFromUrlString(s: string): string | null {
    const m = s.match(/\/agents\/([^/,\s"?]+)(?:\/|\?|$|,|"|'|&)/);
    if (m?.[1]) return m[1];
    return agentIdFromAgentsResourceString(s);
  }
  function walk(node: unknown, depth: number): string | null {
    if (depth > maxDepth || node == null) return null;
    if (typeof node === "string") {
      return agentIdFromUrlString(node);
    }
    if (typeof node !== "object") return null;
    if (seen.has(node)) return null;
    seen.add(node);
    if (Array.isArray(node)) {
      for (const x of node) {
        const g = walk(x, depth + 1);
        if (g) return g;
      }
      return null;
    }
    for (const v of Object.values(node as Record<string, unknown>)) {
      const g = walk(v, depth + 1);
      if (g) return g;
    }
    return null;
  }
  return walk(root, 0);
}
