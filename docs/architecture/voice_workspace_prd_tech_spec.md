# Voice Workspace
## Unified PRD + Technical Specification
### Granola + Wispr Flow Inspired Product

**Version:** 1.0  
**Date:** 2026-04-05  
**Document Type:** Product Requirements Document + Technical Specification  
**Audience:** Founder, product designer, engineering lead, LLM coding assistant

---

# 1. Executive Summary

Build a **voice-native desktop workspace** that combines:

1. **Ambient meeting capture and AI notes** inspired by Granola
2. **System-wide polished dictation** inspired by Wispr Flow
3. **A unified memory and action layer** that turns spoken content into durable, searchable, and editable work artifacts

The product should let users:
- capture meetings without a bot
- dictate into any app with polished output
- save voice memos and spoken drafts
- search and chat across all captured voice sessions
- automatically turn speech into notes, follow-ups, tasks, CRM updates, and documents

This is not just a meeting notes app and not just a dictation app.
It is a **voice workspace** for knowledge workers who spend their day in meetings, writing, and follow-up work.

---

# 2. Product Vision

## 2.1 Vision Statement

Create the default operating system for spoken work: a product that helps people **talk, write, remember, and execute through voice**.

## 2.2 Core Promise

Users should be able to:
- **speak naturally**
- **capture important context automatically**
- **convert speech into polished output**
- **retrieve and reuse voice-derived knowledge later**

## 2.3 Product Thesis

Most current tools solve one narrow slice:
- meeting notes
- dictation
- transcription
- AI summarization
- voice memos

The opportunity is to unify them into one coherent workflow:

**speech in → structured work out**

---

# 3. Goals

## 3.1 Primary Goals

1. Help users stay present in meetings while still generating high-quality notes
2. Let users write substantially faster using voice across apps
3. Create a persistent, searchable memory of spoken work
4. Reduce post-meeting admin and follow-up effort
5. Build a daily-use desktop utility with strong retention

## 3.2 Success Criteria

The product is successful if users adopt it for both:
- **capture** during real work
- **retrieval and action** after the fact

## 3.3 Non-Goals for V1

- full enterprise admin suite
- complete mobile parity
- deep industry-specific workflows
- video recording
- browser-only implementation
- full offline local inference stack

---

# 4. Ideal Customer Profile

## 4.1 Primary ICP

Knowledge workers who spend significant time in both:
- meetings/calls
- writing/follow-up work

Examples:
- founders
- product managers
- recruiters
- sales reps
- customer success managers
- consultants
- researchers
- analysts
- operators
- lawyers
- journalists

## 4.2 Secondary ICP

Teams that need a lightweight system of record for conversations and follow-ups.

## 4.3 Anti-ICP for V1

- users who only want pure transcription
- users who never work on desktop
- compliance-heavy industries requiring day-one on-prem deployment
- users who need domain-specific voice workflows before generic workflows are proven

---

# 5. Product Principles

1. **Voice-first, not voice-only**  
   Voice should accelerate work, but every output must be editable.

2. **User control beats black-box automation**  
   AI drafts should be transparent and revisable.

3. **Context is the moat**  
   The system should use meeting context, app context, and user context to produce better output.

4. **One memory layer**  
   Meetings, dictated text, and voice memos should all live in the same retrievable system.

5. **Fast enough for daily habit**  
   Launch speed, dictation latency, and summary generation must feel instant or near-instant.

6. **Privacy is product-critical**  
   Recording, storage, sharing, and AI processing must be legible and controllable.

---

# 6. Core Product Definition

The product consists of **three primary surfaces**.

## 6.1 Surface A: Global Voice Bar

A lightweight overlay for voice dictation and commands across any app.

Use cases:
- email drafting
- Slack messages
- writing documents
- filling forms
- brainstorming into notes
- rewriting selected text

## 6.2 Surface B: Meeting Companion

A dedicated meeting workspace for capturing:
- system audio
- microphone audio
- live notes
- live transcript
- AI-generated notes after the meeting

Use cases:
- internal meetings
- customer calls
- interviews
- research sessions
- standups
- performance reviews

## 6.3 Surface C: Memory Workspace

A searchable library and AI chat interface over all voice sessions.

Use cases:
- “What did we decide last week?”
- “Find every time customer X mentioned pricing”
- “Draft a follow-up using my meeting notes and earlier voice memo”
- “What action items do I own?”

---

