import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { SkillsPage } from "../SkillsPage";

vi.mock("../config", () => ({ API_BASE: "http://localhost:4242" }));

vi.mock("../MarkdownMessage", () => ({
  MarkdownMessage: ({ content }: { content: string }) => <div>{content}</div>,
}));

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

describe("SkillsPage", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("renders skills from the wrapped API response without crashing", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        skills: [
          {
            id: "example/code-review",
            name: "code-review",
            description: "Review code for bugs and regressions.",
            category: "Engineering",
            source: "example",
            path: "",
          },
        ],
      }),
    });

    render(<SkillsPage />);

    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Skills" })).toBeInTheDocument(),
    );
    expect(screen.getByText("code-review")).toBeInTheDocument();
    expect(screen.getByText("1 skill")).toBeInTheDocument();
  });

  it("shows an inline error for an unexpected API payload", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ unexpected: true }),
    });

    render(<SkillsPage />);

    await waitFor(() =>
      expect(screen.getByText("Error: Invalid skills response")).toBeInTheDocument(),
    );
  });
});
