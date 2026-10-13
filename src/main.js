// Ties everything together: the 3D scene, the call and the page controls.
import { createScene, MAX, PALETTE, seatAngle } from './scene.js';
import { createCall, createLocalRoom } from './call.js';

const $ = (id) => document.getElementById(id);
const SEAT_ORDER = [1, 8, 3, 6, 4, 5, 2, 7, 0, 9]; // same seat order the server uses

const state = {
  call: null,        // the real call or the local room
  joined: false,
  joining: false,
  leaving: false,
  busy: false,       // a microphone/camera/screen change is in progress
  room: '',
  picked: -1,        // seat picked on the map before joining
  view: 'overview',
  notice: '',
  list: [],          // people already assigned to seats
  big: null,         // <video> being shown full size
};

/* ---------- scene ---------- */
let scene = null;
try {
  scene = createScene($('scene'), $('app'), {
    onStats: (text) => { $('perf').textContent = text; },
    onError: (message) => notify('Error drawing the scene: ' + message),
  });
} catch (e) {
  const d = document.createElement('div');
  d.className = 'fail';
  d.textContent = 'This browser could not start the 3D scene. Turn on hardware acceleration or try another browser.';
  $('app').appendChild(d);
}

/* ---------- helpers ---------- */
const cleanRoom = (v) => String(v || '').toLowerCase().trim().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').slice(0, 40);
const cleanName = (v) => String(v || '').replace(/\s+/g, ' ').trim().slice(0, 24);
const me = () => state.list.find((p) => p.isMe) || null;
const sharer = () => state.list.find((p) => p.screen) || null;

function notify(text) { state.notice = text || ''; render(); }
function remember(key, value) { try { localStorage.setItem(key, value); } catch { /* no storage */ } }
function recall(key) { try { return localStorage.getItem(key) || ''; } catch { return ''; } }

/* Assigns seats the same way in every browser: everyone keeps the one the server gave them;
   if two collide, whoever joined first keeps it and the other moves to the next free one. */
function assignSeats(people) {
  const ordered = [...people].sort((a, b) => (a.joinedAt - b.joinedAt) || (a.id < b.id ? -1 : 1));
  const taken = new Array(MAX).fill(false);
  for (const p of ordered) {
    if (p.wanted >= 0 && p.wanted < MAX && !taken[p.wanted]) { p.seat = p.wanted; taken[p.wanted] = true; }
    else p.seat = -1;
  }
  for (const p of ordered) {
    if (p.seat >= 0) continue;
    const free = SEAT_ORDER.find((i) => !taken[i]);
    if (free !== undefined) { p.seat = free; taken[free] = true; }
  }
  return ordered.filter((p) => p.seat >= 0);
}

/* ---------- from call state to the page ---------- */
let pending = false;
function onChange() {
  if (pending) return;
  pending = true;
  queueMicrotask(() => { pending = false; refresh(); });
}

function refresh() {
  state.list = state.call && state.joined ? assignSeats(state.call.people()) : [];
  const s = sharer();
  if (scene) {
    scene.setPeople(state.list);
    scene.setScreen(s ? s.screen : null);
    if (state.view === 'seat' && !me()) state.view = scene.setView('overview');
  }
  if (state.big && (!s || s.screen !== state.big)) closeBig();
  render();
}

function onLeave() {
  const dropped = state.joined && !state.leaving;
  state.call = null; state.joined = false; state.leaving = false; state.busy = false;
  state.view = scene ? scene.setView('overview') : 'overview';
  closeBig();
  state.notice = dropped ? 'The connection to the room was closed. You can join again.' : '';
  refresh();
}

/* ---------- seat map ---------- */
const seatButtons = [];
for (let i = 0; i < MAX; i++) {
  const b = document.createElement('button');
  b.type = 'button'; b.className = 'seat'; b.id = 'seat' + (i + 1);
  b.addEventListener('click', () => pickSeat(i));
  b.style.left = (90 + Math.sin(seatAngle(i)) * 66) + 'px';
  b.style.top = (58 + Math.cos(seatAngle(i)) * 66) + 'px';
  b.textContent = String(i + 1);
  $('seatmap').appendChild(b); seatButtons.push(b);
}

/* Tapping a free seat: before joining it gets picked; once inside, it moves you there. */
function pickSeat(i) {
  if (state.list.some((p) => p.seat === i)) return;
  if (state.joined) action((call) => call.setSeat(i), 'Could not change seats. Try again.');
  else { state.picked = state.picked === i ? -1 : i; render(); $('name').focus(); }
}

