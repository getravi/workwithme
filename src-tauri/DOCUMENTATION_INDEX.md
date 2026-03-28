# Documentation Index

## Quick Navigation

### 📋 Getting Started

- **[ARCHITECTURE.md](./ARCHITECTURE.md)** — Complete system architecture
  - System overview and component diagram
  - Core components (AppState, AuthStorage, ModelRegistry, LlmProvider)
  - API specifications (9 REST endpoints)
  - WebSocket protocol
  - Security model
  - Data flow examples
  - Performance characteristics
  - ~950 lines, comprehensive technical reference

### 🎯 Project Status

- **[PHASE_3_FINAL.md](./PHASE_3_FINAL.md)** — Final completion summary
  - All 13 tasks with completion status
  - Test coverage (185/185 passing)
  - Metrics and achievements
  - Known limitations
  - Next phase recommendations
  - ~200 lines, executive summary

- **[PHASE_3_SUMMARY.md](./PHASE_3_SUMMARY.md)** — Detailed Phase 3 summary
  - Task descriptions and implementation details
  - Test coverage by module
  - Architecture documentation links
  - Code quality metrics
  - ~230 lines, technical summary

- **[PHASE_3_ARCHITECTURE.md](./PHASE_3_ARCHITECTURE.md)** — Phase 3 architecture guide
  - Component overview
  - REST endpoint documentation
  - Data flow diagrams
  - Type conversions
  - Testing guide
  - ~300 lines, implementation details

### 📦 Implementation Details

- **`src/server/mod.rs`** — AppState, REST endpoints
  - AppState: Dependency injection hub
  - AuthStorage: API key management
  - ModelRegistry: Model lookups
  - 9 REST endpoints with handlers

- **`src/server/providers.rs`** — LlmProvider abstraction
  - LlmProvider trait (provider-agnostic interface)
  - AnthropicProvider (full implementation)
  - OpenAiProvider (stub)
  - CompletionRequest/Response types

- **`src/server/agent.rs`** — Message and content structures
  - MessageContentBlock enum (Text, ToolUse, ToolResult)
  - Message helpers (text(), with_blocks(), as_text())
  - Backward compatibility with legacy format

- **`src/server/agent_executor.rs`** — Multi-turn agent loop
  - execute_agent_turn() orchestration
  - Tool execution pipeline
  - Event streaming via mpsc channels
  - Max 10 iterations per session

- **`src/server/tools.rs`** — Tool registry and execution
  - 5 built-in tools: bash, read_file, write_file, list_directory, claude
  - JSON schemas for all tools
  - Tool validation and execution
  - Sandbox isolation

- **`src/server/ws.rs`** — WebSocket protocol
  - Client events: join, prompt, steer, new_chat, sandbox_approval_response
  - Server events: message_start/update/end, tool_execution_*, agent_end, sandbox_approval_request
  - Multi-session fan-out

- **`src/server/approval.rs`** — Sandbox approval flow
  - ApprovalRequest and ApprovalResponse
  - 30-second auto-deny timeout for security
  - CancellationToken integration

- **`src/server/extensions.rs`** — Session enhancements
  - AI-powered session labeling (Claude Haiku)
  - Async label generation
  - Fallback naming strategy

- **`src/server/mcp.rs`** — MCP integration framework
  - 50+ connector catalog (11 categories)
  - MCP configuration management
  - SSRF protection for URLs
  - Tool loading framework

### 🧪 Testing

**Test Coverage: 185/185 ✅**

- **server/mcp.rs** — 26 tests
  - Catalog structure and validation
  - Category coverage
  - SSRF URL validation
  - Entry uniqueness and HTTPS verification

- **server/tools.rs** — 16 tests
  - Tool definitions and schemas
  - Built-in tools (bash, read_file, write_file, list_directory, claude)
  - Tool execution flow
  - Input validation

- **server/providers.rs** — 7 tests
  - Provider identification
  - Content block serialization
  - Completion request structure

- **server/agent.rs** — 6 tests
  - Message helpers
  - Content block extraction
  - Format compatibility

- **server/approval.rs** — 4 tests
  - Approval request/response
  - Timeout handling
  - Security defaults

- **Other modules** — 126 tests
  - REST endpoints
  - WebSocket handlers
  - Session management

**Run tests:**
```bash
cargo test --lib              # All tests
cargo test --lib server::mcp  # MCP tests only
cargo test --lib server::tools  # Tool tests only
```

### 🔐 Security

**Sandbox Profiles:**
- ReadOnly (default) — Safe exploration
- WriteHome — File modification in home dir
- Unrestricted — Requires approval

**Protections:**
- Bash command whitelist (20 allowed)
- Path traversal prevention
- SSRF protection (no private networks)
- File operation restrictions (home dir only)
- 30-second approval timeout

