# Voice Workspace PRD
## Unified Product Covering Granola + Wispr Flow

## 1. Overview

Build a unified voice-native productivity workspace that combines:
- Granola-style meeting capture and AI meeting notes
- Wispr Flow-style system-wide voice dictation and rewriting

The product should help users:
1. capture meetings without a bot,
2. dictate polished text into any app,
3. turn spoken context into summaries, tasks, drafts, and searchable memory.

This product is not just a meeting note taker and not just a dictation app. It is a voice operating layer for knowledge work.

## 2. Product Vision

Create the best tool for people who spend their day:
- in meetings,
- writing emails and documents,
- switching between apps,
- trying not to lose context.

### Core promise
Speak naturally anywhere, and the system turns your voice into useful work.

That includes:
- meeting summaries,
- action items,
- polished writing,
- follow-up emails,
- CRM updates,
- searchable memory across all voice interactions.

## 3. Goals

### Primary goals
- Reduce manual note-taking effort during meetings
- Let users write across apps with voice faster than typing
- Preserve useful context from meetings and dictated content
- Convert raw speech into structured outputs automatically

### Business goals
- Build a differentiated wedge broader than AI meeting notes
- Increase daily usage by combining meetings + everyday dictation
- Create a durable memory layer that improves retention
- Open future monetization through premium workflows, teams, and integrations

## 4. Target Users

### Primary ICP
Knowledge workers who both:
- attend frequent meetings, and
- produce lots of written communication

### Examples
- founders
- product managers
- recruiters
- sales reps
- customer success managers
- consultants
- analysts
- operators
- researchers
- lawyers
- journalists

## 5. Problem Statement

Users face two related problems:

### Problem A: Meetings are high-friction
People want to stay engaged in conversation but also need accurate notes, decisions, and follow-ups.

### Problem B: Writing everywhere is repetitive
Users spend hours writing:
- emails,
- Slack messages,
- docs,
- CRM updates,
- plans,
- summaries.

Voice tools often help with raw transcription but not enough with polished output.

### Problem C: Context gets lost
Meeting notes live in one place, dictated content in another, and action items somewhere else. There is no unified memory layer.

## 6. Product Thesis

A unified product should merge:
- capture
- rewriting
- memory
- action

### Capture
Listen during meetings or dictation sessions.

### Rewriting
Turn messy speech into polished, context-appropriate output.

### Memory
Store transcripts, notes, summaries, and generated artifacts in one searchable system.

### Action
Use captured speech to generate useful outputs:
- follow-ups
- tasks
- updates
- documents
- CRM entries

## 7. Product Principles

1. User-first, not bot-first  
   The product should feel like a personal workspace, not a meeting bot.

2. Low friction  
   Starting capture or dictation should be instant.

3. Editable by default  
   AI output is a draft users can trust, inspect, and change.

4. Context-aware  
   Output should adapt to the user’s current context: meeting, email, chat, document, etc.

5. Unified memory  
   All spoken work should become retrievable later.

6. Privacy-sensitive  
   Clear controls around retention, sharing, recording, and model usage.

## 8. Product Definition

### Working category
Voice Workspace

### One-sentence positioning
A voice-native workspace that captures meetings, writes across apps, and turns spoken context into searchable memory and action.

## 9. Product Surfaces

The product should have three core surfaces.

### Surface A: Global Voice Bar
A lightweight overlay for system-wide dictation into any app.

Use cases:
- email drafting
- Slack replies
- docs
- forms
- search boxes
- journaling
- quick notes

Responsibilities:
- start/stop dictation
- live transcription
- smart rewrite before insertion
- commands
- correction/backtracking
- personalized tone

### Surface B: Meeting Companion
A dedicated window for meeting capture and note-taking.

Use cases:
- Zoom, Meet, Teams, Slack calls
- in-person meetings
- customer calls
- interviews
- internal syncs

Responsibilities:
- capture mic + system audio
- show live transcript
- let user take rough notes
- mark decisions / moments
- generate post-meeting notes
- produce follow-up outputs

### Surface C: Memory Workspace
A searchable library of captured sessions and generated artifacts.

Use cases:
- look up past decisions
- search customer pain points
- review action items
- reuse prior language
- chat with one session or many sessions

Responsibilities:
- session history
- full-text search
- AI chat
- folders/tags
- exports
- sharing

## 10. Core Feature Set

### 10.1 Meeting Mode
Granola-style capabilities.

