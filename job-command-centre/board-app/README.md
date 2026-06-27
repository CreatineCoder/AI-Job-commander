# Board app (React)

Modular React + CSS source for the Job Command Centre board. The Lemma pod serves
a single static file at [`../apps/board/index.html`](../apps/board/index.html); this
project builds the whole app (JS + CSS inlined) into that one file via
[`vite-plugin-singlefile`](https://www.npmjs.com/package/vite-plugin-singlefile),
so the pod keeps shipping a single self-contained HTML page.

The Lemma client SDK is **not** bundled — it's still loaded at runtime from the pod
host (`/public/sdk/lemma-client.js`), honoring `window.__LEMMA_CONFIG__`, exactly as
the original did. See [src/lib/lemma.js](src/lib/lemma.js).

## Develop

```bash
npm install
npm run dev      # local dev server (SDK loads from window.location.origin)
```

## Build / deploy

```bash
npm run build    # emits ../apps/board/index.html
```

Then import the pod as usual:

```bash
lemma pods import ../../job-command-centre
```

## Layout

```
src/
  main.jsx               app entry
  App.jsx                boot (auth, load), top-level state, modal routing
  AppContext.jsx         shared client/data/reload context
  styles/global.css      design tokens + all element styles (from the original)
  lib/
    constants.js         stages, agent/table names, org + auth-config ids
    lemma.js             runtime SDK loader + singleton client
    records.js           field() record accessor
    helpers.js           listOf / scoreColor / asArray / follow-up state
    data.js              load, permissions, polling, gmail auth-url
  hooks/useTheme.js      light/dark theme persistence
  components/
    Loading / Fatal / SignIn / Header / StatBar / FollowupBanner
    Board / Column / Card
    Modal                overlay shell
    AddJobModal          paste resume + JD → parser_scorer agent
    DetailModal          full application view + edit
    detail/
      OutreachSection        generate → approve → send recruiter email
      FollowupSection        draft / send / mark-done follow-ups
      ResumeImproveSection   re-check gaps after a resume update
```
