import { useChat } from "./context/ChatContext";

export function ApprovalModal() {
  const { approvalRequest, handleApprovalResponse, isApprovingLoading } = useChat();

  if (!approvalRequest) return null;

  const { operation_type, description, details } = approvalRequest;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-[#1f2937] rounded-lg shadow-xl max-w-lg w-[90%] border border-[#374151]">
        <div className="p-6">
          <div className="mb-4">
            <h2 className="text-lg font-semibold text-white mb-2">
              {operation_type === "sandbox_escape" ? "⚠️ Sandbox Escape Request" : "🔒 Approval Required"}
            </h2>
            <p className="text-gray-300">{description}</p>
          </div>

          {details && (
            <div className="mb-6 p-4 bg-[#111827] rounded border border-[#374151] overflow-auto max-h-48">
              <div className="font-mono text-sm text-gray-400">
                {operation_type === "write_file" && (
                  <>
                    <div className="mb-3">
                      <span className="text-gray-500">Path:</span>{" "}
                      <span className="text-blue-300">{String(details.path)}</span>
                    </div>
                    <div>
                      <span className="text-gray-500 block mb-1">Content Preview:</span>
                      <div className="text-gray-400 whitespace-pre-wrap break-words">
                        {String(details.content_preview)}
                      </div>
                    </div>
                  </>
                )}
                {operation_type === "bash_write" && (
                  <>
                    <span className="text-gray-500">Command:</span>{" "}
                    <span className="text-yellow-300">{String(details.command)}</span>
                  </>
                )}
                {operation_type === "sandbox_escape" && (
                  <>
                    <div className="mb-3">
                      <span className="text-gray-500">Operation:</span>{" "}
                      <span className="text-orange-300">{String(details.operation)}</span>
                    </div>
                    <div className="mb-3">
                      <span className="text-gray-500">Reason:</span>{" "}
                      <span className="text-orange-300">{String(details.reason)}</span>
                    </div>
                    {details.context && (
                      <div>
                        <span className="text-gray-500 block mb-1">Context:</span>
                        <div className="text-gray-400">{JSON.stringify(details.context, null, 2)}</div>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          )}

          <div className="text-sm text-gray-400 mb-6 p-3 bg-[#0f1419] rounded border border-[#374151]/50">
            ⏱️ This request will auto-deny in 30 seconds for security
          </div>

          <div className="flex gap-3">
            <button
              onClick={() => handleApprovalResponse(false)}
              disabled={isApprovingLoading}
              className="flex-1 px-4 py-2 rounded-lg bg-[#374151] hover:bg-[#4b5563] text-gray-300 font-medium transition-colors disabled:opacity-50"
            >
              {isApprovingLoading ? "..." : "Deny"}
            </button>
            <button
              onClick={() => handleApprovalResponse(true)}
              disabled={isApprovingLoading}
              className="flex-1 px-4 py-2 rounded-lg bg-[#c5f016] hover:bg-[#d4ff24] text-black font-medium transition-colors disabled:opacity-50"
            >
              {isApprovingLoading ? "..." : "Approve"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
