import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const apiRequest = vi.fn();
vi.mock("@/lib/queryClient", () => ({ apiRequest: (...args: unknown[]) => apiRequest(...args) }));
import WaitlistPage from "./WaitlistPage";

const data = {
  enabled: true,
  summary: { total: 51, subscribed: 50, unsubscribed: 1, emailFailed: 0 },
  rows: [{
    id: 1, email: "test@example.com", firstName: "Test", device: "iphone",
    source: "instagram", campaign: "launch", status: "subscribed", emailStatus: "sent",
    createdAt: "2026-09-28T12:00:00.000Z",
  }],
};
function mount() {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <WaitlistPage />
  </QueryClientProvider>);
}
beforeEach(() => { cleanup(); apiRequest.mockReset(); });
describe("owner launch list", () => {
  it("renders signups and supports pagination and refresh", async () => {
    apiRequest.mockResolvedValue({ json: async () => data });
    mount();
    await screen.findByText("test@example.com");
    expect(screen.getByText("instagram / launch")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(apiRequest).toHaveBeenCalledWith("GET", "/api/waitlist/contacts?offset=50"));
    expect(await screen.findByText("Page 2")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Previous" }));
    await screen.findByText("Page 1");
    const count = apiRequest.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await waitFor(() => expect(apiRequest.mock.calls.length).toBeGreaterThan(count));
  });
  it("shows owner-access guidance on failure without contact data", async () => {
    apiRequest.mockRejectedValue(new Error("403"));
    mount();
    expect((await screen.findByRole("alert")).textContent).toContain("platform owner");
    expect(screen.queryByText("test@example.com")).toBeNull();
  });
  it("downloads via the authenticated API only after explicit export click", async () => {
    apiRequest.mockImplementation(async (_method, url) => url.endsWith("/export")
      ? { blob: async () => new Blob(["email\nprivate@example.com"], { type: "text/csv" }) }
      : { json: async () => data });
    URL.createObjectURL = vi.fn(() => "blob:test");
    URL.revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    mount();
    await screen.findByText("test@example.com");
    expect(apiRequest).not.toHaveBeenCalledWith("GET", "/api/waitlist/export");
    fireEvent.click(screen.getByRole("button", { name: "Export subscribed contacts" }));
    await waitFor(() => expect(click).toHaveBeenCalledTimes(1));
    expect(apiRequest).toHaveBeenCalledWith("GET", "/api/waitlist/export");
    click.mockRestore();
  });
  it("renders disabled signup collection and empty state", async () => {
    apiRequest.mockResolvedValue({ json: async () => ({ enabled: false, rows: [], summary: { total: 0, subscribed: 0, unsubscribed: 0, emailFailed: 0 } }) });
    mount();
    await screen.findByText("Disabled");
    expect(screen.getByText(/No signups yet/)).toBeTruthy();
  });
});
