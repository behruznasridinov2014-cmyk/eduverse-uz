import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ApiError,
  answerMyRoomTest,
  assignIndividualRoomTests,
  awardRoomWinner,
  createLessonRoom,
  endLessonRoom,
  findLessonRoomByCode,
  getLessonRoom,
  getMyRoomTest,
  getRoomResults,
  joinLessonRoom,
  leaveLessonRoom,
  listTopics,
  pollLessonSignals,
  sendLessonSignal,
  setLessonPresence,
  type LessonParticipant,
  type LessonRoom,
  type LessonTopic,
  type QuizQuestion,
  type RoomRankEntry,
  type User,
} from '@workspace/api-client-react';
import {
  ArrowLeft,
  Award,
  Camera,
  CameraOff,
  Check,
  Copy,
  Crown,
  Mic,
  MicOff,
  MonitorUp,
  Phone,
  Play,
  RefreshCw,
  Send,
  Sparkles,
  Trophy,
  Users,
  Video,
  X,
} from 'lucide-react';
import { Interactive3d } from './interactive-3d';
import type { Language } from './school-data';

/* -------------------------------------------------------------------------- */

type RtcPeer = {
  userId: string;
  username: string;
  connection: RTCPeerConnection;
  stream: MediaStream | null;
  pendingIce: RTCIceCandidateInit[];
};

// Free servers by default; override via VITE_TURN_URL / VITE_TURN_USERNAME / VITE_TURN_CREDENTIAL
function iceServers(): RTCIceServer[] {
  const turnUrl = import.meta.env.VITE_TURN_URL;
  const turnUser = import.meta.env.VITE_TURN_USERNAME;
  const turnCred = import.meta.env.VITE_TURN_CREDENTIAL;
  const servers: RTCIceServer[] = [
    { urls: 'stun:stun.cloudflare.com:3478' },
    { urls: 'stun:stun.l.google.com:19302' },
  ];
  if (turnUrl) {
    servers.push({
      urls: turnUrl,
      ...(turnUser ? { username: turnUser } : {}),
      ...(turnCred ? { credential: turnCred } : {}),
    });
  } else {
    // Cheap free relay (no key needed) — helps when direct connection fails
    servers.push({ urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' });
  }
  return servers;
}

type SignalPayload = unknown;

export function LessonRoomPage({
  user,
  language,
  prefillTopicId,
}: {
  user: User;
  language: Language;
  prefillTopicId?: string;
}) {
  const copy = COPY[language];
  const isTeacher = user.role === 'teacher' || user.role === 'school_director' || user.role === 'school_admin';

  const [topics, setTopics] = useState<LessonTopic[]>([]);
  const [selectedTopicId, setSelectedTopicId] = useState(prefillTopicId ?? '');
  const [room, setRoom] = useState<LessonRoom | null>(null);
  const [participants, setParticipants] = useState<LessonParticipant[]>([]);
  const [joinCode, setJoinCode] = useState('');
  const [mode, setMode] = useState<'idle' | 'host' | 'guest'>('idle');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const response = await listTopics();
        setTopics(response.topics);
        setSelectedTopicId((current) => current || response.topics[0]?.id || '');
      } catch {
        /* topics are optional */
      }
    })();
  }, []);

  const selectedTopic = useMemo(
    () => topics.find((topic) => topic.id === selectedTopicId),
    [topics, selectedTopicId],
  );

  const refreshParticipants = useCallback(async (roomId: string) => {
    try {
      const detail = await getLessonRoom(roomId);
      setParticipants(detail.participants);
      setRoom((current) => (current ? { ...current, status: detail.room.status } : detail.room));
      if (detail.room.status === 'ended') setMode('idle');
    } catch {
      /* transient */
    }
  }, []);

  async function hostLesson() {
    setBusy(true);
    setError('');
    try {
      const response = await createLessonRoom({
        ...(selectedTopicId ? { topicId: selectedTopicId } : {}),
        ...(selectedTopic ? { subject: selectedTopic.subject, title: selectedTopic.title } : {}),
      });
      const joined = await joinLessonRoom(response.room.id);
      setRoom(joined.room);
      setParticipants(joined.participants);
      setMode('host');
    } catch (requestError) {
      setError(describe(requestError, language));
    } finally {
      setBusy(false);
    }
  }

  async function joinByCode() {
    if (!joinCode.trim()) return;
    setBusy(true);
    setError('');
    try {
      const found = await findLessonRoomByCode(joinCode.trim().toUpperCase());
      const joined = await joinLessonRoom(found.room.id);
      setRoom(joined.room);
      setParticipants(joined.participants);
      setMode('guest');
    } catch (requestError) {
      setError(describe(requestError, language));
    } finally {
      setBusy(false);
    }
  }

  async function leave() {
    if (!room) return;
    try {
      await leaveLessonRoom(room.id);
    } catch {
      /* ignore */
    }
    setRoom(null);
    setParticipants([]);
    setMode('idle');
  }

  if (!room || mode === 'idle') {
    return (
      <div className="lesson-room-lobby">
        <div className="page-heading">
          <div>
            <div className="eyebrow">{copy.eyebrow}</div>
            <h1>{copy.title}</h1>
            <p className="page-subtitle">{copy.subtitle}</p>
          </div>
        </div>
        {error && <div className="notice" role="alert">{error}</div>}
        <div className="grid grid-2">
          {isTeacher && (
            <section className="panel reveal-up lobby-card">
              <h2><Video size={17} /> {copy.hostCard}</h2>
              <p className="muted">{copy.hostHint}</p>
              <div className="control">
                <label htmlFor="host-topic">{copy.chooseTopic}</label>
                <select id="host-topic" value={selectedTopicId} onChange={(event) => setSelectedTopicId(event.target.value)}>
                  <option value="">{copy.noTopic}</option>
                  {topics.map((topic) => (
                    <option key={topic.id} value={topic.id}>
                      {topic.subject} · {topic.title}
                    </option>
                  ))}
                </select>
              </div>
              <button type="button" className="btn primary" disabled={busy} onClick={() => void hostLesson()}>
                {busy ? <RefreshCw className="school-spin" size={15} /> : <Video size={15} />}
                {copy.hostAction}
              </button>
            </section>
          )}
          <section className="panel reveal-up lobby-card">
            <h2><Users size={17} /> {copy.joinCard}</h2>
            <p className="muted">{copy.joinHint}</p>
            <div className="control">
              <label htmlFor="join-code">{copy.joinCode}</label>
              <input
                id="join-code"
                value={joinCode}
                onChange={(event) => setJoinCode(event.target.value.toUpperCase())}
                placeholder="ABC-123"
                maxLength={7}
              />
            </div>
            <button type="button" className="btn primary" disabled={busy || joinCode.trim().length < 7} onClick={() => void joinByCode()}>
              <ArrowLeft size={15} /> {copy.joinAction}
            </button>
          </section>
        </div>
      </div>
    );
  }

  return (
    <RoomView
      room={room}
      participants={participants}
      topic={topics.find((topic) => topic.id === room.topicId) ?? null}
      user={user}
      language={language}
      isHost={mode === 'host'}
      onRefresh={() => void refreshParticipants(room.id)}
      onParticipants={setParticipants}
      onLeave={() => void leave()}
      onCopy={() => {
        void navigator.clipboard?.writeText(room.code);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1600);
      }}
      copied={copied}
      error={error}
      setError={setError}
    />
  );
}

