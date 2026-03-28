# Phase 3 Architecture: LLM-Agnostic Agent Runtime

## Overview

Phase 3 makes the Rust backend **feature-complete** against the original Node.js sidecar by implementing a fully LLM-agnostic agent runtime. The architecture decouples agent execution from any specific LLM provider, allowing seamless switching between Claude, OpenAI, and other models.

## Core Components

### 1. AppState (src/server/mod.rs)

**Purpose**: Central state container for the application, injected into all routes via Axum's state mechanism.

```rust
pub struct AppState {
    pub model_registry: Arc<ModelRegistry>,
    pub auth_storage: Arc<AuthStorage>,
    pub session_map: Arc<RwLock<HashMap<String, Arc<RwLock<AgentSession>>>>>,
}
```

**Responsibilities**:
- Holds reference to model registry for model selection
- Centralizes API key management (keychain + env var fallback)
- Maintains in-memory session map for active agent sessions

**Key Methods**:
- `AppState::new()` — Initialize state with model registry and auth storage

---

### 2. ModelRegistry & AuthStorage (src/server/mod.rs)

#### ModelRegistry

Wraps the existing `models.rs` module and provides model metadata.

```rust
pub struct ModelRegistry {
    models: Vec<models::Model>,
}
```

**Methods**:
- `list()` — Get all available models
- `find(id)` — Find model by ID
- `get_api_key_for_model(model_id, auth_storage)` — Get key for model's provider

#### AuthStorage

Centralizes API key lookups with a consistent strategy: keychain first, then environment variables.

```rust
pub struct AuthStorage;

impl AuthStorage {
    pub fn get_key(&self, provider: &str) -> Option<String> {
        // Checks keychain["provider-api-key"] first
        // Falls back to env vars (ANTHROPIC_API_KEY, OPENAI_API_KEY, etc.)
    }

    pub fn set_key(&self, provider: &str, key: &str) -> Result<(), String> {
        // Stores in keychain
    }

    pub fn get_configured_providers(&self) -> Result<Vec<String>, String> {
        // Returns list of providers with stored keys
    }
}
```

**Supported Providers**:
- `anthropic` → `ANTHROPIC_API_KEY`
- `openai` → `OPENAI_API_KEY`
- `google` → `GOOGLE_API_KEY`
- `cohere` → `COHERE_API_KEY`

---

### 3. LlmProvider Trait (src/server/providers.rs)

**Purpose**: Abstract interface for any LLM provider, enabling provider-agnostic agent execution.

```rust
#[async_trait]
pub trait LlmProvider: Send + Sync {
    fn provider_id(&self) -> &str;
    fn model_ids(&self) -> Vec<&str>;
    async fn complete(&self, req: CompletionRequest) -> Result<CompletionResponse, String>;
    async fn stream(&self, req: CompletionRequest, tx: mpsc::Sender<StreamEvent>)
        -> Result<(), String>;
}
```

**Key Design**:
- Generic `CompletionRequest` and `CompletionResponse` structures normalize API differences
- Implementations convert internal format ↔ provider's API format
- Streaming support via mpsc channel for real-time updates

#### AnthropicProvider

Full implementation handling:
- Proper tool_use content blocks (no markdown parsing)
- SSE streaming via `response.bytes_stream()`
- Anthropic-specific headers and versioning

#### OpenAiProvider

Stub for future expansion. Signature ready for `/v1/chat/completions` format.

---

### 4. ContentBlock Refactor (src/server/agent.rs)

**Previous Issue**: Messages stored as plain text strings, requiring markdown parsing to extract tool calls.

**New Architecture**: Multi-part content blocks enable proper LLM content representation.

```rust
#[serde(tag = "type", rename_all = "snake_case")]
pub enum MessageContentBlock {
    Text { text: String },
    ToolUse { id: String, name: String, input: Value },
    ToolResult { tool_use_id: String, content: String, is_error: bool },
}

pub struct Message {
    pub role: String,
    pub content: Option<String>,                    // Legacy format (backward compat)
    pub content_blocks: Option<Vec<MessageContentBlock>>, // New multi-part format
}
```

**Benefits**:
- Real tool_use blocks from API (not markdown string parsing)
- Proper tool_result content blocks
- Backward compatible with existing session JSON

