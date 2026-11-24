import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * WebRTC mesh for live lessons.
 *
 * Why the previous implementation never showed a picture:
 *
 * - Both peers created their own transceivers and both sent an offer, and the
 *   receiving side simply dropped every offer while it had a local offer. Both
 *   sides stayed in "have-local-offer" forever, so no ICE/DTLS session was
 *   ever established and only the chat (plain signalling) worked.
 * - The camera/microphone were published from a stale closure, so a track that
 *   was toggled on after the other device was already running was never added
 *   to the peer connection.
 *
 * The mesh below follows the "perfect negotiation" pattern (RFC 8829):
 *
 * 1. Exactly one media track per kind is published per peer (one video sender,
 *    one audio sender). A track is attached with `addTrack` (which triggers a
 *    negotiation) and later swapped with `replaceTrack`, which needs no
 *    renegotiation at all.
 * 2. Both peers may send an offer. The impolite peer ignores a colliding
 *    offer, the polite peer rolls its own offer back and answers. The role is
 *    derived from the user id, so both sides always agree on it.
 * 3. Local media lives in refs. Toggling the microphone after the camera (or
 *    the camera off and on again) re-acquires the missing track instead of
 *    publishing a stopped one.
 */

export type MeshSignalKind = 'offer' | 'answer' | 'ice';

export type MeshPresence = {
  cameraOn?: boolean;
  micOn?: boolean;
  sharingScreen?: boolean;
};

type PeerRecord = {
  userId: string;
  username: string;
  pc: RTCPeerConnection;
  /** The peer with the smaller id is impolite and keeps its own offer. */
  polite: boolean;
  makingOffer: boolean;
  ignoreOffer: boolean;
  pendingIce: RTCIceCandidateInit[];
  remoteStream: MediaStream | null;
  videoSender: RTCRtpSender | null;
  audioSender: RTCRtpSender | null;
  /** A new offer is needed (a track was added while a negotiation was open). */
  needsNegotiation: boolean;
  /** A negotiation is currently running. */
  negotiating: boolean;
  /** The media state that was negotiated with the peer. */
  offeredSignature: string;
};

/**
 * Virtual devices (Steam Streaming Microphone, VB-Cable, Stereo Mix, OBS...)
 * record silence unless a program feeds them, yet Chrome often remembers one
 * of them as the microphone of a site. When that happens the lesson stays
 * silent, so a real microphone is opened instead.
 */
const VIRTUAL_MIC = /steam|virtual|vb-?audio|cable|voicemeeter|stereo mix|stereomix|obs|loopback|nvidia broadcast|krisp|\bnull\b/i;

async function preferRealMicrophone(stream: MediaStream, withVideo: boolean): Promise<MediaStream> {
  try {
    const track = stream.getAudioTracks()[0];
    if (!track || !VIRTUAL_MIC.test(track.label)) return stream;
    const devices = (await navigator.mediaDevices.enumerateDevices()).filter(
      (device) => device.kind === 'audioinput' && device.deviceId && !VIRTUAL_MIC.test(device.label),
    );
    // "default" and "communications" are aliases; the Windows default comes first.
    const real = devices.find((device) => device.deviceId === 'default') ?? devices[0];
    if (!real) return stream;
    const better = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: { exact: real.deviceId } } });
    const betterTrack = better.getAudioTracks()[0];
    if (!betterTrack) return stream;
    stream.getAudioTracks().forEach((item) => {
      stream.removeTrack(item);
      item.stop();
    });
    stream.addTrack(betterTrack);
    void withVideo;
    return stream;
  } catch {
    return stream;
  }
}

export type MeshError = 'camera' | 'mic' | 'share-denied' | 'share-unsupported' | null;

/**
 * ICE configuration.
 *
 * STUN finds the server-reflexive candidate (that is enough for most school
 * networks). The public relay is only a fallback for networks that block UDP
 * — it is rate-limited, so a dedicated TURN server should be configured for
 * production (set VITE_TURN_URL / VITE_TURN_USERNAME / VITE_TURN_CREDENTIAL at
 * build time).
 */
let serverIce: RTCIceServer[] = [];

/** Loads relay servers configured on the API (Cloudflare TURN or a custom TURN). */
export async function loadServerIceServers(): Promise<void> {
  try {
    const response = await fetch('/api/ice-servers', { credentials: 'include' });
    if (!response.ok) return;
    const body = (await response.json()) as { iceServers?: RTCIceServer[] };
    if (Array.isArray(body.iceServers)) serverIce = body.iceServers;
  } catch {
    /* STUN-only fallback below */
  }
}

