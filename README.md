# Cozy Firecamp

A 3D room for the team's retrospectives: a campfire in the forest, 10 chairs and a projection screen for screen sharing. Each attendee is a character; with the camera on, their head is a monitor showing their video, and with the camera off it is a head that moves its mouth when they talk.

## Requirements

- Node.js 18 or newer.

## Try it on your computer

```
npm install
npm run dev
```

Open <http://localhost:5173>. Without configuring anything else, the page offers **Join without a call**: you see the scene, your character, your camera on the monitor and your screen on the projection screen, but nobody else connects.

## Enable the call

Voice, video and screen sharing go through [LiveKit](https://livekit.io). The project uses its cloud service, which has a free plan.

1. Create a project on LiveKit Cloud and copy its URL (starts with `wss://`), the key and the secret.
2. Copy `.env.example` to `.env` and paste the three values there.
3. Restart `npm run dev`.

With that, **Sit by the fire** connects the call. The server creates each room with a cap of 10 and stops issuing tokens when it is full.

On the seat map you can pick a chair before joining, or tap a free seat to move once you are inside.

## Try it from another device with a tunnel

With `npm run dev` running, open a tunnel to port 5173 (for example `ngrok http 5173`) and join from the other device with the `https` address it gives you. ngrok domains are already allowed; for another tunnel service, add its domain to `ALLOWED_HOSTS` in `.env`.

## Use it with the team

Browsers only allow camera and microphone on secure pages (`https`) or on `localhost`. For the team to join, deploy the app on any service that runs Node:

```
npm install
npm run build
npm start
```

Set the same `.env` variables on that service (`LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`). The port is read from `PORT`.

Each room has its own link: `https://your-domain/?room=team-retro`. Inside the room, **Copy link** gets it ready to share.

## How it is built

| File | What it does |
| --- | --- |
| `server.js` | Issues room tokens (cap of 10, seat assignment) and serves the page. |
| `src/scene.js` | The whole 3D scene and the characters. Everything is geometry generated in code. |
| `src/call.js` | The LiveKit call and the local "no call" room. |
| `src/main.js` | Ties scene, call and controls together. |
| `src/styles.css` | Look of the controls. |

## Quick tweaks

- **Video quality:** in `src/call.js`, the `VIDEO` and `OPTIONS` constants. It is set to 320×240 at 15 fps because it is shown on a small monitor; that keeps 10 people light.
- **Cap:** `MAX` in `server.js`. The scene has 10 chairs, so raising it means adding seats in `src/scene.js`.
- **Performance:** the scene uses a single dynamic light, no shadows, and about 50 draw calls. "Power saver" drops to 30 frames per second.
- **three version:** pinned to `0.128.0`, the one the scene was tested with. If you upgrade it, colors and lights need to be reviewed.

## Status

- The scene and controls are tested in the browser.
- The call with LiveKit Cloud has been tested by joining the same room from several devices.
