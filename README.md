# Developer Stats Dashboard

A comprehensive dashboard to track your engineering statistics across GitHub, GitLab, and Jira.

## Features

- **GitHub Integration**: Track all your pull requests, merge rates, and average time to merge
- **GitLab Integration**: Monitor merge requests across all your GitLab projects
- **Jira Integration**: Track issues, velocity, resolution times, and sprint metrics
- **Combined Overview**: See all your contributions in one place with FTE/P2 benchmark comparisons
- **Real-time Updates**: Auto-refreshes every 5 minutes
- **Date Range Filtering**: Filter stats by custom date ranges (work year, last 6/12 months, etc.)

## Setup

### 1. Install Dependencies

```bash
npm run install-all
```

### 2. Configure Environment Variables

Copy `.env.example` to `.env` and fill in your credentials:

```bash
cp .env.example .env
```

#### GitHub Setup
1. Go to GitHub Settings → Developer settings → Personal access tokens → Tokens (classic)
2. Generate a new token with `public_repo` scope (or `repo` for private repos)
3. Add your GitHub username and token to `.env`

#### GitLab Setup
1. Go to GitLab → Preferences → Access Tokens
2. Create a token with `api` scope
3. Add your GitLab username, token, and base URL to `.env`
   - For GitLab.com, use: `https://gitlab.com`
   - For self-hosted, use your instance URL

#### Jira Setup
1. Go to your Jira instance → Profile → Personal Access Tokens
2. Create a new Personal Access Token (PAT)
3. Add your Jira PAT and base URL to `.env`
   - For Disney Jira: `https://jira.disney.com`
   - For Atlassian Cloud: `https://your-domain.atlassian.net`
   - For self-hosted: your instance URL

### 4. Run the Application

```bash
npm run dev
```

This will start:
- Backend server on `http://localhost:3001`
- Frontend React app on `http://localhost:3000`

## API Endpoints

- `GET /api/stats` - Get all stats from GitHub, GitLab, and Jira
- `GET /api/stats/github` - Get GitHub stats only
- `GET /api/stats/gitlab` - Get GitLab stats only
- `GET /api/stats/jira` - Get Jira stats only
- `GET /api/stats/leaderboard` - Get stats for all users (leaderboard)
- `GET /api/health` - Health check endpoint
- `GET /api/debug/env` - Check which environment variables are set (for debugging)

## Leaderboard Configuration

The leaderboard page displays stats for multiple users. Users can be configured in several ways:

### Option 1: Extract from Engineering-Metrics Source Files (Recommended)

Since engineering-metrics has users hardcoded in source files, you can extract them automatically:

1. **Run the extraction script** to generate `server/config/users.json`:

```bash
node server/utils/extractUsersFromEngineeringMetrics.js [path-to-engineering-metrics]
```

If engineering-metrics is in a sibling directory (`../engineering-metrics`), you can omit the path:

```bash
node server/utils/extractUsersFromEngineeringMetrics.js
```

The script reads users from:
- `individual_github/github.js` (GitHub usernames)
- `individual_gitlab/user_processing/gitlab.js` (GitLab user IDs)
- `JIRA/jira_authored.js`, `JIRA/jira_coding_overall.js`, `JIRA/jira_coding_ctoi.js` (JIRA email addresses)

You can also use the npm script:
```bash
npm run extract-users
```

2. **Or set `ENGINEERING_METRICS_PATH`** to extract on-the-fly:

```bash
ENGINEERING_METRICS_PATH=/path/to/engineering-metrics
```

The system will automatically extract users from the source files when the server starts.

### Option 2: Load from Engineering-Metrics API

Set the `ENGINEERING_METRICS_USERS_URL` environment variable to fetch users directly from an API:

```bash
ENGINEERING_METRICS_USERS_URL=https://engineering-metrics.example.com/api/users
```

The API should return an array of user objects in one of these formats:
```json
[
  {
    "id": "user1",
    "github": { "username": "user1" },
    "gitlab": { "username": "user1" },
    "jira": { "email": "user1@example.com" }
  }
]
```

### Option 3: Load from Engineering-Metrics JSON File

Set the `ENGINEERING_METRICS_USERS_FILE` environment variable to load users from a local JSON file:

```bash
ENGINEERING_METRICS_USERS_FILE=/path/to/engineering-metrics-users.json
```

### Option 4: Use Config File (Default)

Create `server/config/users.json` manually with user IDs/usernames:

```json
[
  {
    "id": "user1",
    "github": {
      "username": "user1"
    },
    "gitlab": {
      "username": "user1"
    },
    "jira": {
      "email": "user1@example.com"
    }
  }
]
```

**Note**: You only need to set your own tokens (`GITHUB_TOKEN`, `GITLAB_TOKEN`, `JIRA_PAT`) in environment variables. The system will use these tokens to query stats for all users listed in the config.

## Metrics Tracked

### GitHub
- Total pull requests (all time, last 30/90 days)
- Merged vs open PRs
- Average time to merge
- PRs by repository

### GitLab
- Total merge requests (all time, last 30/90 days)
- Merged vs open MRs
- Average time to merge
- MRs by project

### Jira
- Total issues (all time, last 30/90 days)
- Resolved vs in progress vs done
- Average resolution time
- Issues by type (Bug, Story, Task, Epic)
- Issues by project
- Sprint velocity (story points per sprint)
- Velocity trends over time

### Combined Overview
- Total PRs/MRs across both platforms
- Average PRs/MRs per month (with FTE/P2 benchmarks)
- Total comments authored
- Average comments per month (with FTE/P2 benchmarks)

## Project Structure

```
developer-stats/
├── server/
│   ├── index.js           # Express server
│   ├── services/
│   │   ├── github.js      # GitHub API integration
│   │   ├── gitlab.js      # GitLab API integration
│   │   └── jira.js        # Jira API integration
│   └── utils/
│       ├── dateHelpers.js # Date range utilities
│       └── statsHelpers.js # Stats calculation utilities
├── client/
│   ├── src/
│   │   ├── App.js         # Main app component
│   │   ├── components/    # React components
│   │   │   ├── JiraSection.js # Jira-specific UI component
│   │   │   └── ...
│   │   └── utils/
│   │       └── combinedStats.js # Combined stats calculations
│   └── public/
└── package.json
```

## Notes

- **Credentials Required**: All services require proper API credentials to function. The dashboard will show errors if credentials are missing or invalid.
- API rate limits are respected with pagination
- Sprint velocity calculation uses 2-week sprints (approximate)
- Data is fetched on-demand, not cached (refresh manually or wait for auto-refresh)

## Troubleshooting

**GitHub API errors**: Make sure your token has the correct scopes and isn't expired.

**GitLab API errors**: Verify your base URL is correct (including `https://`).

**Jira API errors**: 
- Make sure your PAT is correct and not expired
- Verify your `JIRA_BASE_URL` is correct (including `https://`)
- Check that your PAT has the necessary permissions for JQL queries
- If you get 403 errors, your PAT may have restricted JQL access - try using email-based queries instead

**CORS errors**: Make sure the frontend proxy is configured correctly in `client/package.json`.

**GitHub Enterprise**: If using GitHub Enterprise Server, set `GITHUB_BASE_URL` to your instance URL (e.g., `https://github.yourcompany.com`).

