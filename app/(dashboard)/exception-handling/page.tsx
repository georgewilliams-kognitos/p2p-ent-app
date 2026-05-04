"use client";

import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { formatDistanceToNow } from "date-fns";
import {
  CheckCircle2,
  ChevronRight,
  Copy,
  ExternalLink,
  FileText,
  Filter,
  Loader2,
  Mail,
  MoreHorizontal,
  RefreshCw,
  Send,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import type {
  CreateEventAckDto,
  ExceptionDetailBundleDto,
  ExceptionDetailDto,
  ExceptionEventDto,
  ExceptionStateUi,
  ExceptionSummaryDto,
} from "@/lib/kognitos/exception-view-model";
import { cn } from "@/lib/utils";

type StateFilterParam =
  | "pending"
  | "archived"
  | "resolved"
  | "non_resolved";

function formatReplyAckLine(ack: CreateEventAckDto): string {
  const bits: string[] = ["Message received by Kognitos."];
  if (ack.eventState) bits.push(`Event state: ${ack.eventState}.`);
  if (ack.createTime) bits.push(`Recorded ${ack.createTime}.`);
  return bits.join(" ");
}

const STATE_TABS: { value: StateFilterParam; label: string }[] = [
  { value: "pending", label: "Needs review" },
  { value: "resolved", label: "Resolved" },
  { value: "archived", label: "Archived" },
  { value: "non_resolved", label: "All non-resolved" },
];

function statePillClass(s: ExceptionStateUi): string {
  if (s === "PENDING")
    return "border-app-amber/25 bg-app-amber-bg text-app-amber-text border";
  if (s === "ARCHIVED")
    return "border-app-border bg-app-slate-bg text-app-text-muted border";
  if (s === "RESOLVED")
    return "border-app-green-border/60 bg-app-green-bg text-[color:var(--app-green)] border";
  return "border-app-border bg-app-slate-bg text-app-text-secondary border";
}

function stateDotClass(s: ExceptionStateUi): string {
  if (s === "PENDING") return "bg-[#F59E0B]";
  if (s === "RESOLVED") return "bg-app-green";
  if (s === "ARCHIVED") return "bg-app-slate";
  return "bg-navy-700/40";
}

function stateVisibleLabel(s: ExceptionStateUi): string {
  if (s === "PENDING") return "Needs review";
  if (s === "RESOLVED") return "Resolved";
  if (s === "ARCHIVED") return "Archived";
  return "Unknown";
}

function looksLikeOpaqueId(s: string): boolean {
  const t = s.trim();
  if (t.length < 16) return false;
  return /^[A-Za-z0-9_-]+$/.test(t);
}

function isFriendlyAutomationDisplayName(
  displayName: string | null | undefined,
  automationId: string,
): boolean {
  if (!displayName?.trim()) return false;
  const d = displayName.trim();
  if (d === automationId.trim()) return false;
  if (looksLikeOpaqueId(d)) return false;
  return true;
}

type ConciseTitleInput = {
  title: string;
  descriptionFull?: string | null;
  groupLabel?: string;
};

function clipTitleAtWord(s: string, max: number): string {
  const t = s.trim();
  if (t.length <= max) return t;
  const slice = t.slice(0, max);
  const lastSpace = slice.lastIndexOf(" ");
  const cut = lastSpace > max * 0.45 ? lastSpace : max;
  return `${t.slice(0, cut).trim()}…`;
}

/** Presentation-only short title for list and inspector (does not change API data). */
function exceptionConciseTitle(input: ConciseTitleInput): string {
  const title = input.title.trim();
  const hay = `${title}\n${input.descriptionFull ?? ""}\n${input.groupLabel ?? ""}`.toLowerCase();

  if (
    (/invoice\s*pdf|\bpdf\b/i.test(hay) && /purchase\s*order|\bpo\b|p\.o\./i.test(hay)) ||
    /missing\s+po\s+number\s+in/i.test(hay)
  ) {
    return "Missing PO number in invoice PDF";
  }
  if (/unable\s+to\s+create\s+invoice\s+line|invoice\s+line\s+items?/i.test(hay)) {
    return "Unable to create invoice line items";
  }
  if (/unable\s+to\s+process\s+(the\s+)?purchase\s*order|process\s+(the\s+)?purchase\s*order/i.test(hay)) {
    return "Unable to process purchase order";
  }
  if (/purchase\s*order\s+item\s+data|item\s+data.*purchase\s*order|missing.*item\s+data/i.test(hay)) {
    return "Missing purchase order item data";
  }
  if (
    /missing\s+(the\s+)?purchase\s*order\s+number|missing\s+po\s+number\b|purchase\s*order\s+number\s+is\s+missing|no\s+purchase\s*order\s+number\b/i.test(
      hay,
    ) &&
    !/purchase\s*order\s+items?/i.test(hay)
  ) {
    return "Missing purchase order number";
  }
  if (
    /purchase\s*order|p\.o\.|\bpo\b/i.test(hay) &&
    /supplier\s*invoice|unable to build|invoice cannot|no purchase order|purchase order items|line items|were not found|not found/i.test(
      hay,
    )
  ) {
    return "Missing purchase order items";
  }

  const runOn =
    title.length > 56 ||
    /^unable to .{25,}/i.test(title) ||
    (title.includes(" because ") && title.length > 48);

  if (!runOn && title.length > 0) return title;

  const beforeBecause = title.match(/^(unable to [^\n]+?)(?=\s+because\b)/i);
  if (beforeBecause?.[1]) {
    const seg = beforeBecause[1].trim();
    if (seg.length >= 14 && seg.length <= 58) return seg;
    if (seg.length > 58) return clipTitleAtWord(seg, 56);
    if (seg.length >= 10) return seg;
  }

  if (title.length > 56) return clipTitleAtWord(title, 56);
  return title || "Exception";
}

function sentenceTooCloseToConcise(s: string, concise: string): boolean {
  const a = s.toLowerCase().replace(/\s+/g, " ").trim();
  const b = concise.toLowerCase().replace(/\s+/g, " ").trim();
  if (!a || !b) return false;
  if (a === b) return true;
  const pref = b.slice(0, Math.min(36, b.length));
  if (pref.length > 10 && a.startsWith(pref.slice(0, Math.min(20, pref.length)))) return true;
  if (pref.length > 10 && b.startsWith(a.slice(0, Math.min(24, a.length)))) return true;
  return false;
}

function cardLeadingIcon(row: ExceptionSummaryDto) {
  const g = row.groupLabel.toLowerCase();
  if (g.includes("mail") || g.includes("email")) return Mail;
  return FileText;
}

function filterSummaries(
  list: ExceptionSummaryDto[],
  query: string,
): ExceptionSummaryDto[] {
  const q = query.trim().toLowerCase();
  if (!q) return list;
  return list.filter((row) => {
    const hay = [
      row.title,
      row.groupLabel,
      row.automationId,
      row.automationDisplayName ?? "",
      row.exceptionId,
    ]
      .join("\n")
      .toLowerCase();
    return hay.includes(q);
  });
}

function firstParagraph(text: string): string {
  const t = text.trim();
  if (!t) return "";
  const para = t.split(/\n\s*\n/)[0] ?? t;
  return para.split("\n")[0]?.trim() ?? t;
}

function sentencesFromParagraph(p: string): string[] {
  return p
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function headerBusinessImpact(ex: ExceptionDetailDto): string {
  const concise = exceptionConciseTitle({
    title: ex.title,
    descriptionFull: ex.descriptionFull,
    groupLabel: ex.groupLabel,
  });
  const raw = ex.descriptionFull?.trim();
  if (!raw) {
    return "Resolve this issue so the automation can continue processing related work.";
  }
  const p1 = firstParagraph(raw);
  const sents = sentencesFromParagraph(p1);

  const score = (s: string) => {
    let sc = 0;
    if (/because|cannot|unable to|missing|failed to|no \w+ found|without a\b/i.test(s)) sc += 3;
    if (/\b(invoice|supplier|customer|payment|order|po)\b/i.test(s)) sc += 1;
    return sc;
  };

  const candidates = [...sents].sort((a, b) => score(b) - score(a));
  for (const s of candidates) {
    if (sentenceTooCloseToConcise(s, concise)) continue;
    return s.length > 280 ? `${s.slice(0, 280)}…` : s;
  }
  for (const s of sents) {
    if (!sentenceTooCloseToConcise(s, concise)) {
      return s.length > 240 ? `${s.slice(0, 240)}…` : s;
    }
  }
  if (p1.toLowerCase() !== concise.toLowerCase() && !sentenceTooCloseToConcise(p1, concise)) {
    return p1.length > 240 ? `${p1.slice(0, 240)}…` : p1;
  }
  return "Resolve this issue so the automation can continue processing related work.";
}

function whatHappenedOperational(ex: ExceptionDetailDto): string {
  const raw = ex.descriptionFull?.trim();
  if (!raw) {
    return "No operational narrative was stored for this exception beyond the summary above.";
  }
  const concise = exceptionConciseTitle({
    title: ex.title,
    descriptionFull: ex.descriptionFull,
    groupLabel: ex.groupLabel,
  });
  const impact = headerBusinessImpact(ex).replace(/…$/, "").trim();
  const hay = `${raw} ${ex.title}`.toLowerCase();
  const poFamilyTitles = new Set([
    "Missing purchase order items",
    "Missing purchase order number",
    "Missing purchase order item data",
    "Missing PO number in invoice PDF",
    "Unable to create invoice line items",
    "Unable to process purchase order",
  ]);
  const poCtx =
    poFamilyTitles.has(concise) ||
    (/purchase\s*order|\bpo\b|p\.o\./i.test(hay) &&
      /supplier\s*invoice|unable to build|invoice|line items/i.test(hay));

  function overlapsLayer(s: string): boolean {
    const t = s.trim();
    if (!t) return true;
    if (sentenceTooCloseToConcise(t, concise)) return true;
    if (impact.length > 16) {
      const ip = impact.slice(0, Math.min(56, impact.length)).toLowerCase();
      if (t.toLowerCase().includes(ip)) return true;
    }
    return false;
  }

  const paras = raw.split(/\n\s*\n/).map((x) => x.trim()).filter(Boolean);
  if (paras.length >= 2) {
    const body = paras.slice(1).join("\n\n");
    if (!overlapsLayer(body)) {
      return body.length > 900 ? `${body.slice(0, 900)}…` : body;
    }
  }
  const p1 = paras[0] ?? raw;
  const sents = sentencesFromParagraph(p1);
  const rest = sents.filter((s) => !overlapsLayer(s));
  if (rest.length) {
    const out = rest.join(" ");
    return out.length > 900 ? `${out.slice(0, 900)}…` : out;
  }
  if (poCtx) {
    if (concise === "Missing purchase order number" || concise === "Missing PO number in invoice PDF") {
      return "The automation could not proceed because a valid purchase order number was not available in the inputs for this step.";
    }
    if (concise === "Unable to create invoice line items") {
      return "The automation could not derive invoice line rows from the current purchase order and invoice inputs.";
    }
    if (concise === "Unable to process purchase order") {
      return "The automation halted while processing the purchase order with the data and rules currently in scope.";
    }
    if (concise === "Missing purchase order item data") {
      return "Required purchase order item fields were missing or incomplete, so the step could not continue.";
    }
    if (concise === "Missing purchase order items") {
      return "The automation stopped at this step because the required purchase order line items were not available in scope.";
    }
    return "The automation stopped at this step because purchase-order-related inputs did not satisfy the rules for this step.";
  }
  return "The automation stopped at this step based on the rules and inputs in scope. Adjust the data or guidance, then retry once corrected.";
}

function suggestedGuidanceFromException(description: string | null): string {
  const base = description?.trim();
  if (base) {
    return base.length > 500 ? `${base.slice(0, 500)}…` : base;
  }
  return "Please validate recipient data and retry the step once corrected.";
}

/** Prescriptive next step — does not repeat the raw error paragraph. */
function recommendedActionCopy(ex: ExceptionDetailDto): string {
  const desc = (ex.descriptionFull ?? "").toLowerCase();
  const title = ex.title.toLowerCase();
  const hay = `${desc} ${title}`;
  if (/purchase\s*order|\bpo\b|p\.o\./i.test(hay)) {
    return "Provide the correct purchase order number, or confirm that this invoice should be processed without a PO. Once provided, the agent can continue.";
  }
  if (/missing|required field|invalid.?value|not found|unknown recipient/i.test(hay)) {
    return "Identify the missing or invalid field, correct it in source data or confirm the intended value, then tell the agent exactly what to use so the step can be retried safely.";
  }
  if (/timeout|timed out|unavailable|503|502|connection/i.test(hay)) {
    return "Confirm whether the failure was transient. If so, retry after a short wait; if not, specify an alternate path or data source so the agent can continue without repeating the same failure.";
  }
  return "State the concrete correction or decision the agent should apply, then send guidance so the resolution agent can continue without guessing.";
}

function neutralMetaPillClass() {
  return cn(
    "max-w-full truncate rounded-[10px] border border-app-border bg-app-slate-bg px-2 py-0.5",
    "text-app-text-secondary text-[12px] font-normal leading-tight",
  );
}

function byteLocationFromDisplay(display: string): string | null {
  const t = display.trim();
  if (!t || t === "—") return null;
  return /^bytes\s/i.test(t) ? t : null;
}

function rawLocationForTechnical(display: string): string | null {
  const t = display.trim();
  if (!t || t === "—") return null;
  return /^bytes\s/i.test(t) ? null : t;
}

function tracebackFromExtra(extra: Record<string, string>): string | null {
  const hits: string[] = [];
  for (const [k, v] of Object.entries(extra)) {
    const kl = k.toLowerCase();
    if (/trace|stack|tb|error|exception|cause|detail/i.test(kl)) {
      hits.push(`${k}\n${v}`);
    }
  }
  if (hits.length) return hits.join("\n\n");
  return null;
}

async function copyToClipboard(value: string) {
  try {
    await navigator.clipboard.writeText(value);
  } catch {
    /* ignore */
  }
}

function TechField({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  if (!value.trim()) return null;
  const showCopy = value.trim() !== "—";
  return (
    <div className="min-w-0">
      <div className="text-app-text-secondary flex flex-wrap items-center justify-between gap-2 font-sans text-[12px] font-medium">
        <span>{label}</span>
        {showCopy ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-app-text-muted h-7 px-2 text-[11px]"
            onClick={() => void copyToClipboard(value)}
          >
            <Copy className="mr-1 size-3" aria-hidden />
            Copy
          </Button>
        ) : null}
      </div>
      <p
        className={cn(
          "text-app-text-primary mt-1 min-w-0 break-all leading-relaxed",
          mono && "font-mono text-[12px]",
        )}
      >
        {value}
      </p>
    </div>
  );
}

function DetailSection({
  title,
  sectionId,
  children,
}: {
  title: string;
  sectionId: string;
  children: ReactNode;
}) {
  return (
    <section className="min-w-0 px-6 py-4" aria-labelledby={sectionId}>
      <h2
        id={sectionId}
        className="text-app-text-primary mb-2 text-sm font-semibold tracking-tight"
      >
        {title}
      </h2>
      <div className="min-w-0 space-y-2 text-[13px] leading-relaxed">{children}</div>
    </section>
  );
}

export default function ExceptionHandlingPage() {
  const [stateFilter, setStateFilter] = useState<StateFilterParam>("pending");
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [items, setItems] = useState<ExceptionSummaryDto[]>([]);
  const [nextPageToken, setNextPageToken] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [bundle, setBundle] = useState<ExceptionDetailBundleDto | null>(null);

  const [replyText, setReplyText] = useState("");
  const [replyBusy, setReplyBusy] = useState(false);
  const [replyError, setReplyError] = useState<string | null>(null);
  const [replyAck, setReplyAck] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState("");
  const deferredSearch = useDeferredValue(searchQuery);
  const filteredItems = useMemo(
    () => filterSummaries(items, deferredSearch),
    [items, deferredSearch],
  );

  const loadList = useCallback(
    async (opts?: { pageToken?: string | null; append?: boolean }) => {
      setListLoading(true);
      setListError(null);
      try {
        const params = new URLSearchParams();
        params.set("state", stateFilter);
        params.set("page_size", "50");
        if (opts?.pageToken) params.set("page_token", opts.pageToken);
        const res = await fetch(`/api/kognitos/exceptions?${params}`);
        const data = (await res.json()) as {
          items?: ExceptionSummaryDto[];
          nextPageToken?: string | null;
          error?: string;
        };
        if (!res.ok) {
          setListError(data.error ?? res.statusText);
          setItems([]);
          setNextPageToken(null);
          return;
        }
        const next = data.items ?? [];
        if (opts?.append) {
          setItems((prev) => [...prev, ...next]);
        } else {
          setItems(next);
        }
        setNextPageToken(data.nextPageToken ?? null);
      } catch (e) {
        setListError(e instanceof Error ? e.message : "load_failed");
        setItems([]);
        setNextPageToken(null);
      } finally {
        setListLoading(false);
      }
    },
    [stateFilter],
  );

  useEffect(() => {
    void loadList();
  }, [loadList]);

  const loadDetail = useCallback(async (id: string) => {
    setDetailLoading(true);
    setDetailError(null);
    setReplyText("");
    setReplyError(null);
    try {
      const res = await fetch(
        `/api/kognitos/exceptions/${encodeURIComponent(id)}`,
      );
      const data = (await res.json()) as ExceptionDetailBundleDto & {
        error?: string;
      };
      if (!res.ok) {
        setBundle(null);
        setDetailError(data.error ?? res.statusText);
        return;
      }
      setBundle(data);
    } catch (e) {
      setBundle(null);
      setDetailError(e instanceof Error ? e.message : "load_failed");
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedId) void loadDetail(selectedId);
    else setBundle(null);
  }, [selectedId, loadDetail]);

  useEffect(() => {
    setReplyAck(null);
  }, [selectedId]);

  async function submitReply() {
    if (!selectedId || !replyText.trim()) return;
    setReplyBusy(true);
    setReplyError(null);
    setReplyAck(null);
    try {
      const res = await fetch(
        `/api/kognitos/exceptions/${encodeURIComponent(selectedId)}/reply`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: replyText.trim() }),
        },
      );
      const data = (await res.json()) as {
        ok?: boolean;
        ack?: CreateEventAckDto;
        error?: string;
        hint?: string;
      };
      if (!res.ok) {
        const base = data.error ?? res.statusText;
        setReplyError(data.hint ? `${base}\n\n${data.hint}` : base);
        return;
      }
      if (data.ack) {
        setReplyAck(formatReplyAckLine(data.ack));
      } else {
        setReplyAck("Message received by Kognitos.");
      }
      setReplyText("");
      await new Promise((r) => setTimeout(r, 1500));
      await loadDetail(selectedId);
    } catch (e) {
      setReplyError(e instanceof Error ? e.message : "reply_failed");
    } finally {
      setReplyBusy(false);
    }
  }

  function applySuggestedResponse() {
    if (!bundle) return;
    setReplyText(suggestedGuidanceFromException(bundle.exception.descriptionFull));
  }

  async function copyExceptionId(id: string) {
    await copyToClipboard(id);
  }

  return (
    <div className="flex min-h-[calc(100vh-6rem)] min-w-0 flex-col gap-4 lg:flex-row lg:items-stretch lg:gap-5">
      <div className="flex min-w-0 flex-1 flex-col gap-4">
        <div className="min-w-0">
          <h1 className="text-app-text-primary text-[1.625rem] font-semibold leading-tight tracking-tight">
            Exceptions
          </h1>
          <p className="text-app-text-secondary mt-1.5 max-w-2xl text-sm leading-relaxed">
            Triage workspace exceptions from Kognitos. Pick an item to review context and
            send guidance to the resolution agent.
          </p>
        </div>

        <div
          role="tablist"
          aria-label="Exception status"
          className="border-app-border bg-app-surface flex w-full min-w-0 flex-wrap gap-1 rounded-[12px] border p-1 shadow-[var(--app-card-shadow)]"
        >
          {STATE_TABS.map((t) => {
            const active = stateFilter === t.value;
            return (
              <button
                key={t.value}
                type="button"
                role="tab"
                aria-selected={active}
                className={cn(
                  "rounded-[10px] px-3 py-2 text-sm font-medium transition-colors",
                  active
                    ? "bg-navy-900 text-white shadow-sm"
                    : "border-app-border text-app-text-secondary hover:bg-app-surface-muted border bg-app-surface",
                )}
                onClick={() => {
                  setStateFilter(t.value);
                  setSelectedId(null);
                }}
              >
                {t.label}
              </button>
            );
          })}
        </div>

        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search exceptions by title, group, automation, or id..."
            className="border-app-border bg-app-surface text-app-text-primary h-10 min-w-[12rem] flex-1 rounded-[11px] border text-sm placeholder:text-app-text-muted"
            aria-label="Search exceptions"
          />
          <Popover>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="border-app-border bg-app-surface text-app-text-secondary h-10 shrink-0 rounded-[11px]"
              >
                <Filter className="size-3.5" />
                <span className="ml-1.5">Filters</span>
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-64 text-sm" align="end">
              <p className="text-app-text-secondary text-xs leading-relaxed">
                Automation filters will appear here. For now, use search and the status
                segments above.
              </p>
            </PopoverContent>
          </Popover>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="border-app-border bg-app-surface text-app-text-secondary h-10 shrink-0 rounded-[11px]"
            disabled={listLoading}
            onClick={() => void loadList()}
          >
            {listLoading ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <RefreshCw className="size-3.5" />
            )}
            <span className="ml-1.5">Refresh</span>
          </Button>
        </div>

        {listError ? (
          <p className="text-destructive text-sm">{listError}</p>
        ) : null}

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[14px] border border-transparent">
          <ScrollArea className="min-h-[12rem] max-h-[min(52vh,28rem)] lg:max-h-[calc(100vh-14rem)]">
            <div className="flex flex-col gap-2 pr-2 pb-1">
              {listLoading && items.length === 0 ? (
                <div className="text-app-text-secondary flex flex-col items-center justify-center gap-2 py-10 text-sm">
                  <Loader2 className="size-5 animate-spin" />
                  Loading…
                </div>
              ) : null}
              {!listLoading && filteredItems.length === 0 ? (
                <p className="text-app-text-secondary py-8 text-center text-sm">
                  {items.length === 0
                    ? "No exceptions for this filter."
                    : "No exceptions match your search."}
                </p>
              ) : null}
              {filteredItems.map((row) => {
                const selected = row.exceptionId === selectedId;
                const Icon = cardLeadingIcon(row);
                const listTitle = exceptionConciseTitle({
                  title: row.title,
                  groupLabel: row.groupLabel,
                });
                const friendlyAuto = isFriendlyAutomationDisplayName(
                  row.automationDisplayName,
                  row.automationId,
                );
                return (
                  <button
                    key={row.exceptionId}
                    type="button"
                    tabIndex={0}
                    data-state={selected ? "selected" : undefined}
                    aria-pressed={selected}
                    className={cn(
                      "border-app-border text-app-text-primary text-left transition-shadow transition-colors",
                      "focus-visible:ring-navy-700/30 flex w-full min-w-0 cursor-pointer rounded-[14px] border bg-app-surface shadow-[var(--app-card-shadow)]",
                      "focus-visible:ring-[3px] focus-visible:outline-none",
                      "hover:border-app-border-strong",
                      "border-l-[4px] border-l-transparent",
                      selected &&
                        "border-navy-selected-border bg-navy-selected-bg border-l-navy-700 shadow-[var(--app-card-shadow)]",
                    )}
                    onClick={() => setSelectedId(row.exceptionId)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setSelectedId(row.exceptionId);
                      }
                    }}
                  >
                    <div className="flex min-w-0 gap-3 px-5 py-3.5">
                      <div
                        className="bg-app-surface-muted text-app-text-muted flex size-9 shrink-0 items-center justify-center rounded-[10px]"
                        aria-hidden
                      >
                        <Icon className="size-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 items-start justify-between gap-2">
                          <span
                            className={cn(
                              "text-app-text-primary line-clamp-2 text-sm font-semibold leading-snug",
                              selected && "text-navy-900",
                            )}
                            title={row.title}
                          >
                            {listTitle}
                          </span>
                          <div className="flex shrink-0 flex-col items-end gap-1.5">
                            <span
                              className="text-app-text-muted whitespace-nowrap text-[12px] tabular-nums"
                              title={row.createTime ?? undefined}
                            >
                              {row.createTime
                                ? formatDistanceToNow(new Date(row.createTime), {
                                    addSuffix: true,
                                  })
                                : "—"}
                            </span>
                            <span className="inline-flex items-center gap-1.5 text-[12px] font-medium leading-none text-slate-600">
                              <span
                                className={cn(
                                  "size-2 shrink-0 rounded-full",
                                  stateDotClass(row.state),
                                )}
                                aria-hidden
                              />
                              {stateVisibleLabel(row.state)}
                            </span>
                          </div>
                        </div>
                        <p className="text-app-text-secondary mt-1 line-clamp-1 text-[13px]">
                          {row.groupLabel}
                          {friendlyAuto && row.automationDisplayName ? (
                            <>
                              <span className="text-app-text-muted"> · </span>
                              {row.automationDisplayName}
                            </>
                          ) : null}
                        </p>
                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                          <span className={neutralMetaPillClass()} title={row.groupLabel}>
                            {row.groupLabel}
                          </span>
                          {friendlyAuto && row.automationDisplayName ? (
                            <span
                              className={neutralMetaPillClass()}
                              title={row.automationDisplayName}
                            >
                              {row.automationDisplayName}
                            </span>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </ScrollArea>
        </div>
        {nextPageToken ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="self-start text-xs"
            disabled={listLoading}
            onClick={() => void loadList({ pageToken: nextPageToken, append: true })}
          >
            Load more
          </Button>
        ) : null}
      </div>

      <aside
        className={cn(
          "border-app-border bg-app-surface flex min-h-[20rem] w-full max-w-full min-w-0 flex-col overflow-hidden rounded-[16px] border shadow-[var(--app-card-shadow)]",
          "lg:sticky lg:top-20 lg:max-h-[calc(100vh-8rem)] lg:w-[28rem] lg:max-w-[min(32rem,40vw)] lg:shrink-0",
        )}
      >
        {bundle ? (
          <div className="border-app-border min-w-0 border-b px-6 py-6">
            <div className="flex min-w-0 items-start justify-between gap-3">
              <div className="min-w-0 flex-1 space-y-3">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span
                    className={cn(
                      "inline-flex items-center rounded-[10px] px-2 py-0.5 text-[12px] font-medium tabular-nums",
                      statePillClass(bundle.exception.state),
                    )}
                  >
                    {stateVisibleLabel(bundle.exception.state)}
                  </span>
                  <span className={neutralMetaPillClass()} title={bundle.exception.groupLabel}>
                    {bundle.exception.groupLabel}
                  </span>
                </div>
                <h2
                  className="text-navy-900 text-app-text-primary line-clamp-3 text-xl font-semibold leading-snug tracking-tight"
                  title={bundle.exception.title}
                >
                  {exceptionConciseTitle({
                    title: bundle.exception.title,
                    descriptionFull: bundle.exception.descriptionFull,
                    groupLabel: bundle.exception.groupLabel,
                  })}
                </h2>
                <p className="text-app-text-secondary text-[13px] leading-relaxed">
                  {headerBusinessImpact(bundle.exception)}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {bundle.kognitosRunUrl ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="border-app-border text-app-text-secondary h-8 rounded-[10px] px-2 text-xs"
                    asChild
                  >
                    <a href={bundle.kognitosRunUrl} target="_blank" rel="noreferrer">
                      Run
                      <ExternalLink className="ml-1 size-3 opacity-70" />
                    </a>
                  </Button>
                ) : null}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="text-app-text-secondary size-8"
                      aria-label="More actions"
                    >
                      <MoreHorizontal className="size-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-48">
                    <DropdownMenuItem
                      onSelect={() => void copyExceptionId(bundle.exception.exceptionId)}
                    >
                      Copy exception id
                    </DropdownMenuItem>
                    {bundle.kognitosRunUrl ? (
                      <DropdownMenuItem asChild>
                        <a href={bundle.kognitosRunUrl} target="_blank" rel="noreferrer">
                          Open in Kognitos
                        </a>
                      </DropdownMenuItem>
                    ) : null}
                  </DropdownMenuContent>
                </DropdownMenu>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="text-app-text-secondary size-8"
                  aria-label="Close detail"
                  onClick={() => setSelectedId(null)}
                >
                  <X className="size-4" />
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <div className="text-app-text-secondary border-app-border flex items-center justify-between gap-2 border-b px-5 py-3 text-sm">
            <span>Detail</span>
          </div>
        )}

        <ScrollArea className="min-h-0 min-w-0 max-w-full flex-1">
          <div className="text-app-text-primary min-w-0 max-w-full overflow-x-hidden pb-4 text-[13px]">
            {!selectedId ? (
              <p className="text-app-text-secondary px-5 py-5 text-sm">
                Select an exception from the list to load detail.
              </p>
            ) : null}
            {detailLoading ? (
              <div className="text-app-text-secondary flex items-center gap-2 px-5 py-5 text-sm">
                <Loader2 className="size-4 animate-spin" />
                Loading detail…
              </div>
            ) : null}
            {detailError ? (
              <p className="text-destructive min-w-0 break-words px-5 py-4 text-sm">
                {detailError}
              </p>
            ) : null}
            {bundle ? (
              <>
                <DetailSection title="What happened" sectionId="sec-what">
                  {bundle.exception.descriptionFull ? (
                    <p className="text-app-text-primary min-w-0 break-words leading-relaxed">
                      {whatHappenedOperational(bundle.exception)}
                    </p>
                  ) : (
                    <p className="text-app-text-muted text-sm italic">
                      No service description on this exception.
                    </p>
                  )}
                </DetailSection>
                <Separator className="bg-app-border" />
                <DetailSection title="Recommended action" sectionId="sec-rec">
                  <div className="text-navy-900 flex gap-3 rounded-[12px] border border-[color:color-mix(in_srgb,var(--app-green-border)_55%,var(--app-border))] bg-app-green-bg/90 p-3.5">
                    <CheckCircle2
                      className="text-app-green mt-0.5 size-4 shrink-0"
                      aria-hidden
                    />
                    <p className="text-app-text-primary min-w-0 leading-relaxed">
                      {recommendedActionCopy(bundle.exception)}
                    </p>
                  </div>
                </DetailSection>
                <Separator className="bg-app-border" />
                {bundle.exception.state === "ARCHIVED" ? (
                  <div className="px-5 py-3">
                    <p className="text-app-text-secondary text-sm leading-relaxed">
                      Archived exceptions are already triaged and hidden from active work.
                      Guidance is read-only for this item.
                    </p>
                  </div>
                ) : (
                  <DetailSection title="Send guidance to the agent" sectionId="sec-guide">
                    <p className="text-app-text-secondary min-w-0 leading-relaxed">
                      Tell the agent how to resolve the issue, validate assumptions, or request
                      clarification. Your message is sent through the exception reply API
                      (processing is asynchronous).
                    </p>
                    <Textarea
                      value={replyText}
                      onChange={(e) => setReplyText(e.target.value)}
                      placeholder="Tell the agent how to resolve this exception..."
                      rows={3}
                      className="border-app-border bg-app-surface text-app-text-primary mt-2 min-w-0 max-w-full resize-y rounded-[11px] border text-[13px] placeholder:text-app-text-muted"
                      disabled={replyBusy}
                    />
                    {!replyText.trim() ? (
                      <p className="text-app-text-muted mt-1.5 text-[12px]">
                        Enter guidance to enable sending.
                      </p>
                    ) : null}
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="border-app-border text-app-text-secondary h-8 rounded-[10px] text-xs"
                        onClick={applySuggestedResponse}
                        disabled={replyBusy}
                      >
                        Use suggested response
                      </Button>
                    </div>
                    {replyError ? (
                      <p className="text-destructive mt-2 min-w-0 whitespace-pre-wrap break-words text-sm">
                        {replyError}
                      </p>
                    ) : null}
                    {replyAck ? (
                      <p className="text-app-text-secondary mt-2 min-w-0 break-words text-sm">
                        {replyAck}
                      </p>
                    ) : null}
                    <div className="mt-3 flex items-center justify-end gap-2">
                      <Button
                        type="button"
                        size="sm"
                        className={cn(
                          "h-9 min-w-[8.5rem] rounded-[10px] text-sm font-medium [&_svg]:shrink-0",
                          replyBusy || !replyText.trim()
                            ? "cursor-not-allowed border border-slate-300 bg-[#E2E8F0] text-[#64748B] hover:bg-[#E2E8F0] [&_svg]:text-[#64748B]"
                            : "bg-navy-900 text-white hover:bg-navy-800 [&_svg]:text-white",
                        )}
                        disabled={replyBusy || !replyText.trim()}
                        onClick={() => void submitReply()}
                      >
                        {replyBusy ? (
                          <>
                            <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                            Sending…
                          </>
                        ) : (
                          <>
                            <Send className="mr-1.5 size-3.5" aria-hidden />
                            Send guidance
                          </>
                        )}
                      </Button>
                    </div>
                  </DetailSection>
                )}
                <Separator className="bg-app-border" />
                <details className="border-app-border bg-app-surface-muted/60 group mx-5 my-2 rounded-[12px] border open:bg-app-surface">
                  <summary className="text-app-text-primary cursor-pointer list-none px-4 py-3 text-sm font-semibold [&::-webkit-details-marker]:hidden">
                    <span className="inline-flex items-center gap-2">
                      <ChevronRight className="text-app-text-muted size-4 shrink-0 transition-transform group-open:rotate-90" />
                      Context
                    </span>
                  </summary>
                  <div className="border-app-border border-t px-4 pb-4 pt-2">
                    {!bundle.runContext.foundInDb ? (
                      <p className="text-app-text-muted text-[13px] leading-snug">
                        No matching run in this app’s database (sync may be missing for this run
                        id).
                      </p>
                    ) : (
                      <dl className="grid min-w-0 grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
                        {bundle.runContext.keyValues.map((kv) => (
                          <div
                            key={kv.label}
                            className="border-app-border min-w-0 border-b pb-2 last:border-0 sm:odd:border-r sm:odd:pr-3"
                          >
                            <dt className="text-app-text-muted text-[12px] font-medium">
                              {kv.label}
                            </dt>
                            <dd className="text-app-text-primary mt-1 min-w-0 break-words font-medium leading-snug [overflow-wrap:anywhere]">
                              {kv.value}
                            </dd>
                          </div>
                        ))}
                      </dl>
                    )}
                    {bundle.runContext.inputFiles.length > 0 ? (
                      <div className="mt-3 min-w-0">
                        <p className="text-app-text-muted mb-1 text-[12px] font-medium">
                          Input files
                        </p>
                        <ul className="text-app-text-secondary min-w-0 space-y-0.5 font-sans text-[13px] leading-tight">
                          {bundle.runContext.inputFiles.map((f, i) => (
                            <li
                              key={`${f.inputKey}:${f.kognitosFileId ?? ""}:${f.fileName ?? ""}:${i}`}
                              className="min-w-0 break-all [overflow-wrap:anywhere]"
                              title={`${f.inputKey}: ${f.fileName ?? f.kognitosFileId ?? "file"}`}
                            >
                              <span className="text-app-text-muted">{f.inputKey}:</span>{" "}
                              {f.fileName ?? f.kognitosFileId ?? "file"}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </div>
                </details>
                <details className="border-app-border bg-app-surface-muted/60 group mx-5 my-2 rounded-[12px] border open:bg-app-surface">
                  <summary className="text-app-text-primary cursor-pointer list-none px-4 py-3 text-sm font-semibold [&::-webkit-details-marker]:hidden">
                    <span className="inline-flex items-center gap-2">
                      <ChevronRight className="text-app-text-muted size-4 shrink-0 transition-transform group-open:rotate-90" />
                      Activity
                    </span>
                  </summary>
                  <div className="border-app-border border-t px-4 pb-4 pt-2">
                    {!bundle.eventsAgentIdUsed ? (
                      <p className="text-app-text-muted text-[12px] leading-snug [overflow-wrap:anywhere]">
                        Resolution events could not be loaded from Kognitos (check base URL,
                        credentials, and org/workspace scope).
                      </p>
                    ) : null}
                    <EventList
                      events={bundle.events}
                      agentResolved={Boolean(bundle.eventsAgentIdUsed)}
                    />
                  </div>
                </details>

                <details className="border-app-border bg-app-surface-muted/60 group mx-5 my-2 rounded-[12px] border open:bg-app-surface">
                  <summary className="text-app-text-primary hover:bg-app-surface-muted/80 cursor-pointer list-none px-4 py-3 [&::-webkit-details-marker]:hidden">
                    <span className="flex flex-col gap-0.5">
                      <span className="inline-flex items-center gap-2 text-sm font-semibold">
                        <ChevronRight className="text-app-text-muted size-4 shrink-0 transition-transform group-open:rotate-90" />
                        Technical details
                      </span>
                      <span className="text-app-text-muted pl-6 text-[12px] font-normal leading-snug">
                        Execution IDs, run information, and error trace
                      </span>
                    </span>
                  </summary>
                  <div className="border-app-border text-app-text-secondary space-y-4 border-t px-4 pb-4 pt-3">
                    <TechField
                      label="System state"
                      value={bundle.exception.state}
                      mono={false}
                    />
                    <TechField label="Exception ID" value={bundle.exception.exceptionId} mono />
                    <TechField
                      label="Run ID"
                      value={bundle.exception.runId ?? ""}
                      mono
                    />
                    <TechField
                      label="Execution ID"
                      value={bundle.exception.executionId ?? ""}
                      mono
                    />
                    <TechField
                      label="Automation ID"
                      value={bundle.exception.automationId}
                      mono
                    />
                    <TechField
                      label="Byte location"
                      value={byteLocationFromDisplay(bundle.exception.locationDisplay) ?? "—"}
                      mono
                    />
                    {rawLocationForTechnical(bundle.exception.locationDisplay) ? (
                      <TechField
                        label="Location (raw)"
                        value={rawLocationForTechnical(bundle.exception.locationDisplay) ?? ""}
                        mono
                      />
                    ) : null}
                    <TechField
                      label="Assignee"
                      value={bundle.exception.assigneeShort ?? "—"}
                      mono={false}
                    />
                    <div className="min-w-0">
                      <div className="text-app-text-secondary flex flex-wrap items-center justify-between gap-2 font-sans text-[12px] font-medium">
                        <span>Interpreter message</span>
                        {bundle.exception.messageFull.trim() ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="text-app-text-muted h-7 px-2 text-[11px]"
                            onClick={() => void copyToClipboard(bundle.exception.messageFull)}
                          >
                            <Copy className="mr-1 size-3" aria-hidden />
                            Copy
                          </Button>
                        ) : null}
                      </div>
                      <div className="border-app-border mt-1.5 min-w-0 max-w-full overflow-x-auto rounded-[10px] border bg-app-surface-muted">
                        <pre
                          className="text-app-text-primary max-h-40 min-w-0 max-w-full overflow-y-auto p-2.5 font-mono text-[12px] leading-snug whitespace-pre-wrap break-all [overflow-wrap:anywhere]"
                          tabIndex={0}
                        >
                          {bundle.exception.messageFull.trim()
                            ? bundle.exception.messageFull
                            : "—"}
                        </pre>
                      </div>
                    </div>
                    <div className="min-w-0">
                      <div className="text-app-text-secondary mb-1 font-sans text-[12px] font-medium">
                        Traceback
                      </div>
                      <div className="border-app-border rounded-[10px] border bg-app-surface-muted p-2.5">
                        <pre className="text-app-text-primary font-mono text-[12px] leading-snug whitespace-pre-wrap break-all">
                          {tracebackFromExtra(bundle.exception.extra) ?? "—"}
                        </pre>
                      </div>
                    </div>
                  </div>
                </details>
              </>
            ) : null}
          </div>
        </ScrollArea>
      </aside>
    </div>
  );
}

function EventList({
  events,
  agentResolved,
}: {
  events: ExceptionEventDto[];
  agentResolved: boolean;
}) {
  if (events.length === 0) {
    return (
      <div className="text-app-text-secondary min-w-0 rounded-[10px] border border-dashed border-app-border bg-app-surface-muted/40 px-3 py-3">
        <p className="text-app-text-primary text-sm font-medium">No guidance has been sent yet.</p>
        <p className="text-app-text-muted mt-1 min-w-0 text-[12px] leading-snug [overflow-wrap:anywhere]">
          {agentResolved
            ? "When you send guidance, activity will appear here."
            : "Configure an exception-resolution agent id to load the event stream from Kognitos."}
        </p>
      </div>
    );
  }
  return (
    <ul className="border-border min-w-0 space-y-2.5 border-l-2 border-l-border/80 pl-2.5">
      {events.map((ev, i) => (
        <li key={`${ev.createTime ?? i}-${i}`} className="min-w-0 text-xs">
          <div className="text-muted-foreground mb-0.5 flex min-w-0 flex-wrap items-center gap-x-1.5 font-mono text-[10px]">
            <span className="min-w-0 max-w-full shrink break-all tabular-nums">
              {ev.createTime ? new Date(ev.createTime).toLocaleString() : "—"}
            </span>
            <Badge
              variant="secondary"
              className="h-4 max-w-full min-w-0 shrink truncate px-1 text-[9px] font-normal"
              title={ev.kind}
            >
              {ev.kind}
            </Badge>
          </div>
          <div className="text-foreground/95 min-w-0 break-words leading-snug [overflow-wrap:anywhere]">
            {ev.summary}
          </div>
          {ev.detail && ev.detail !== ev.summary ? (
            <div className="mt-1 min-w-0 max-w-full overflow-x-auto rounded border border-border/60">
              <pre className="bg-muted/60 max-h-20 min-w-0 max-w-full overflow-y-auto p-1.5 font-mono text-[10px] leading-snug whitespace-pre-wrap break-all">
                {ev.detail}
              </pre>
            </div>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
