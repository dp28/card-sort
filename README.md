# Card Sort

A mobile-first, client-side web app for sorting difficult-to-rank lists through repeated pairwise comparisons.

## Features

- Enter one item per line and start a sorting session.
- Choose the preferred item from each pair until the app produces a full ordering.
- Persist progress locally in `localStorage`.
- Copy a share link that encodes the current sorting state in the URL.
- Deploy as a static Cloudflare Pages app for `https://card-sort.djpdev.com`.

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

## Cloudflare Pages

The app builds to `dist` and includes a `wrangler.toml` with the Pages output directory.

```sh
npm run deploy
```

Configure the production custom domain `card-sort.djpdev.com` on the Cloudflare Pages project named `card-sort`.