/* -------------------------------------------------------------------------- */

function RoomView({
  room,
  participants,
  topic,
  user,
  language,
  isHost,
  onRefresh,
  onParticipants,
  onLeave,
  onCopy,
  copied,
  error,
  setError,
}: {
  room: LessonRoom;
  participants: LessonParticipant[];
  topic: LessonTopic | null;
  user: User;
  language: Language;
  isHost: boolean;
  onRefresh: () => void;
  onParticipants: (participants: LessonParticipant[]) => void;
  onLeave: () => void;
  onCopy: () => void;
  copied: boolean;
  error: string;
  setError: (value: string) => void;
}) {
  const copy = COPY[language];
  const localVideo = useRef<HTMLVideoElement | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null);
  const [cameraOn, setCameraOn] = useState(false);
  const [micOn, setMicOn] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [peers, setPeers] = useState<RtcPeer[]>([]);
  const [remoteStreams, setRemoteStreams] = useState<Record<string, MediaStream | null>>({});
  const [chat, setChat] = useState<Array<{ from: string; text: string }>>([]);
  const [chatDraft, setChatDraft] = useState('');
  const [results, setResults] = useState<{ ranking: RoomRankEntry[] }>({ ranking: [] });
  const [myTest, setMyTest] = useState<{ question: QuizQuestion | null; answer: string | null } | null>(null);
  const [testAnswer, setTestAnswer] = useState('');
  const [testFeedback, setTestFeedback] = useState('');
  const [testStarted, setTestStarted] = useState(false);

  const peersRef = useRef<Map<string, RtcPeer>>(new Map());
  const participantsRef = useRef<LessonParticipant[]>([]);
  const lastSeq = useRef(0);

  /* ---- Local camera / microphone ---- */
  async function toggleCamera() {
    if (cameraOn) {
      localStream?.getVideoTracks().forEach((track) => track.stop());
      setCameraOn(false);
      void setLessonPresence(room.id, { cameraOn: false });
      await republish();
      return;
    }
    try {
      const stream = localStream ?? (await navigator.mediaDevices.getUserMedia({ video: true, audio: micOn }));
      const videoTrack = stream.getVideoTracks()[0];
      if (!videoTrack) throw new Error('no video');
      const next = localStream ?? new MediaStream();
      if (!localStream) stream.getTracks().forEach((track) => next.addTrack(track));
      setLocalStream(next);
      if (localVideo.current) localVideo.current.srcObject = next;
      setCameraOn(true);
      void setLessonPresence(room.id, { cameraOn: true });
      await republish();
    } catch {
      setError(copy.cameraDenied);
    }
  }

  async function toggleMic() {
    if (micOn) {
      localStream?.getAudioTracks().forEach((track) => (track.enabled = false));
      setMicOn(false);
      void setLessonPresence(room.id, { micOn: false });
      return;
    }
    try {
      const stream = localStream ?? (await navigator.mediaDevices.getUserMedia({ audio: true }));
      if (!localStream) setLocalStream(stream);
      stream.getAudioTracks().forEach((track) => {
        track.enabled = true;
        if (localStream && !localStream.getAudioTracks().includes(track)) localStream.addTrack(track);
      });
      setMicOn(true);
      void setLessonPresence(room.id, { micOn: true });
      await republish();
    } catch {
      setError(copy.micDenied);
    }
  }

  async function toggleShare() {
    if (sharing) {
      screenStream?.getTracks().forEach((track) => track.stop());
      setScreenStream(null);
      setSharing(false);
      void setLessonPresence(room.id, { sharingScreen: false });
      await republish();
      return;
    }
    if (!navigator.mediaDevices?.getDisplayMedia) {
      setError(copy.shareUnsupported);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
      stream.getVideoTracks()[0]?.addEventListener('ended', () => {
        setScreenStream(null);
        setSharing(false);
        void republish();
      });
      setScreenStream(stream);
      setSharing(true);
      void setLessonPresence(room.id, { sharingScreen: true });
      await republish();
    } catch {
      setError(copy.shareDenied);
    }
  }

  /* ---- WebRTC mesh ---- */
  const republish = useCallback(
    async () => {
      for (const peer of peersRef.current.values()) {
        const senders = peer.connection.getSenders();
        const tracks = [...(localStream?.getTracks() ?? []), ...(screenStream?.getTracks() ?? [])];
        let addedTrack = false;
        for (const track of tracks) {
          const existing = senders.find((sender) => sender.track?.kind === track.kind);
          if (existing) {
            await existing.replaceTrack(track).catch(() => {});
          } else {
            peer.connection.addTrack(track, localStream ?? screenStream ?? new MediaStream());
            addedTrack = true;
          }
        }
        // New tracks need a fresh offer, otherwise the student never sees them.
        if (addedTrack && peer.connection.signalingState === 'stable') {
          try {
            const offer = await peer.connection.createOffer();
            await peer.connection.setLocalDescription(offer);
            void sendLessonSignal(room.id, { to: peer.userId, kind: 'offer', payload: offer }).catch(() => {});
          } catch {
            /* ignore */
          }
        }
      }
    },
    [localStream, screenStream, room.id],
  );

  const ensurePeer = useCallback(
    async (remoteUserId: string, remoteUsername: string, initiator: boolean) => {
      if (peersRef.current.has(remoteUserId)) return peersRef.current.get(remoteUserId)!;
      const connection = new RTCPeerConnection({ iceServers: iceServers() });
      const peer: RtcPeer = { userId: remoteUserId, username: remoteUsername, connection, stream: null, pendingIce: [] };
      peersRef.current.set(remoteUserId, peer);

      for (const track of [...(localStream?.getTracks() ?? []), ...(screenStream?.getTracks() ?? [])]) {
        connection.addTrack(track, localStream ?? screenStream ?? new MediaStream());
      }

      connection.onicecandidate = (event) => {
        if (event.candidate) {
          void sendLessonSignal(room.id, {
            to: remoteUserId,
            kind: 'ice',
            payload: event.candidate.toJSON(),
          }).catch(() => {});
        }
      };
      connection.ontrack = (event) => {
        const [stream] = event.streams;
        peer.stream = stream ?? null;
        setRemoteStreams((current) => ({ ...current, [remoteUserId]: stream ?? null }));
      };
      connection.onconnectionstatechange = () => {
        if (['failed', 'closed', 'disconnected'].includes(connection.connectionState)) {
          peersRef.current.delete(remoteUserId);
          setPeers([...peersRef.current.values()]);
        }
      };

      setPeers([...peersRef.current.values()]);

      if (initiator) {
        const offer = await connection.createOffer();
        await connection.setLocalDescription(offer);
        void sendLessonSignal(room.id, { to: remoteUserId, kind: 'offer', payload: offer }).catch(() => {});
      }
      return peer;
    },
    [room.id, localStream, screenStream],
  );

  /* ---- Signalling poll loop ---- */
  useEffect(() => {
    let active = true;
    let timer: number | undefined;
    const poll = async () => {
      if (!active) return;
      try {
        const batch = await pollLessonSignals(room.id, { since: lastSeq.current });
        lastSeq.current = batch.lastSeq;
        for (const message of batch.messages) {
          await handleSignal(message.from, message.kind, message.payload as SignalPayload);
        }
        onParticipants(batch.participants);
        if (batch.roomStatus === 'ended') {
          onRefresh();
        }
      } catch {
        /* keep polling */
      }
      if (active) timer = window.setTimeout(poll, 1500);
    };

    const handleSignal = async (from: string, kind: string, payload: SignalPayload) => {
      const username = participantsRef.current.find((p) => p.userId === from)?.username ?? from.slice(0, 6);
      if (kind === 'control') {
        const event = (payload as { event?: string })?.event;
        if (event === 'individual-tests-started' || event === 'test-started') void loadMyTest();
        if (event === 'ended') onRefresh();
        return;
      }
      if (kind === 'chat') {
        const text = (payload as { text?: string })?.text;
        if (text) setChat((current) => [...current, { from: username, text }]);
        return;
      }
      const peer = await ensurePeer(from, username, false);
      if (kind === 'offer') {
        await peer.connection.setRemoteDescription(new RTCSessionDescription(payload as RTCSessionDescriptionInit));
        for (const candidate of peer.pendingIce.splice(0)) {
          try {
            await peer.connection.addIceCandidate(new RTCIceCandidate(candidate));
          } catch {
            /* ignore late candidates */
          }
        }
        const answer = await peer.connection.createAnswer();
        await peer.connection.setLocalDescription(answer);
        void sendLessonSignal(room.id, { to: from, kind: 'answer', payload: answer }).catch(() => {});
      } else if (kind === 'answer') {
        await peer.connection.setRemoteDescription(new RTCSessionDescription(payload as RTCSessionDescriptionInit));
        for (const candidate of peer.pendingIce.splice(0)) {
          try {
            await peer.connection.addIceCandidate(new RTCIceCandidate(candidate));
          } catch {
            /* ignore late candidates */
          }
        }
      } else if (kind === 'ice') {
        const candidate = payload as RTCIceCandidateInit;
        if (!peer.connection.remoteDescription) {
          peer.pendingIce.push(candidate);
        } else {
          try {
            await peer.connection.addIceCandidate(new RTCIceCandidate(candidate));
          } catch {
            /* ignore late candidates */
          }
        }
      }
    };

    void poll();
    return () => {
      active = false;
      if (timer) window.clearTimeout(timer);
      for (const peer of peersRef.current.values()) peer.connection.close();
      peersRef.current.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room.id]);

  useEffect(() => {
    participantsRef.current = participants;
  }, [participants]);

  /* Teacher connects to every student as soon as they appear (even before camera). */
  useEffect(() => {
    if (!isHost) return;
    for (const participant of participants) {
      if (participant.userId === user.id) continue;
      if (!peersRef.current.has(participant.userId)) {
        void ensurePeer(participant.userId, participant.username, true);
      }
    }
  }, [participants, isHost, user.id, ensurePeer]);

  /* Student fallback: if the teacher never called (e.g. tabs reloaded), call them in 2s. */
  useEffect(() => {
    if (isHost) return;
    const timer = window.setTimeout(() => {
      for (const participant of participants) {
        if (participant.userId === user.id) continue;
        const isTeacherLike = participant.role === 'teacher' || participant.role === 'school_director' || participant.role === 'school_admin';
        if (isTeacherLike && !peersRef.current.has(participant.userId)) {
          void ensurePeer(participant.userId, participant.username, true);
        }
      }
    }, 2000);
    return () => window.clearTimeout(timer);
  }, [participants, isHost, user.id, ensurePeer]);

  /* ---- Individual AI test for a student ---- */
  const loadMyTest = useCallback(async () => {
    try {
      const response = await getMyRoomTest(room.id);
      setMyTest({ question: response.question ?? null, answer: response.answer ?? null });
      setTestAnswer(response.answer ?? '');
    } catch {
      /* ignore */
    }
  }, [room.id]);

  useEffect(() => {
    void loadMyTest();
  }, [loadMyTest]);

  async function submitTest() {
    if (!testAnswer.trim()) return;
    try {
      const result = await answerMyRoomTest(room.id, { answer: testAnswer });
      setTestFeedback(result.correct ? copy.correct : copy.incorrect);
      void loadMyTest();
    } catch (requestError) {
      setError(describe(requestError, language));
    }
  }

  /* ---- Gamified results ---- */
  const loadResults = useCallback(async () => {
    try {
      const response = await getRoomResults(room.id);
      setResults({ ranking: response.ranking });
    } catch {
      /* ignore */
    }
  }, [room.id]);

  useEffect(() => {
    if (!isHost) return;
    void loadResults();
    const timer = window.setInterval(() => void loadResults(), 4000);
    return () => window.clearInterval(timer);
  }, [isHost, loadResults]);

  async function startIndividualTests() {
    setError('');
    try {
      await assignIndividualRoomTests(room.id);
      await loadResults();
    } catch (requestError) {
      setError(describe(requestError, language));
    }
  }

  async function awardTop() {
    const leader = results.ranking[0];
    if (!leader || !room.classId) {
      setError(copy.awardNeedsClass);
      return;
    }
    try {
      await awardRoomWinner(room.id, { studentId: leader.studentId, assignmentId: room.classId, grade: 5 });
      setError(copy.awardDone.replace('{name}', leader.studentName));
    } catch {
      /* the award endpoint needs an assignment; surface a soft notice */
      setError(copy.awardNeedsClass);
    }
  }

  async function endRoom() {
    try {
      await endLessonRoom(room.id);
    } catch {
      /* ignore */
    }
    onLeave();
  }

  function sendChat(event: React.FormEvent) {
    event.preventDefault();
    if (!chatDraft.trim()) return;
    void sendLessonSignal(room.id, { to: 'all', kind: 'chat', payload: { text: chatDraft.trim() } }).catch(() => {});
    setChat((current) => [...current, { from: user.username, text: chatDraft.trim() }]);
    setChatDraft('');
  }

  useEffect(() => {
    if (localVideo.current && localStream) localVideo.current.srcObject = localStream;
  }, [localStream]);

  return (
    <div className="lesson-room">
      <div className="lesson-room-bar">
        <button type="button" className="btn small" onClick={onLeave}>
          <ArrowLeft size={14} /> {copy.leave}
        </button>
        <div className="lesson-room-code">
          <span>{copy.joinCode}</span>
          <b>{room.code}</b>
          <button type="button" className="btn small" onClick={onCopy}>
            {copied ? <Check size={13} /> : <Copy size={13} />}
          </button>
        </div>
        <span className={`tag ${room.status === 'live' ? 'green' : 'gold'}`}>
          <span className="small-dot" /> {room.status === 'live' ? copy.live : copy.open}
        </span>
      </div>

      {error && <div className="notice" role="alert">{error}</div>}

      <div className="lesson-room-grid">
        <div className="lesson-stage">
          <div className="video-grid">
            <VideoTile
              name={`${user.username} (${copy.you})`}
              stream={sharing ? screenStream : localStream}
              videoRef={localVideo}
              muted
              active={cameraOn || sharing}
              sharing={sharing}
            />
            {participants
              .filter((participant) => participant.userId !== user.id)
              .map((participant) => (
                <VideoTile
                  key={participant.userId}
                  name={participant.username}
                  stream={remoteStreams[participant.userId] ?? null}
                  active={participant.cameraOn || participant.sharingScreen}
                  sharing={participant.sharingScreen}
                />
              ))}
          </div>

          {topic && (
            <section className="panel lesson-topic-panel">
              <div className="section-head">
                <div>
                  <div className="eyebrow">{topic.subject}</div>
                  <h2>{topic.title}</h2>
                </div>
              </div>
              <Interactive3d scene={topic.visual3d} height={260} compact />
              <details className="lesson-facts">
                <summary>{copy.studyFacts}</summary>
                <div className="stack" style={{ marginTop: 10 }}>
                  {topic.facts.map((fact, index) => (
                    <div className="callout" key={`${fact.text}-${index}`}>
                      <b>{index + 1}.</b> {fact.text} <span className="fact-source">{fact.source}</span>
                    </div>
                  ))}
                </div>
              </details>
            </section>
          )}

          <div className="lesson-controls">
            <button type="button" className={`ctrl ${cameraOn ? 'on' : ''}`} onClick={() => void toggleCamera()}>
              {cameraOn ? <Camera size={18} /> : <CameraOff size={18} />}
            </button>
            <button type="button" className={`ctrl ${micOn ? 'on' : ''}`} onClick={() => void toggleMic()}>
              {micOn ? <Mic size={18} /> : <MicOff size={18} />}
            </button>
            <button type="button" className={`ctrl ${sharing ? 'on' : ''}`} onClick={() => void toggleShare()}>
              <MonitorUp size={18} />
            </button>
            <button type="button" className="ctrl danger" onClick={onLeave}>
              <Phone size={18} />
            </button>
          </div>
        </div>

        <aside className="lesson-side">
          <section className="panel">
            <div className="section-head">
              <h2><Users size={15} /> {copy.participants} · {participants.length}</h2>
              <button type="button" className="btn small" onClick={onRefresh}><RefreshCw size={12} /></button>
            </div>
            <div className="stack lesson-people">
              {participants.map((participant) => (
                <div className="lesson-person" key={participant.userId}>
                  <span className="avatar">{participant.username.slice(0, 1).toUpperCase()}</span>
                  <span className="lesson-person-name">{participant.username}</span>
                  <span className="lesson-person-icons">
                    <Camera size={12} className={participant.cameraOn ? 'on' : 'off'} />
                    <Mic size={12} className={participant.micOn ? 'on' : 'off'} />
                    {participant.sharingScreen && <MonitorUp size={12} className="on" />}
                  </span>
                </div>
              ))}
            </div>
          </section>

          <section className="panel">
            <div className="section-head"><h2>{copy.chat}</h2></div>
            <div className="lesson-chat">
              {chat.length === 0 && <p className="muted">{copy.chatEmpty}</p>}
              {chat.map((message, index) => (
                <div className="lesson-chat-line" key={index}>
                  <b>{message.from}:</b> {message.text}
                </div>
              ))}
            </div>
            <form className="row" onSubmit={sendChat} style={{ gap: 6 }}>
              <input
                className="input"
                value={chatDraft}
                onChange={(event) => setChatDraft(event.target.value)}
                placeholder={copy.chatPlaceholder}
              />
              <button type="submit" className="btn small primary" aria-label={copy.chat}>
                <Send size={14} />
              </button>
            </form>
          </section>

          {isHost && (
            <section className="panel">
              <div className="section-head"><h2><Sparkles size={15} /> {copy.teachPanel}</h2></div>
              <div className="stack">
                <button type="button" className="btn primary" onClick={() => void startIndividualTests()}>
                  <Sparkles size={14} /> {copy.startIndividual}
                </button>
                <button type="button" className="btn" onClick={() => void endRoom()}>
                  <X size={14} /> {copy.endLesson}
                </button>
              </div>
            </section>
          )}

          {myTest?.question && (
            <section className="panel lesson-test">
              <div className="section-head">
                <h2><Play size={15} /> {copy.myTest}</h2>
                {myTest.answer && <span className="tag green"><Check size={12} /> {copy.answered}</span>}
              </div>
              {!myTest.answer && !testStarted ? (
                <div className="test-confirm">
                  <p className="lesson-test-question">{copy.testConfirm}</p>
                  <p className="muted">{copy.testConfirmHint}</p>
                  <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
                    <button type="button" className="btn primary" onClick={() => setTestStarted(true)}>
                      <Check size={14} /> {copy.testReady}
                    </button>
                    <button type="button" className="btn" onClick={() => setTestFeedback(copy.testNotReady)}>
                      <X size={14} /> {copy.testNotReadyBtn}
                    </button>
                  </div>
                  {testFeedback && testFeedback === copy.testNotReady && (
                    <div className="callout" style={{ marginTop: 10 }}>{copy.testStudyHint}</div>
                  )}
                </div>
              ) : (
                <>
                  <p className="lesson-test-question">{myTest.question.prompt}</p>
                  <div className="stack">
                    {myTest.question.choices.map((choice) => (
                      <button
                        key={choice}
                        type="button"
                        className={`answer-choice ${testAnswer === choice ? 'chosen' : ''} ${myTest.answer && choice === myTest.question?.correct ? 'correct' : ''}`}
                        onClick={() => setTestAnswer(choice)}
                        disabled={Boolean(myTest.answer)}
                      >
                        {choice}
                      </button>
                    ))}
                  </div>
                  {!myTest.answer && (
                    <button type="button" className="btn primary" style={{ marginTop: 10 }} disabled={!testAnswer} onClick={() => void submitTest()}>
                      <Send size={14} /> {copy.submitAnswer}
                    </button>
                  )}
                </>
              )}
              {testFeedback && testFeedback !== copy.testNotReady && <div className="callout" style={{ marginTop: 10 }}>{testFeedback}</div>}
            </section>
          )}

          {isHost && results.ranking.length > 0 && (
            <section className="panel lesson-ranking">
              <div className="section-head">
                <h2><Trophy size={15} /> {copy.ranking}</h2>
                <button type="button" className="btn small" onClick={() => void awardTop()}>
                  <Award size={13} /> {copy.award}
                </button>
              </div>
              <div className="stack">
                {results.ranking.map((entry, index) => (
                  <div className={`lesson-rank ${index === 0 ? 'top' : ''}`} key={entry.studentId}>
                    <span className="rank-pos">
                      {index === 0 ? <Crown size={15} /> : index + 1}
                    </span>
                    <span className="rank-name">{entry.studentName}</span>
                    <span className="rank-score">{entry.score}</span>
                  </div>
                ))}
              </div>
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}

function VideoTile({
  name,
  stream,
  videoRef,
  muted = false,
  active,
  sharing,
}: {
  name: string;
  stream: MediaStream | null;
  videoRef?: React.RefObject<HTMLVideoElement | null>;
  muted?: boolean;
  active: boolean;
  sharing?: boolean;
}) {
  const internalRef = useRef<HTMLVideoElement | null>(null);
  const ref = videoRef ?? internalRef;
  useEffect(() => {
    if (ref.current && stream) {
      ref.current.srcObject = stream;
      void ref.current.play().catch(() => {});
    }
  }, [stream, ref]);
  return (
    <div className={`video-tile ${active ? 'active' : ''}`}>
      <video ref={ref} autoPlay playsInline muted={muted} />
      {!active && (
        <div className="video-placeholder">
          <span className="avatar large">{name.slice(0, 1).toUpperCase()}</span>
        </div>
      )}
      <span className="video-name">
        {sharing && <MonitorUp size={12} />}
        {name}
      </span>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

const COPY: Record<Language, Record<string, string>> = {
  Русский: {
    eyebrow: 'ЖИВОЙ УРОК · ВИДЕО, МИКРОФОН, ЭКРАН',
    title: 'Онлайн-урок',
    subtitle: 'Откройте урок по теме, поделитесь кодом, и ученики подключатся со своими камерами и экранами.',
    hostCard: 'Открыть урок (учитель)',
    hostHint: 'Выберите тему, создайте комнату и передайте код классу.',
    chooseTopic: 'Тема урока',
    noTopic: 'Без темы (пустая комната)',
    hostAction: 'Создать комнату',
    joinCard: 'Подключиться (ученик)',
    joinHint: 'Введите код, который показал учитель.',
    joinCode: 'Код урока',
    joinAction: 'Войти в урок',
    leave: 'Выйти',
    live: 'В эфире',
    open: 'Открыт',
    you: 'вы',
    participants: 'Участники',
    chat: 'Чат урока',
    chatEmpty: 'Сообщений пока нет.',
    chatPlaceholder: 'Написать сообщение…',
    teachPanel: 'Управление уроком',
    startIndividual: 'Старт индивидуальных ИИ-тестов',
    endLesson: 'Завершить урок',
    myTest: 'Мой тест',
    answered: 'Отвечено',
    submitAnswer: 'Отправить ответ',
    testConfirm: 'Вы входите в индивидуальный тест по теме. Вопрос только для вас.',
    testConfirmHint: 'Сначала изучите 3D-объект и факты в теме, затем подтвердите готовность.',
    testReady: 'Я готов',
    testNotReadyBtn: 'Не готов',
    testNotReady: 'Не готов',
    testStudyHint: 'Не спешите: посмотрите 3D-объект, откройте факты и возвращайтесь, когда будете готовы.',
    studyFacts: 'Изучить факты по теме',
    correct: 'Верно! Учитель увидит ваш результат.',
    incorrect: 'Ответ сохранён. Разберите тему ещё раз.',
    ranking: 'Рейтинг класса',
    award: 'Наградить 1 место',
    cameraDenied: 'Доступ к камере не получен.',
    micDenied: 'Доступ к микрофону не получен.',
    shareDenied: 'Демонстрация экрана отменена.',
    shareUnsupported: 'Браузер не поддерживает демонстрацию экрана.',
    awardNeedsClass: 'Награда требует привязанного класса и задания.',
    awardDone: 'Отличная оценка выставлена: {name}.',
  },
  Uzbek: {
    eyebrow: 'JONLI DARS · VIDEO, MIKROFON, EKRAN',
    title: 'Onlayn dars',
    subtitle: 'Mavzu bo‘yicha dars oching, kodni ulashing — o‘quvchilar kamera va ekran bilan ulanadi.',
    hostCard: 'Dars ochish (o‘qituvchi)',
    hostHint: 'Mavzuni tanlang, xona yarating va kodni sinfga bering.',
    chooseTopic: 'Dars mavzusi',
    noTopic: 'Mavzusiz (bo‘sh xona)',
    hostAction: 'Xona yaratish',
    joinCard: 'Ulanish (o‘quvchi)',
    joinHint: 'O‘qituvchi ko‘rsatgan kodni kiriting.',
    joinCode: 'Dars kodi',
    joinAction: 'Darsga kirish',
    leave: 'Chiqish',
    live: 'Efirda',
    open: 'Ochiq',
    you: 'siz',
    participants: 'Qatnashchilar',
    chat: 'Dars chati',
    chatEmpty: 'Hozircha xabar yo‘q.',
    chatPlaceholder: 'Xabar yozish…',
    teachPanel: 'Darsni boshqarish',
    startIndividual: 'Individual AI testlarni boshlash',
    endLesson: 'Darsni tugatish',
    myTest: 'Mening testim',
    answered: 'Javob berildi',
    submitAnswer: 'Javobni yuborish',
    testConfirm: 'Siz mavzu bo‘yicha individual testga kirmoqdasiz. Savol faqat siz uchun.',
    testConfirmHint: 'Avval 3D obyekt va faktlarni o‘rganing, so‘ng tayyorligingizni tasdiqlang.',
    testReady: 'Tayyorman',
    testNotReadyBtn: 'Tayyor emasman',
    testNotReady: 'Tayyor emasman',
    testStudyHint: 'Shoshilmang: 3D obyektni ko‘ring, faktlarni ochib o‘qing va tayyor bo‘lganda qaytib keling.',
    studyFacts: 'Mavzu bo‘yicha faktlarni o‘rganish',
    correct: 'To‘g‘ri! O‘qituvchi natijani ko‘radi.',
    incorrect: 'Javob saqlandi. Mavzuni yana ko‘rib chiqing.',
    ranking: 'Sinf reytingi',
    award: '1-o‘rinni taqdirlash',
    cameraDenied: 'Kameraga ruxsat berilmadi.',
    micDenied: 'Mikrofonga ruxsat berilmadi.',
    shareDenied: 'Ekran namoyishi bekor qilindi.',
    shareUnsupported: 'Brauzer ekran namoyishini qo‘llamaydi.',
    awardNeedsClass: 'Taqdirlash uchun sinf va topshiriq kerak.',
    awardDone: 'A’lo baho qo‘yildi: {name}.',
  },
  English: {
    eyebrow: 'LIVE LESSON · VIDEO, MIC, SCREEN',
    title: 'Online lesson',
    subtitle: 'Open a lesson for a topic, share the code, and students join with their cameras and screens.',
    hostCard: 'Host a lesson (teacher)',
    hostHint: 'Choose a topic, create a room, and share the code with the class.',
    chooseTopic: 'Lesson topic',
    noTopic: 'No topic (empty room)',
    hostAction: 'Create room',
    joinCard: 'Join (student)',
    joinHint: 'Enter the code the teacher shared.',
    joinCode: 'Lesson code',
    joinAction: 'Join lesson',
    leave: 'Leave',
    live: 'Live',
    open: 'Open',
    you: 'you',
    participants: 'Participants',
    chat: 'Lesson chat',
    chatEmpty: 'No messages yet.',
    chatPlaceholder: 'Write a message…',
    teachPanel: 'Lesson controls',
    startIndividual: 'Start individual AI tests',
    endLesson: 'End lesson',
    myTest: 'My test',
    answered: 'Answered',
    submitAnswer: 'Submit answer',
    testConfirm: 'You are entering your individual topic test. The question is for you only.',
    testConfirmHint: 'Study the 3D object and facts first, then confirm you are ready.',
    testReady: 'I am ready',
    testNotReadyBtn: 'Not ready',
    testNotReady: 'Not ready',
    testStudyHint: 'No rush: explore the 3D object, reveal the facts, and come back when you are ready.',
    studyFacts: 'Study the topic facts',
    correct: 'Correct! Your teacher will see the result.',
    incorrect: 'Answer saved. Review the topic again.',
    ranking: 'Class ranking',
    award: 'Award 1st place',
    cameraDenied: 'Camera permission was not granted.',
    micDenied: 'Microphone permission was not granted.',
    shareDenied: 'Screen sharing was cancelled.',
    shareUnsupported: 'This browser cannot share the screen.',
    awardNeedsClass: 'Awarding needs a linked class and assignment.',
    awardDone: 'Top grade recorded for {name}.',
  },
};

function describe(error: unknown, language: Language): string {
  if (error instanceof ApiError) {
    if (typeof error.data === 'object' && error.data !== null && 'error' in error.data) {
      const message = (error.data as { error?: unknown }).error;
      if (typeof message === 'string') return message;
    }
    return `HTTP ${error.status}`;
  }
  return language === 'Русский' ? 'Не удалось выполнить действие.' : 'Amalni bajarib bo‘lmadi.';
}
