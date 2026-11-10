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
import { useLessonMesh } from './lesson-mesh';
import type { Language } from './school-data';

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
  const [chat, setChat] = useState<Array<{ from: string; text: string }>>([]);
  const [chatDraft, setChatDraft] = useState('');
  const [results, setResults] = useState<{ ranking: RoomRankEntry[] }>({ ranking: [] });
  const [myTest, setMyTest] = useState<{ question: QuizQuestion | null; answer: string | null } | null>(null);
  const [testAnswer, setTestAnswer] = useState('');
  const [testFeedback, setTestFeedback] = useState('');
  const [testStarted, setTestStarted] = useState(false);

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
    onError: (kind) => {
      if (kind === 'camera') setError(copy.cameraDenied);
      else if (kind === 'mic') setError(copy.micDenied);
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
          const username =
            participantsRef.current.find((participant) => participant.userId === message.from)?.username ??
            message.from.slice(0, 6);
          if (message.kind === 'control') {
            const event = (message.payload as { event?: string })?.event;
            if (event === 'individual-tests-started' || event === 'test-started') void loadMyTest();
            if (event === 'ended') onRefresh();
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
      if (active) timer = window.setTimeout(poll, negotiationPending() ? 700 : 1500);
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

  useEffect(() => {
    const element = ref.current;
    if (!element || !stream) return;
    if (element.srcObject !== stream) element.srcObject = stream;
    void element.play().then(() => setSoundBlocked(false)).catch(() => {
      // Autoplay with sound is blocked until the page is activated.
      setSoundBlocked(true);
      const retry = () => {
        void element.play().then(() => setSoundBlocked(false)).catch(() => {});
      };
      document.addEventListener('click', retry, { once: true });
      document.addEventListener('touchstart', retry, { once: true });
    });
  }, [stream, ref, active]);

  async function enableSound() {
    const element = ref.current;
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
      <video ref={ref} autoPlay playsInline muted={muted} />
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
    connectionConnecting: 'Соединение с участниками…',
    connectionLost: 'Соединение с участником потеряно.',
    connectionFailed: 'Не удалось подключиться. Проверьте интернет или нажмите «Переподключиться».',
    reconnect: 'Переподключиться',
    soundBlocked: 'Нажмите, чтобы включить звук',
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
    connectionConnecting: 'Qatnashchilar bilan ulanmoqda…',
    connectionLost: 'Qatnashchi bilan aloqa uzildi.',
    connectionFailed: 'Ulanib bo‘lmadi. Internetingni tekshiring yoki «Qayta ulanish» tugmasini bosing.',
    reconnect: 'Qayta ulanish',
    soundBlocked: 'Ovozni yoqish uchun bosing',
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
    connectionConnecting: 'Connecting to the participants…',
    connectionLost: 'The connection to a participant was lost.',
    connectionFailed: 'Could not connect. Check the internet connection or press “Reconnect”.',
    reconnect: 'Reconnect',
    soundBlocked: 'Tap to enable the sound',
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
