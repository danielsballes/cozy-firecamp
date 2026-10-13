# Fogata Retro

A 3D room in the browser for a team's retrospectives: a campfire in the forest, 10 chairs and a projection screen. Each attendee is a character; with the camera on, their head is a monitor showing their video, and with the camera off it is a head with a beanie that moves its mouth when they talk. Voice, video and screen sharing go through LiveKit.

## Usage context

- It is for a single team of 7 people (sometimes 8), about 2 retros a month. It is not a public product.
- The owner's two priorities: it must be **lightweight** (runs on ordinary computers) and **cost nothing**.
- LiveKit is used on its free cloud plan. Monthly quotas (checked on 2026-10-09): 5,000 participant minutes, 50 GB of downstream data and 100 concurrent participants. The quota is a hard cap: once exceeded, new connections fail. Tests with a real call also use up minutes.
- Language: everything is in English — code (names, comments), commit messages, docs and interface text.

## Commands

```
npm install
npm run dev      # server + Vite at http://localhost:5173
npm run build    # builds the page into dist/
npm start        # serves dist/ (production)
```

There are no automated tests or linter. `node --check file.js` checks syntax.

## How it is built

Plain JavaScript with modules, no framework or TypeScript.

| File | Responsibility |
| --- | --- |
| `server.js` | Node server with no web dependencies. Issues room tokens (`POST /api/join`), reports whether LiveKit is configured (`GET /api/status`), mounts Vite inside in development and serves `dist/` in production. |
| `src/scene.js` | The whole 3D scene and the characters. Geometry generated in code, no external models. Exports `createScene()`, which returns `{ setPeople, setScreen, setView, setSaver }`. |
| `src/call.js` | `createCall()` (LiveKit) and `createLocalRoom()` ("no call" mode). Both return the same shape. |
| `src/main.js` | Ties scene, call and controls together. Keeps state in the `state` object and redraws with `render()`. |
| `src/styles.css`, `index.html` | Page controls. |

Flow of a join:

1. `main.js` requests a token from `/api/join` with room, name and, if one was picked, seat.
2. `server.js` creates the room with a cap of 10, checks it is not full, assigns a chair and signs the token. The chair goes in the participant's metadata as `{"seat": n}`.
3. `call.js` connects and calls `onChange` on every LiveKit event.
4. `main.js` takes `call.people()`, assigns chairs with `assignSeats()` and passes the list to `scene.setPeople()`.

## Rules that must not be broken

Each one comes from a real bug that has already been fixed.

- **three is pinned to `0.128.0`.** The scene uses its old color handling (`outputEncoding`, `sRGBEncoding`, manual conversion with `C()`). Upgrading changes lights and colors; don't do it without reviewing the whole scene in the browser.
- **Do not share a material between plain meshes and instanced meshes**, nor between instanced meshes with and without their own color. That is what `vmat`, `imat` and `icmat` are for. If shared, three throws `Cannot read properties of null (reading 'isInterleavedBufferAttribute')` mid-frame and stops drawing the rest. The symptom is a black ground and sky, with no bodies or screens.
- **Do not use `THREE.VideoTexture`.** The call's `<video>` elements live hidden in `#media` and the browser doesn't report their new frames, so the texture stays black. `videoTexture()` is used instead and refreshed by hand in the loop every `VIDEO_REFRESH` seconds.
- **`adaptiveStream` stays `false`** for the same reason: LiveKit would pause the videos that are not on screen.
- **Instanced meshes and characters have `frustumCulled = false`.**
- **`SEAT_ORDER` (the order in which chairs fill up) must be identical in `server.js` and `main.js`.** `assignSeats()` resolves collisions by join order and must give the same result in every browser.
- **The cap is 10** because the scene has 10 chairs (`MAX` in `server.js` and in `scene.js`). Raising it requires adding seats.
- **Changing seats** uses `setMetadata` and needs the `canUpdateOwnMetadata` permission in the token.
- **Never write keys** in the code or in this file. They go in `.env`, which is not committed.

## Budget

- Scene: about 21,000 triangles and 50 draw calls, a single point light and no shadows. Stay close to that. Static pieces are joined with `merge()` so each group is a single draw call.
- Call: video at 320×240, 15 fps and 150 kbps; screen at 1.5 Mbps (`VIDEO` and `OPTIONS` in `call.js`). Raising them uses up the data quota faster.

## How to verify a change

There are no tests, so changes are verified in the browser:

- With `npm run dev`, the **Join without a call** button shows the scene, your character, your camera on the monitor and your screen on the projection screen without using up minutes. Use it for anything visual.
- For the real call, join the same room from two tabs or two devices. Camera and microphone only work on `localhost` or `https`.
- Check the browser console. If the notice "Error drawing the scene" appears, an exception was thrown while drawing.
- The top left shows triangles, draw calls and frames per second.

## Dev server details

- Vite runs in middleware mode inside `server.js`. Allowed domains are in `HOSTS` (ngrok ones are already included); others are added with `ALLOWED_HOSTS` in `.env`.
- `LIVEKIT_URL` points to the LiveKit cloud project (`wss://...`) and the browser connects directly to that address. LiveKit is not hosted on the computer: that was ruled out because voice and video don't go through a tunnel.

## Status

Tested:

- The scene, the characters and video as a texture, in the browser.
- The page flows with a simulated call: joining, full room, not configured, denied permissions, sharing, changing seats, leaving and dropped connection.
- The real call with LiveKit Cloud: the owner confirmed joining the same room from several devices.

Not confirmed:

- Changing seats during a real call.
- A full session with the team's 7 or 8 people.
- The whole app after translating it to English (2026-10-13): identifiers, API routes (`/api/join`, `/api/status`), the metadata field (`seat`) and the URL parameter (`?room=`) all changed.

Pending:

- Deploy the app on a service with `https` so the team can join without tunnels. Today it only runs on the owner's computer, with ngrok for access from other devices.

There are two diagnostic `console.error` calls added by the owner (in the `catch` of `issueToken` in `server.js` and in `join()` in `main.js`). Keep them until the owner asks to remove them.
