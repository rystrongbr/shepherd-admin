import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const apiRequest = vi.fn();
const toast = vi.fn();

vi.mock("@/lib/queryClient", () => ({
  apiRequest: (...args: any[]) => apiRequest(...args),
}));
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast }),
}));

import UpdateUniqueUsersForm, { parseUniqueUsers } from "./UpdateUniqueUsersForm";

function renderForm() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const invalidate = vi.spyOn(qc, "invalidateQueries");
  render(
    <QueryClientProvider client={qc}>
      <UpdateUniqueUsersForm />
    </QueryClientProvider>,
  );
  return { invalidate };
}

function openForm() {
  fireEvent.click(screen.getByTestId("update-unique-users-toggle"));
}

beforeEach(() => {
  apiRequest.mockReset();
  toast.mockReset();
  cleanup();
});

describe("parseUniqueUsers", () => {
  it("parses plain digits, grouped, and shorthand", () => {
    expect(parseUniqueUsers("2260")).toBe(2260);
    expect(parseUniqueUsers("2,260")).toBe(2260);
    expect(parseUniqueUsers("2.26k")).toBe(2260);
    expect(parseUniqueUsers(" 1500 ")).toBe(1500);
  });

  it("rejects empty and non-numeric input", () => {
    expect(parseUniqueUsers("")).toBeNull();
    expect(parseUniqueUsers("abc")).toBeNull();
    expect(parseUniqueUsers("-5")).toBeNull();
  });
});

describe("UpdateUniqueUsersForm", () => {
  it("renders a collapsed toggle and expands to reveal the form", () => {
    renderForm();
    expect(screen.getByTestId("update-unique-users-toggle")).toBeTruthy();
    openForm();
    expect(screen.getByTestId("update-unique-users-form")).toBeTruthy();
    expect(screen.getByTestId("update-unique-users-value")).toBeTruthy();
  });

  it("accepts input and posts the correct snapshot payload, then invalidates the tile query", async () => {
    apiRequest.mockResolvedValue({ json: async () => ({ ok: true }) });
    const { invalidate } = renderForm();
    openForm();

    fireEvent.change(screen.getByTestId("update-unique-users-value"), { target: { value: "2,260" } });
    fireEvent.change(screen.getByTestId("update-unique-users-note"), { target: { value: "test note" } });
    fireEvent.click(screen.getByTestId("update-unique-users-submit"));

    await waitFor(() => expect(apiRequest).toHaveBeenCalledTimes(1));
    expect(apiRequest).toHaveBeenCalledWith("POST", "/api/traffic/snapshot", {
      source: "cloudflare",
      metric: "uniques_30d",
      value: 2260,
      note: "test note",
    });
    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({
        queryKey: ["/api/traffic/latest", "cloudflare", "uniques_30d"],
      }),
    );
    await waitFor(() => expect(toast).toHaveBeenCalledWith({ title: "Updated to 2,260" }));
  });

  it("shows a validation error for non-numeric input without calling the API", () => {
    renderForm();
    openForm();
    fireEvent.change(screen.getByTestId("update-unique-users-value"), { target: { value: "abc" } });
    fireEvent.click(screen.getByTestId("update-unique-users-submit"));

    expect(screen.getByTestId("update-unique-users-error").textContent).toMatch(/valid number/i);
    expect(apiRequest).not.toHaveBeenCalled();
  });

  it("surfaces the server error message on failure", async () => {
    apiRequest.mockRejectedValue(new Error("500: boom"));
    renderForm();
    openForm();
    fireEvent.change(screen.getByTestId("update-unique-users-value"), { target: { value: "100" } });
    fireEvent.click(screen.getByTestId("update-unique-users-submit"));

    await waitFor(() =>
      expect(screen.getByTestId("update-unique-users-error").textContent).toContain("500: boom"),
    );
  });
});