Features:
- start a meeting note in one click
- capture system audio and microphone audio
- live transcription
- rich note editor
- AI-enhanced post-meeting notes
- action item extraction
- decision extraction
- follow-up email generation
- meeting templates
- searchable transcript and summary
- chat with a meeting
- folder/tag organization
- sharing/export

### 10.2 Dictation Mode
Wispr Flow-style capabilities.

Features:
- global hotkey to start dictation
- works in any text field where possible
- polished text insertion
- punctuation inference
- filler word removal
- support for backtracking corrections
- command support
- list formatting
- personalized writing style
- multilingual dictation
- app-aware formatting modes

### 10.3 Unified Memory Layer
The main differentiator.

Features:
- all sessions stored in one searchable timeline
- meetings, dictation sessions, voice memos, and generated outputs linked together
- cross-session AI chat
- semantic search
- source-grounded responses
- per-session metadata
- personal glossary / custom vocabulary

### 10.4 Action Layer
Turn captured speech into useful work.

Output types:
- summaries
- action items
- email drafts
- Slack drafts
- PRD drafts
- CRM updates
- meeting recaps
- call notes
- journal entries
- task extraction

## 11. v1 Scope

Build desktop-first v1.

### In scope
1. macOS desktop app
2. global dictation overlay
3. meeting capture window
4. live transcription
5. AI rewrite before insertion
6. post-meeting summary generation
7. action item extraction
8. searchable session history
9. single-session AI chat
10. export to clipboard / markdown
11. basic settings and privacy controls

### Nice to have in v1 if feasible
- app-aware writing modes
- templates for meeting summaries
- folders/tags
- follow-up email generator
- Notion export

### Out of scope for v1
- Windows native app
- full mobile apps
- enterprise admin
- SSO/SAML
- team workspace permissions
- CRM sync
- cross-session team memory
- API platform
- browser extension
- advanced workflow automations

## 12. User Stories

### 12.1 Meeting capture
- As a user, I can open the app and start capturing a meeting quickly.
- As a user, I can type rough notes while the meeting is happening.
- As a user, I receive a structured summary after the meeting.
- As a user, I can review decisions and action items without rereading the whole transcript.

### 12.2 Dictation
- As a user, I can press a hotkey and dictate into any app.
- As a user, my speech is converted into polished text rather than raw transcription.
- As a user, I can say corrections naturally and have the output update.
- As a user, I can use voice to create lists, bullets, and short messages.

### 12.3 Retrieval
- As a user, I can search across meetings and dictation sessions.
- As a user, I can ask what was decided in a prior discussion.
- As a user, I can find action items or follow-ups tied to a session.

### 12.4 Output generation
- As a user, I can generate an email draft from a meeting.
- As a user, I can convert dictated thoughts into a polished document.
- As a user, I can export a summary into another tool.

## 13. Key Workflows

### Workflow A: Dictate anywhere
1. User presses global hotkey
2. Voice bar opens
3. User speaks
4. System transcribes and rewrites text in real time or near-real time
5. User inserts cleaned output into active app

### Workflow B: Capture a meeting
1. User opens Meeting Companion
2. Starts meeting capture
3. System records mic + system audio
4. User types rough notes if desired
5. Transcript accumulates live
6. On finish, system generates structured recap

### Workflow C: Retrieve context later
1. User opens Memory Workspace
2. Searches for a topic, person, or phrase
3. Opens session
4. Reviews transcript, summary, and generated outputs
5. Chats with the session to extract specifics

## 14. Functional Requirements

### 14.1 Desktop shell
- native-feeling macOS app
- fast startup
- background processing support
- global hotkey support
- permission handling for mic/system audio/accessibility if needed

### 14.2 Dictation engine
- microphone capture
- streaming STT
- real-time partial transcripts
- rewrite layer before insertion
- support insert/replace behavior
- handle punctuation and capitalization
- support natural language corrections

### 14.3 Meeting capture
- mic capture
- system audio capture
- live transcript view
- optional note editor alongside transcript
- finish meeting manually
- background finalization pipeline after meeting ends

### 14.4 AI generation
The system must support:
- summarize transcript
- combine transcript + user notes
- extract decisions
- extract action items
- draft follow-up message
- rewrite dictated text based on output mode

### 14.5 Search and memory
- store transcript text
- store generated artifacts
- full-text search
- semantic retrieval for AI chat
- filters by type/date/tag

### 14.6 Sharing/export
- copy to clipboard
- export markdown
- export plain text
- optionally share note by link in later versions

