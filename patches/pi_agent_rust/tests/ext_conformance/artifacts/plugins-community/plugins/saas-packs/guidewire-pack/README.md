# Guidewire Skill Pack

> Claude Code skill pack for Guidewire InsuranceSuite integration (24 skills)

## Installation

```bash
/plugin install guidewire-pack@claude-code-plugins-plus
```

## Skills Included

### Standard Skills (S01-S12)
| Skill | Description |
|-------|-------------|
| `guidewire-install-auth` | Install Auth - Set up Guidewire SDK, Studio, and configure Cloud API authentication |
| `guidewire-hello-world` | Hello World - First API calls to PolicyCenter, ClaimCenter, and BillingCenter |
| `guidewire-local-dev-loop` | Local Dev Loop - Configure Guidewire Studio and local development workflow |
| `guidewire-sdk-patterns` | SDK Patterns - Digital SDK, REST API Client, and Gosu patterns |
| `guidewire-core-workflow-a` | Core Workflow A - Policy lifecycle management (quote, bind, issue, endorse) |
| `guidewire-core-workflow-b` | Core Workflow B - Claims processing (FNOL, investigation, settlement) |
| `guidewire-common-errors` | Common Errors - InsuranceSuite error codes and resolution patterns |
| `guidewire-debug-bundle` | Debug Bundle - Debugging Gosu, Cloud API, and integration issues |
| `guidewire-rate-limits` | Rate Limits - Cloud API quotas and throttling management |
| `guidewire-security-basics` | Security Basics - OAuth2, JWT, API roles, and secure Gosu coding |
| `guidewire-prod-checklist` | Prod Checklist - Production deployment readiness for Guidewire Cloud |
| `guidewire-upgrade-migration` | Upgrade Migration - Version upgrades and Cloud migration paths |

### Pro Skills (P13-P18)
| Skill | Description |
|-------|-------------|
| `guidewire-ci-integration` | CI Integration - Automated testing and build pipelines for Guidewire |
| `guidewire-deploy-integration` | Deploy Integration - Guidewire Cloud deployment strategies |
| `guidewire-webhooks-events` | Webhooks Events - App Events, message queuing, and async integration |
| `guidewire-performance-tuning` | Performance Tuning - Query optimization and batch processing |
| `guidewire-cost-tuning` | Cost Tuning - License optimization and cloud resource management |
| `guidewire-reference-architecture` | Reference Architecture - Enterprise InsuranceSuite architecture patterns |

### Flagship Skills (F19-F24)
| Skill | Description |
|-------|-------------|
| `guidewire-multi-env-setup` | Multi Env Setup - Dev, staging, and production environment configuration |
| `guidewire-observability` | Observability - Logging, monitoring, and alerting for InsuranceSuite |
| `guidewire-incident-runbook` | Incident Runbook - Production incident response procedures |
| `guidewire-data-handling` | Data Handling - Entity management, data migration, and batch operations |
| `guidewire-enterprise-rbac` | Enterprise RBAC - Role-based access control and API permissions |
| `guidewire-migration-deep-dive` | Migration Deep Dive - Self-managed to Cloud migration strategies |

## Usage

Skills trigger automatically when you discuss Guidewire topics. For example:

- "Help me set up Guidewire" triggers `guidewire-install-auth`
- "Debug this PolicyCenter error" triggers `guidewire-common-errors`
- "Deploy my Guidewire integration" triggers `guidewire-deploy-integration`
- "Create a new claim in ClaimCenter" triggers `guidewire-core-workflow-b`

## About Guidewire

Guidewire is the leading platform for P&C (Property & Casualty) insurance carriers. The InsuranceSuite includes:

- **PolicyCenter** - Policy administration for quoting, binding, and policy lifecycle
- **ClaimCenter** - Claims management from FNOL to settlement
- **BillingCenter** - Premium billing and payment processing
- **Jutro Digital Platform** - Modern frontend framework for insurance portals
- **Cloud Platform** - Managed cloud infrastructure and APIs

## Resources

- [Guidewire Developer Portal](https://developer.guidewire.com/)
- [Guidewire Documentation](https://docs.guidewire.com/)
- [Cloud API Reference](https://docs.guidewire.com/cloud/pc/202503/apiref/)
- [Gosu Programming Language](https://gosu-lang.github.io/)

## License

MIT
