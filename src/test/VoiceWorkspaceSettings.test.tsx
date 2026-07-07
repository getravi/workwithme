import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";

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

const defaultShortcuts = {
  dictate: "Super+Shift+Space",
  capture_region: "Super+Ctrl+Digit4",
  capture_window: "Super+Ctrl+Digit5",
  screen_recording: "Super+Ctrl+Digit6",
  new_meeting: "Super+Ctrl+Digit7",
};

describe("VoiceWorkspaceSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "llm_get_config") return Promise.resolve(defaultConfig);
      if (cmd === "llm_save_config") return Promise.resolve(null);
      if (cmd === "llm_set_api_key") return Promise.resolve(null);
      if (cmd === "llm_test_connection") return Promise.resolve("ok");
      if (cmd === "voice_get_shortcuts") return Promise.resolve(defaultShortcuts);
      if (cmd === "whisper_model_available") return Promise.resolve(true);
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

  it("shows amber warning banner when Whisper model is unavailable", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "llm_get_config") return Promise.resolve(defaultConfig);
      if (cmd === "voice_get_shortcuts") return Promise.resolve(defaultShortcuts);
      if (cmd === "whisper_model_available") return Promise.resolve(false);
      return Promise.resolve(null);
    });
    render(<VoiceWorkspaceSettings />);
    await waitFor(() => {
      expect(screen.getByText(/voice model not found/i)).toBeInTheDocument();
    });
  });

  it("does NOT show amber warning when Whisper model is available", async () => {
    render(<VoiceWorkspaceSettings />);
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("whisper_model_available");
    });
    expect(screen.queryByText(/voice model not found/i)).not.toBeInTheDocument();
  });

  it("shows shortcut conflict error when same key is assigned to two actions", async () => {
    render(<VoiceWorkspaceSettings />);
    // Wait for shortcuts section to appear
    await waitFor(() => screen.getByText(/dictate into active window/i));

    // Find and click the dictate row's shortcut button to enter edit mode
    // The button for the first row (Dictate) shows ⌘ ⇧ Space
    const shortcutButtons = screen.getAllByRole("button");
    const dictateBtn = shortcutButtons.find((b) =>
      b.textContent?.includes("⌘") && b.textContent?.includes("Space"),
    );
    expect(dictateBtn).toBeDefined();
    fireEvent.click(dictateBtn!);

    // Simulate pressing Super+Ctrl+4 — already assigned to capture_region
    // fireEvent maps these directly onto the DOM KeyboardEvent, which becomes
    // e.nativeEvent inside the React synthetic event handler.
    await act(async () => {
      fireEvent.keyDown(dictateBtn!, {
        key: "4",
        metaKey: true,
        ctrlKey: true,
        shiftKey: false,
        altKey: false,
      });
    });

    // The "Save" button appears once a valid pending shortcut is captured
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /^save$/i })).toBeInTheDocument(),
    );
    fireEvent.mouseDown(screen.getByRole("button", { name: /^save$/i }));
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => {
      expect(screen.getByText(/already assigned to/i)).toBeInTheDocument();
    });
  });
});
