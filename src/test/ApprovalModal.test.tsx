import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ApprovalModal } from "../ApprovalModal";
import { ChatContext } from "../context/ChatContext";
import type { ChatContextValue } from "../context/ChatContext";
import type { ApprovalRequest } from "../types";

const mockApproval: ApprovalRequest = {
  id: "req-1",
  operation_type: "bash_write",
  description: "Write to /etc/hosts",
  details: { command: "echo foo >> /etc/hosts" },
};

function makeCtx(overrides: Partial<ChatContextValue> = {}): ChatContextValue {
  return {
    messages: [], toolExecutions: [], isProcessing: false, isSteering: false,
    currentToolStatus: null, approvalRequest: null, chatError: null,
    handleSubmit: vi.fn(), handleStop: vi.fn(), handleApprovalResponse: vi.fn(),
    clearMessages: vi.fn(), loadSession: vi.fn(), setChatError: vi.fn(),
    ...overrides,
  };
}

describe("ApprovalModal", () => {
  it("renders nothing when approvalRequest is null", () => {
    const { container } = render(
      <ChatContext.Provider value={makeCtx({ approvalRequest: null })}>
        <ApprovalModal />
      </ChatContext.Provider>,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders approval details when request is present", () => {
    render(
      <ChatContext.Provider value={makeCtx({ approvalRequest: mockApproval })}>
        <ApprovalModal />
      </ChatContext.Provider>,
    );
    expect(screen.getByText(/Write to \/etc\/hosts/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /approve/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /deny/i })).toBeInTheDocument();
  });

  it("calls handleApprovalResponse(true) on Approve click", () => {
    const handleApprovalResponse = vi.fn();
    render(
      <ChatContext.Provider value={makeCtx({ approvalRequest: mockApproval, handleApprovalResponse })}>
        <ApprovalModal />
      </ChatContext.Provider>,
    );
    fireEvent.click(screen.getByRole("button", { name: /approve/i }));
    expect(handleApprovalResponse).toHaveBeenCalledWith(true);
  });

  it("calls handleApprovalResponse(false) on Deny click", () => {
    const handleApprovalResponse = vi.fn();
    render(
      <ChatContext.Provider value={makeCtx({ approvalRequest: mockApproval, handleApprovalResponse })}>
        <ApprovalModal />
      </ChatContext.Provider>,
    );
    fireEvent.click(screen.getByRole("button", { name: /deny/i }));
    expect(handleApprovalResponse).toHaveBeenCalledWith(false);
  });
});
