# OpenEvidence Skill Pack

> Claude Code skill pack for OpenEvidence medical AI integration (24 skills)

## Installation

```bash
/plugin install openevidence-pack@claude-code-plugins-plus
```

## About OpenEvidence

OpenEvidence is the leading AI-powered medical evidence platform for clinicians. Developed as part of Mayo Clinic Platform Accelerate and powering Elsevier's ClinicalKey AI, OpenEvidence provides:

- Evidence-based answers from peer-reviewed research
- Clinical decision support at the point of care
- DeepConsult for comprehensive medical research synthesis
- HIPAA-compliant, SOC 2 Type II certified platform
- Integration with Epic, Cerner, and other EHR systems via HL7 FHIR

## Skills Included

### Standard Skills (S01-S12)
| Skill | Description |
|-------|-------------|
| `openevidence-install-auth` | Install and configure OpenEvidence API authentication |
| `openevidence-hello-world` | Create your first OpenEvidence clinical query |
| `openevidence-local-dev-loop` | Set up local development environment |
| `openevidence-sdk-patterns` | OpenEvidence SDK patterns and best practices |
| `openevidence-core-workflow-a` | Clinical Query workflow for point-of-care decisions |
| `openevidence-core-workflow-b` | DeepConsult workflow for comprehensive research |
| `openevidence-common-errors` | Common error codes and solutions |
| `openevidence-debug-bundle` | Debugging and troubleshooting toolkit |
| `openevidence-rate-limits` | Rate limiting and request optimization |
| `openevidence-security-basics` | HIPAA compliance and PHI handling |
| `openevidence-prod-checklist` | Production readiness checklist |
| `openevidence-upgrade-migration` | API version upgrades and migrations |

### Pro Skills (P13-P18)
| Skill | Description |
|-------|-------------|
| `openevidence-ci-integration` | CI/CD pipeline integration |
| `openevidence-deploy-integration` | Deployment strategies for healthcare environments |
| `openevidence-webhooks-events` | Webhook configuration for async responses |
| `openevidence-performance-tuning` | Query optimization and response caching |
| `openevidence-cost-tuning` | API cost optimization strategies |
| `openevidence-reference-architecture` | Production architecture patterns |

### Flagship Skills (F19-F24)
| Skill | Description |
|-------|-------------|
| `openevidence-multi-env-setup` | Multi-environment configuration |
| `openevidence-observability` | Monitoring, metrics, and alerting |
| `openevidence-incident-runbook` | Incident response procedures |
| `openevidence-data-handling` | PHI data handling and retention |
| `openevidence-enterprise-rbac` | Enterprise SSO and access control |
| `openevidence-migration-deep-dive` | EHR integration migrations |

## Usage

Skills trigger automatically when you discuss OpenEvidence topics. For example:

- "Help me set up OpenEvidence" -> triggers `openevidence-install-auth`
- "Query OpenEvidence for drug interactions" -> triggers `openevidence-core-workflow-a`
- "Set up HIPAA-compliant logging" -> triggers `openevidence-security-basics`

## Healthcare Compliance Notice

OpenEvidence integrations handle Protected Health Information (PHI). Ensure your implementation follows:

- HIPAA Privacy, Security, and Breach Notification Rules
- BAA (Business Associate Agreement) requirements
- Data encryption at rest (AES-256) and in transit (TLS 1.2+)
- Audit logging for all PHI access

## Resources

- [OpenEvidence](https://www.openevidence.com/)
- [OpenEvidence Security](https://www.openevidence.com/security)
- [API Terms of Service](https://www.openevidence.com/policies/api)

## License

MIT
