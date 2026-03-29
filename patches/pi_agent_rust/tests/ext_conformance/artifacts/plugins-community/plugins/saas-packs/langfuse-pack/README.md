# Langfuse Skill Pack

> Claude Code skill pack for Langfuse LLM observability integration (24 skills)

## Installation

```bash
/plugin install langfuse-pack@claude-code-plugins-plus
```

## Skills Included

### Standard Skills (S01-S12)
| Skill | Description |
|-------|-------------|
| `langfuse-install-auth` | Install SDK and configure authentication |
| `langfuse-hello-world` | First trace with minimal code |
| `langfuse-local-dev-loop` | Local development with trace debugging |
| `langfuse-sdk-patterns` | SDK best practices and patterns |
| `langfuse-core-workflow-a` | Tracing LLM calls and spans |
| `langfuse-core-workflow-b` | Evaluation and scoring workflows |
| `langfuse-common-errors` | Debug common Langfuse issues |
| `langfuse-debug-bundle` | Collect diagnostic info for support |
| `langfuse-rate-limits` | Handle rate limits and batching |
| `langfuse-security-basics` | API key security and data privacy |
| `langfuse-prod-checklist` | Production readiness verification |
| `langfuse-upgrade-migration` | SDK version upgrades and migrations |

### Pro Skills (P13-P18)
| Skill | Description |
|-------|-------------|
| `langfuse-ci-integration` | GitHub Actions and CI/CD testing |
| `langfuse-deploy-integration` | Deploy Langfuse with your app |
| `langfuse-webhooks-events` | Webhooks and event callbacks |
| `langfuse-performance-tuning` | Optimize tracing performance |
| `langfuse-cost-tuning` | Monitor and optimize LLM costs |
| `langfuse-reference-architecture` | Production-grade architecture |

### Flagship Skills (F19-F24)
| Skill | Description |
|-------|-------------|
| `langfuse-multi-env-setup` | Dev/staging/prod environments |
| `langfuse-observability` | Metrics, dashboards, and alerts |
| `langfuse-incident-runbook` | Troubleshooting and incident response |
| `langfuse-data-handling` | Data export, retention, and compliance |
| `langfuse-enterprise-rbac` | Organization and access control |
| `langfuse-migration-deep-dive` | Complex migration scenarios |

## Usage

Skills trigger automatically when you discuss Langfuse topics. For example:

- "Help me set up Langfuse" -> triggers `langfuse-install-auth`
- "Debug this Langfuse trace" -> triggers `langfuse-common-errors`
- "Track LLM costs with Langfuse" -> triggers `langfuse-cost-tuning`
- "Add tracing to my LLM app" -> triggers `langfuse-core-workflow-a`

## What is Langfuse?

[Langfuse](https://langfuse.com) is an open-source LLM observability platform that provides:

- **Tracing**: Track LLM calls, chains, and agents end-to-end
- **Evaluation**: Score outputs with human feedback or automated evals
- **Analytics**: Monitor costs, latency, and usage patterns
- **Prompt Management**: Version and deploy prompts
- **Self-hosted or Cloud**: Deploy anywhere or use managed cloud

## License

MIT
