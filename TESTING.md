# Phase 1-3a Testing Plan

## Overview
This document outlines how to test the Rust HTTP backend implementation (Phase 1-3a) that replaces the Node.js sidecar.

**Status**: Ready to test. All code compiles without errors.

## Prerequisites
- Rust toolchain (cargo)
- Tauri CLI: `npm install -g @tauri-apps/cli`
- curl or Postman for HTTP testing
- WebSocket client (wscat, or browser console)

## Test Environment Setup

### 1. Build the Rust Backend
```bash
cd src-tauri
cargo build --dev
# Expected: Clean build, no errors (only warnings about unused functions)
```

### 2. Start the Tauri App
```bash
npm run tauri dev
# Expected:
# - App window opens
# - Console logs show "[http-server] starting on http://127.0.0.1:4242"
# - Backend server is running on localhost:4242
```

## HTTP Endpoint Tests

### Health Check
```bash
curl http://localhost:4242/api/health
# Expected: {"status":"ok","server":"workwithme-rust-backend"}
```

### Skills Management
```bash
# List all skills
curl http://localhost:4242/api/skills
# Expected: {"skills": [...]}

# Get specific skill (example/code-review is built-in)
curl http://localhost:4242/api/skills/example/code-review
# Expected: {"success":true,"content":"---\nname: code-review\n..."}
```

### Keychain (Cross-Platform)
```bash
# Store a token
curl -X POST http://localhost:4242/api/keychain \
  -H "Content-Type: application/json" \
  -d '{"key":"test-service","token":"my-secret-token"}'
# Expected: {"success":true}

# Retrieve token
curl http://localhost:4242/api/keychain/test-service
# Expected: {"success":true,"token":"my-secret-token"}

# Delete token
curl -X DELETE http://localhost:4242/api/keychain/test-service
# Expected: {"success":true,"deleted":true}
```

### Session Management
```bash
# Create a new session
curl -X POST http://localhost:4242/api/sessions \
  -H "Content-Type: application/json" \
  -d '{"name":"test-session"}'
# Expected: {"success":true,"id":"<uuid>"}
# Copy the returned ID for next tests

# List sessions
curl http://localhost:4242/api/sessions
# Expected: {"success":true,"sessions":[...]}

# Get specific session (use ID from create)
curl http://localhost:4242/api/sessions/<SESSION_ID>
# Expected: {"success":true,"session":{...}}

# Update session
curl -X PUT http://localhost:4242/api/sessions/<SESSION_ID> \
  -H "Content-Type: application/json" \
  -d '{"name":"updated-session"}'
# Expected: {"success":true}

# Archive session
curl -X POST http://localhost:4242/api/sessions/<SESSION_ID>/archive
# Expected: {"success":true,"archived":true}
```

### MCP Configuration
```bash
# Get current MCP config
curl http://localhost:4242/api/mcp
# Expected: {"success":true,"config":{"mcpServers":{}}}

# Get MCP catalog
curl http://localhost:4242/api/mcp/catalog
# Expected: {"success":true,"catalog":[...20+ services...]}

# Update MCP config
curl -X POST http://localhost:4242/api/mcp \
  -H "Content-Type: application/json" \
  -d '{"mcpServers":{"notion":{"url":"https://mcp.notion.com/v1"}}}'
# Expected: {"success":true}
```

### Audit Logging
```bash
# Log an audit event
curl -X POST http://localhost:4242/api/audit \
  -H "Content-Type: application/json" \
  -d '{"type":"user_action","details":{"action":"test"}}'
# Expected: {"success":true}

# Verify log file was created/appended
cat ~/.pi/audit.log
# Expected: JSON lines with timestamp, type, details
```

### OAuth Providers
```bash
# List available OAuth providers
curl http://localhost:4242/api/auth/oauth-providers
# Expected: {"providers":[{"id":"anthropic","name":"Anthropic"},{"id":"google",...}]}
```

