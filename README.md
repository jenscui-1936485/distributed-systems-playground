# Distributed Systems Playground

Interactive, browser-only simulations of five distributed-systems ideas: queue delivery, cache freshness, rate limiting, resilience, and replica consistency.

Each lab is a deterministic model. The same settings and seed always produce the same timeline, so a configuration can be replayed, saved, and compared. These are teaching models, not production infrastructure.

## Run locally

```bash
npm install
npm run dev
```

Open the URL Vite prints (usually `http://localhost:5173`).

```bash
npm run build    # typecheck and write dist/
npm run preview  # serve the built site
npm run check    # replay the simulations and assert the lab outcomes
```

The app uses hash routing (`/#/labs/queue`), so a static file host can refresh any screen without a rewrite rule.

## Labs

- **Queue Processing.** Workers, retries, ordering, and idempotency. A crash before ack shows duplicate work, and an idempotent consumer makes the redelivery harmless.
- **Cache Behavior.** TTL, invalidate-on-write, and write-through for a single price key. TTL limits how long a stale read can last. It does not make the write visible immediately. A second writer can still lose an update.
- **Rate Limiting.** Fixed window, sliding window, and token bucket. A boundary spike shows why a fixed window can admit about twice its limit.
- **Resilience.** Timeout, retry, backoff, and a circuit breaker while a fault is injected. An outage with immediate retries is the retry storm.
- **Database Consistency.** Eventual, strong, read-your-writes, and monotonic reads across a lagging replica set. Stronger reads take longer and can time out. Faster reads can be stale.

Progress, saved configurations, and recent runs live in `localStorage` under `distributed-systems-playground-v1`.

## Assumptions worth knowing

- Time is a discrete tick. Play, pause, step, and the scrubber all move that clock.
- The queue has one consumer crash, and unacked work goes to the tail only for at-least-once delivery.
- The cache holds one key. Reads do not refresh TTL.
- Rate-limit windows are counted in ticks. Burst capacity applies only to the token bucket.
- Resilience uses one client. An open circuit pauses the next call instead of sending the rest of the retry budget.
- Consistency uses one primary. Replica N applies a write after `lag + (N - 1)` ticks. Monotonic reads remember versions a client has read, not versions it has written.

## Deploy to GitHub Pages

This is a static Vite app. A workflow at `.github/workflows/pages.yml` builds `dist` and publishes it with GitHub Pages on pushes to `main` or `master`.

In the repository settings, set **Pages → Build and deployment → Source** to **GitHub Actions**.

The workflow sets `VITE_BASE` to `/<repository-name>/`, which is what a project site needs. For this repository the public URL is:

`https://jenscui-1936485.github.io/distributed-systems-playground/#/labs`

For a user site published from `<user>.github.io`, set `VITE_BASE` to `/` in the workflow instead. Local `npm run dev` and `npm run build` leave the base as `./` when `VITE_BASE` is unset.

To publish without Actions, run `npm run build` and upload the `dist` directory to any static host.

## Limitations

- One queue, one cache key, one client in the resilience lab, and uniform replica lag. Real systems add networks, partial failure, and membership changes these models leave out.
- Metrics are for the scripted scenario on screen. They are comparable across settings, and they are not capacity numbers for a production cluster.
- Saved data never leaves the browser. Another machine, or a cleared site storage, starts empty.
