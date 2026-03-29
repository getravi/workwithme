# Evernote Skill Pack

> Claude Code skill pack for Evernote integration (24 skills)

## Installation

```bash
/plugin install evernote-pack@claude-code-plugins-plus
```

## Skills Included

### Standard Skills (S01-S12)
| Skill | Description |
|-------|-------------|
| `evernote-install-auth` | Install SDK and configure OAuth 1.0a authentication |
| `evernote-hello-world` | Create your first note with ENML format |
| `evernote-local-dev-loop` | Set up local development with sandbox testing |
| `evernote-sdk-patterns` | Advanced SDK patterns for search, batch ops, resources |
| `evernote-core-workflow-a` | Note creation and management workflows |
| `evernote-core-workflow-b` | Search, filtering, and retrieval patterns |
| `evernote-common-errors` | Diagnose and fix EDAMUserException/SystemException |
| `evernote-debug-bundle` | Debug tools, ENML validation, token inspection |
| `evernote-rate-limits` | Handle rate limits with retry and queuing |
| `evernote-security-basics` | OAuth security, credential management, input validation |
| `evernote-prod-checklist` | Production readiness checklist |
| `evernote-upgrade-migration` | SDK upgrades and breaking changes |

### Pro Skills (P13-P18)
| Skill | Description |
|-------|-------------|
| `evernote-ci-integration` | GitHub Actions, testing, mocks for CI/CD |
| `evernote-deploy-integration` | Docker, AWS, GCP, Kubernetes deployments |
| `evernote-webhooks-events` | Webhook handling and sync state management |
| `evernote-performance-tuning` | Caching, batching, connection optimization |
| `evernote-cost-tuning` | Quota management, resource optimization |
| `evernote-reference-architecture` | Production architecture patterns |

### Flagship Skills (F19-F24)
| Skill | Description |
|-------|-------------|
| `evernote-multi-env-setup` | Dev/staging/production environment configuration |
| `evernote-observability` | Metrics, logging, tracing, alerting |
| `evernote-incident-runbook` | Incident response procedures |
| `evernote-data-handling` | ENML processing, sync, data export |
| `evernote-enterprise-rbac` | Multi-tenant RBAC and business accounts |
| `evernote-migration-deep-dive` | Bulk data migration strategies |

## Usage

Skills trigger automatically when you discuss Evernote topics. For example:

- "Help me set up Evernote" triggers `evernote-install-auth`
- "Debug this Evernote error" triggers `evernote-common-errors`
- "Deploy my Evernote integration" triggers `evernote-deploy-integration`
- "Search for notes" triggers `evernote-core-workflow-b`
- "Handle rate limits" triggers `evernote-rate-limits`

## Quick Start

1. **Get API Key**: Request from [Evernote Developer Portal](https://dev.evernote.com/)
2. **Install SDK**:
   ```bash
   npm install evernote
   # or
   pip install evernote
   ```
3. **Configure OAuth**: Set up environment variables:
   ```bash
   EVERNOTE_CONSUMER_KEY=your-key
   EVERNOTE_CONSUMER_SECRET=your-secret
   EVERNOTE_SANDBOX=true
   ```
4. **Create First Note**: Use `evernote-hello-world` skill

## Evernote API Overview

- **Authentication**: OAuth 1.0a (developer tokens for sandbox only)
- **Content Format**: ENML (Evernote Markup Language)
- **Rate Limits**: Per API key, per user, per hour
- **SDKs**: JavaScript, Python, iOS, Android, Java, PHP, Ruby

## Key Concepts

- **NoteStore**: Manages notes, notebooks, tags, resources
- **UserStore**: Manages user accounts and authentication
- **ENML**: XML-based content format (subset of XHTML)
- **Resources**: Attachments (images, PDFs, files)
- **Sync**: Update Sequence Numbers (USN) for incremental sync

## Resources

- [Evernote Developer Portal](https://dev.evernote.com/)
- [API Documentation](https://dev.evernote.com/doc/)
- [JavaScript SDK](https://github.com/Evernote/evernote-sdk-js)
- [Python SDK](https://github.com/Evernote/evernote-sdk-python)
- [ENML Reference](https://dev.evernote.com/doc/articles/enml.php)
- [Search Grammar](https://dev.evernote.com/doc/articles/search_grammar.php)

## License

MIT
