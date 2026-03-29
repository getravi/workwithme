# TwinMind Skill Pack

> Claude Code skill pack for TwinMind AI meeting assistant integration (24 skills)

## Installation

```bash
/plugin install twinmind-pack@claude-code-plugins-plus
```

## About TwinMind

TwinMind is an AI-powered meeting assistant and "second brain" that:
- Records and transcribes meetings in 140+ languages with Ear-3 speech model (5.26% WER)
- Generates summaries and extracts action items automatically
- Integrates with Google Calendar, Zoom, Meet, Teams, and more
- Provides memory vault for past conversation recall
- Works via Chrome extension and mobile apps (iOS/Android)
- Processes audio on-device for privacy (no recordings stored)

## Skills Included

### Standard Skills (S01-S12)
| Skill | Description |
|-------|-------------|
| `twinmind-install-auth` | Install Chrome extension, mobile app, and configure account |
| `twinmind-hello-world` | First meeting transcription and AI summary |
| `twinmind-local-dev-loop` | Development workflow with TwinMind API |
| `twinmind-sdk-patterns` | Production patterns for TwinMind integration |
| `twinmind-core-workflow-a` | Meeting transcription and summary workflow |
| `twinmind-core-workflow-b` | Action item extraction and follow-up automation |
| `twinmind-common-errors` | Diagnose transcription and sync errors |
| `twinmind-debug-bundle` | Collect diagnostic data for TwinMind issues |
| `twinmind-rate-limits` | Handle API limits and optimize token usage |
| `twinmind-security-basics` | Privacy controls and data handling |
| `twinmind-prod-checklist` | Production deployment checklist |
| `twinmind-upgrade-migration` | Upgrade between TwinMind plan tiers |

### Pro Skills (P13-P18)
| Skill | Description |
|-------|-------------|
| `twinmind-ci-integration` | CI pipeline integration for meeting workflows |
| `twinmind-deploy-integration` | Deploy TwinMind to production environments |
| `twinmind-webhooks-events` | Handle meeting events and webhooks |
| `twinmind-performance-tuning` | Optimize transcription accuracy and speed |
| `twinmind-cost-tuning` | Optimize costs across Free/Pro/Enterprise tiers |
| `twinmind-reference-architecture` | Reference architecture for meeting AI systems |

### Flagship Skills (F19-F24)
| Skill | Description |
|-------|-------------|
| `twinmind-multi-env-setup` | Multi-environment configuration |
| `twinmind-observability` | Monitoring and alerting for TwinMind |
| `twinmind-incident-runbook` | Incident response for meeting failures |
| `twinmind-data-handling` | GDPR compliance and data retention |
| `twinmind-enterprise-rbac` | Enterprise role-based access control |
| `twinmind-migration-deep-dive` | Migrate from other meeting AI tools |

## Usage

Skills trigger automatically when you discuss TwinMind topics. For example:

- "Help me set up TwinMind" → triggers `twinmind-install-auth`
- "Debug this transcription error" → triggers `twinmind-common-errors`
- "Deploy my TwinMind integration" → triggers `twinmind-deploy-integration`
- "Migrate from Otter.ai" → triggers `twinmind-migration-deep-dive`

## Key Features

### Ear-3 Speech Model
- Industry-leading 5.26% Word Error Rate (WER)
- 3.8% Diarization Error Rate for speaker labeling
- 140+ language support
- $0.23/hour transcription cost

### Privacy-First Architecture
- On-device audio processing
- No audio recordings stored
- Local transcript storage with optional encrypted cloud backup
- GDPR and privacy regulation compliant

### Platform Integration
- Google Calendar, Meet, Docs, Gmail
- Zoom, Microsoft Teams
- Slack, LinkedIn, GitHub
- Chrome extension + iOS/Android apps

## License

MIT
