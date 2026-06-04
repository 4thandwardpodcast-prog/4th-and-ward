# Jimmys & Joes — Deployment Checklist

Step-by-step list of everything you need to do (outside the codebase) before
the Jimmys & Joes feature works end-to-end in production. Run through these
once after pulling the J&J changes; afterwards, normal `git push` deploys are
all that's needed.

---

## 1. One-time Firebase console steps

### a. Enable Authentication providers
Console → **Authentication** → **Sign-in method**:
- **Google** — enable, support email `4thandwardpodcast@gmail.com`
- **Email/Password** — enable (leave email-link off)

Then **Authentication → Settings → Authorized domains** — confirm your
Vercel production domain is listed (e.g. `4thandward.com`).

### b. Storage Buckets
Already configured for Pulse/Drip. No new buckets needed for J&J — we don't
upload any prospect-side media (videos are YouTube/Hudl embeds, not files
we host).

---

## 2. Install dependencies

From the repo root:

```bash
npm install
```

This installs `@vercel/og` (added for the OG-image generator). Vercel runs
`npm install` automatically on each deploy, so on Vercel this is automatic
— you only need to run it locally if you want to test before push.

---

## 3. Deploy Firebase artifacts

```bash
firebase deploy --only firestore:rules,firestore:indexes,functions
```

What this ships:
- New Firestore rules for `prospects`, `prospect_ratings`, `prospect_comments`,
  `comment_votes`, `coach_profiles`, `users`, `users_public`.
- 5 new composite indexes (J&J leaderboard queries, scout leaderboard).
- 5 new Cloud Functions:
  - `recomputeProspectRating` — aggregates ratings into the J&J score
  - `awardRatingPoints` — gamification points + streaks + badges
  - `awardCommentVotePoints` — comment upvote count + author points
  - `mirrorUserPublic` — sync safe profile fields to `users_public` mirror
  - (existing Wardle / Pulse functions untouched)

Without this step:
- Submissions fail with permission errors
- Ratings are saved but never aggregate (the J&J score stays 0)
- Hall of Scouts stays empty
- Coach approvals fail

---

## 4. Vercel deploy

`git push` to the branch wired to your Vercel project. Vercel auto-deploys.
Routes added in `vercel.json`:

| URL                                         | Maps to                                |
|---------------------------------------------|----------------------------------------|
| `/jimmysandjoes`                            | hub page                               |
| `/jimmysandjoes/submit`                     | single-prospect submission form        |
| `/jimmysandjoes/leaderboards`               | Top 25 by class × position             |
| `/jimmysandjoes/rankings`                   | Strongest / Fastest / Size+Speed / Trending |
| `/jimmysandjoes/scouts`                     | Hall of Scouts                         |
| `/jimmysandjoes/how-it-works`               | rating formula explainer               |
| `/jimmysandjoes/team/<slug>`                | team aggregation page                  |
| `/jimmysandjoes/prospect/<slug>`            | **server-rendered** prospect profile   |
| `/coach`                                    | coach landing + verification form      |
| `/coach/dashboard`                          | coach's own submissions                |
| `/coach/bulk-upload`                        | CSV bulk-upload roster tool            |
| `/api/jj-og?n=…&p=…&r=…`                    | per-prospect OG image (PNG)            |
| `/sitemap-jimmys.xml`                       | dynamic sitemap of approved prospects  |

No new Vercel env vars are required. The OG generator (`api/jj-og.js`) and
the server-rendered prospect handler (`api/jj-prospect.js`) both use the
public Firestore REST API (read-only, scoped to approved status by the
existing security rules), so there's no service account or secret to manage.

---

## 5. Smoke-test path

1. Sign up via the **Log In** button (your admin email auto-promotes you).
2. Visit `/jimmysandjoes/submit` and submit a fake prospect with a YouTube link.
3. Visit `/admin` → **Pending Prospects** → **Approve**.
4. Visit `/jimmysandjoes` — the prospect appears in the grid.
5. Click into the profile, hit **★ Rate & Comment**, submit a rating.
6. Wait ~5 seconds, refresh — `jjRating` updates, your `points` appear on `/account`.
7. Hit **Share** on the profile — copies the canonical URL. Paste it into Twitter or iMessage to verify the OG card renders.
8. Visit `/sitemap-jimmys.xml` — your prospect should be listed.

---

## 6. Manual moderation needed

These flows require admin attention regularly:
- **`/admin → Pending Prospects`** — approve new submissions before they go live
- **`/admin → Coach Verifications`** — verify or reject coach applications
- Spot-check the **All Prospects** view for bad data or duplicates

The Pending counts surface as red badges on the sidebar items, and refresh
on a 60-second poll, so you'll see them when you open the admin page.

---

## 7. What's intentionally NOT shipped

These were left for a later sub-phase — call them out if you want them next:

- **Profile claiming** (a coach claims an existing prospect for their team)
- **Production score normalization** (the 15% Production component currently
  returns 0 and the weight redistributes; needs per-position stat thresholds)
- **Comment reply threads** (the schema has `parentId` but no UI)
- **Random rating multipliers** for the "Rate a Random Jimmy" button
- **True weekly leaderboard** (currently a proxy: scouts with `lastRatedDate`
  in last 7 days, sorted by all-time points)
- **Email notifications** for coach approval, prospect approval, etc.
- **Automated school-email verification** in coach signup (currently
  admin manually decides)

---

## 8. Where to edit common things

| What you want to change                          | File                                  |
|--------------------------------------------------|---------------------------------------|
| Add a position or rename one                     | `js/jj-config.js` → `POSITIONS`       |
| Change trait sliders for a position              | `js/jj-config.js` → `TRAITS_BY_POSITION` |
| Add an accolade or change point weight           | `js/jj-config.js` → `ACCOLADES` AND keep `JJ_ACCOLADE_POINTS` in `functions/index.js` in sync |
| Change scoring formula weights                   | `js/jj-config.js` → `SCORE_WEIGHTS` AND `JJ_WEIGHTS` in `functions/index.js` |
| Change minimum ratings before stars show         | `js/jj-config.js` → `MIN_RATINGS_FOR_STARS` |
| Add a new badge                                  | `js/jj-config.js` → `BADGES` AND `JJ_BADGES` in `functions/index.js` |
| Change points per rating / upvote                | `js/jj-config.js` → `POINTS` AND `JJ_POINTS` in `functions/index.js` |
| Change CSV bulk-upload columns                   | `js/jj-csv.js` → `CSV_COLUMNS`        |
| OG image design                                  | `api/jj-og.js`                        |
| What the privacy policy says                     | `privacy.html`                        |

Anything labeled "**AND keep in sync**" is duplicated between the browser
config and the Cloud Function — the function uses CommonJS and can't import
the ES module, so the values are copied. Comments in both files flag this.
