import { expect, test } from "@playwright/test";

const MOCK_USER = {
  id: "usr_001",
  org_id: "org_001",
  full_name: "E2E User",
  email: "e2e@example.com",
  role: "requester",
  created_at: "2025-01-15T08:00:00Z",
};

const INTERPRETER_MARKER = "INTERPRETER_UNIQUE_MARKER_E2E";

const listJson = {
  items: [
    {
      exceptionId: "e2e-exc-1",
      state: "PENDING",
      groupLabel: "e2e-group",
      title: "E2E interpreter placement",
      automationId: "auto-e2e",
      automationDisplayName: "E2E Auto",
      runId: null,
      createTime: "2026-01-15T12:00:00Z",
      assigneeShort: null,
      executionId: null,
    },
  ],
  nextPageToken: null,
};

const bundleJson = {
  exception: {
    exceptionId: "e2e-exc-1",
    state: "PENDING",
    groupLabel: "e2e-group",
    title: "E2E interpreter placement",
    automationId: "auto-e2e",
    automationDisplayName: "E2E Auto",
    runId: null,
    createTime: "2026-01-15T12:00:00Z",
    assigneeShort: null,
    executionId: null,
    messageFull: INTERPRETER_MARKER,
    descriptionFull: "Service description for e2e.",
    locationDisplay: "automation / step",
    extra: {},
    automationResource: null,
    runResource: null,
    exceptionResourceName: null,
  },
  events: [],
  runContext: {
    runId: null,
    foundInDb: false,
    keyValues: [],
    inputFiles: [],
  },
  eventsAgentIdUsed: null,
  kognitosRunUrl: null,
};

test.describe("Exception handling — interpreter message", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript((u) => {
      localStorage.setItem("workflowapp_user", JSON.stringify(u));
    }, MOCK_USER);

    await page.route("**/api/kognitos/exceptions?*", async (route) => {
      if (route.request().method() !== "GET") {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(listJson),
      });
    });

    await page.route("**/api/kognitos/exceptions/e2e-exc-1", async (route) => {
      if (route.request().method() !== "GET") {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(bundleJson),
      });
    });
  });

  test("interpreter label and body live under Technical details, not What happened", async ({
    page,
  }) => {
    await page.goto("/exception-handling", { waitUntil: "domcontentloaded" });

    const whatHappened = page.getByRole("region", { name: "What happened" });
    await expect(whatHappened).toBeVisible();
    await expect(whatHappened.getByText("Interpreter message")).toHaveCount(0);
    await expect(whatHappened.getByText(INTERPRETER_MARKER)).toHaveCount(0);

    const technical = page.locator("details").filter({
      has: page.getByText("Execution IDs, run information, and error trace"),
    });
    await technical.getByText("Technical details").click();

    await expect(technical.getByText("System state")).toBeVisible();
    await expect(technical.getByText("PENDING")).toBeVisible();
    await expect(technical.getByText("Interpreter message")).toBeVisible();
    await expect(technical.getByText(INTERPRETER_MARKER)).toBeVisible();
  });
});
