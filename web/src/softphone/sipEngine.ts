import JsSIP from 'jssip';
import type { RTCSession } from 'jssip/lib/RTCSession';
import { useSoftphoneStore } from '@/store/softphoneStore';
import type { Extension } from '@/lib/types';

// Silence JsSIP debug logs in production
if (import.meta.env.PROD) {
  JsSIP.debug.disable('JsSIP:*');
}

let ua: JsSIP.UA | null = null;
let activeSession: RTCSession | null = null;
let localAudio: HTMLAudioElement | null = null;
let remoteAudio: HTMLAudioElement | null = null;

function getOrCreateAudioEl(id: string): HTMLAudioElement {
  let el = document.getElementById(id) as HTMLAudioElement | null;
  if (!el) {
    el = document.createElement('audio');
    el.id = id;
    el.autoplay = true;
    el.style.display = 'none';
    document.body.appendChild(el);
  }
  return el;
}

export function initSoftphone(extension: Extension) {
  if (ua) {
    ua.stop();
    ua = null;
    activeSession = null;
  }

  const wsUrl = import.meta.env.VITE_SIP_WSS_URL ?? 'wss://localhost:8089/ws';
  const socket = new JsSIP.WebSocketInterface(wsUrl);
  const store = useSoftphoneStore.getState();

  store.setRegistrationState('registering');

  ua = new JsSIP.UA({
    sockets: [socket],
    uri: `sip:${extension.sip_username}@${new URL(wsUrl.replace('wss://', 'https://').replace('ws://', 'http://')).hostname}`,
    password: extension.sip_password,
    display_name: extension.display_name,
    register: true,
    session_timers: false,
    connection_recovery_min_interval: 2,
    connection_recovery_max_interval: 30,
  });

  ua.on('registered', () => {
    useSoftphoneStore.getState().setRegistrationState('registered');
  });

  ua.on('unregistered', () => {
    useSoftphoneStore.getState().setRegistrationState('unregistered');
  });

  ua.on('registrationFailed', () => {
    useSoftphoneStore.getState().setRegistrationState('failed');
  });

  ua.on('newRTCSession', ({ session }: { session: RTCSession }) => {
    const store = useSoftphoneStore.getState();

    if (session.direction === 'incoming') {
      activeSession = session;
      const from = session.remote_identity.uri.user ?? 'Unknown';
      const displayName = session.remote_identity.display_name ?? undefined;
      store.setIncomingCall({ from, displayName });

      session.on('ended', () => cleanupCall());
      session.on('failed', () => cleanupCall());
    }
  });

  ua.start();
}

export function stopSoftphone() {
  if (ua) {
    ua.stop();
    ua = null;
    activeSession = null;
    useSoftphoneStore.getState().setRegistrationState('unregistered');
  }
}

export function placeCall(target: string, extension: Extension) {
  if (!ua) return;
  const store = useSoftphoneStore.getState();
  const wsUrl = import.meta.env.VITE_SIP_WSS_URL ?? 'wss://localhost:8089/ws';
  const domain = new URL(wsUrl.replace('wss://', 'https://').replace('ws://', 'http://')).hostname;

  localAudio = getOrCreateAudioEl('sip-local-audio');
  remoteAudio = getOrCreateAudioEl('sip-remote-audio');

  const session = ua.call(`sip:${target}@${domain}`, {
    mediaConstraints: { audio: true, video: false },
    rtcOfferConstraints: { offerToReceiveAudio: true, offerToReceiveVideo: false },
    pcConfig: {
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
    },
  }) as RTCSession;

  activeSession = session;

  store.setCurrentCall({
    id: session.id,
    remoteIdentity: target,
    direction: 'outbound',
    state: 'ringing_out',
    startedAt: new Date(),
    isMuted: false,
    isOnHold: false,
  });

  session.connection?.addEventListener('track', (e: RTCTrackEvent) => {
    if (remoteAudio && e.streams[0]) {
      remoteAudio.srcObject = e.streams[0];
    }
  });

  session.on('accepted', () => {
    store.updateCurrentCall({ state: 'active' });
  });

  session.on('confirmed', () => {
    store.updateCurrentCall({ state: 'active' });
  });

  session.on('ended', () => cleanupCall());
  session.on('failed', () => cleanupCall());

  void extension; // used for future features
}

export function answerCall() {
  if (!activeSession) return;
  const store = useSoftphoneStore.getState();
  const incoming = store.incomingCall;

  localAudio = getOrCreateAudioEl('sip-local-audio');
  remoteAudio = getOrCreateAudioEl('sip-remote-audio');

  activeSession.answer({
    mediaConstraints: { audio: true, video: false },
    pcConfig: {
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
    },
  });

  activeSession.connection?.addEventListener('track', (e: RTCTrackEvent) => {
    if (remoteAudio && e.streams[0]) {
      remoteAudio.srcObject = e.streams[0];
    }
  });

  store.setIncomingCall(null);
  store.setCurrentCall({
    id: activeSession.id,
    remoteIdentity: incoming?.from ?? 'Unknown',
    displayName: incoming?.displayName,
    direction: 'inbound',
    state: 'active',
    startedAt: new Date(),
    isMuted: false,
    isOnHold: false,
  });
}

export function hangupCall() {
  if (activeSession) {
    try {
      activeSession.terminate();
    } catch {
      // already terminated
    }
  }
  cleanupCall();
}

export function rejectCall() {
  if (activeSession) {
    try {
      activeSession.terminate({ status_code: 486, reason_phrase: 'Busy Here' });
    } catch {
      // already gone
    }
  }
  useSoftphoneStore.getState().setIncomingCall(null);
  activeSession = null;
}

export function toggleMute(): boolean {
  const store = useSoftphoneStore.getState();
  if (!activeSession || !store.currentCall) return false;
  const isMuted = !store.currentCall.isMuted;
  if (isMuted) {
    activeSession.mute({ audio: true });
  } else {
    activeSession.unmute({ audio: true });
  }
  store.updateCurrentCall({ isMuted });
  return isMuted;
}

export function toggleHold(): boolean {
  const store = useSoftphoneStore.getState();
  if (!activeSession || !store.currentCall) return false;
  const isOnHold = !store.currentCall.isOnHold;
  if (isOnHold) {
    activeSession.hold();
  } else {
    activeSession.unhold();
  }
  store.updateCurrentCall({ isOnHold, state: isOnHold ? 'held' : 'active' });
  return isOnHold;
}

export function sendDTMF(tone: string) {
  if (!activeSession) return;
  activeSession.sendDTMF(tone, { duration: 160, interToneGap: 50 });
}

export function blindTransfer(target: string) {
  if (!activeSession) return;
  const wsUrl = import.meta.env.VITE_SIP_WSS_URL ?? 'wss://localhost:8089/ws';
  const domain = new URL(wsUrl.replace('wss://', 'https://').replace('ws://', 'http://')).hostname;
  activeSession.refer(`sip:${target}@${domain}`);
  cleanupCall();
}

function cleanupCall() {
  activeSession = null;
  if (remoteAudio) remoteAudio.srcObject = null;
  const store = useSoftphoneStore.getState();
  store.setCurrentCall(null);
  store.setIncomingCall(null);
}