# 7. V1 Product Scope

## 7.1 In Scope

### Core platform
- macOS desktop app first
- account system
- local session storage with cloud sync
- settings and privacy controls

### Dictation
- global hotkey to start/stop dictation
- speech-to-text insertion in active app
- punctuation inference
- filler word removal
- simple voice formatting commands
- rewrite current dictated text

### Meeting capture
- create meeting session manually
- capture microphone + system audio
- live transcription
- user note-taking editor during meeting
- post-meeting AI notes
- action item extraction
- summary generation

### Memory
- searchable session history
- folder/tag organization
- per-session AI chat
- cross-session search

### Outputs
- copy to clipboard
- export to Markdown
- send to Notion
- send to Slack
- draft Gmail follow-up text

## 7.2 Out of Scope for V1

- Windows support
- native iOS/Android apps
- enterprise SSO/SAML
- full team admin console
- advanced CRM write-back
- auto-join calendar-based meeting capture
- deep per-app plugins
- offline-only mode
- multilingual simultaneous translation

---

# 8. User Personas

## Persona 1: Product Manager

Needs:
- capture planning meetings
- summarize decisions
- draft follow-ups
- dictate specs and messages quickly

## Persona 2: Sales Rep

Needs:
- capture customer calls
- create concise CRM-ready notes
- dictate outbound and follow-up emails
- search prior customer conversations

## Persona 3: Recruiter

Needs:
- summarize interviews
- dictate candidate feedback
- compare multiple interview sessions
- generate structured candidate notes

## Persona 4: Founder / Executive

Needs:
- reduce admin after meetings
- capture ideas while moving
- dictate messages across apps
- retrieve context quickly across many conversations

---

# 9. Primary User Stories

## 9.1 Dictation Stories

- As a user, I want to trigger dictation with a hotkey so I can speak into any app.
- As a user, I want my speech to become polished text automatically.
- As a user, I want the system to handle punctuation without my needing to say it explicitly every time.
- As a user, I want to correct myself naturally while speaking.
- As a user, I want to apply voice commands like “new bullet” or “make this shorter.”

## 9.2 Meeting Stories

- As a user, I want to start a meeting note with one click.
- As a user, I want to write rough notes while the app captures transcript in the background.
- As a user, I want a polished summary after the meeting ends.
- As a user, I want clear action items and decisions extracted automatically.
- As a user, I want to edit the output before sharing.

## 9.3 Memory Stories

- As a user, I want all my voice-derived work saved in one place.
- As a user, I want to search past meetings, memos, and dictation sessions.
- As a user, I want to ask questions about one session or multiple sessions.
- As a user, I want to reuse previous spoken content to draft new documents.

## 9.4 Sharing Stories

- As a user, I want to export notes to my tools.
- As a user, I want to share a summary without exposing full transcript by default.
- As a user, I want clear privacy controls over what is stored and synced.

---

# 10. Detailed Functional Requirements

# 10.1 Desktop Application Shell

## Requirements
- Native-feeling desktop app for macOS
- Global hotkey registration
- Menu bar/tray presence
- Fast cold start
- Background session processing
- Offline-tolerant local cache

## Behavior
- The app should remain accessible while the user works in other apps.
- Dictation should not require the main window to be open.
- Meeting capture should continue if the window is minimized.

---

# 10.2 Authentication and User Accounts

## Requirements
- email/password or magic link login
- OAuth optional in later phase
- per-user settings sync
- local anonymous trial mode optional

## Stored settings
- preferred language
- preferred output style
- dictation hotkey
- auto-punctuation setting
- filler removal preference
- retention preferences
- AI processing preferences
- share defaults

---

# 10.3 Global Dictation Overlay

## Requirements
- summon via hotkey
- floating compact UI
- start/stop dictation
- display listening state
- show live transcript preview
- insert final text into active text field when possible

## Commands in V1
- new paragraph
- new bullet
- undo last sentence
- make this shorter
- make this more professional
- rewrite for Slack
- rewrite for email

## Acceptance criteria
- user can trigger dictation in common desktop apps
- dictated text is visibly cleaner than raw transcript
- latency is low enough to feel fluid

---

# 10.4 Meeting Capture Workspace

## Requirements
- create meeting session manually
- editable title
- meeting notes editor
- live transcript panel
- start/stop capture controls
- post-meeting AI generation controls

## Audio Sources
- microphone input
- system audio input
- combined session timeline