**Helper Methods**:
```rust
Message::text("user", "Hello")                          // Shorthand for legacy format
Message::with_blocks("assistant", vec![...])           // Shorthand for new format
message.as_text()                                       // Extracts text from blocks
```

---

### 5. ToolRegistry with JSON Schemas (src/server/tools.rs)

**Purpose**: Provide tool definitions to LLMs so they understand available tools.

```rust
pub fn tool_definitions() -> Vec<ToolDefinition> {
    // Returns 4 tools: bash, read_file, write_file, list_directory
    // Each includes name, description, and JSON Schema
}
```

**Example Schema**:
```json
{
    "type": "object",
    "properties": {
        "command": {
            "type": "string",
            "description": "The bash command to execute"
        }
    },
    "required": ["command"]
}
```

**Integration**: Schemas included in every `CompletionRequest.tools` sent to provider.

---

### 6. Agent Executor Rewrite (src/server/agent_executor.rs)

**Purpose**: Core agent loop using LlmProvider trait, AppState, and proper content blocks.

```rust
pub async fn execute_agent_turn(
    state: Arc<AppState>,
    session: Arc<RwLock<AgentSession>>,
    user_message: String,
    event_tx: mpsc::Sender<AgentEvent>,
) -> Result<String, String>
```

**Flow**:
1. Add user message to session
2. Look up session model (default: Claude Opus)
3. Get API key from AuthStorage
4. Create provider instance (AnthropicProvider, etc.)
5. Build CompletionRequest with current session messages + tool schemas
6. Call provider.complete()
7. Process response content blocks:
   - Emit `MessageStart`, `MessageDelta`, `MessageEnd` events
   - Detect tool_use blocks
8. If tool_use blocks present:
   - Execute each tool
   - Emit `ToolExecutionStart`, `ToolExecutionDelta`, `ToolExecutionEnd` events
   - Add `ToolResult` content block to session
   - Loop to get next response
9. Emit `AgentEnd` event with final response
10. Update session timestamp

**Event Stream** (via mpsc::Sender):
```rust
pub enum AgentEvent {
    MessageStart,
    MessageDelta { text: String },
    MessageEnd,
    ToolExecutionStart { tool_name: String, tool_id: String },
    ToolExecutionDelta { output: String },
    ToolExecutionEnd { tool_name: String, output: String },
    AgentEnd { final_response: String },
    Error { message: String },
}
```

**Max Iterations**: 10 (prevents infinite loops)

---

## REST Endpoints (Phase 3)

### Auth/Key Management
- `POST /api/auth/key` — `{ provider, key }` → Store API key in keychain
- `GET /api/auth` — List configured providers and their status

### Model Selection
- `POST /api/model` — `{ provider, modelId, sessionId }` → Set session-scoped model

### Agent Control
- `POST /api/stop` — `{ sessionId }` → Abort active agent run (fires CancellationToken)

### Project/Session Management
- `GET /api/project` — Return current session cwd
- `POST /api/project` — `{ cwd }` → Create new session at cwd
- `POST /api/sessions/archive` — Archive/unarchive session
- `POST /api/sessions/load` — Load session by path

### System Status
- `GET /api/sandbox/status` — Return sandbox support status

---

## Data Flow: Agent Execution

```
User Input (REST /api/agent/session)
    ↓
[AppState] Look up model + auth key
    ↓
[LlmProvider] Create provider instance (AnthropicProvider)
    ↓
[CompletionRequest] Build request with:
    - Session messages (with content blocks)
    - Tool schemas (JSON)
    - Model ID
    - System prompt
    ↓
[Provider.complete()] Call Anthropic API
    ↓
[CompletionResponse] Parse response with real content blocks
    ↓
[AgentEvent] Stream events: MessageStart, MessageDelta, MessageEnd
    ↓
[Tool Detection] If response has tool_use blocks:
    → Execute each tool
    → Stream ToolExecutionStart/Delta/End events
    → Add ToolResult to session
    → Loop (max 10 iterations)
    ↓
[AgentEnd Event] Return final response
```

---

## Type Conversions

### Our Format → Provider Format