function setControl(button, active, text, cls) {
  button.setAttribute('aria-pressed', active ? 'true' : 'false');
  button.classList.toggle(cls, cls === 'off' ? !active : active);
  button.querySelector('span').textContent = text; button.title = text;
}

function render() {
  const list = state.list, mine = me(), s = sharer(), real = Boolean(state.call && state.call.real);
  const bySeat = new Array(MAX).fill(null); list.forEach((p) => { bySeat[p.seat] = p; });

  const roster = $('roster'); roster.textContent = '';
  for (let i = 0; i < MAX; i++) {
    const p = bySeat[i], button = seatButtons[i];
    const picked = !p && !state.joined && state.picked === i;
    button.className = 'seat' + (p ? ' taken' : '') + (p && p.isMe ? ' me' : '') + (p && p.speaking && p.mic ? ' talk' : '') + (picked ? ' pick' : '');
    if (p) button.style.setProperty('--c', PALETTE[i]);
    button.disabled = Boolean(p) || state.busy || state.joining;
    const label = 'Seat ' + (i + 1) + (p ? ', taken by ' + p.name : (picked ? ', picked' : ', free'));
    button.title = label; button.setAttribute('aria-label', label);
    if (!p) continue;
    const li = document.createElement('li'), dot = document.createElement('span'), nm = document.createElement('span'), st = document.createElement('span');
    dot.className = 'dot'; dot.style.setProperty('--c', PALETTE[i]);
    nm.className = 'nm'; nm.textContent = p.name;
    const tags = [];
    if (p.isMe) tags.push('you');
    if (p.screen) tags.push('sharing');
    if (!p.mic) tags.push('muted');
    if (!p.cam) tags.push('camera off');
    st.className = 'st'; st.textContent = tags.join(' · ');
    li.append(dot, nm, st); roster.appendChild(li);
  }
  if (!list.length) {
    const li = document.createElement('li'); li.className = 'empty';
    li.textContent = 'Nobody is by the fire yet.'; roster.appendChild(li);
  }
  $('count').textContent = list.length + '/' + MAX;

  $('join').hidden = state.joined; $('dock').hidden = !state.joined;
  $('go').disabled = state.joining; $('go').textContent = state.joining ? 'Joining…' : (state.picked >= 0 ? 'Take seat ' + (state.picked + 1) : 'Sit by the fire');
  $('seatHelp').textContent = state.joined ? 'Tap a free seat to move.' : 'Tap a seat to pick it before joining.';
  $('roomInfo').hidden = !(state.joined && real);
  $('roomName').textContent = state.room;

  if (mine) {
    setControl($('bMic'), mine.mic, mine.mic ? 'Microphone' : 'Muted', 'off');
    setControl($('bCam'), mine.cam, mine.cam ? 'Camera' : 'Camera off', 'off');
    setControl($('bShare'), Boolean(mine.screen), mine.screen ? 'Stop sharing' : 'Share screen', 'live');
  }
  $('bMic').disabled = !real || state.busy;
  $('bCam').disabled = state.busy; $('bShare').disabled = state.busy;
  setControl($('bView'), state.view === 'seat', state.view === 'seat' ? 'Overview' : 'View from my seat', 'live');
  $('bBig').hidden = !s;
  $('bSound').hidden = !(state.joined && state.call && state.call.audioBlocked());

  const note = $('note');
  const base = !state.joined ? 'Drag to move the camera. Scroll or pinch to zoom.'
    : (real ? '' : 'No call: only you see this room. Your camera and screen stay in your browser.');
  const text = state.notice || base;
  note.classList.toggle('warn', Boolean(state.notice));
  if (note.textContent !== text) note.textContent = text;
}