## During-meeting UX
- rough notes in center panel
- live transcript in side panel
- markers/bookmarks for important moments
- simple timer and recording status

## End-of-meeting outputs
- summary
- key discussion points
- decisions
- action items
- follow-up email draft
- optional CRM-style recap template

---

# 10.5 Audio Capture Pipeline

## Requirements
- capture microphone audio stream
- capture system audio stream
- normalize audio where possible
- chunk audio for streaming transcription
- recover gracefully from interruptions

## Considerations
- macOS system audio capture can require a virtual audio driver or OS-specific APIs depending on implementation path
- permissions and onboarding must be explicit and clear

## Failure cases
- missing permission
- no input device
- system audio unavailable
- network outage during live transcription

## Required responses
- graceful fallback to microphone-only mode
- clear error banners
- local buffering for temporary reconnect

---

# 10.6 Speech Recognition

## Requirements
- streaming transcription for dictation mode
- streaming transcription for meeting mode
- finalization pass after session ends
- configurable language
- punctuation restoration
- confidence metadata

## Optional V1.1
- speaker diarization in meeting mode
- multilingual auto-detection

---

# 10.7 AI Text Polishing for Dictation

## Input
- raw transcript chunk
- app context if available
- user style preferences
- recent text buffer

## Output
- cleaned text ready for insertion

## Transformations
- remove filler words
- fix casing
- infer punctuation
- resolve simple speech disfluencies
- preserve user intent
- preserve explicit formatting commands

## Constraints
- no factual invention
- minimal unnecessary rewriting
- fast response time required

---

# 10.8 AI-Enhanced Meeting Notes

## Inputs
- transcript
- user notes
- title
- session metadata
- template type

## Outputs
- executive summary
- detailed notes
- decisions made
- open questions
- action items with likely owners if grounded
- follow-up draft

## Prompting requirements
- prefer transcript-grounded statements
- preserve user-written notes as signal
- mark uncertainty when ownership or decision is ambiguous
- do not invent commitments not supported by source material

## Regeneration options
- concise
- detailed
- sales call
- recruiting interview
- product sync
- customer research

---

# 10.9 Memory Workspace

## Requirements
- session library view
- filters by type
- search by title/content/tags/date
- session detail view
- cross-session search results

## Session types in V1
- meeting
- dictation session
- voice memo

## Display metadata
- title
- type
- date/time
- duration
- tags
- source app if available

---

# 10.10 AI Chat

## V1 Scope
- chat within a single session
- ask questions over transcript + notes + generated outputs
- grounded answers with citations/snippets

## V1.1 Scope
- cross-session chat
- memory-aware synthesis across sessions

## Suggested prompts
- what did we decide?
- what are the follow-ups?
- summarize customer objections
- draft a recap email
- list every open question

---

# 10.11 Integrations

## V1 Integrations
- Notion export
- Slack export
- copy to clipboard
- download Markdown
- Gmail draft text generation for manual paste

## V1.1 Integrations
- direct Gmail draft creation
- HubSpot/Salesforce push
- Linear/Jira task creation
- Google Docs export

---

# 10.12 Privacy and Consent Controls

## Requirements
- visible recording indicators
- explicit microphone/system audio permission requests
- per-session delete
- retention controls
- sync on/off toggle
- transcript deletion controls
- share defaults conservative by default

## Sharing policy for V1
- private by default
- explicit share action required
- transcript hidden by default when sharing summary externally

---

# 11. Non-Functional Requirements

## Performance
- dictation transcript preview: target under 800 ms incremental update
- polished dictation insertion: target under 1.5 s perceived lag for short utterances
- post-meeting summary generation: target under 15 s for average meetings
- app launch: target under 3 s cold start

## Reliability
- no transcript loss on app focus change
- auto-save every few seconds during capture
- recover active session after app crash when possible

## Security
- encryption in transit
- encryption at rest
- secure token storage in OS keychain
- audit log hooks for future enterprise edition

## Scalability
- architecture should support many sessions per user
- searchable indexing must remain responsive as history grows

---

# 12. Information Architecture

## 12.1 Main Navigation

- Home
- New Meeting
- Dictation History
- Meetings
- Voice Memos
- Search
- Settings

## 12.2 Session Detail Tabs

- Notes
- Summary
- Actions
- Transcript
- Chat

## 12.3 Data Hierarchy

