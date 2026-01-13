# Supporting Artifact — Nilay Barde | P3 Promotion

---

## Performance Metrics (FY25)

| Metric | Result |
|--------|--------|
| **Velocity** | 10.3 SP/sprint (vs 5.8 avg) |
| **Merge Requests** | 22/month (vs 11 avg) |
| **Code Review Comments** | 196 (vs 103 avg) |
| **CTOI Incidents Handled** | 75 tickets |
| **JIRA Tickets Created** | 154 (scoping & breakdown) |

---

## Engineering Output (Sep 2024 – Jan 2026)

| Metric | Count |
|--------|-------|
| Months Active | 17 |
| Total Work Items | 707 |
| Jira Issues | 324 |
| GitLab MRs | 337 |
| GitHub PRs | 46 |
| Story Points | 418 |

---

## Feature Impact

| Feature | Clicks | % of Engagement |
|---------|--------|-----------------|
| Bet Six Pack | 567K+ | 47% |
| Odds Strip | 282K+ | 23% |
| Odds Column | 118K+ | 7% |
| **Total** | **~970K** | **77%** |

**Next Gen Gamecast:** 144% engagement growth (9.5K → 23K weekly users)

---

## Peer & Leadership Feedback

| Source | Quote |
|--------|-------|
| **Manager** | "MVP-level impact on Odds Strip 1.1; sustained technical leadership and betting SME status" |
| **Lead** | "De facto leader"; "Moves quickly on complex tasks with high ownership" |
| **Senior Eng** | "Recognized as squad lead in all but title" |

---

## Feature Work Summary (Jan 2025 – Jan 2026)

| Feature | Tickets | Story Points |
|---------|---------|--------------|
| **Exclusives Carousel** | 40 | 68 SP |
| **Odds Strip 1.1** | 42 | 62.5 SP |
| **MyBets / Bet Carousel** | 26 | 42 SP |
| **Cover Probability** *(in progress)* | 12+ | ~30 SP |
| **Six Pack** | 16 | 23.5 SP |
| **Toggle/Location Gating** | 13 | 15.5 SP |
| **DraftKings Migration** | 12 | 15 SP |

---

## Key Projects & Artifacts

### Exclusives Carousel (Feb–Aug 2025)

Complete feature build: carousel, expanded modals, ExclusiveCard, iframe integration, location gating.

- 40 tickets, 68 story points
- Includes BetCardViewThatFits component ([MR #365](https://gitlab.disney.com/dtci/webdev/espn/core/-/merge_requests/365))

### Odds Strip 1.1 (Mar–Sep 2025)

Major platform upgrade adding Exclusives parlay bets within the Odds Strip on sCore pages.

- 42 tickets, 62.5 story points
- **Technical Challenge:** Browser memory limitations caused page crashes when multiple iframe-based Exclusives were open simultaneously
- **Solution:** Built lifecycle management that auto-closes previous Odds Strips when opening a new one, preventing memory overflow
- Key tickets: SEWEB-57013 (Multiple Handshakes fix), SEWEB-54611 (Iframe integration), SEWEB-56050 (Hide when not operating)

### MyBets / Bet Carousel (Apr–Aug 2025)

Full feature: parsing, expanded modals, carousel arrows, dark mode, documentation.

- 26 tickets, 42 story points
- [MyBets Documentation](https://jira.disney.com/browse/SEWEB-57174)

### DraftKings Migration (Nov 2025)

6-week confidential platform migration across core, fitt, prism.

- [MR #740](https://gitlab.disney.com/dtci/webdev/espn/core/-/merge_requests/740) — Core component updates
- [MR #5272](https://gitlab.disney.com/dtci/webdev/espn/fitt/-/merge_requests/5272) — ESPN Bet → DraftKings launch

### Cover Probability (Dec 2025 – Present) 🚧

In progress: data parsing, Game Flow components, filters, BottomSheet UI.

- ~30 SP, 12+ tickets
- SEWEB-60311, SEWEB-54827, SEWEB-60377, SEWEB-59183

### Betting Toggle & Gating

Full implementation + [Engineering Guide](https://confluence.disney.com/pages/viewpage.action?pageId=1625316242)

- 13 tickets, 15.5 SP
- Created `useDisableLinks`, `useBettingContent` hooks
- Built debugging params: `_userZip`, `bettingContentEnabled`, `bettingLinksEnabled`

---

## Bug Fixes & Quality

| Ticket | Fix |
|--------|-----|
| CTOI-60825 | Double analytics calls on Odds Strip |
| CTOI-60824 | Incorrect sport abbreviations in GP4 |
| CTOI-60826 | Incorrect bet clicks on non-linked odds |

---

## Shared Components & DX Improvements

- **BottomSheet** → [MR #341](https://gitlab.disney.com/dtci/webdev/espn/core/-/merge_requests/341) — Moved from fitt to core
- **Generic Filter** → SEWEB-59183 — Converted to reusable pattern
- **Storybook Theme** → SEWEB-54330 — Proactively added Next Gen Gamecast theme to core Storybook, enabling engineers to toggle between legacy and new themes during component development

---

*Data from Engineering Logbook API*