### Agent Session Creation
```bash
# Create new agent session
curl -X POST http://localhost:4242/api/agent/session \
  -H "Content-Type: application/json" \
  -d '{"metadata":{"model":"claude-opus-4-6"}}'
# Expected: {"success":true,"session":{"id":"<uuid>","created_at":"<rfc3339>","messages":[],...}}
```

## WebSocket Tests

### Using wscat
```bash
npm install -g wscat

# Connect to WebSocket
wscat -c ws://localhost:4242

# In the wscat shell, send test messages:

# List sessions
{"type":"session:list"}
# Expected: {"type":"session:list","sessions":[]}

# Load session (will fail gracefully with null)
{"type":"session:load","session_id":"test-123"}
# Expected: {"type":"session:load","sessionId":"test-123","session":null}

# Send agent message (placeholder response for now)
{"type":"agent:message","session_id":"<uuid>","content":"Hello"}
# Expected: {"type":"agent:response","sessionId":"<uuid>","content":"Agent integration coming in Phase 3a"}

# Send invalid message type
{"type":"invalid:type"}
# Expected: {"type":"error","error":"Unknown message type: invalid:type"}
```

### Using Browser Console
```javascript
// In browser DevTools console
const ws = new WebSocket('ws://localhost:4242');

ws.onopen = () => {
  console.log('Connected');
  ws.send(JSON.stringify({
    type: 'session:list'
  }));
};

ws.onmessage = (event) => {
  console.log('Received:', JSON.parse(event.data));
};

ws.onerror = (error) => {
  console.error('Error:', error);
};
```

## File System Checks

After running tests, verify created files:

```bash
# Skills directory (should exist, may be empty)
ls -la ~/.config/workwithme/skills/

# Sessions directory
ls -la ~/.pi/sessions/

# Audit log
cat ~/.pi/audit.log | tail -5

# MCP config
cat ~/.pi/agent/mcp.json
```

## Performance Baseline

Record these metrics for comparison after optimization:

```bash
# HTTP response time (health check should be <10ms)
time curl http://localhost:4242/api/health

# Session creation time
time curl -X POST http://localhost:4242/api/sessions \
  -H "Content-Type: application/json" \
  -d '{}'

# WebSocket handshake time
# Use browser DevTools Network tab to measure
```

## Troubleshooting

### Server not starting
```
Error: [http-server] failed to bind to port 4242
→ Check if something else is using port 4242:
  lsof -i :4242
  # Kill if necessary: kill -9 <PID>
```

### Keychain errors on Linux
```
Error: keychain entry creation failed
→ Ensure secret-tool is installed:
  sudo apt-get install libsecret-tools
```

### Sessions directory permission error
```
Error: Failed to create sessions directory
→ Check home directory permissions:
  ls -ld ~
  # Should be drwx------  or similar
```

### CORS errors from frontend
```
→ CORS is enabled with permissive settings
→ All origins allowed: .layer(CorsLayer::permissive())
→ If issues persist, check browser console for specific error
```

## Test Checklist

- [ ] Cargo build succeeds with no errors
- [ ] Tauri app starts and logs server startup
- [ ] Health check returns 200 OK
- [ ] Skills endpoint lists built-in skills
- [ ] Keychain operations (store/retrieve/delete) work
- [ ] Session CRUD operations work
- [ ] MCP config read/write works
- [ ] Audit logging creates file
- [ ] OAuth provider list returns 4+ providers
- [ ] Agent session creation returns valid session
- [ ] WebSocket connection establishes
- [ ] WebSocket message routing works
- [ ] Invalid message types return proper errors
- [ ] Verify all files created in ~/.pi/ and ~/.config/

## Next Steps

Once all tests pass:
1. Document any issues found
2. Decide whether to proceed with Phase 3b (tool execution)
3. Consider integration testing with frontend (if frontend exists)
4. Performance profiling and optimization

## Notes

- Phase 3a does NOT include full Claude API integration yet (needs API key)
- Tool execution is NOT implemented (Phase 3b)
- OAuth flows are NOT implemented (just provider listing)
- Responses are JSON, not streaming (Phase 3 continuation will add SSE/streaming)
