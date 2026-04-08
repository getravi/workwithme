import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const { mockInvoke } = vi.hoisted(() => ({ mockInvoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mockInvoke }));

// Import whatever component/function you create for the voice settings section
// Adjust this import to match your implementation
import { VoiceWorkspaceSettings } from "../VoiceWorkspaceSettings";

const defaultConfig = {
  provider: "anthropic",
  base_url: "https://api.anthropic.com/v1",
  model: "claude-sonnet-4-6",
  api_key_name: "anthropic-api-key",
};

describe("VoiceWorkspaceSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "llm_get_config") return Promise.resolve(defaultConfig);
      if (cmd === "llm_save_config") return Promise.resolve(null);
      if (cmd === "llm_set_api_key") return Promise.resolve(null);
      if (cmd === "llm_test_connection") return Promise.resolve("ok");
      return Promise.resolve(null);
    });
  });

  it("loads and displays current config on mount", async () => {
    render(<VoiceWorkspaceSettings />);
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("llm_get_config");
    });
  });

  it("calls llm_set_api_key when API key save button is clicked", async () => {
    render(<VoiceWorkspaceSettings />);
    await waitFor(() => screen.getByPlaceholderText(/api key/i));
    fireEvent.change(screen.getByPlaceholderText(/api key/i), { target: { value: "sk-test123" } });
    fireEvent.click(screen.getByRole("button", { name: /save key/i }));
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("llm_set_api_key", {
        apiKeyName: "anthropic-api-key",
        key: "sk-test123",
      });
    });
  });

  it("shows connection status after Test Connection click", async () => {
    render(<VoiceWorkspaceSettings />);
    await waitFor(() => screen.getByRole("button", { name: /test connection/i }));
    fireEvent.click(screen.getByRole("button", { name: /test connection/i }));
    await waitFor(() => {
      expect(screen.getByText(/connected/i)).toBeInTheDocument();
    });
  });
});
