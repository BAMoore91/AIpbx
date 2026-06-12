/**
 * Minimal ambient typings for `ari-client` (which ships no @types). We model
 * only the surface this service uses. The runtime object is the real client;
 * these interfaces give us type-safety at the call sites.
 */

export interface AriChannel {
  id: string;
  name?: string;
  state?: string;
  caller?: { number?: string; name?: string };
  connected?: { number?: string; name?: string };
  dialplan?: { context?: string; exten?: string; priority?: number };
  // The ari-client Channel object also carries bound operation methods:
  answer(): Promise<void>;
  hangup(opts?: { reason?: string }): Promise<void>;
  continueInDialplan(opts?: {
    context?: string;
    extension?: string;
    priority?: number;
  }): Promise<void>;
  setChannelVar(opts: { variable: string; value: string }): Promise<void>;
  play(opts: { media: string }): Promise<AriPlayback>;
  record(opts: {
    name: string;
    format: string;
    maxDurationSeconds?: number;
    beep?: boolean;
    ifExists?: string;
  }): Promise<AriLiveRecording>;
  hold(): Promise<void>;
  unhold(): Promise<void>;
  mute?(opts: { direction: string }): Promise<void>;
  sendDTMF?(opts: { dtmf: string }): Promise<void>;
}

export interface AriPlayback {
  id: string;
  stop(): Promise<void>;
}

export interface AriLiveRecording {
  name: string;
  stop(): Promise<void>;
}

export interface AriBridge {
  id: string;
  addChannel(opts: { channel: string }): Promise<void>;
  removeChannel(opts: { channel: string }): Promise<void>;
  destroy(): Promise<void>;
}

export interface StasisStartEvent {
  type: 'StasisStart';
  channel: AriChannel;
  args: string[];
}

export interface StasisEndEvent {
  type: 'StasisEnd';
  channel: AriChannel;
}

export interface ChannelStateChangeEvent {
  type: 'ChannelStateChange';
  channel: AriChannel;
}

export interface ChannelDtmfReceivedEvent {
  type: 'ChannelDtmfReceived';
  channel: AriChannel;
  digit: string;
}

export interface ChannelHangupRequestEvent {
  type: 'ChannelHangupRequest';
  channel: AriChannel;
  cause?: number;
}

export interface DeviceStateChangeEvent {
  type: 'DeviceStateChange';
  device_state: { name: string; state: string };
}

export interface DialEvent {
  type: 'Dial';
  dialstatus?: string;
  peer?: AriChannel;
  caller?: AriChannel;
}

export interface AriClient {
  on(event: 'StasisStart', cb: (e: StasisStartEvent, channel: AriChannel) => void): void;
  on(event: 'StasisEnd', cb: (e: StasisEndEvent, channel: AriChannel) => void): void;
  on(event: 'ChannelStateChange', cb: (e: ChannelStateChangeEvent, channel: AriChannel) => void): void;
  on(event: 'ChannelDtmfReceived', cb: (e: ChannelDtmfReceivedEvent, channel: AriChannel) => void): void;
  on(event: 'ChannelHangupRequest', cb: (e: ChannelHangupRequestEvent, channel: AriChannel) => void): void;
  on(event: 'DeviceStateChange', cb: (e: DeviceStateChangeEvent) => void): void;
  on(event: 'Dial', cb: (e: DialEvent) => void): void;
  on(event: string, cb: (...args: unknown[]) => void): void;

  start(appName: string): void;
  stop?(): void;

  channels: {
    get(opts: { channelId: string }): Promise<AriChannel>;
    originate(opts: Record<string, unknown>): Promise<AriChannel>;
    hangup(opts: { channelId: string; reason?: string }): Promise<void>;
    answer(opts: { channelId: string }): Promise<void>;
    hold(opts: { channelId: string }): Promise<void>;
    unhold(opts: { channelId: string }): Promise<void>;
    mute(opts: { channelId: string; direction: string }): Promise<void>;
    unmute(opts: { channelId: string; direction: string }): Promise<void>;
    play(opts: { channelId: string; media: string }): Promise<AriPlayback>;
    record(opts: Record<string, unknown>): Promise<AriLiveRecording>;
    sendDTMF(opts: { channelId: string; dtmf: string }): Promise<void>;
    setChannelVar(opts: { channelId: string; variable: string; value: string }): Promise<void>;
    continueInDialplan(opts: Record<string, unknown>): Promise<void>;
    redirect?(opts: { channelId: string; endpoint: string }): Promise<void>;
  };

  bridges: {
    create(opts: { type: string; bridgeId?: string }): Promise<AriBridge>;
    get(opts: { bridgeId: string }): Promise<AriBridge>;
    list(): Promise<AriBridge[]>;
  };

  asterisk: {
    reloadModule(opts: { moduleName: string }): Promise<void>;
    ping?(): Promise<unknown>;
  };
}

/** The module's default export is a callable connect(url, user, pass, cb). */
export interface AriModule {
  connect(
    url: string,
    username: string,
    password: string,
  ): Promise<AriClient>;
}
