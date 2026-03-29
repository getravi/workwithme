# Speak Skill Pack

> Claude Code skill pack for Speak AI Language Learning Platform integration (24 skills)

## Installation

```bash
/plugin install speak-pack@claude-code-plugins-plus
```

## About Speak

[Speak](https://speak.com) is an AI-powered language learning platform focused on speaking practice. Features include:

- **AI Tutors**: Personalized AI tutors that adapt to your learning style
- **Speech Recognition**: Real-time pronunciation feedback and scoring
- **Conversation Practice**: Natural dialogue practice without a live tutor
- **Personalized Lessons**: Curriculum tailored to individual learners
- **Progress Tracking**: Detailed metrics on pronunciation, vocabulary, and fluency

### Supported Languages
- English, Spanish, French, German, Portuguese (Brazilian)
- Korean, Japanese, Mandarin (Traditional & Simplified), Indonesian

## Skills Included

### Standard Skills (S01-S12)
| Skill | Description |
|-------|-------------|
| `speak-install-auth` | Install SDK and configure API authentication |
| `speak-hello-world` | Create your first lesson session |
| `speak-local-dev-loop` | Set up development environment with mocks |
| `speak-sdk-patterns` | Production-ready SDK patterns |
| `speak-core-workflow-a` | AI conversation practice implementation |
| `speak-core-workflow-b` | Pronunciation training with phoneme analysis |
| `speak-common-errors` | Diagnose and fix common errors |
| `speak-debug-bundle` | Collect diagnostic information for support |
| `speak-rate-limits` | Handle rate limiting and backoff |
| `speak-security-basics` | API key security and audio privacy |
| `speak-prod-checklist` | Production deployment checklist |
| `speak-upgrade-migration` | SDK version upgrades |

### Pro Skills (P13-P18)
| Skill | Description |
|-------|-------------|
| `speak-ci-integration` | GitHub Actions and automated testing |
| `speak-deploy-integration` | Deploy to Vercel, Fly.io, Cloud Run |
| `speak-webhooks-events` | Handle lesson and progress events |
| `speak-performance-tuning` | Optimize audio processing and caching |
| `speak-cost-tuning` | Optimize usage and control costs |
| `speak-reference-architecture` | Best-practice project structure |

### Flagship Skills (F19-F24)
| Skill | Description |
|-------|-------------|
| `speak-multi-env-setup` | Dev/staging/production configuration |
| `speak-observability` | Metrics, tracing, and alerting |
| `speak-incident-runbook` | Incident response procedures |
| `speak-data-handling` | GDPR/CCPA compliance and audio privacy |
| `speak-enterprise-rbac` | SSO, roles, and organization management |
| `speak-migration-deep-dive` | Platform migration strategies |

## Usage

Skills trigger automatically when you discuss Speak topics. For example:

- "Help me set up Speak" triggers `speak-install-auth`
- "Debug this Speak error" triggers `speak-common-errors`
- "Deploy my Speak integration" triggers `speak-deploy-integration`
- "Add pronunciation practice" triggers `speak-core-workflow-b`

## Quick Start

```typescript
import { SpeakClient, AITutor } from '@speak/language-sdk';

// Initialize client
const client = new SpeakClient({
  apiKey: process.env.SPEAK_API_KEY!,
  appId: process.env.SPEAK_APP_ID!,
  language: 'es', // Learning Spanish
});

// Create AI tutor session
const tutor = new AITutor(client, {
  targetLanguage: 'es',
  nativeLanguage: 'en',
  proficiencyLevel: 'beginner',
});

// Start a conversation practice
const session = await tutor.startSession({
  topic: 'greetings',
  duration: 10, // minutes
});

// Get AI prompt
const prompt = await session.getPrompt();
console.log('Tutor:', prompt.text);

// Submit response and get feedback
const feedback = await session.submitResponse({
  text: 'Hola, me llamo Juan',
});
console.log('Pronunciation Score:', feedback.pronunciationScore);
```

## Key Features

### AI Conversation Practice
Build natural dialogue experiences with real-time feedback on grammar, vocabulary, and pronunciation.

### Speech Recognition & Scoring
Process user audio for accurate transcription and detailed pronunciation analysis down to the phoneme level.

### Progress Tracking
Track learning progress including streaks, vocabulary acquisition, and pronunciation improvement over time.

### Enterprise Support
SSO integration, team management for schools and businesses, and comprehensive audit logging.

## Resources

- [Speak Website](https://speak.com)
- [Speak Developer Documentation](https://developer.speak.com/docs)
- [Speak API Reference](https://developer.speak.com/api)
- [Speak Status Page](https://status.speak.com)

## License

MIT
