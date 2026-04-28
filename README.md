# Card Sort

A mobile-first, installable PWA for sorting difficult-to-rank lists through repeated pairwise comparisons.

## Features

- Enter one item per line and start a sorting session.
- Choose the preferred item from each pair until the app produces a full ordering.
- Persist the current sort locally in `localStorage`.
- Keep a local history of every completed sort, including the time it was sorted and the order at that time.
- Copy a share link for only the current list state. Your local sort history is never included in share links.
- Install as a PWA with a card-based icon and offline app shell.
- Deploy as static assets on a Cloudflare Worker for `https://card-sort.djpdev.com`.

## Development

```sh
npm install
npm run dev
```

## Verification

```sh
npm run lint
npm run build
```

## Cloudflare Worker deploy

The app builds to `dist` and deploys those files as Cloudflare Workers Static Assets. The `wrangler.toml` is configured for the existing Worker named `card-sort` and serves `index.html` for unmatched navigation routes.

```sh
npm run deploy
```

Configure the production custom domain `card-sort.djpdev.com` as a route/custom domain for the `card-sort` Worker.

## GitHub Actions deploy credentials

The workflow in `.github/workflows/deploy.yml` deploys `main` to the Cloudflare Worker after lint and build pass. Add these repository secrets in GitHub under **Settings > Secrets and variables > Actions > Repository secrets**:

- `CLOUDFLARE_ACCOUNT_ID`: your Cloudflare account ID.
  - In Cloudflare, open the account dashboard and copy the Account ID from the right sidebar, or run `wrangler whoami` locally if already authenticated.
- `CLOUDFLARE_API_TOKEN`: an API token allowed to deploy this Worker.
  - In Cloudflare, go to **My Profile > API Tokens > Create Token**.
  - Use **Custom token** with:
    - Account permissions: `Workers Scripts:Edit`
    - Account resources: include the account that owns the `card-sort` Worker
  - Copy the token value once and store it as the GitHub secret.

The workflow deploys to the Cloudflare Worker named `card-sort`, which should have a dashboard path like `/workers/services/view/card-sort/production`.

If deployment fails with an authorization error, check that `CLOUDFLARE_ACCOUNT_ID` matches the account in the Worker URL and that the API token is scoped to that same account.