```rust
// Our generic ContentBlock
ContentBlock::ToolUse { id, name, input }

// Converts to Anthropic format
{
    "type": "tool_use",
    "id": "...",
    "name": "bash",
    "input": {...}
}
```

### Provider Format → Our Format

```rust
// Anthropic API response
{"type": "tool_use", "id": "...", "name": "bash", "input": {...}}

// Converts to our ResponseContentBlock
ResponseContentBlock::ToolUse { id, name, input }

// Stored in session as MessageContentBlock
MessageContentBlock::ToolUse { id, name, input }
```

---

## Testing

### Tests Added in Phase 3

#### providers.rs
- `test_anthropic_provider_ids()` — Verify provider identity
- `test_anthropic_model_ids()` — Verify available models
- `test_content_block_text_serialization()` — Verify content block JSON
- `test_content_block_tool_use_serialization()` — Verify tool use JSON
- `test_completion_request_structure()` — Verify request shape

#### agent.rs
- `test_message_text_helper()` — Verify Message::text() helper
- `test_message_with_blocks()` — Verify Message::with_blocks() helper
- `test_message_as_text_from_string()` — Verify text extraction
- `test_message_as_text_from_blocks()` — Verify block text extraction
- `test_message_as_text_mixed_blocks()` — Verify filtering non-text blocks

#### tools.rs
- `test_tool_definitions_exists()` — Verify 4 tools defined
- `test_tool_definitions_have_schemas()` — Verify JSON schemas present
- `test_bash_tool_definition()` — Verify bash tool schema
- `test_read_file_tool_definition()` — Verify read_file schema
- `test_write_file_tool_definition()` — Verify write_file schema
- `test_list_directory_tool_definition()` — Verify list_directory schema

### Run Tests
```bash
cd src-tauri
cargo test
```

---

## Future Extensions

### Task 6: WebSocket Protocol
- Full bidirectional event streaming
- `join`, `prompt`, `steer`, `new_chat` client events
- Multi-session fan-out via `session_subscribers` map

### Task 8: Sandbox Approval Flow
- `PENDING_APPROVALS` HashMap with 30s expiry
- `sandbox_approval_request` event
- `sandbox_approval_response` WS message
- CancellationToken firing

### Task 9: Claude-Tool Extension
- Register `claude` tool in registry
- Spawn Claude Code sub-sessions via `std::process::Command`
- Parallel execution (up to 8 tasks, 3 concurrent)

### Task 10: MCP Adapter
- Load ~/.pi/mcp.json
- Start stdio servers as child processes
- Merge MCP tools into session ToolRegistry

---

## Key Design Decisions

1. **AppState Injection**: Axum's `.with_state()` makes auth/models available to all handlers without global state.

2. **AuthStorage Strategy**: Keychain first (secure) + env fallback (convenient for CI/testing).

3. **Content Blocks Over String Parsing**: Real LLM content representation eliminates markdown parsing bugs.

4. **LlmProvider Trait**: Generic interface allows easy addition of new providers (OpenAI, Cohere, etc.) without core changes.

5. **Message Backward Compatibility**: Sessions with legacy string-only messages remain readable; new messages use blocks.

6. **Event Streaming**: mpsc channels enable real-time WS streaming without blocking agent executor.

7. **Max Iterations**: Prevents runaway agent loops while supporting multi-turn tool use.

---

## Files Modified/Created

- **Created**: `src/server/providers.rs` (LlmProvider trait + implementations)
- **Modified**: `src/server/mod.rs` (AppState, AuthStorage, ModelRegistry, new endpoints)
- **Modified**: `src/server/agent.rs` (ContentBlock enum, Message helpers)
- **Modified**: `src/server/agent_executor.rs` (Complete rewrite using AppState + LlmProvider)
- **Modified**: `src/server/tools.rs` (Added tool_definitions with JSON schemas)
- **Modified**: `Cargo.toml` (Added async-trait dependency)

---

## Compatibility Notes

- Sessions created before Phase 3 have string-only messages; `Message::as_text()` extracts text from both formats
- Backward compatible with all existing REST endpoints
- No breaking changes to WebSocket protocol (yet; Task 6 will refactor)
- All tests pass with existing codebase

