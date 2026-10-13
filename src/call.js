// The call: voice, video and screen sharing with LiveKit.
// There is also a "local" version (no call) to see the room without configuring anything.
// Both return the same shape, so the rest of the app doesn't know which one it is using.
import { Room, RoomEvent, Track } from 'livekit-client';

// Quality tuned so 10 people stay light: the video is shown on a small monitor.
const VIDEO = { width: 320, height: 240, frameRate: 15 };
const OPTIONS = {
  adaptiveStream: false, // the <video> elements are not on screen (they are textures), so nothing gets paused
  dynacast: false,
  videoCaptureDefaults: { resolution: VIDEO },
  publishDefaults: {
    simulcast: false,
    videoEncoding: { maxBitrate: 150_000, maxFramerate: 15 },
    screenShareEncoding: { maxBitrate: 1_500_000, maxFramerate: 15 },
  },
};

/** Hidden container where the call's <video> and <audio> elements live. */
function mediaBox() {
  let box = document.getElementById('media');
  if (!box) {
    box = document.createElement('div');
    box.id = 'media';
    box.setAttribute('aria-hidden', 'true');
    document.body.appendChild(box);
  }
  return box;
}

function prepareVideo(el) {
  el.muted = true; el.playsInline = true; el.autoplay = true;
  mediaBox().appendChild(el);
  const p = el.play(); if (p && p.catch) p.catch(() => {});
  return el;
}

function seatOf(metadata) {
  try { const s = JSON.parse(metadata || '{}').seat; return Number.isInteger(s) ? s : -1; } catch { return -1; }
}

/**
 * Real call. `onChange` is called whenever something changes (someone joins, talks, turns on the camera...).
 * `onLeave` is called when the connection ends.
 */
export function createCall({ onChange, onLeave }) {
  let room = null;
  const videos = new Map(); // identity -> { cam, screen }

  const entry = (id) => { if (!videos.has(id)) videos.set(id, { cam: null, screen: null }); return videos.get(id); };

  function attach(track, pub, who) {
    if (track.kind === Track.Kind.Audio) {
      if (who === room.localParticipant) return; // never play back your own microphone
      mediaBox().appendChild(track.attach());
      return;
    }
    const el = prepareVideo(track.attach());
    const e = entry(who.identity);
    if (pub.source === Track.Source.ScreenShare) e.screen = el; else e.cam = el;
  }

  function detach(track, pub, who) {
    track.detach().forEach((el) => el.remove());
    if (track.kind !== Track.Kind.Video) return;
    const e = videos.get(who.identity); if (!e) return;
    if (pub.source === Track.Source.ScreenShare) e.screen = null; else e.cam = null;
  }

  async function join(url, token, start) {
    room = new Room(OPTIONS);
    room
      .on(RoomEvent.ParticipantConnected, onChange)
      .on(RoomEvent.ParticipantDisconnected, (p) => { videos.delete(p.identity); onChange(); })
      .on(RoomEvent.TrackSubscribed, (track, pub, p) => { attach(track, pub, p); onChange(); })
      .on(RoomEvent.TrackUnsubscribed, (track, pub, p) => { detach(track, pub, p); onChange(); })
      .on(RoomEvent.LocalTrackPublished, (pub, p) => { if (pub.track) attach(pub.track, pub, p); onChange(); })
      .on(RoomEvent.LocalTrackUnpublished, (pub, p) => { if (pub.track) detach(pub.track, pub, p); onChange(); })
      .on(RoomEvent.TrackMuted, onChange)
      .on(RoomEvent.TrackUnmuted, onChange)
      .on(RoomEvent.ActiveSpeakersChanged, onChange)
      .on(RoomEvent.ParticipantMetadataChanged, onChange)
      .on(RoomEvent.AudioPlaybackStatusChanged, onChange)
      .on(RoomEvent.Disconnected, (reason) => { cleanup(); onLeave(reason); });

    await room.connect(url, token);
    room.startAudio().catch(() => {});
    // Microphone and camera permissions can be denied without breaking the join.
    const failures = [];
    if (start.mic) await room.localParticipant.setMicrophoneEnabled(true).catch(() => failures.push('mic'));
    if (start.cam) await room.localParticipant.setCameraEnabled(true).catch(() => failures.push('cam'));
    onChange();
    return failures;
  }

  function cleanup() {
    videos.clear();
    mediaBox().replaceChildren();
    room = null;
  }

  function people() {
    if (!room) return [];
    const me = room.localParticipant;
    return [me, ...room.remoteParticipants.values()].map((p) => {
      const e = videos.get(p.identity) || {};
      const cam = Boolean(p.isCameraEnabled && e.cam);
      return {
        id: p.identity,
        name: p.name || 'Guest',
        isMe: p === me,
        wanted: seatOf(p.metadata),
        joinedAt: p.joinedAt ? p.joinedAt.getTime() : 0,
        mic: Boolean(p.isMicrophoneEnabled),
        cam,
        video: cam ? e.cam : null,
        screen: e.screen || null,
        speaking: Boolean(p.isSpeaking),
      };
    });
  }

  return {
    real: true,
    join,
    people,
    setMic: async (v) => { await room.localParticipant.setMicrophoneEnabled(v); onChange(); },
    setCam: async (v) => { await room.localParticipant.setCameraEnabled(v); onChange(); },
    setShare: async (v) => { await room.localParticipant.setScreenShareEnabled(v); onChange(); },
    // The seat travels in the participant's metadata, so everyone sees it change.
    setSeat: async (i) => { await room.localParticipant.setMetadata(JSON.stringify({ seat: i })); onChange(); },
    audioBlocked: () => Boolean(room && !room.canPlaybackAudio),
    enableAudio: async () => { if (room) await room.startAudio(); onChange(); },
    leave: () => { if (room) room.disconnect(); },
  };
}