User  
→ Sessions  
→ Transcript segments  
→ Notes / Outputs  
→ Actions / Exports / Chat

---

# 13. UX Specifications

# 13.1 Global Voice Bar UX

## States
- idle
- listening
- processing
- inserted
- error

## UI elements
- microphone state icon
- elapsed timer
- live transcript preview
- stop button
- rewrite quick actions

## Interaction model
- press hotkey once to start
- press again to stop
- optional press-and-hold mode later

---

# 13.2 Meeting Workspace UX

## Layout
Left sidebar:
- session list / folders / tags

Center pane:
- editable user notes

Right pane:
- live transcript during capture
- AI outputs after session

Top bar:
- title
- timer
- recording state
- generate button
- export/share actions

---

# 13.3 Memory Workspace UX

## Views
- list view
- grouped by date
- filtered by type
- search results view

## Search result card fields
- title
- date
- type
- matching excerpt
- tags

---

# 14. Data Model

## 14.1 User

```ts
interface User {
  id: string
  email: string
  name?: string
  createdAt: string
  updatedAt: string
  settings: UserSettings
}
```

## 14.2 UserSettings

```ts
interface UserSettings {
  preferredLanguage: string
  dictationHotkey: string
  autoPunctuation: boolean
  removeFillers: boolean
  defaultSummaryStyle: string
  syncEnabled: boolean
  retentionDays?: number
  shareDefault: 'private' | 'invited' | 'link'
}
```

## 14.3 Session

```ts
interface Session {
  id: string
  userId: string
  type: 'meeting' | 'dictation' | 'memo'
  title: string
  status: 'draft' | 'recording' | 'processing' | 'complete' | 'error'
  sourceApp?: string
  startedAt?: string
  endedAt?: string
  durationSec?: number
  language?: string
  folderId?: string
  tags: string[]
  metadata?: Record<string, unknown>
  createdAt: string
  updatedAt: string
}
```

## 14.4 TranscriptSegment

```ts
interface TranscriptSegment {
  id: string
  sessionId: string
  source: 'mic' | 'system' | 'mixed'
  speakerLabel?: string
  startMs: number
  endMs: number
  text: string
  isFinal: boolean
  confidence?: number
  createdAt: string
}
```

## 14.5 SessionNote

```ts
interface SessionNote {
  id: string
  sessionId: string
  rawUserNotes?: string
  polishedText?: string
  aiSummary?: string
  aiDetailedNotes?: string
  decisions?: string
  actionItems?: string
  followUpDraft?: string
  version: number
  createdAt: string
  updatedAt: string
}
```

## 14.6 ChatMessage

```ts
interface ChatMessage {
  id: string
  sessionId: string
  role: 'user' | 'assistant' | 'system'
  content: string
  citations?: Array<{ segmentId: string; excerpt: string }>
  createdAt: string
}
```

## 14.7 ExportEvent

```ts
interface ExportEvent {
  id: string
  sessionId: string
  destination: 'clipboard' | 'markdown' | 'notion' | 'slack' | 'gmail_text'
  status: 'queued' | 'success' | 'error'
  payload?: Record<string, unknown>
  createdAt: string
}
```

---

# 15. System Architecture

## 15.1 High-Level Architecture

### Client
- Tauri desktop shell
- Rust native layer
- React/TypeScript frontend
- local SQLite database
- local audio capture service
- global shortcut handler

### Backend API
- auth service
- session sync service
- transcript ingestion service
- AI orchestration service
- search/index service
- export/integration service

### External services
- speech-to-text provider
- LLM provider
- object storage if needed
- hosted database

---

# 15.2 Recommended Stack

## Desktop
- **Tauri** for desktop shell
- **Rust** for native integration and performance-sensitive tasks
- **React + TypeScript** for UI
- **Vite** for frontend tooling

## Local persistence
- **SQLite** via Tauri plugin or Rust DB layer

## Backend
- **TypeScript / Node** or **Rust** services
- **Postgres** for primary cloud DB
- **pgvector** optional for semantic retrieval
- **Redis** optional for background job queue state

## AI services
- speech-to-text provider: Deepgram, AssemblyAI, or Whisper-based service
- LLM provider: OpenAI / Anthropic

## Hosting
- Cloudflare Workers + managed DB if lightweight API model fits
- or Fly.io / Railway / Render / AWS for more conventional streaming backend