### 14.7 Settings
- transcription language
- default dictation style
- retention policy
- hotkey customization
- privacy/model usage settings
- export defaults

## 15. UX Requirements

### 15.1 Voice bar
Should feel:
- instant
- minimal
- non-intrusive
- reliable

Basic states:
- idle
- listening
- processing
- preview
- inserted
- error

### 15.2 Meeting window
Three-column layout recommended:
- left: session list / metadata
- center: notes editor
- right: transcript / AI outputs

Alternative:
- center editor + right tabbed sidebar for transcript, summary, and chat

### 15.3 Memory workspace
Views:
- all sessions
- meetings
- dictation sessions
- starred
- recent

Each session card should show:
- title
- type
- date/time
- duration
- short summary
- tags

## 16. Information Architecture

- Home
- New Dictation
- New Meeting
- All Sessions
- Meetings
- Dictation
- Starred
- Tags/Folders
- Settings

Inside a session:
- Overview
- Transcript
- Notes
- Summary
- Actions
- Chat

## 17. Output Modes

The dictation layer should support modes such as:
- default polished prose
- concise email
- Slack message
- bullet list
- meeting note
- brainstorming
- formal writing

The meeting layer should support templates such as:
- internal sync
- 1:1
- sales call
- customer interview
- recruiting interview
- project review
- standup

## 18. Success Metrics

### Activation
- % of users who complete first dictation
- % of users who complete first meeting capture

### Engagement
- dictation sessions per week
- meetings captured per week
- search/chat usage
- summaries generated per week

### Retention
- 7-day retention
- 30-day retention
- % of users using both meetings and dictation

### Quality
- transcript accuracy
- user acceptance of rewritten text
- summary satisfaction
- action item precision
- hallucination rate

## 19. Risks

### 1. Product sprawl
If too many features land at once, the product feels unfocused.

### 2. Clunky insertion UX
A dictation tool only works if insertion is fast and reliable.

### 3. Audio capture complexity
System audio capture is technically tricky and platform-specific.

### 4. Privacy concerns
Always-on or ambient-feeling products can make users nervous.

### 5. Hallucinated outputs
Summaries and action items must remain grounded in source material.

## 20. Strategic Differentiation

The winning angle is not “we do meetings and dictation.”

It is:
we turn spoken work into reusable knowledge and action.

That means the moat is:
- unified memory
- context-aware output
- strong insertion UX
- high trust
- workflow depth over time

## 21. Pricing Hypothesis

### Free
- limited dictation minutes
- limited meeting summaries
- basic history window

### Pro
- unlimited or high-limit dictation
- meeting capture
- AI summaries
- memory search
- chat
- export/templates

### Team
- shared folders
- admin controls
- retention controls
- integrations
- team search and collaboration

## 22. Recommended v1 Build Plan

### Phase 1: Core foundation
- desktop shell
- microphone capture
- transcription pipeline
- local session store
- basic session UI

### Phase 2: Dictation MVP
- global hotkey
- voice bar
- rewrite engine
- insertion workflow

### Phase 3: Meeting MVP
- system audio capture
- note editor
- transcript finalization
- summary + action items

### Phase 4: Memory MVP
- session library
- search
- single-session AI chat
- markdown export

### Phase 5: Polish
- templates
- app-aware modes
- settings
- onboarding
- analytics

## 23. Recommended Tech Direction

### Frontend/Desktop
- Tauri
- Rust
- React
- TypeScript

### Local storage
- SQLite

### Backend
- Postgres
- object storage for optional artifacts
- auth service

### AI/ML
- streaming speech-to-text provider
- LLM for rewrite/summarization
- embeddings for semantic retrieval

### Search
- Postgres full text + vector retrieval

## 24. What to Hand to an LLM Coding Assistant

Tell the coding assistant to optimize for:
- desktop-first performance
- modular architecture
- privacy-aware defaults
- clean abstractions between dictation, meeting capture, and memory
- fast local-first UX with cloud-enhanced AI processing

It should treat the product as:
1. input capture layer,
2. transformation layer,
3. memory layer,
4. action/output layer.

## 25. Final Product Summary

This product should be built as a voice-native workspace that combines:
- the best of AI meeting notes,
- the best of voice dictation,
- and a shared memory/action system that makes both better.

The best initial version is a focused desktop app that helps users:
- speak in meetings,
- dictate across apps,
- and recover everything later as useful, structured work.