/**
 * Room without a call: only you are in it. The camera and screen work in your browser
 * so you can see how they look on the monitor and the projection screen, but nobody else receives them.
 */
export function createLocalRoom({ onChange, onLeave }) {
  let me = null, cam = null, screen = null, seat = 1;

  function stopVideo(el) {
    if (!el) return null;
    if (el.srcObject) el.srcObject.getTracks().forEach((t) => t.stop());
    el.remove();
    return null;
  }
  async function startVideo(stream) {
    const el = document.createElement('video');
    el.srcObject = stream;
    return prepareVideo(el);
  }

  return {
    real: false,
    join: async (name, start, wantedSeat) => {
      me = { name, joinedAt: Date.now() }; seat = wantedSeat >= 0 ? wantedSeat : 1;
      const failures = [];
      if (start.cam) {
        try { cam = await startVideo(await navigator.mediaDevices.getUserMedia({ video: VIDEO })); } catch { failures.push('cam'); }
      }
      onChange();
      return failures;
    },
    people: () => (me ? [{
      id: 'me', name: me.name, isMe: true, wanted: seat, joinedAt: me.joinedAt,
      mic: false, cam: Boolean(cam), video: cam, screen, speaking: false,
    }] : []),
    setMic: async () => {},
    setCam: async (v) => {
      cam = stopVideo(cam);
      if (v) cam = await startVideo(await navigator.mediaDevices.getUserMedia({ video: VIDEO }));
      onChange();
    },
    setShare: async (v) => {
      screen = stopVideo(screen);
      if (v) {
        const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
        screen = await startVideo(stream);
        // If sharing is stopped from the browser's banner, turn it off here too.
        stream.getVideoTracks()[0].addEventListener('ended', () => { screen = stopVideo(screen); onChange(); });
      }
      onChange();
    },
    setSeat: async (i) => { seat = i; onChange(); },
    audioBlocked: () => false,
    enableAudio: async () => {},
    leave: () => { cam = stopVideo(cam); screen = stopVideo(screen); me = null; onLeave(); },
  };
}