### Recommended practical path
Use:
- Tauri + React on desktop
- Postgres backend
- hosted STT provider
- hosted LLM provider
- background job worker for summaries and exports

---

# 16. Service Boundaries

## 16.1 Auth Service
Responsibilities:
- login/signup
- token issuance
- user settings retrieval

## 16.2 Session Service
Responsibilities:
- create/update session records
- sync local sessions
- list session history
- tag/folder operations

## 16.3 Transcript Service
Responsibilities:
- accept streaming transcript chunks
- finalize transcript
- store and index segments

## 16.4 AI Orchestration Service
Responsibilities:
- polish dictation output
- generate meeting summaries
- extract actions
- power session chat
- manage prompt templates

## 16.5 Search Service
Responsibilities:
- keyword search
- semantic retrieval optional
- transcript snippet matching

## 16.6 Integration Service
Responsibilities:
- Slack formatting/export
- Notion formatting/export
- Markdown generation
- future Gmail/CRM integrations

---

# 17. Background Jobs

## Job Types

### 1. FinalizeTranscriptJob
- runs when capture stops
- reconciles partial transcript chunks into final transcript

### 2. GenerateMeetingSummaryJob
- creates summary, decisions, actions, follow-up draft

### 3. PolishDictationJob
- refines dictated text into insertion-ready output

### 4. BuildSearchIndexJob
- updates full-text and semantic indexes

### 5. ExportSessionJob
- pushes session output to destination

## Queue behavior
- idempotent jobs
- retriable on transient API errors
- status visible to client

---

# 18. API Design

## 18.1 Example REST Endpoints

### Auth
- `POST /api/auth/login`
- `POST /api/auth/signup`
- `GET /api/me`
- `PATCH /api/me/settings`

### Sessions
- `POST /api/sessions`
- `GET /api/sessions`
- `GET /api/sessions/:id`
- `PATCH /api/sessions/:id`
- `DELETE /api/sessions/:id`

### Transcript
- `POST /api/sessions/:id/transcript-segments`
- `POST /api/sessions/:id/finalize`

### AI
- `POST /api/sessions/:id/generate-summary`
- `POST /api/sessions/:id/polish-dictation`
- `POST /api/sessions/:id/chat`

### Search
- `GET /api/search?q=...`

### Export
- `POST /api/sessions/:id/export`

---

# 19. Example Internal TypeScript Interfaces

## Create session request

```ts
interface CreateSessionRequest {
  type: 'meeting' | 'dictation' | 'memo'
  title?: string
  sourceApp?: string
  language?: string
}
```

## Generate summary request

```ts
interface GenerateSummaryRequest {
  template?: 'general' | 'sales' | 'recruiting' | 'product' | 'research'
  includeFollowUpDraft?: boolean
}
```

## Chat request

```ts
interface SessionChatRequest {
  message: string
  includeSummaryContext?: boolean
  includeTranscriptContext?: boolean
}
```

---

# 20. AI Prompting Strategy

## 20.1 Dictation polishing prompt goals
- preserve meaning
- improve readability
- keep style aligned with destination context
- maintain concise latency footprint

## 20.2 Meeting summary prompt goals
- ground all claims in transcript and user notes
- prioritize high-signal decisions and tasks
- explicitly mark uncertainty
- preserve user wording where useful

## 20.3 Session chat retrieval strategy
- retrieve relevant transcript chunks
- retrieve generated note artifacts
- answer with citations/snippets
- avoid unsupported synthesis when evidence is weak

---

# 21. Permissions and Privacy Design

## Required permissions
- microphone access
- accessibility/automation access only if needed for text insertion depending on implementation
- system audio capture permissions depending on chosen technical path

## User controls
- delete transcript
- delete full session
- disable sync
- disable cloud AI processing if future local mode exists
- set retention period

## Default posture
- conservative sharing
- explicit consent surfaces
- visible recording status

---

# 22. Analytics and Telemetry

## Product metrics
- daily active users
- weekly active users
- sessions per user
- meetings captured per week
- dictation sessions per week
- average dictation duration
- average meeting duration
- summary generation rate
- export rate
- search rate
- chat usage rate

## Quality metrics
- transcript correction rate
- regenerated summary rate
- share rate
- latency percentiles
- insertion success rate
- export success rate

## Retention metrics
- day 1 / day 7 / day 30 retention
- multi-surface retention: users who use both meeting + dictation features

---

# 23. Risks and Mitigations