/* ---------- joining ---------- */
async function join(offline) {
  if (state.joining || state.joined) return;
  const name = cleanName($('name').value);
  const room = cleanRoom($('room').value);
  if (!name) { notify('Type your name to join.'); $('name').focus(); return; }
  if (!room && !offline) { notify('Type the room name. Only letters, numbers and dashes.'); $('room').focus(); return; }
  $('room').value = room;
  const start = { mic: $('withMic').checked, cam: $('withCam').checked };
  state.joining = true; state.notice = ''; render();

  try {
    let failures = [];
    if (offline) {
      state.call = createLocalRoom({ onChange, onLeave });
      state.joined = true; state.room = '';
      failures = await state.call.join(name, start, state.picked);
    } else {
      const r = await fetch('/api/join', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ room, name, seat: state.picked }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        console.error('Error joining the room:', data.error);
        if (data.error === 'not_configured') { $('bOffline').hidden = false; notify('The call is not configured yet (see the README). Meanwhile you can join without a call.'); }
        else if (data.error === 'room_full') notify('The room is full: there are already 10 people by the fire.');
        else notify('Could not join the room. Try again in a moment.');
        return;
      }
      state.call = createCall({ onChange, onLeave });
      state.joined = true; state.room = room;
      try { failures = await state.call.join(data.url, data.token, start); }
      catch (e) {
        state.call = null; state.joined = false;
        notify('Could not connect to the room. It may have filled up or the connection may be failing.');
        return;
      }
      const u = new URL(location.href); u.searchParams.set('room', room); history.replaceState(null, '', u);
      remember('fogata.room', room);
    }
    remember('fogata.name', name);
    state.picked = -1;
    if (failures.length) {
      const what = failures.map((f) => (f === 'mic' ? 'the microphone' : 'the camera')).join(' or ');
      state.notice = 'Could not use ' + what + '. Check the browser permission and turn it back on below.';
    }
  } finally {
    state.joining = false;
    refresh();
  }
}
$('join').addEventListener('submit', (ev) => { ev.preventDefault(); join(false); });
$('bOffline').addEventListener('click', () => join(true));

/* ---------- call controls ---------- */
async function action(run, onFail) {
  if (!state.call || state.busy) return;
  state.busy = true; state.notice = ''; render();
  try { await run(state.call, me() || {}); }
  catch (e) { state.notice = onFail; }
  finally { state.busy = false; refresh(); }
}
$('bMic').addEventListener('click', () => action((call, m) => call.setMic(!m.mic), 'Could not use the microphone. Check the browser permission.'));
$('bCam').addEventListener('click', () => action((call, m) => call.setCam(!m.cam), 'Could not use the camera. Check the browser permission.'));
$('bShare').addEventListener('click', () => action((call, m) => call.setShare(!m.screen), 'The screen was not shared.'));
$('bView').addEventListener('click', () => {
  if (!scene) return;
  state.view = scene.setView(state.view === 'seat' ? 'overview' : 'seat'); render();
});
$('bLeave').addEventListener('click', () => { if (state.call) { state.leaving = true; state.call.leave(); } });
$('bSound').addEventListener('click', () => { if (state.call) state.call.enableAudio().catch(() => {}); });
$('eco').addEventListener('change', (ev) => { if (scene) scene.setSaver(ev.target.checked); });
$('panelToggle').addEventListener('click', (ev) => {
  const open = ev.currentTarget.getAttribute('aria-expanded') !== 'true';
  ev.currentTarget.setAttribute('aria-expanded', open ? 'true' : 'false'); $('panelBody').hidden = !open;
});
$('bLink').addEventListener('click', async () => {
  const u = new URL(location.href); u.search = ''; u.searchParams.set('room', state.room);
  try { await navigator.clipboard.writeText(u.href); notify('Link copied. Share it with your team.'); }
  catch { notify('Copy this link: ' + u.href); }
});

/* ---------- shared screen full size ---------- */
function openBig() {
  const s = sharer(); if (!s) return;
  const v = document.createElement('video');
  v.srcObject = s.screen.srcObject; v.muted = true; v.autoplay = true; v.playsInline = true;
  $('bigVideo').replaceChildren(v);
  $('bigTitle').textContent = s.name + "'s screen";
  $('big').hidden = false; state.big = s.screen;
  const p = v.play(); if (p && p.catch) p.catch(() => {});
  $('bCloseBig').focus();
}
function closeBig() {
  $('big').hidden = true; $('bigVideo').replaceChildren(); state.big = null;
}
$('bBig').addEventListener('click', openBig);
$('bCloseBig').addEventListener('click', closeBig);
document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && state.big) closeBig(); });

/* ---------- startup ---------- */
$('name').value = recall('fogata.name').slice(0, 24);
$('room').value = cleanRoom(new URLSearchParams(location.search).get('room')) || recall('fogata.room') || ('retro-' + Math.floor(1000 + Math.random() * 9000));
if (window.innerWidth < 640) { $('panelToggle').setAttribute('aria-expanded', 'false'); $('panelBody').hidden = true; }
render();

fetch('/api/status').then((r) => r.json()).then((d) => {
  if (d && d.configured === false && !state.joined) {
    $('bOffline').hidden = false;
    notify('The call is not configured yet (see the README). Meanwhile you can join without a call.');
  }
}).catch(() => {});