export function iceServers(): RTCIceServer[] {
  const turnUrl = import.meta.env.VITE_TURN_URL;
  const turnUser = import.meta.env.VITE_TURN_USERNAME;
  const turnCred = import.meta.env.VITE_TURN_CREDENTIAL;
  const servers: RTCIceServer[] = [
    { urls: 'stun:stun.cloudflare.com:3478' },
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:global.stun.twilio.com:3478' },
  ];
  if (serverIce.length) {
    servers.push(...serverIce);
  } else if (turnUrl) {
    servers.push({
      urls: turnUrl,
      ...(turnUser ? { username: turnUser } : {}),
      ...(turnCred ? { credential: turnCred } : {}),
    });
  } else {
    // Public relays without an own server. They are rate-limited, so several
    // of them are offered: as soon as one answers, the connection is up.
    servers.push({
      urls: [
        'turn:openrelay.metered.ca:80',
        'turn:openrelay.metered.ca:443',
        'turn:relay.metered.ca:80',
        'turn:relay.metered.ca:443',
      ],
      username: 'openrelayproject',
      credential: 'openrelayproject',
    });
  }
  return servers;
}

export type LessonMeshOptions = {
  roomId: string;
  selfUserId: string;
  /** Sends one signalling message to one peer. */
  sendSignal: (to: string, kind: MeshSignalKind, payload: unknown) => Promise<void> | void;
  /** Reports the local media state so the roster can show the right icons. */
  onPresence?: (patch: MeshPresence) => void;
  /** Called when a local device cannot be opened. */
  onError?: (error: Exclude<MeshError, null>, reason?: string) => void;
  /** Reports the connection state of one peer. */
  onPeerState?: (userId: string, state: RTCPeerConnectionState) => void;
};

export type LessonMesh = {
  localStream: MediaStream | null;
  screenStream: MediaStream | null;
  cameraOn: boolean;
  micOn: boolean;
  sharing: boolean;
  remoteStreams: Record<string, MediaStream | null>;
  /** Connection state per participant ("new" | "connecting" | "connected" | …). */
  peerStates: Record<string, RTCPeerConnectionState>;
  toggleCamera: () => Promise<void>;
  toggleMic: () => Promise<void>;
  toggleShare: () => Promise<void>;
  handleSignal: (from: string, kind: string, payload: unknown) => Promise<void>;
  /** Creates (or reuses) the peer connection for a participant. */
  ensurePeer: (remoteUserId: string, remoteUsername: string) => void;
  /** Restarts the ICE session for every peer (used by the reconnect button). */
  reconnect: () => void;
  /** Sends pending offers — called with every signalling round trip. */
  flushNegotiations: () => void;
  /** True while an offer still has to be sent. */
  negotiationPending: () => boolean;
  stop: () => void;
};

