import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { SettingsContent } from "../SettingsPage";

vi.mock("../config", () => ({ API_BASE: "http://localhost:4242" }));

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

describe("SettingsPage", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("shows only actionable OAuth providers with active and setup states", async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes("/api/auth/oauth-providers")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            providers: [
              { id: "anthropic", name: "Claude", category: "AI", available: true },
              { id: "openai-codex", name: "Codex", category: "AI", available: true },
              { id: "google-gemini-cli", name: "Gemini CLI", category: "AI", available: true },
            ],
          }),
        });
      }

      if (url.includes("/api/auth/status")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            authenticated_providers: ["anthropic"],
          }),
        });
      }

      return Promise.resolve({
        ok: true,
        json: async () => ({
          availableProviders: ["openai", "anthropic"],
          configured: ["google"],
        }),
      });
    });

    render(<SettingsContent tab="connections" isConnected />);

    await waitFor(() => expect(screen.getByRole("button", { name: /claude/i })).toBeInTheDocument());

    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.getAllByText("Set up").length).toBeGreaterThan(0);
    expect(screen.queryByText("Unavailable")).toBeNull();
    expect(screen.getByRole("button", { name: /codex/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /gemini cli/i })).toBeInTheDocument();
  });
});
