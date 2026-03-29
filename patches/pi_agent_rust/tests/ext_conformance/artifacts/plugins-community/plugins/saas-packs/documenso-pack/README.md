# Documenso Skill Pack

> Claude Code skill pack for Documenso integration (24 skills)

## Installation

```bash
/plugin install documenso-pack@claude-code-plugins-plus
```

## Skills Included

### Standard Skills (S01-S12)
| Skill | Description |
|-------|-------------|
| `documenso-install-auth` | Install and configure Documenso SDK/API authentication |
| `documenso-hello-world` | Create minimal working Documenso example |
| `documenso-local-dev-loop` | Local development and testing workflow |
| `documenso-sdk-patterns` | Production SDK patterns for TypeScript/Python |
| `documenso-core-workflow-a` | Document creation and recipient management |
| `documenso-core-workflow-b` | Templates and direct signing links |
| `documenso-common-errors` | Common error patterns and solutions |
| `documenso-debug-bundle` | Debugging tools and techniques |
| `documenso-rate-limits` | Rate limiting and backoff strategies |
| `documenso-security-basics` | Security best practices for signing |
| `documenso-prod-checklist` | Production deployment checklist |
| `documenso-upgrade-migration` | API version upgrades (v1 to v2) |

### Pro Skills (P13-P18)
| Skill | Description |
|-------|-------------|
| `documenso-ci-integration` | CI/CD pipeline integration |
| `documenso-deploy-integration` | Deployment strategies |
| `documenso-webhooks-events` | Webhook configuration and event handling |
| `documenso-performance-tuning` | Performance optimization |
| `documenso-cost-tuning` | Cost optimization strategies |
| `documenso-reference-architecture` | Reference architecture patterns |

### Flagship Skills (F19-F24)
| Skill | Description |
|-------|-------------|
| `documenso-multi-env-setup` | Multi-environment configuration |
| `documenso-observability` | Monitoring and observability |
| `documenso-incident-runbook` | Incident response procedures |
| `documenso-data-handling` | Document and signature data management |
| `documenso-enterprise-rbac` | Enterprise RBAC and team management |
| `documenso-migration-deep-dive` | Full migration strategies |

## Usage

Skills trigger automatically when you discuss Documenso topics. For example:

- "Help me set up Documenso" -> triggers `documenso-install-auth`
- "Debug this Documenso error" -> triggers `documenso-common-errors`
- "Configure Documenso webhooks" -> triggers `documenso-webhooks-events`
- "Deploy my Documenso integration" -> triggers `documenso-deploy-integration`

## About Documenso

Documenso is the open-source DocuSign alternative, providing:

- **Document Signing**: Electronic signatures with full legal compliance
- **Templates**: Reusable document templates with pre-configured fields
- **API v2**: Modern REST API with TypeScript, Python, and Go SDKs
- **Webhooks**: Real-time event notifications for document lifecycle
- **Self-Hosting**: Full control with Docker deployment options
- **Embedding**: React, Vue, Svelte, and other framework integrations

## Resources

- [Documenso Documentation](https://docs.documenso.com)
- [Documenso API v2](https://openapi.documenso.com)
- [TypeScript SDK](https://github.com/documenso/sdk-typescript)
- [Python SDK](https://github.com/documenso/sdk-python)
- [Documenso GitHub](https://github.com/documenso/documenso)

## License

MIT