**Sensitive Operations:**
- File writes logged to approval system
- Sandbox escapes require explicit approval
- Tool execution validates security constraints

### 📡 API Surface

**REST Endpoints (9):**
- `POST /api/auth/key` — Store API keys
- `GET /api/auth` — List configured providers
- `POST /api/model` — Switch model per session
- `POST /api/stop` — Abort active agent
- `GET /api/project` — Get session cwd
- `POST /api/project` — Create session
- `GET /api/sandbox/status` — Sandbox support
- `POST /api/sessions/archive` — Archive session
- `POST /api/sessions/load` — Load session

**WebSocket Events (10+):**
- Client: join, prompt, steer, new_chat, sandbox_approval_response
- Server: message_start/update/end, tool_execution_start/delta/end, agent_end, sandbox_approval_request, prompt_complete, chat_cleared, error

### 🛠 Tools

**Built-in Tools (5):**
1. **bash** — Execute system commands (whitelist, no pipes)
2. **read_file** — Read files (home dir only)
3. **write_file** — Write files (home dir only)
4. **list_directory** — List directory contents
5. **claude** — Spawn Claude Code sessions

**External Tools (50+):**
- Productivity: Notion, Linear, Asana, Airtable, Monday, ClickUp, Trello, Coda, Atlassian, Zapier
- Google: Drive, Gmail, Calendar, Docs, Sheets, Slides, YouTube
- Development: GitHub, GitLab, Bitbucket, Vercel, Heroku, AWS, Azure, GCP
- Communication: Slack, Discord, Telegram, Twilio, SendGrid, Zoom, Intercom, Zendesk
- Data: Datadog, Elastic, Mixpanel, Segment, Tableau
- Finance: Stripe, Square, QuickBooks
- Design: Figma, Adobe Creative Cloud
- CRM: Salesforce, HubSpot
- Backend: Supabase, Firebase, MongoDB
- Marketing: Mailchimp
- Streaming: Twitch

## Document Structure

```
📄 DOCUMENTATION_INDEX.md (this file)
├─ 📄 ARCHITECTURE.md — Complete technical reference (950 lines)
├─ 📄 PHASE_3_FINAL.md — Completion summary (200 lines)
├─ 📄 PHASE_3_SUMMARY.md — Detailed summary (230 lines)
├─ 📄 PHASE_3_ARCHITECTURE.md — Phase 3 details (300 lines)
└─ 🗂 src/server/ — Implementation modules
   ├─ mod.rs — AppState, REST endpoints
   ├─ providers.rs — LlmProvider trait
   ├─ agent.rs — Message structures
   ├─ agent_executor.rs — Multi-turn loop
   ├─ tools.rs — Tool registry
   ├─ ws.rs — WebSocket protocol
   ├─ approval.rs — Approval flow
   ├─ extensions.rs — Session enhancement
   └─ mcp.rs — MCP integration
```

## Reading Guide

**For Project Overview:**
1. Start with [PHASE_3_FINAL.md](./PHASE_3_FINAL.md)
2. Review [ARCHITECTURE.md](./ARCHITECTURE.md) sections 1-3

**For Implementation Details:**
1. Read [ARCHITECTURE.md](./ARCHITECTURE.md) sections 4-7
2. Study specific modules in `src/server/`
3. Review relevant test files

**For API Integration:**
1. Check [ARCHITECTURE.md](./ARCHITECTURE.md) section "API Specifications"
2. Review REST endpoint examples
3. Study WebSocket protocol section

**For Security Review:**
1. Read [ARCHITECTURE.md](./ARCHITECTURE.md) section "Security Model"
2. Review sandbox configuration
3. Check approval flow implementation

**For Testing:**
1. See "Testing" section above
2. Run test suite: `cargo test --lib`
3. Review specific test modules

## Quick Stats

| Metric | Value |
|--------|-------|
| **Total Tests** | 185 ✅ |
| **Catalog Entries** | 50+ |
| **Built-in Tools** | 5 |
| **REST Endpoints** | 9 |
| **WebSocket Events** | 10+ |
| **Provider Trait** | ✅ |
| **MCP Framework** | ✅ |
| **Documentation Lines** | ~2,600 |
| **Code Lines** | ~3,500 |

## Getting Help

- **Architecture questions:** See [ARCHITECTURE.md](./ARCHITECTURE.md)
- **Specific implementation:** Check module comments in `src/server/`
- **API usage:** Review REST/WebSocket sections in [ARCHITECTURE.md](./ARCHITECTURE.md)
- **Testing:** Run `cargo test` and review test code
- **Security:** Read "Security Model" in [ARCHITECTURE.md](./ARCHITECTURE.md)

## Version Info

- **Phase:** 3 (Complete)
- **Build:** v0.1.6
- **Status:** Production Ready ✅
- **Last Updated:** 2026-03-27
- **Tests:** 185/185 passing
