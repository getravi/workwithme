# Lokalise Skill Pack

> Claude Code skill pack for Lokalise translation management system integration (24 skills)

## Installation

```bash
/plugin install lokalise-pack@claude-code-plugins-plus
```

## Skills Included

### Standard Skills (S01-S12)
| Skill | Description |
|-------|-------------|
| `lokalise-install-auth` | Install Lokalise SDK/CLI and configure API token authentication |
| `lokalise-hello-world` | Create minimal working Lokalise example with projects and keys |
| `lokalise-local-dev-loop` | Set up local development with file sync and hot reload |
| `lokalise-sdk-patterns` | Production-ready SDK patterns for Node.js and TypeScript |
| `lokalise-core-workflow-a` | Core workflow: Upload source files and manage translation keys |
| `lokalise-core-workflow-b` | Core workflow: Download translations and integrate with app |
| `lokalise-common-errors` | Diagnose and fix common Lokalise API errors |
| `lokalise-debug-bundle` | Collect debug evidence for support tickets |
| `lokalise-rate-limits` | Handle 6 req/sec rate limits with queuing and backoff |
| `lokalise-security-basics` | Secure API tokens and implement least privilege access |
| `lokalise-prod-checklist` | Production deployment checklist for Lokalise integration |
| `lokalise-upgrade-migration` | SDK version upgrades and breaking change handling |

### Pro Skills (P13-P18)
| Skill | Description |
|-------|-------------|
| `lokalise-ci-integration` | GitHub Actions CI/CD for automated translation sync |
| `lokalise-deploy-integration` | Deploy with Lokalise CLI to Vercel, Netlify, Cloud Run |
| `lokalise-webhooks-events` | Handle Lokalise webhooks for translation and key events |
| `lokalise-performance-tuning` | Optimize with caching, pagination, and bulk operations |
| `lokalise-cost-tuning` | Optimize Lokalise subscription costs and usage |
| `lokalise-reference-architecture` | Best-practice project layout for Lokalise integration |

### Flagship Skills (F19-F24)
| Skill | Description |
|-------|-------------|
| `lokalise-multi-env-setup` | Configure Lokalise across dev/staging/prod environments |
| `lokalise-observability` | Metrics, traces, and alerts for Lokalise operations |
| `lokalise-incident-runbook` | Incident response for Lokalise-related issues |
| `lokalise-data-handling` | Handle translation data, PII, and compliance |
| `lokalise-enterprise-rbac` | Enterprise SSO, roles, and team management |
| `lokalise-migration-deep-dive` | Migrate to Lokalise from other TMS platforms |

## Usage

Skills trigger automatically when you discuss Lokalise topics. For example:

- "Help me set up Lokalise" -> triggers `lokalise-install-auth`
- "Debug this Lokalise error" -> triggers `lokalise-common-errors`
- "Set up CI for translations" -> triggers `lokalise-ci-integration`
- "Handle Lokalise webhooks" -> triggers `lokalise-webhooks-events`

## About Lokalise

Lokalise is a translation management system (TMS) for software localization. Key features include:
- REST API with 6 requests/sec rate limit
- Official Node.js SDK (`@lokalise/node-api`)
- CLI tool (`lokalise2`) for file operations
- Webhooks for real-time event notifications
- OTA (Over-The-Air) updates for mobile apps
- GitHub/GitLab integrations
- Translation memory and glossary

## License

MIT
