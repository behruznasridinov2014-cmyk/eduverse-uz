import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ApiError,
  answerMyRoomTest,
  assignIndividualRoomTests,
  awardRoomWinner,
  createLessonRoom,
  customFetch,
  endLessonRoom,
  findLessonRoomByCode,
  getLessonRoom,
  getMyRoomTest,
  getRoomResults,
  joinLessonRoom,
  leaveLessonRoom,
  listLessonRooms,
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
import { TopicModels } from './topic-library';
import { AiTutor } from './extras';
import { loadServerIceServers, useLessonMesh } from './lesson-mesh';
import type { Language } from './school-data';
import { friendlyError } from './errors';

/* -------------------------------------------------------------------------- */

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
  useEffect(() => {
    void loadServerIceServers();
  }, []);
  const [room, setRoom] = useState<LessonRoom | null>(null);
  const [openRooms, setOpenRooms] = useState<LessonRoom[]>([]);
  const [participants, setParticipants] = useState<LessonParticipant[]>([]);
  const [joinCode, setJoinCode] = useState('');
  const [mode, setMode] = useState<'idle' | 'host' | 'guest'>('idle');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  // Rooms this account can return to: the lesson survives a page change or
  // an accidental tab close until the host ends it.
  const loadOpenRooms = useCallback(async () => {
    try {
      const response = await listLessonRooms();
      const mine = response.rooms.filter(
        (item) => item.status !== 'ended' && (isTeacher ? item.hostId === user.id : true),
      );
      setOpenRooms(mine.slice(0, 5));
    } catch {
      /* lobby works without the list */
    }
  }, [isTeacher, user.id]);

  useEffect(() => {
    if (mode === 'idle') void loadOpenRooms();
  }, [mode, loadOpenRooms]);

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

  async function rejoin(target: LessonRoom) {
    setBusy(true);
    setError('');
    try {
      const joined = await joinLessonRoom(target.id);
      setRoom(joined.room);
      setParticipants(joined.participants);
      setMode(target.hostId === user.id ? 'host' : 'guest');
    } catch (requestError) {
      setError(describe(requestError, language));
    } finally {
      setBusy(false);
    }
  }

  async function endFromLobby(target: LessonRoom) {
    setBusy(true);
    try {
      await endLessonRoom(target.id);
      await loadOpenRooms();
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
        {openRooms.length > 0 && (
          <section className="panel open-rooms">
            <div className="section-head"><h2><Video size={16} /> {copy.openRooms}</h2></div>
            <div className="stack">
              {openRooms.map((item) => (
                <div className="open-room-row" key={item.id}>
                  <span className="open-room-code">{item.code}</span>
                  <span className="open-room-title">{item.title}{item.subject ? ` · ${item.subject}` : ''}</span>
                  <button type="button" className="btn small primary" disabled={busy} onClick={() => void rejoin(item)}>
                    {copy.rejoin}
                  </button>
                  {item.hostId === user.id && (
                    <button type="button" className="btn small" disabled={busy} onClick={() => void endFromLobby(item)}>
                      {copy.endLesson}
                    </button>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}
        <div className="grid grid-2">
          {isTeacher && (
            <section className="panel reveal-up lobby-card">
              <h2><Video size={17} /> {copy.hostCard}</h2>
              <p className="muted">{copy.hostHint}</p>
              <div className="control">
                <label htmlFor="host-topic">{copy.chooseTopic}</label>
                <select id="host-topic" value={selectedTopicId} onChange={(event) => setSelectedTopicId(event.target.value)}>
                  <option value="">{copy.noTopic}</option>
                  {[...new Map(topics.map((topic) => [`${topic.subject} · ${topic.title}`, topic])).values()].map((topic) => (
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
      topics={topics}
      user={user}
      language={language}
      isHost={mode === 'host' || room.hostId === user.id}
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

type TestItemView = { prompt: string; choices: string[]; answer: string | null; correct: string | null; explanation: string | null };
type RankRow = RoomRankEntry & {
  total?: number;
  answeredCount?: number;
  correctCount?: number;
  items?: Array<{ prompt: string; answer: string | null; correct: string; isCorrect: boolean }>;
};

function RoomView({
  room,
  participants,
  topic: initialTopic,
  topics,
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
  topics: LessonTopic[];
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
  const [chat, setChat] = useState<Array<{ from: string; text: string }>>([]);
  const [chatDraft, setChatDraft] = useState('');
  const [results, setResults] = useState<{ ranking: RankRow[] }>({ ranking: [] });
  const [myTest, setMyTest] = useState<{ items: TestItemView[] } | null>(null);
  const [testAnswer, setTestAnswer] = useState('');
  const [testIndex, setTestIndex] = useState(0);
  const [testFeedback, setTestFeedback] = useState('');
  const [testStarted, setTestStarted] = useState(false);
  const [topic, setTopic] = useState<LessonTopic | null>(initialTopic);
  const [info, setInfo] = useState('');
  const [testsBusy, setTestsBusy] = useState(false);

  /* ---- Topic of the lesson (3D object + facts), shared with everybody ---- */
  const loadRoomTopic = useCallback(async () => {
    try {
      const response = await customFetch<{ topic: LessonTopic | null }>(`/api/rooms/${room.id}/topic`, { method: 'GET' });
      setTopic(response.topic);
    } catch {
      /* the lesson works without a topic */
    }
  }, [room.id]);

  useEffect(() => {
    void loadRoomTopic();
  }, [loadRoomTopic]);

  async function changeTopic(topicId: string) {
    setError('');
    try {
      const response = await customFetch<{ topic: LessonTopic | null }>(`/api/rooms/${room.id}/topic`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topicId: topicId || null }),
      });
      setTopic(response.topic);
    } catch (requestError) {
      setError(describe(requestError, language));
    }
  }

  const participantsRef = useRef<LessonParticipant[]>([]);
  const lastSeq = useRef(0);

  /* ---- WebRTC mesh (camera / microphone / screen) ---- */
  const mesh = useLessonMesh({
    roomId: room.id,
    selfUserId: user.id,
    sendSignal: async (to, kind, payload) => {
      await sendLessonSignal(room.id, { to, kind, payload });
    },
    onPresence: (patch) => {
      void setLessonPresence(room.id, patch);
    },
    onError: (kind, reason) => {
      if (kind === 'camera') setError(copy.cameraDenied);
      else if (kind === 'mic') {
        setError(
          reason === 'NotAllowedError' || reason === 'SecurityError'
            ? copy.micDenied
            : reason === 'NotFoundError' || reason === 'OverconstrainedError'
              ? copy.micMissing
              : reason === 'NotReadableError' || reason === 'AbortError'
                ? copy.micBusy
                : reason === 'InsecureContext'
                  ? copy.micInsecure
                  : copy.micDenied,
        );
      }
      else if (kind === 'share-denied') setError(copy.shareDenied);
      else if (kind === 'share-unsupported') setError(copy.shareUnsupported);
    },
  });

  const {
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
    handleSignal: handleMeshSignal,
    ensurePeer,
    reconnect,
    flushNegotiations,
    negotiationPending,
  } = mesh;

  /* Somebody is not connected yet (or the path is blocked). */
  const connectionProblem = useMemo(() => {
    const states = Object.values(peerStates);
    if (states.includes('failed')) return 'failed';
    if (states.includes('disconnected')) return 'disconnected';
    if (states.some((state) => state === 'connecting' || state === 'new')) {
      return 'connecting';
    }
    return 'ok';
  }, [peerStates]);

  /* ---- Leaving by navigation or tab close ----
   * The participant row is closed so others stop calling this peer, but the
   * room itself stays open: the lobby offers to return until the host ends it.
   */
  useEffect(() => {
    const leaveQuietly = () => {
      try {
        void fetch(`/api/rooms/${room.id}/leave`, { method: 'POST', keepalive: true, headers: { 'content-type': 'application/json' } });
      } catch {
        /* closing anyway */
      }
    };
    window.addEventListener('pagehide', leaveQuietly);
    return () => {
      window.removeEventListener('pagehide', leaveQuietly);
      leaveQuietly();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room.id]);

  /* ---- Signalling poll loop (long poll) ---- */
  useEffect(() => {
    let active = true;
    let timer: number | undefined;
    const poll = async () => {
      if (!active) return;
      try {
        // The server holds the request until a message arrives, so the next
        // offer is seen in a fraction of a second instead of a full poll cycle.
        const batch = await pollLessonSignals(room.id, { since: lastSeq.current, wait: 6000 });
        lastSeq.current = batch.lastSeq;
        for (const message of batch.messages) {
          const username =
            participantsRef.current.find((participant) => participant.userId === message.from)?.username ??
            message.from.slice(0, 6);
          if (message.kind === 'control') {
            const event = (message.payload as { event?: string })?.event;
            if (event === 'individual-tests-started' || event === 'test-started') void loadMyTest();
            if (event === 'ended') onRefresh();
            if (event === 'topic') void loadRoomTopic();
            if (event === 'test-progress') void loadResults();
            continue;
          }
          if (message.kind === 'chat') {
            const text = (message.payload as { text?: string })?.text;
            if (text) setChat((current) => [...current, { from: username, text }]);
            continue;
          }
          await handleMeshSignal(message.from, message.kind, message.payload as SignalPayload);
        }
        onParticipants(batch.participants);
        // Offers that are still missing are sent with the next round trip.
        flushNegotiations();
        if (batch.roomStatus === 'ended') {
          onRefresh();
        }
      } catch {
        /* keep polling */
      }
      if (active) timer = window.setTimeout(poll, 150);
    };

    void poll();
    return () => {
      active = false;
      if (timer) window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room.id]);

  useEffect(() => {
    participantsRef.current = participants;
  }, [participants]);

  /* Everybody connects to everybody as soon as both sides are in the room. */
  useEffect(() => {
    for (const participant of participants) {
      if (participant.userId === user.id) continue;
      ensurePeer(participant.userId, participant.username);
    }
  }, [participants, user.id, ensurePeer]);

  /* ---- Individual AI test for a student ---- */
  const loadMyTest = useCallback(async () => {
    try {
      const response = await customFetch<{ items?: TestItemView[] }>(`/api/rooms/${room.id}/my-test`, { method: 'GET' });
      const items = response.items ?? [];
      setMyTest({ items });
      const next = items.findIndex((item) => item.answer === null);
      setTestIndex(next === -1 ? Math.max(0, items.length - 1) : next);
      setTestAnswer('');
      if (next === 0) setTestStarted(false);
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
      const result = await customFetch<{ items: TestItemView[] }>(`/api/rooms/${room.id}/my-test`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ index: testIndex, answer: testAnswer }),
      });
      setMyTest({ items: result.items });
    } catch (requestError) {
      setError(describe(requestError, language));
    }
  }

  function nextQuestion() {
    if (!myTest) return;
    const next = myTest.items.findIndex((item) => item.answer === null);
    setTestIndex(next === -1 ? myTest.items.length : next);
    setTestAnswer('');
  }

  /* ---- Gamified results ---- */
  const loadResults = useCallback(async () => {
    try {
      const response = await customFetch<{ ranking: RankRow[] }>(`/api/rooms/${room.id}/results`, { method: 'GET' });
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
    setInfo('');
    setTestsBusy(true);
    try {
      const response = await assignIndividualRoomTests(room.id);
      const count = (response as { assigned?: number }).assigned ?? 0;
      setInfo(copy.testsSent.replace('{n}', String(count)));
      await loadResults();
    } catch (requestError) {
      setError(describe(requestError, language));
    } finally {
      setTestsBusy(false);
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
    const element = localVideo.current;
    if (!element) return;
    const stream = sharing ? screenStream : localStream;
    if (!stream) return;
    if (element.srcObject !== stream) element.srcObject = stream;
    void element.play().catch(() => {});
  }, [localStream, screenStream, sharing, cameraOn, micOn]);

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
      {info && <div className="notice success" role="status">{info}</div>}
      {isHost && participants.length <= 1 && (
        <div className="notice lesson-invite" role="status">{copy.inviteHint.replace('{code}', room.code)}</div>
      )}

      {connectionProblem !== 'ok' && (
        <div className={`notice lesson-connection ${connectionProblem}`} role="status">
          <span>
            {connectionProblem === 'connecting'
              ? copy.connectionConnecting
              : connectionProblem === 'disconnected'
                ? copy.connectionLost
                : copy.connectionFailed}
          </span>
          {connectionProblem !== 'connecting' && (
            <button type="button" className="btn small" onClick={reconnect}>
              <RefreshCw size={13} /> {copy.reconnect}
            </button>
          )}
        </div>
      )}

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
                  soundLabel={copy.soundBlocked}
                />
              ))}
          </div>

          {(topic || isHost) && (
            <section className="panel lesson-topic-panel">
              {isHost && (
                <div className="control lesson-topic-picker">
                  <label htmlFor="room-topic">{copy.chooseTopic}</label>
                  <select id="room-topic" value={topic?.id ?? ''} onChange={(event) => void changeTopic(event.target.value)}>
                    <option value="">{copy.noTopic}</option>
                    {[...new Map(topics.map((item) => [`${item.subject} · ${item.title}`, item])).values()].map((item) => (
                      <option key={item.id} value={item.id}>{item.subject} · {item.title}</option>
                    ))}
                  </select>
                </div>
              )}
              {topic && (<>
              <div className="section-head">
                <div>
                  <div className="eyebrow">{topic.subject}</div>
                  <h2>{topic.title}</h2>
                </div>
              </div>
              <TopicModels topic={topic} language={language} />
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
              </>)}
              {!topic && isHost && <p className="muted">{copy.topicEmpty}</p>}
            </section>
          )}

          <div className="lesson-controls">
            <button type="button" className={`ctrl ${cameraOn ? 'on' : ''}`} onClick={() => void toggleCamera()}>
              {cameraOn ? <Camera size={18} /> : <CameraOff size={18} />}
            </button>
            <span className="ctrl-wrap">
              <button type="button" className={`ctrl ${micOn ? 'on' : ''}`} onClick={() => void toggleMic()}>
                {micOn ? <Mic size={18} /> : <MicOff size={18} />}
              </button>
              {micOn && <MicLevel stream={localStream} active={micOn} />}
            </span>
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
              {participants.map((participant) => {
                const state = participant.userId === user.id ? 'connected' : peerStates[participant.userId] ?? 'new';
                const connected = state === 'connected';
                return (
                  <div className="lesson-person" key={participant.userId}>
                    <span className="avatar">{participant.username.slice(0, 1).toUpperCase()}</span>
                    <span className="lesson-person-name">{participant.username}</span>
                    <span className="lesson-person-icons">
                      <Camera size={12} className={participant.cameraOn ? 'on' : 'off'} />
                      <Mic size={12} className={participant.micOn ? 'on' : 'off'} />
                      {participant.sharingScreen && <MonitorUp size={12} className="on" />}
                      <span className={`lesson-person-link ${connected ? 'on' : 'off'}`} title={connected ? copy.connected : copy.connecting} />
                    </span>
                  </div>
                );
              })}
            </div>
          </section>

          <AiTutor language={language} topicId={topic?.id ?? null} compact />

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
                <button type="button" className="btn primary" disabled={testsBusy} onClick={() => void startIndividualTests()}>
                  {testsBusy ? <RefreshCw size={14} className="school-spin" /> : <Sparkles size={14} />} {copy.startIndividual}
                </button>
                <button type="button" className="btn" onClick={() => void endRoom()}>
                  <X size={14} /> {copy.endLesson}
                </button>
              </div>
            </section>
          )}

          {myTest && myTest.items.length > 0 && (() => {
            const items = myTest.items;
            const total = items.length;
            const answeredCount = items.filter((item) => item.answer !== null).length;
            const rightCount = items.filter((item) => item.answer !== null && item.answer === item.correct).length;
            const current = items[testIndex];
            return (
              <section className="panel lesson-test">
                <div className="section-head">
                  <h2><Play size={15} /> {copy.myTest}</h2>
                  <span className="tag">{Math.min(answeredCount + (current && current.answer === null ? 1 : 0), total)} / {total}</span>
                </div>
                <div className="test-progress"><span style={{ width: `${(answeredCount / total) * 100}%` }} /></div>
                {!testStarted && answeredCount === 0 ? (
                  <div className="test-confirm">
                    <p className="lesson-test-question">{copy.testConfirm}</p>
                    <p className="muted">{copy.testConfirmHint}</p>
                    <button type="button" className="btn primary" style={{ marginTop: 10 }} onClick={() => setTestStarted(true)}>
                      <Check size={14} /> {copy.testReady}
                    </button>
                  </div>
                ) : !current ? (
                  <div className="test-done">
                    <b>{rightCount} / {total}</b>
                    <p className="muted">{copy.testDone}</p>
                    <div className="stack">
                      {items.map((item, index) => (
                        <div className={`test-review ${item.answer === item.correct ? 'right' : 'wrong'}`} key={index}>
                          <span>{index + 1}. {item.prompt}</span>
                          {item.answer !== item.correct && <small>{copy.rightAnswer}: {item.correct}</small>}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <>
                    <p className="lesson-test-question">{current.prompt}</p>
                    <div className="stack">
                      {current.choices.map((choice) => (
                        <button
                          key={choice}
                          type="button"
                          className={`answer-choice ${(current.answer ?? testAnswer) === choice ? 'chosen' : ''} ${current.answer !== null && choice === current.correct ? 'correct' : ''} ${current.answer === choice && choice !== current.correct ? 'wrong' : ''}`}
                          onClick={() => setTestAnswer(choice)}
                          disabled={current.answer !== null}
                        >
                          {choice}
                        </button>
                      ))}
                    </div>
                    {current.answer === null ? (
                      <button type="button" className="btn primary" style={{ marginTop: 10 }} disabled={!testAnswer} onClick={() => void submitTest()}>
                        <Send size={14} /> {copy.submitAnswer}
                      </button>
                    ) : (
                      <>
                        <div className="callout" style={{ marginTop: 10 }}>
                          <b>{current.answer === current.correct ? copy.correct : copy.incorrect}</b>
                          {current.explanation ? <><br />{current.explanation}</> : null}
                        </div>
                        <button type="button" className="btn primary" style={{ marginTop: 10 }} onClick={nextQuestion}>
                          {answeredCount === total ? copy.testFinish : copy.testNext}
                        </button>
                      </>
                    )}
                  </>
                )}
              </section>
            );
          })()}

          {isHost && results.ranking.some((entry) => (entry.total ?? 0) > 0) && (
            <section className="panel lesson-ranking">
              <div className="section-head">
                <h2><Trophy size={15} /> {copy.ranking}</h2>
                <button type="button" className="btn small" onClick={() => void awardTop()}>
                  <Award size={13} /> {copy.award}
                </button>
              </div>
              <div className="stack">
                {results.ranking.filter((entry) => (entry.total ?? 0) > 0).map((entry, index) => {
                  const wrong = (entry.items ?? []).filter((item) => item.answer !== null && !item.isCorrect);
                  return (
                    <details className={`lesson-rank ${index === 0 && entry.answered ? 'top' : ''}`} key={entry.studentId}>
                      <summary>
                        <span className="rank-pos">{index === 0 && entry.answered ? <Crown size={15} /> : index + 1}</span>
                        <span className="rank-name">{entry.studentName}</span>
                        <span className="rank-score">
                          {entry.answered ? `${entry.correctCount} / ${entry.total}` : `${copy.inProgress} ${entry.answeredCount}/${entry.total}`}
                        </span>
                      </summary>
                      <div className="rank-detail">
                        {(entry.items ?? []).map((item, itemIndex) => (
                          <div className={`test-review ${item.answer === null ? 'pending' : item.isCorrect ? 'right' : 'wrong'}`} key={itemIndex}>
                            <span>{itemIndex + 1}. {item.prompt}</span>
                            {item.answer !== null && !item.isCorrect && <small>{copy.studentAnswer}: {item.answer} · {copy.rightAnswer}: {item.correct}</small>}
                          </div>
                        ))}
                        {entry.answered && <p className="muted">{wrong.length === 0 ? copy.allRight : copy.needsHelp.replace('{n}', String(wrong.length))}</p>}
                      </div>
                    </details>
                  );
                })}
              </div>
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}


/**
 * Shows the level of the local microphone. It answers the question "does my
 * microphone work?" without waiting for the other side to say something.
 */
function MicLevel({ stream, active }: { stream: MediaStream | null; active: boolean }) {
  const [level, setLevel] = useState(0);

  useEffect(() => {
    if (!stream || !active) {
      setLevel(0);
      return;
    }
    const tracks = stream.getAudioTracks();
    if (tracks.length === 0) return;
    const context = new AudioContext();
    const source = context.createMediaStreamSource(new MediaStream(tracks));
    const analyser = context.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);
    const data = new Uint8Array(analyser.frequencyBinCount);
    let frame = 0;
    const tick = () => {
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (const value of data) {
        const sample = (value - 128) / 128;
        sum += sample * sample;
      }
      const rms = Math.sqrt(sum / data.length);
      setLevel(Math.min(1, rms * 5));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      source.disconnect();
      void context.close();
    };
  }, [stream, active]);

  return (
    <span className="mic-level" title="Уровень микрофона">
      <i style={{ transform: `scaleX(${Math.max(0.04, level)})` }} />
    </span>
  );
}

function VideoTile({
  name,
  stream,
  videoRef,
  muted = false,
  active,
  sharing,
  soundLabel,
}: {
  name: string;
  stream: MediaStream | null;
  videoRef?: React.RefObject<HTMLVideoElement | null>;
  muted?: boolean;
  active: boolean;
  sharing?: boolean;
  soundLabel?: string;
}) {
  const internalRef = useRef<HTMLVideoElement | null>(null);
  const ref = videoRef ?? internalRef;
  const [hasVideo, setHasVideo] = useState(false);
  const [soundBlocked, setSoundBlocked] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const detect = () => setHasVideo(element.videoWidth > 0 && element.videoHeight > 0);
    element.addEventListener('loadeddata', detect);
    element.addEventListener('resize', detect);
    detect();
    return () => {
      element.removeEventListener('loadeddata', detect);
      element.removeEventListener('resize', detect);
    };
  }, [stream, ref]);

  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Picture: the video element is always muted, so the browser never blocks it.
  useEffect(() => {
    const element = ref.current;
    if (!element || !stream) return;
    if (element.srcObject !== stream) element.srcObject = stream;
    void element.play().catch(() => {});
  }, [stream, ref, active]);

  // Sound: a separate audio element that is re-attached whenever the set of
  // audio tracks changes. A microphone that is switched on after the camera
  // adds its track to an already playing stream, and a video element does not
  // reliably start playing such a late track.
  useEffect(() => {
    const element = audioRef.current;
    if (!element || !stream || muted) return;
    let signature = '';
    const attach = () => {
      const tracks = stream.getAudioTracks().filter((track) => track.readyState === 'live');
      const next = tracks.map((track) => track.id).join(',');
      if (next === signature && (next === '' || !element.paused)) return;
      signature = next;
      if (!tracks.length) {
        element.srcObject = null;
        return;
      }
      element.srcObject = new MediaStream(tracks);
      element.volume = 1;
      void element.play().then(() => setSoundBlocked(false)).catch(() => setSoundBlocked(true));
    };
    attach();
    const timer = window.setInterval(attach, 700);
    const retry = () => {
      void element.play().then(() => setSoundBlocked(false)).catch(() => {});
    };
    document.addEventListener('click', retry);
    document.addEventListener('touchstart', retry);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('click', retry);
      document.removeEventListener('touchstart', retry);
      element.srcObject = null;
    };
  }, [stream, muted]);

  async function enableSound() {
    const element = audioRef.current;
    if (!element) return;
    try {
      await element.play();
      setSoundBlocked(false);
    } catch {
      setSoundBlocked(true);
    }
  }

  return (
    <div className={`video-tile ${active ? 'active' : ''}`}>
      <video ref={ref} autoPlay playsInline muted />
      {!muted && <audio ref={audioRef} autoPlay />}
      {(!active || !hasVideo) && (
        <div className="video-placeholder">
          <span className="avatar large">{name.slice(0, 1).toUpperCase()}</span>
        </div>
      )}
      {soundBlocked && !muted && (
        <button type="button" className="video-sound-hint" onClick={() => void enableSound()}>
          <Mic size={13} /> {soundLabel ?? 'Sound'}
        </button>
      )}
      <span className="video-name">
        {sharing && <MonitorUp size={12} />}
        {name}
        {!muted && stream && stream.getAudioTracks().length > 0 && <MicLevel stream={stream} active />}
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
    openRooms: 'Ваши открытые уроки',
    rejoin: 'Вернуться',
    testsSent: 'Тесты отправлены ученикам: {n}. Каждый видит только свой вопрос.',
    inviteHint: 'Сообщите ученикам код {code}. Каждый ученик входит со своего устройства и под своим аккаунтом. Для проверки на одном компьютере откройте ученика в окне инкогнито (Ctrl+Shift+N).',
    topicEmpty: 'Выберите тему — ученики увидят 3D-объект и факты.',
    chatPlaceholder: 'Написать сообщение…',
    teachPanel: 'Управление уроком',
    startIndividual: 'Старт индивидуальных ИИ-тестов',
    endLesson: 'Завершить урок',
    myTest: 'Мой тест',
    testDone: 'Тест завершён. Учитель видит ваш результат.',
    rightAnswer: 'Верно',
    studentAnswer: 'Ответ',
    testNext: 'Следующий вопрос',
    testFinish: 'Показать результат',
    inProgress: 'Отвечает',
    allRight: 'Все ответы верные.',
    needsHelp: 'Ошибок: {n}. Эти вопросы стоит объяснить ещё раз.',
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
    micDenied: 'Нет доступа к микрофону. Нажмите значок замка слева от адреса сайта → Микрофон → Разрешить и обновите страницу.',
    micMissing: 'Микрофон не найден. Подключите микрофон или наушники с микрофоном и обновите страницу.',
    micBusy: 'Микрофон занят другой программой или вкладкой (Zoom, Telegram, другая вкладка). Закройте её и нажмите на микрофон снова.',
    micInsecure: 'Микрофон работает только на защищённом адресе https://.',
    micHint: 'Микрофон включён. Полоска показывает, что вас слышно.',
    shareDenied: 'Демонстрация экрана отменена.',
    shareUnsupported: 'Этот браузер не умеет показывать экран (iPhone/Safari). Откройте урок в Chrome на Android или на компьютере.',
    connectionConnecting: 'Соединение с участниками…',
    connectionLost: 'Соединение с участником потеряно.',
    connectionFailed: 'Не удалось подключиться. Проверьте интернет или нажмите «Переподключиться».',
    reconnect: 'Переподключиться',
    soundBlocked: 'Нажмите, чтобы включить звук',
    connected: 'Соединение установлено',
    connecting: 'Подключение…',
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
    openRooms: 'Ochiq darslaringiz',
    rejoin: 'Qaytish',
    testsSent: 'Testlar o‘quvchilarga yuborildi: {n}. Har kim faqat o‘z savolini ko‘radi.',
    inviteHint: 'O‘quvchilarga {code} kodini ayting. Har bir o‘quvchi o‘z qurilmasidan va o‘z hisobidan kiradi. Bitta kompyuterda sinash uchun o‘quvchini inkognito oynada oching (Ctrl+Shift+N).',
    topicEmpty: 'Mavzuni tanlang — o‘quvchilar 3D obyekt va faktlarni ko‘radi.',
    chatPlaceholder: 'Xabar yozish…',
    teachPanel: 'Darsni boshqarish',
    startIndividual: 'Individual AI testlarni boshlash',
    endLesson: 'Darsni tugatish',
    myTest: 'Mening testim',
    testDone: 'Test tugadi. O‘qituvchi natijangizni ko‘radi.',
    rightAnswer: 'To‘g‘ri',
    studentAnswer: 'Javob',
    testNext: 'Keyingi savol',
    testFinish: 'Natijani ko‘rish',
    inProgress: 'Javob bermoqda',
    allRight: 'Barcha javoblar to‘g‘ri.',
    needsHelp: 'Xatolar: {n}. Bu savollarni yana tushuntirish kerak.',
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
    micDenied: 'Mikrofonga ruxsat yo‘q. Sayt manzili chap tomondagi qulf belgisini bosing → Mikrofon → Ruxsat berish va sahifani yangilang.',
    micMissing: 'Mikrofon topilmadi. Mikrofon yoki quloqchinni ulang va sahifani yangilang.',
    micBusy: 'Mikrofonni boshqa dastur yoki oyna band qilgan (Zoom, Telegram, boshqa oyna). Uni yoping va mikrofonni qayta bosing.',
    micInsecure: 'Mikrofon faqat himoyalangan https:// manzilda ishlaydi.',
    micHint: 'Mikrofon yoqilgan. Chiziq sizning ovozingiz eshitilayotganini ko‘rsatadi.',
    shareDenied: 'Ekran namoyishi bekor qilindi.',
    shareUnsupported: 'Bu brauzer ekran ko‘rsata olmaydi (iPhone/Safari). Darsni Android yoki kompyuterda Chrome’da oching.',
    connectionConnecting: 'Qatnashchilar bilan ulanmoqda…',
    connectionLost: 'Qatnashchi bilan aloqa uzildi.',
    connectionFailed: 'Ulanib bo‘lmadi. Internetingni tekshiring yoki «Qayta ulanish» tugmasini bosing.',
    reconnect: 'Qayta ulanish',
    soundBlocked: 'Ovozni yoqish uchun bosing',
    connected: 'Ulanish o‘rnatildi',
    connecting: 'Ulanmoqda…',
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
    openRooms: 'Your open lessons',
    rejoin: 'Return',
    testsSent: 'Tests sent to {n} students. Each one sees only their own question.',
    inviteHint: 'Give the students the code {code}. Every student joins from their own device and account. To try it on one computer, open the student in an incognito window (Ctrl+Shift+N).',
    topicEmpty: 'Choose a topic — students will see the 3D object and facts.',
    chatPlaceholder: 'Write a message…',
    teachPanel: 'Lesson controls',
    startIndividual: 'Start individual AI tests',
    endLesson: 'End lesson',
    myTest: 'My test',
    testDone: 'Test finished. Your teacher sees the result.',
    rightAnswer: 'Correct',
    studentAnswer: 'Answer',
    testNext: 'Next question',
    testFinish: 'Show result',
    inProgress: 'Answering',
    allRight: 'All answers are correct.',
    needsHelp: 'Mistakes: {n}. These questions need another explanation.',
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
    micDenied: 'No microphone access. Click the lock icon left of the address → Microphone → Allow, then reload the page.',
    micMissing: 'No microphone found. Plug in a microphone or headset and reload the page.',
    micBusy: 'The microphone is used by another app or tab (Zoom, Telegram, another tab). Close it and press the microphone again.',
    micInsecure: 'The microphone only works on a secure https:// address.',
    micHint: 'Microphone is on. The bar shows that you can be heard.',
    shareDenied: 'Screen sharing was cancelled.',
    shareUnsupported: 'This browser cannot share the screen (iPhone/Safari). Open the lesson in Chrome on Android or on a computer.',
    connectionConnecting: 'Connecting to the participants…',
    connectionLost: 'The connection to a participant was lost.',
    connectionFailed: 'Could not connect. Check the internet connection or press “Reconnect”.',
    reconnect: 'Reconnect',
    soundBlocked: 'Tap to enable the sound',
    connected: 'Connected',
    connecting: 'Connecting…',
    awardNeedsClass: 'Awarding needs a linked class and assignment.',
    awardDone: 'Top grade recorded for {name}.',
  },
};

function describe(error: unknown, language: Language): string {
  return friendlyError(error, language, { en: 'The action failed.', ru: 'Не удалось выполнить действие.', uz: 'Amalni bajarib bo‘lmadi.' });
}