export function useLessonMesh(options: LessonMeshOptions): LessonMesh {
  const { roomId, selfUserId } = options;

  const peersRef = useRef<Map<string, PeerRecord>>(new Map());
  const localStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const cameraOnRef = useRef(false);
  const micOnRef = useRef(false);
  const sharingRef = useRef(false);

  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null);
  const [cameraOn, setCameraOn] = useState(false);
  const [micOn, setMicOn] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [remoteStreams, setRemoteStreams] = useState<Record<string, MediaStream | null>>({});
  const [peerStates, setPeerStates] = useState<Record<string, RTCPeerConnectionState>>({});

  // Keep the latest callbacks without recreating the peer machinery.
  const sendSignalRef = useRef(options.sendSignal);
  sendSignalRef.current = options.sendSignal;
  const onPresenceRef = useRef(options.onPresence);
  onPresenceRef.current = options.onPresence;
  const onErrorRef = useRef(options.onError);
  onErrorRef.current = options.onError;
  const onPeerStateRef = useRef(options.onPeerState);
  onPeerStateRef.current = options.onPeerState;

  const reportPresence = useCallback((patch: MeshPresence) => {
    onPresenceRef.current?.(patch);
  }, []);

  /* ---------------------------------------------------------------------- */
  /* Publishing local media                                                   */
  /* ---------------------------------------------------------------------- */

  const cameraTrack = useCallback((): MediaStreamTrack | null => {
    if (!cameraOnRef.current) return null;
    return localStreamRef.current?.getVideoTracks().find((track) => track.readyState === 'live') ?? null;
  }, []);

  const micTrack = useCallback((): MediaStreamTrack | null => {
    if (!micOnRef.current) return null;
    return localStreamRef.current?.getAudioTracks().find((track) => track.readyState === 'live') ?? null;
  }, []);

  const videoTrackToPublish = useCallback((): MediaStreamTrack | null => {
    if (sharingRef.current) {
      const screen = screenStreamRef.current?.getVideoTracks().find((track) => track.readyState === 'live');
      if (screen) return screen;
    }
    return cameraTrack();
  }, [cameraTrack]);

  const publishTrack = useCallback(
    async (peer: PeerRecord, kind: 'video' | 'audio', track: MediaStreamTrack | null): Promise<boolean> => {
      let sender = kind === 'video' ? peer.videoSender : peer.audioSender;
      let needsOffer = false;
      if (!sender) {
        if (!track) return false;
        sender = peer.pc.addTrack(track, localStreamRef.current ?? new MediaStream());
        if (kind === 'video') peer.videoSender = sender;
        else peer.audioSender = sender;
        needsOffer = true;
      } else {
        // A transceiver that was created by a remote offer is receive-only until
        // it is allowed to send, otherwise the peer keeps receiving silence.
        // The direction has to be restored BEFORE the track is put in, otherwise
        // the browser refuses to send it.
        const transceiver = peer.pc.getTransceivers().find((item) => item.sender === sender);
        if (transceiver && transceiver.direction === 'recvonly') {
          transceiver.direction = 'sendrecv';
          needsOffer = true;
        }
        if (sender.track !== track) {
          const replaced = await sender.replaceTrack(track).then(() => true).catch(() => false);
          if (!replaced && track) needsOffer = true;
        }
      }
      return needsOffer;
    },
    [],
  );

  const syncMedia = useCallback(
    async (peer: PeerRecord): Promise<boolean> => {
      const video = await publishTrack(peer, 'video', videoTrackToPublish());
      const audio = await publishTrack(peer, 'audio', micTrack());
      return video || audio;
    },
    [publishTrack, videoTrackToPublish, micTrack],
  );

  /**
   * Describes the media THIS side wants to send. As long as the signature does
   * not change, no new offer is needed — this keeps the microphone from waiting
   * for a second (and useless) negotiation round trip before the sound starts
   * and it prevents both sides from answering each other with offers forever.
   *
   * The signature uses the tracks we want to publish and not the tracks that
   * are currently attached to the sender: the browser detaches a track when
   * the other side only wants to receive, which would otherwise start an
   * endless offer/answer loop.
   */
  const mediaSignature = useCallback(
    (peer: PeerRecord): string => {
      void peer;
      const screen = screenStreamRef.current?.getVideoTracks().find((track) => track.readyState === 'live');
      return [videoTrackToPublish()?.id ?? '', micTrack()?.id ?? '', screen?.id ?? ''].join('|');
    },
    [videoTrackToPublish, micTrack],
  );

  /**
   * Sends the next offer for a peer.
   *
   * A track that is switched on while another negotiation is still open (for
   * example the microphone right after the camera) used to be lost: the offer
   * could not be created while the signalling state was not "stable" and the
   * track was never negotiated. The peer now remembers that another offer is
   * due and sends it as soon as the current negotiation finished.
   */
  const maybeNegotiate = useCallback(
    async (peer: PeerRecord) => {
      const signature = mediaSignature(peer);
      if (import.meta.env.DEV && signature !== peer.offeredSignature) {
        console.info('[mesh] negotiate', peer.userId.slice(0, 6), signature, '!=', peer.offeredSignature, peer.pc.signalingState);
      }
      if (signature === peer.offeredSignature) {
        // Nothing changed — an offer would be useless.
        peer.needsNegotiation = false;
        return;
      }
      if (peer.pc.signalingState !== 'stable' || peer.negotiating) {
        peer.needsNegotiation = true;
        return;
      }
      peer.needsNegotiation = false;
      peer.negotiating = true;
      try {
        peer.makingOffer = true;
        await peer.pc.setLocalDescription(await peer.pc.createOffer());
        peer.offeredSignature = signature;
        await sendSignalRef.current(peer.userId, 'offer', peer.pc.localDescription);
      } catch {
        // The connection was busy or closed — try again after the current
        // negotiation has finished.
        peer.needsNegotiation = true;
      } finally {
        peer.makingOffer = false;
        peer.negotiating = false;
      }
    },
    [mediaSignature],
  );

  const publishToAll = useCallback(() => {
    for (const peer of peersRef.current.values()) {
      void syncMedia(peer).then(() => {
        // A newly added track needs an offer of its own. The browser does not
        // always report it, so the negotiation is triggered explicitly here.
        if (mediaSignature(peer) !== peer.offeredSignature) {
          peer.needsNegotiation = true;
          void maybeNegotiate(peer);
        }
      });
    }
  }, [syncMedia, maybeNegotiate, mediaSignature]);

  /* ---------------------------------------------------------------------- */
  /* Peer connections                                                         */
  /* ---------------------------------------------------------------------- */

  const createPeer = useCallback(
    (remoteUserId: string, remoteUsername: string): PeerRecord => {
      const pc = new RTCPeerConnection({ iceServers: iceServers(), iceCandidatePoolSize: 4 });
      const peer: PeerRecord = {
        userId: remoteUserId,
        username: remoteUsername,
        pc,
        polite: selfUserId > remoteUserId,
        makingOffer: false,
        ignoreOffer: false,
        pendingIce: [],
        remoteStream: null,
        videoSender: null,
        audioSender: null,
        needsNegotiation: false,
        negotiating: false,
        offeredSignature: '',
      };
      peersRef.current.set(remoteUserId, peer);

      pc.onicecandidate = (event) => {
        if (!event.candidate) return;
        void Promise.resolve(
          sendSignalRef.current(remoteUserId, 'ice', event.candidate.toJSON()),
        ).catch(() => {});
      };

      pc.ontrack = (event) => {
        const stream = peer.remoteStream ?? new MediaStream();
        if (!stream.getTracks().includes(event.track)) {
          stream.addTrack(event.track);
        }
        peer.remoteStream = stream;
        setRemoteStreams((current) => ({ ...current, [remoteUserId]: stream }));
      };

      pc.onnegotiationneeded = () => {
        // The browser asks for a negotiation — it is only sent when the media
        // really changed, otherwise the peer would answer an offer that brings
        // nothing new and the sound would start with a delay.
        peer.needsNegotiation = true;
        void maybeNegotiate(peer);
      };

      pc.onconnectionstatechange = () => {
        onPeerStateRef.current?.(remoteUserId, pc.connectionState);
        setPeerStates((current) => ({ ...current, [remoteUserId]: pc.connectionState }));
        if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
          // The path is broken (a blocked UDP port, a changed network). A new
          // ICE round with the relay servers usually repairs it.
          try {
            pc.restartIce();
          } catch {
            /* not supported everywhere */
          }
        }
      };

      void syncMedia(peer).then(() => {
        if (peer.needsNegotiation) void maybeNegotiate(peer);
      });
      return peer;
    },
    [selfUserId, syncMedia, maybeNegotiate],
  );

  const ensurePeer = useCallback(
    (remoteUserId: string, remoteUsername: string): PeerRecord => {
      const existing = peersRef.current.get(remoteUserId);
      if (existing) {
        if (existing.username !== remoteUsername) existing.username = remoteUsername;
        return existing;
      }
      return createPeer(remoteUserId, remoteUsername);
    },
    [createPeer],
  );

  const flushPendingIce = useCallback(async (peer: PeerRecord) => {
    const queued = peer.pendingIce.splice(0);
    for (const candidate of queued) {
      await peer.pc.addIceCandidate(candidate).catch(() => {});
    }
  }, []);

  /* ---------------------------------------------------------------------- */
  /* Signalling                                                               */
  /* ---------------------------------------------------------------------- */

  const handleSignal = useCallback(
    async (from: string, kind: string, payload: unknown) => {
      if (kind !== 'offer' && kind !== 'answer' && kind !== 'ice') return;
      const peer = ensurePeer(from, from.slice(0, 6));

      if (kind === 'offer') {
        const description = payload as RTCSessionDescriptionInit;
        const collision = peer.makingOffer || peer.pc.signalingState !== 'stable';
        peer.ignoreOffer = !peer.polite && collision;
        if (peer.ignoreOffer) return;
        try {
          if (peer.pc.signalingState === 'have-local-offer') {
            // The polite peer rolls its own offer back and answers instead.
            await peer.pc.setLocalDescription({ type: 'rollback' });
          }
          await peer.pc.setRemoteDescription(description);
          await flushPendingIce(peer);
          // Attach the local tracks before the answer is created so the answer
          // negotiates the media direction as "send".
          await syncMedia(peer);
          await peer.pc.setLocalDescription(await peer.pc.createAnswer());
          await sendSignalRef.current(from, 'answer', peer.pc.localDescription);
          await syncMedia(peer);
        } catch {
          /* a later offer/answer recovers the connection */
        }
        return;
      }

      if (kind === 'answer') {
        if (peer.pc.signalingState !== 'have-local-offer') return;
        try {
          await peer.pc.setRemoteDescription(payload as RTCSessionDescriptionInit);
          await flushPendingIce(peer);
          await syncMedia(peer);
        } catch {
          /* ignore */
        }
        // A track that was switched on while this offer was open still needs
        // its own offer.
        if (peer.needsNegotiation) void maybeNegotiate(peer);
        return;
      }

      const candidate = payload as RTCIceCandidateInit;
      if (!candidate) return;
      if (!peer.pc.remoteDescription) {
        peer.pendingIce.push(candidate);
        return;
      }
      await peer.pc.addIceCandidate(candidate).catch(() => {});
    },
    [ensurePeer, flushPendingIce, syncMedia, maybeNegotiate],
  );

  /* ---------------------------------------------------------------------- */
  /* Local devices                                                            */
  /* ---------------------------------------------------------------------- */

  const ensureLocalStream = useCallback((): MediaStream => {
    if (!localStreamRef.current) {
      const stream = new MediaStream();
      localStreamRef.current = stream;
      setLocalStream(stream);
    }
    return localStreamRef.current;
  }, []);

  /**
   * Opens the camera and the microphone.
   *
   * Both devices are requested in ONE call and the unused track is only
   * disabled. On iOS a second getUserMedia call stops the microphone of the
   * first one, so a separate call for the microphone would stay silent.
   */
  const acquireDevices = useCallback(
    async (needVideo: boolean, needAudio: boolean) => {
      const stream = ensureLocalStream();
      const videoTrack = stream.getVideoTracks().find((item) => item.readyState === 'live') ?? null;
      const audioTrack = stream.getAudioTracks().find((item) => item.readyState === 'live') ?? null;
      const missingVideo = needVideo && !videoTrack;
      const missingAudio = needAudio && !audioTrack;
      if (!missingVideo && !missingAudio) return stream;

      // When the camera is added to an existing microphone, both are requested
      // again - iOS only keeps a microphone that came with a camera.
      const requestAudio = missingAudio || (missingVideo && Boolean(audioTrack));
      let acquired = await navigator.mediaDevices.getUserMedia({
        video: missingVideo,
        audio: requestAudio,
      });
      if (requestAudio) acquired = await preferRealMicrophone(acquired, missingVideo);
      const newVideo = acquired.getVideoTracks()[0] ?? null;
      const newAudio = acquired.getAudioTracks()[0] ?? null;
      if (missingVideo && !newVideo) {
        acquired.getTracks().forEach((item) => item.stop());
        throw new Error('no video track');
      }
      if (requestAudio && !newAudio) {
        acquired.getTracks().forEach((item) => item.stop());
        throw new Error('no audio track');
      }
      if (missingVideo && newVideo) {
        for (const old of stream.getVideoTracks()) {
          stream.removeTrack(old);
          old.stop();
        }
        stream.addTrack(newVideo);
      }
      if (requestAudio && newAudio) {
        for (const old of stream.getAudioTracks()) {
          stream.removeTrack(old);
          old.stop();
        }
        stream.addTrack(newAudio);
      }
      setLocalStream(stream);
      return stream;
    },
    [ensureLocalStream],
  );

  const toggleCamera = useCallback(async () => {
    if (cameraOnRef.current) {
      localStreamRef.current?.getVideoTracks().forEach((track) => {
        track.enabled = false;
      });
      cameraOnRef.current = false;
      setCameraOn(false);
      publishToAll();
      reportPresence({ cameraOn: false });
      return;
    }
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw Object.assign(new Error('insecure'), { name: 'InsecureContext' });
      const stream = await acquireDevices(true, micOnRef.current);
      const track = stream.getVideoTracks().find((item) => item.readyState === 'live');
      if (!track) throw new Error('no video track');
      track.enabled = true;
      cameraOnRef.current = true;
      setCameraOn(true);
      publishToAll();
      reportPresence({ cameraOn: true });
    } catch (error) {
      onErrorRef.current?.('camera', (error as { name?: string })?.name);
    }
  }, [acquireDevices, publishToAll, reportPresence]);

  const toggleMic = useCallback(async () => {
    if (micOnRef.current) {
      localStreamRef.current?.getAudioTracks().forEach((track) => {
        track.enabled = false;
      });
      micOnRef.current = false;
      setMicOn(false);
      publishToAll();
      reportPresence({ micOn: false });
      return;
    }
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw Object.assign(new Error('insecure'), { name: 'InsecureContext' });
      const stream = await acquireDevices(false, true);
      const track = stream.getAudioTracks().find((item) => item.readyState === 'live');
      if (!track) throw new Error('no audio track');
      track.enabled = true;
      micOnRef.current = true;
      setMicOn(true);
      publishToAll();
      reportPresence({ micOn: true });
    } catch (error) {
      onErrorRef.current?.('mic', (error as { name?: string })?.name);
    }
  }, [acquireDevices, publishToAll, reportPresence]);

  const stopSharing = useCallback(() => {
    screenStreamRef.current?.getTracks().forEach((track) => track.stop());
    screenStreamRef.current = null;
    sharingRef.current = false;
    setScreenStream(null);
    setSharing(false);
    publishToAll();
    reportPresence({ sharingScreen: false });
  }, [publishToAll, reportPresence]);

  const toggleShare = useCallback(async () => {
    if (sharingRef.current) {
      stopSharing();
      return;
    }
    if (!navigator.mediaDevices?.getDisplayMedia) {
      // iOS Safari has no screen capture at all.
      onErrorRef.current?.('share-unsupported');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
      const track = stream.getVideoTracks()[0];
      if (!track) {
        stream.getTracks().forEach((item) => item.stop());
        throw new Error('no screen track');
      }
      track.addEventListener('ended', () => {
        stopSharing();
      });
      screenStreamRef.current = stream;
      sharingRef.current = true;
      setScreenStream(stream);
      setSharing(true);
      publishToAll();
      reportPresence({ sharingScreen: true });
    } catch {
      onErrorRef.current?.('share-denied');
    }
  }, [publishToAll, reportPresence, stopSharing]);

  /* ---------------------------------------------------------------------- */
  /* Lifecycle                                                                */
  /* ---------------------------------------------------------------------- */

  /** Restarts the ICE session of every peer — used when the path is blocked. */
  const reconnect = useCallback(() => {
    for (const peer of peersRef.current.values()) {
      try {
        peer.pc.restartIce();
      } catch {
        /* not supported everywhere */
      }
      peer.needsNegotiation = true;
      peer.offeredSignature = '';
      void maybeNegotiate(peer);
    }
  }, [maybeNegotiate]);

  /**
   * Safety net: sends a missing offer. Browsers do not always report a track
   * that was added while another negotiation was still open, so pending offers
   * are retried with every signalling round trip.
   */
  const flushNegotiations = useCallback(() => {
    for (const peer of peersRef.current.values()) {
      if (mediaSignature(peer) !== peer.offeredSignature) {
        peer.needsNegotiation = true;
        void maybeNegotiate(peer);
      }
    }
  }, [maybeNegotiate, mediaSignature]);

  /** True while an offer still has to be sent. */
  const negotiationPending = useCallback(() => {
    for (const peer of peersRef.current.values()) {
      if (peer.needsNegotiation || mediaSignature(peer) !== peer.offeredSignature) return true;
    }
    return false;
  }, [mediaSignature]);

  const stop = useCallback(() => {
    for (const peer of peersRef.current.values()) {
      try {
        peer.pc.close();
      } catch {
        /* ignore */
      }
    }
    peersRef.current.clear();
    setRemoteStreams({});
    setPeerStates({});
    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    localStreamRef.current = null;
    setLocalStream(null);
    screenStreamRef.current?.getTracks().forEach((track) => track.stop());
    screenStreamRef.current = null;
    setScreenStream(null);
    cameraOnRef.current = false;
    micOnRef.current = false;
    sharingRef.current = false;
    setCameraOn(false);
    setMicOn(false);
    setSharing(false);
  }, []);

  useEffect(() => stop, [stop]);

  // A room change invalidates every peer connection.
  useEffect(() => {
    stop();
  }, [roomId, stop]);

  return {
    localStream,
    screenStream,
    cameraOn,
    micOn,
    sharing,
    remoteStreams,
    peerStates,
    toggleCamera,
    toggleMic,
    toggleShare,
    handleSignal,
    ensurePeer,
    reconnect,
    flushNegotiations,
    negotiationPending,
    stop,
  };
}
