# Jira Skill

Browse and manage Jira issues using the jira-cli tool.

## Overview

This skill enables interacting with Jira from the command line. You can:
- List, view, create, and edit issues
- Transition issues between statuses
- Manage comments and worklogs
- Work with epics and sprints
- Search using JQL

## Installation

1. Install jira-cli:
   ```bash
   brew install jira-cli
   ```

2. Get API token: https://id.atlassian.com/manage-profile/security/api-tokens

3. Configure:
   ```bash
   export JIRA_API_TOKEN="your-token"
   jira init
   ```

## Quick Start

```bash
# List your assigned issues
jira issue list --assignee "$(jira me)"

# View an issue
jira issue view ISSUE-123

# Create an issue
jira issue create "Fix the bug"

# Start working on an issue
jira issue transition ISSUE-123 "In Progress"

# Mark as done
jira issue transition ISSUE-123 "Done"
```

## See Also

- [Jira CLI GitHub](https://github.com/ankitpokhrel/jira-cli)
- [Jira CLI Wiki](https://github.com/ankitpokhrel/jira-cli/wiki)
- [SKILL.md](./SKILL.md) - Full documentation
