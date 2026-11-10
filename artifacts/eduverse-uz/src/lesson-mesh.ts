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
};

export type MeshError = 'camera' | 'mic' | 'share-denied' | 'share-unsupported' | null;

/**
 * ICE configuration. A dedicated TURN server is strongly recommended for
 * production (set VITE_TURN_URL / VITE_TURN_USERNAME / VITE_TURN_CREDENTIAL at
 * build time); the public relays below are only a best-effort fallback.
 */
export function iceServers(): RTCIceServer[] {
  const turnUrl = import.meta.env.VITE_TURN_URL;
  const turnUser = import.meta.env.VITE_TURN_USERNAME;
  const turnCred = import.meta.env.VITE_TURN_CREDENTIAL;
  const servers: RTCIceServer[] = [
    { urls: 'stun:stun.cloudflare.com:3478' },
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:global.stun.twilio.com:3478' },
  ];
  if (turnUrl) {
    servers.push({
      urls: turnUrl,
      ...(turnUser ? { username: turnUser } : {}),
      ...(turnCred ? { credential: turnCred } : {}),
    });
  } else {
    servers.push({
      urls: ['turn:openrelay.metered.ca:80', 'turn:openrelay.metered.ca:443', 'turn:relay.metered.ca:80'],
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
  onError?: (error: Exclude<MeshError, null>) => void;
};

export type LessonMesh = {
  localStream: MediaStream | null;
  screenStream: MediaStream | null;
  cameraOn: boolean;
  micOn: boolean;
  sharing: boolean;
  remoteStreams: Record<string, MediaStream | null>;
  toggleCamera: () => Promise<void>;
  toggleMic: () => Promise<void>;
  toggleShare: () => Promise<void>;
  handleSignal: (from: string, kind: string, payload: unknown) => Promise<void>;
  /** Creates (or reuses) the peer connection for a participant. */
  ensurePeer: (remoteUserId: string, remoteUsername: string) => void;
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

  // Keep the latest callbacks without recreating the peer machinery.
  const sendSignalRef = useRef(options.sendSignal);
  sendSignalRef.current = options.sendSignal;
  const onPresenceRef = useRef(options.onPresence);
  onPresenceRef.current = options.onPresence;
  const onErrorRef = useRef(options.onError);
  onErrorRef.current = options.onError;

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
    async (peer: PeerRecord, kind: 'video' | 'audio', track: MediaStreamTrack | null) => {
      let sender = kind === 'video' ? peer.videoSender : peer.audioSender;
      if (!sender) {
        if (!track) return;
        sender = peer.pc.addTrack(track, localStreamRef.current ?? new MediaStream());
        if (kind === 'video') peer.videoSender = sender;
        else peer.audioSender = sender;
      } else if (sender.track !== track) {
        await sender.replaceTrack(track).catch(() => {});
      }
      // A transceiver that was created by a remote offer is receive-only until
      // it is allowed to send, otherwise the peer keeps receiving silence.
      const transceiver = peer.pc.getTransceivers().find((item) => item.sender === sender);
      if (transceiver && transceiver.direction === 'recvonly') {
        transceiver.direction = 'sendrecv';
      }
    },
    [],
  );

  const syncMedia = useCallback(
    async (peer: PeerRecord) => {
      await publishTrack(peer, 'video', videoTrackToPublish());
      await publishTrack(peer, 'audio', micTrack());
    },
    [publishTrack, videoTrackToPublish, micTrack],
  );

  const publishToAll = useCallback(() => {
    for (const peer of peersRef.current.values()) {
      void syncMedia(peer);
    }
  }, [syncMedia]);

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

      pc.onnegotiationneeded = async () => {
        try {
          peer.makingOffer = true;
          await pc.setLocalDescription(await pc.createOffer());
          await sendSignalRef.current(remoteUserId, 'offer', pc.localDescription);
        } catch {
          /* the connection may have been closed meanwhile */
        } finally {
          peer.makingOffer = false;
        }
      };

      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'failed') {
          try {
            pc.restartIce();
          } catch {
            /* not supported everywhere */
          }
        }
      };

      void syncMedia(peer);
      return peer;
    },
    [selfUserId, syncMedia],
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
    [ensurePeer, flushPendingIce, syncMedia],
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
      const stream = ensureLocalStream();
      let track = stream.getVideoTracks().find((item) => item.readyState === 'live');
      if (!track) {
        const acquired = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        track = acquired.getVideoTracks()[0] ?? null;
        if (!track) {
          acquired.getTracks().forEach((item) => item.stop());
          throw new Error('no video track');
        }
        stream.addTrack(track);
        setLocalStream(stream);
      }
      track.enabled = true;
      cameraOnRef.current = true;
      setCameraOn(true);
      publishToAll();
      reportPresence({ cameraOn: true });
    } catch {
      onErrorRef.current?.('camera');
    }
  }, [ensureLocalStream, publishToAll, reportPresence]);

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
      const stream = ensureLocalStream();
      let track = stream.getAudioTracks().find((item) => item.readyState === 'live');
      if (!track) {
        const acquired = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        track = acquired.getAudioTracks()[0] ?? null;
        if (!track) {
          acquired.getTracks().forEach((item) => item.stop());
          throw new Error('no audio track');
        }
        stream.addTrack(track);
        setLocalStream(stream);
      }
      track.enabled = true;
      micOnRef.current = true;
      setMicOn(true);
      publishToAll();
      reportPresence({ micOn: true });
    } catch {
      onErrorRef.current?.('mic');
    }
  }, [ensureLocalStream, publishToAll, reportPresence]);

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
    toggleCamera,
    toggleMic,
    toggleShare,
    handleSignal,
    ensurePeer,
    stop,
  };
}
