# Developer Stats Dashboard

A comprehensive dashboard to track your engineering statistics across GitHub and GitLab.

## Features

- **GitHub Integration**: Track all your pull requests, merge rates, and average time to merge
- **GitLab Integration**: Monitor merge requests across all your GitLab projects
- **Combined Overview**: See all your contributions in one place with FTE/P2 benchmark comparisons
- **Real-time Updates**: Auto-refreshes every 5 minutes
- **Date Range Filtering**: Filter stats by custom date ranges (work year, last 6/12 months, etc.)

## Setup

### 1. Install Dependencies

```bash
npm run install-all
```

### 2. (Optional) Try with Mock Data

The dashboard will automatically use mock data if API credentials are not configured. You can run the app immediately to see how it works:

```bash
npm run dev
```

### 3. Configure Environment Variables (Optional)

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

### 3. Run the Application

```bash
npm run dev
```

This will start:
- Backend server on `http://localhost:3001`
- Frontend React app on `http://localhost:3000`

## API Endpoints

- `GET /api/stats` - Get all stats from GitHub and GitLab
- `GET /api/stats/github` - Get GitHub stats only
- `GET /api/stats/gitlab` - Get GitLab stats only
- `GET /api/health` - Health check endpoint
- `GET /api/debug/env` - Check which environment variables are set (for debugging)

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
│   │   └── gitlab.js      # GitLab API integration
│   └── utils/
│       ├── dateHelpers.js # Date range utilities
│       └── statsHelpers.js # Stats calculation utilities
├── client/
│   ├── src/
│   │   ├── App.js         # Main app component
│   │   ├── components/    # React components
│   │   └── utils/
│   │       └── combinedStats.js # Combined stats calculations
│   └── public/
└── package.json
```

## Notes

- **Mock Data**: If API credentials are not configured, the dashboard will automatically use realistic mock data so you can explore the interface immediately
- The dashboard gracefully handles missing credentials (uses mock data instead of showing errors)
- API rate limits are respected with pagination
- Sprint velocity calculation uses 2-week sprints (approximate)
- Data is fetched on-demand, not cached (refresh manually or wait for auto-refresh)

## Troubleshooting

**GitHub API errors**: Make sure your token has the correct scopes and isn't expired.

**GitLab API errors**: Verify your base URL is correct (including `https://`).

**CORS errors**: Make sure the frontend proxy is configured correctly in `client/package.json`.

**GitHub Enterprise**: If using GitHub Enterprise Server, set `GITHUB_BASE_URL` to your instance URL (e.g., `https://github.yourcompany.com`).