## Risk 1: System audio capture is brittle
Mitigation:
- start with macOS-first tested path
- support mic-only fallback
- build clear onboarding diagnostics

## Risk 2: Dictation insertion across apps is inconsistent
Mitigation:
- start with copy/paste fallback and supported-app matrix
- instrument insertion success/failure

## Risk 3: AI summaries hallucinate
Mitigation:
- transcript-grounded prompts
- user notes as signal
- citations in chat
- regenerate/edit workflows

## Risk 4: Product feels like two disconnected tools
Mitigation:
- one shared session model
- one search surface
- one memory layer
- shared exports and chat

## Risk 5: Cost of STT + LLM usage
Mitigation:
- aggressive prompt sizing
- chunk reuse
- multiple model tiers
- usage limits by plan

---

# 24. Rollout Plan

## Phase 0: Prototype
- local capture proof of concept
- hotkey dictation proof of concept
- raw transcript + AI summary demo

## Phase 1: V1 MVP
- macOS app
- dictation overlay
- meeting capture
- summaries and action items
- session history
- Markdown export

## Phase 2: Usability and Integrations
- better rewrite commands
- Notion/Slack export
- search improvements
- session chat
- improved onboarding

## Phase 3: Collaboration and Growth
- team workspaces
- shared folders
- calendar integrations
- CRM write-back
- cross-session AI chat

## Phase 4: Platform Expansion
- Windows app
- mobile companion
- API / automation hooks
- enterprise security/admin

---

# 25. Suggested Pricing Model

## Free
- limited monthly transcription minutes
- limited AI summaries
- basic dictation
- local history only or short retention

## Pro
- more transcription minutes
- unlimited session history
- advanced summaries
- search and chat
- exports and integrations

## Team
- shared workspace
- shared folders
- team billing
- admin controls
- better integrations

## Enterprise
- SSO
- retention controls
- audit logs
- custom model/privacy controls
- data governance

---

# 26. Engineering Guidance for an LLM Coding Assistant

## Build priorities
1. get microphone + system audio capture working reliably
2. build local session model and persistence
3. implement streaming transcript UX
4. implement post-session AI summary pipeline
5. implement dictation overlay and insertion loop
6. add search and history
7. add integrations

## Code organization recommendation

```text
/apps
  /desktop
    /src
      /components
      /features
        /dictation
        /meetings
        /memory
        /settings
      /lib
      /hooks
      /pages
    /src-tauri
      /src
        /audio
        /shortcuts
        /storage
        /ipc
        /permissions
/services
  /api
  /workers
/packages
  /shared-types
  /prompt-templates
  /ui
```

## Implementation rules
- keep transcript state incremental and append-only where possible
- separate raw transcript from polished output
- maintain explicit session state machine
- treat all AI outputs as versioned artifacts
- build graceful fallbacks for permissions and insertion failures
- prefer observable state changes for debugging

---

# 27. Session State Machine

```text
DRAFT
  -> RECORDING
  -> PROCESSING
  -> COMPLETE
  -> ERROR
```

## Notes
- `RECORDING`: transcript streaming active
- `PROCESSING`: final transcript and AI jobs running
- `COMPLETE`: outputs available
- `ERROR`: recoverable or unrecoverable failure surfaced to user

---

# 28. Acceptance Criteria for MVP

## Dictation MVP is acceptable if:
- user can invoke overlay with hotkey
- speech converts to readable text
- user can insert text into common apps or copy fallback works
- simple rewrite command works

## Meeting MVP is acceptable if:
- user can start and stop meeting capture
- transcript is saved
- summary is generated
- action items are generated
- user can edit and export results

## Memory MVP is acceptable if:
- user can view prior sessions
- search finds sessions by keyword
- user can reopen a session and review notes/transcript

---

# 29. Future Opportunities

- personal memory graph across all sessions
- app-aware proactive suggestions
- auto-generated tasks synced to task manager
- meeting prep briefs based on past sessions
- role-specific templates and agents
- local on-device inference tier
- multilingual live translation and translation-aware notes
- workflow automations triggered from spoken intent

---

# 30. Final Product Definition

**Voice Workspace** is a desktop-first AI product that combines meeting capture, polished dictation, and searchable voice memory into a single workflow.

It should help users:
- speak instead of type when useful
- stay present in meetings
- generate better notes and follow-ups automatically
- search and reuse everything they said later

The core concept is:

**voice in, structured work out**

