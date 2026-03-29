# MaintainX Skill Pack

> Claude Code skill pack for MaintainX CMMS integration (24 skills)

## Installation

```bash
/plugin install maintainx-pack@claude-code-plugins-plus
```

## Skills Included

### Standard Skills (S01-S12)
| Skill | Description |
|-------|-------------|
| `maintainx-install-auth` | Install and configure MaintainX API authentication |
| `maintainx-hello-world` | Create your first work order via the API |
| `maintainx-local-dev-loop` | Set up local development with MaintainX sandbox |
| `maintainx-sdk-patterns` | REST API patterns and client wrappers |
| `maintainx-core-workflow-a` | Work Order lifecycle management |
| `maintainx-core-workflow-b` | Asset and Location management |
| `maintainx-common-errors` | Debug common MaintainX API errors |
| `maintainx-debug-bundle` | Comprehensive debugging toolkit |
| `maintainx-rate-limits` | Handle rate limits and pagination |
| `maintainx-security-basics` | API key security and access control |
| `maintainx-prod-checklist` | Production deployment checklist |
| `maintainx-upgrade-migration` | API version migration guide |

### Pro Skills (P13-P18)
| Skill | Description |
|-------|-------------|
| `maintainx-ci-integration` | CI/CD pipeline integration |
| `maintainx-deploy-integration` | Deployment automation patterns |
| `maintainx-webhooks-events` | Webhook setup and event handling |
| `maintainx-performance-tuning` | Optimize API performance |
| `maintainx-cost-tuning` | Optimize API usage and costs |
| `maintainx-reference-architecture` | Production architecture patterns |

### Flagship Skills (F19-F24)
| Skill | Description |
|-------|-------------|
| `maintainx-multi-env-setup` | Multi-environment configuration |
| `maintainx-observability` | Monitoring and alerting setup |
| `maintainx-incident-runbook` | Incident response procedures |
| `maintainx-data-handling` | Data sync and ETL patterns |
| `maintainx-enterprise-rbac` | Enterprise role-based access |
| `maintainx-migration-deep-dive` | Complete platform migration |

## Usage

Skills trigger automatically when you discuss MaintainX topics. For example:

- "Help me set up MaintainX API" -> triggers `maintainx-install-auth`
- "Create a work order" -> triggers `maintainx-core-workflow-a`
- "Debug this MaintainX error" -> triggers `maintainx-common-errors`
- "Set up webhooks for MaintainX" -> triggers `maintainx-webhooks-events`

## About MaintainX

MaintainX is a cloud-based Computerized Maintenance Management System (CMMS) that helps industrial teams manage:

- **Work Orders**: Create, assign, track, and complete maintenance tasks
- **Assets**: Track equipment, parts, and inventory
- **Preventive Maintenance**: Schedule recurring maintenance tasks
- **Procedures**: Digital checklists and standard operating procedures
- **Locations**: Organize assets by facility and area
- **Messaging**: Team communication and notifications

## API Reference

- Base URL: `https://api.getmaintainx.com/v1/`
- Documentation: [maintainx.dev](https://maintainx.dev/)
- Authentication: Bearer token (API key)

## License

MIT
