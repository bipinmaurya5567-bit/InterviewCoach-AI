"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import Webcam from "react-webcam";
import { useAuth } from "@/context/AuthContext";
import { useInterview } from "@/context/InterviewContext";
import { useSpeechRecognition } from "@/hooks/useSpeechRecognition";
import { useEmotionDetection } from "@/hooks/useEmotionDetection";
import { useTextToSpeech } from "@/hooks/useTextToSpeech";
import EmotionMeter from "@/components/EmotionMeter";
import { QuestionProgress } from "@/components/ui/ProgressBar";
import { PageLoader } from "@/components/ui/LoadingSpinner";
import { db } from "@/lib/firebase";
import { collection, addDoc } from "firebase/firestore";
import type { InterviewQuestion, AnswerAnalysis } from "@/lib/groq";
import type { QuestionResult } from "@/context/InterviewContext";

const TOTAL_QUESTIONS = 10;

type Phase =
  | "loading"
  | "ready"
  | "speaking"
  | "listening"
  | "analyzing"
  | "followup"
  | "listening2"
  | "done";

/* ─────────────────── AI Avatar Tile ─────────────────── */
function AITile({ isSpeaking }: { isSpeaking: boolean }) {
  return (
    <div className={`relative flex flex-col rounded-2xl overflow-hidden bg-[#0a0a18] border ${isSpeaking ? "border-purple-500/60 speaking-pulse" : "border-white/[0.08]"} transition-colors duration-300`}
      style={{ aspectRatio: "4/3" }}>
      {/* gradient backdrop */}
      <div className="absolute inset-0 bg-gradient-to-br from-purple-900/20 via-transparent to-blue-900/20 pointer-events-none" />

      {/* Avatar */}
      <div className="flex-1 flex items-center justify-center">
        <div className="relative flex flex-col items-center gap-3">
          {/* Outer pulse ring */}
          {isSpeaking && (
            <motion.div
              className="absolute inset-0 rounded-full"
              style={{ width: 88, height: 88, top: -4, left: -4 }}
              animate={{ scale: [1, 1.25, 1], opacity: [0.6, 0, 0.6] }}
              transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
            >
              <div className="w-full h-full rounded-full border-2 border-purple-400/50" />
            </motion.div>
          )}

          {/* Avatar circle */}
          <motion.div
            className="w-20 h-20 rounded-full flex items-center justify-center text-4xl"
            style={{ background: "linear-gradient(135deg, #7c3aed, #2563eb)", boxShadow: isSpeaking ? "0 0 32px rgba(139,92,246,0.6)" : "0 0 20px rgba(139,92,246,0.25)" }}
            animate={isSpeaking ? { scale: [1, 1.05, 1] } : {}}
            transition={{ duration: 0.8, repeat: Infinity, ease: "easeInOut" }}
          >
            🤖
          </motion.div>

          {/* Waveform — shown only when speaking */}
          <div className="flex items-end gap-[3px] h-6">
            {isSpeaking ? (
              [32, 40, 24, 48, 40, 28, 36].map((h, i) => (
                <span
                  key={i}
                  className="wave-bar"
                  style={{ height: `${h}%`, animationDelay: `${i * 0.1}s` }}
                />
              ))
            ) : (
              [3, 3, 3, 3, 3].map((_, i) => (
                <span key={i} className="inline-block w-1 rounded-full bg-white/10" style={{ height: 3 }} />
              ))
            )}
          </div>
        </div>
      </div>

      {/* Name tag */}
      <div className="flex items-center justify-between px-3 py-2 bg-black/50 backdrop-blur-sm">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-purple-400" />
          <span className="text-xs font-semibold text-slate-300">AI Interviewer</span>
        </div>
        {isSpeaking && (
          <span className="text-[10px] font-bold text-purple-400 tracking-widest uppercase animate-pulse">Speaking</span>
        )}
      </div>
    </div>
  );
}

/* ─────────────────── Candidate Webcam Tile ─────────────────── */
function CandidateTile({
  webcamRef,
  userName,
  isListening,
  onReady,
  onError,
}: {
  webcamRef: React.RefObject<Webcam | null>;
  userName: string;
  isListening: boolean;
  onReady: () => void;
  onError: () => void;
}) {
  return (
    <div
      className={`relative flex flex-col rounded-2xl overflow-hidden bg-[#080810] border ${isListening ? "border-emerald-500/60 mic-pulse" : "border-white/[0.08]"} transition-colors duration-300`}
      style={{ aspectRatio: "4/3" }}
    >
      <Webcam
        ref={webcamRef}
        audio={false}
        mirrored
        onUserMedia={onReady}
        onUserMediaError={onError}
        className="w-full h-full object-cover"
        style={{ display: "block" }}
      />

      {/* REC badge */}
      <div className="absolute top-2 left-2 flex items-center gap-1.5 bg-black/70 backdrop-blur-sm rounded-full px-2.5 py-1">
        <span className="record-blink w-1.5 h-1.5 rounded-full bg-red-500 inline-block" />
        <span className="text-[10px] font-bold text-white tracking-wider">REC</span>
      </div>

      {/* Mic active indicator */}
      {isListening && (
        <motion.div
          className="absolute top-2 right-2 flex items-center gap-1.5 bg-emerald-900/80 backdrop-blur-sm rounded-full px-2.5 py-1 border border-emerald-500/40"
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
        >
          <motion.span
            className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block"
            animate={{ scale: [1, 1.4, 1] }}
            transition={{ duration: 0.7, repeat: Infinity }}
          />
          <span className="text-[10px] font-bold text-emerald-300">MIC ON</span>
        </motion.div>
      )}

      {/* Name tag */}
      <div className="flex items-center justify-between px-3 py-2 bg-black/60 backdrop-blur-sm">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${isListening ? "bg-emerald-400" : "bg-slate-500"}`} />
          <span className="text-xs font-semibold text-slate-300">{userName}</span>
        </div>
        {isListening && (
          <span className="text-[10px] font-bold text-emerald-400 tracking-widest uppercase">Listening</span>
        )}
      </div>
    </div>
  );
}

/* ─────────────────── Main Component ─────────────────── */
function InterviewContent() {
  const { user, loading: authLoading } = useAuth();
  const {
    session, setQuestions, addResult, addEmotionEntry, setReport,
    currentQuestionIndex, setCurrentQuestionIndex,
  } = useInterview();
  const router = useRouter();

  const [phase, setPhase] = useState<Phase>("loading");
  const [questions, setLocalQuestions] = useState<InterviewQuestion[]>([]);
  const [currentAnalysis, setCurrentAnalysis] = useState<AnswerAnalysis | null>(null);
  const [followUpQuestion, setFollowUpQuestion] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [webcamReady, setWebcamReady] = useState(false);
  const [savingSession, setSavingSession] = useState(false);
  const [micPermissionDenied, setMicPermissionDenied] = useState(false);

  const webcamRef = useRef<Webcam>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const {
    transcript, interimTranscript, isListening,
    startListening, stopListening, resetTranscript, setTranscript,
    error: speechError,
  } = useSpeechRecognition();

  const {
    emotion, confidence, emotionLog, isReady: emotionReady,
    isDetecting, startDetection, stopDetection,
  } = useEmotionDetection();

  const { speak, isSpeaking, stop: stopSpeech } = useTextToSpeech();

  /* ── Auth guard ── */
  useEffect(() => {
    if (!authLoading && !user) { router.push("/login"); return; }
    if (!authLoading && !session.role) { router.push("/setup"); }
  }, [authLoading, user, session.role, router]);

  /* ── Mic permission ── */
  useEffect(() => {
    if (typeof navigator !== "undefined" && navigator.permissions) {
      navigator.permissions.query({ name: "microphone" as PermissionName })
        .then((s) => {
          if (s.state === "denied") setMicPermissionDenied(true);
          s.onchange = () => setMicPermissionDenied(s.state === "denied");
        }).catch(() => {});
    }
  }, []);

  /* ── Generate questions ── */
  useEffect(() => {
    if (!session.role || questions.length > 0) return;
    const generate = async () => {
      try {
        const res = await fetch("/api/generate-questions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ role: session.role, resumeText: session.resumeText }),
        });
        const data = await res.json();
        const qs: InterviewQuestion[] = data.questions?.slice(0, TOTAL_QUESTIONS) ?? [];
        setLocalQuestions(qs);
        setQuestions(qs);
        setPhase("ready");
      } catch {
        setError("Failed to generate questions. Please try again.");
        setPhase("ready");
      }
    };
    generate();
  }, [session.role, session.resumeText, questions.length, setQuestions]);

  /* ── Emotion detection ── */
  useEffect(() => {
    if (webcamReady && emotionReady && phase !== "loading" && phase !== "done") {
      const video = webcamRef.current?.video;
      if (video && !isDetecting) {
        videoRef.current = video;
        startDetection(video);
      }
    }
  }, [webcamReady, emotionReady, phase, isDetecting, startDetection]);

  /* ── Question index logging ── */
  useEffect(() => {
    console.log(`[InterviewFlow] Question index changed: ${currentQuestionIndex} (Question ${currentQuestionIndex + 1}/${Math.min(TOTAL_QUESTIONS, questions.length || TOTAL_QUESTIONS)})`);
  }, [currentQuestionIndex, questions.length]);

  const currentQuestion = questions[currentQuestionIndex];

  /* ── Speak question ── */
  const speakQuestion = useCallback(async (text: string) => {
    setPhase("speaking");
    try { await speak(text); } catch { /* fallback — text is shown */ }
    setPhase("listening");
    resetTranscript();
    startListening();
  }, [speak, resetTranscript, startListening]);

  const startInterview = useCallback(async () => {
    if (!currentQuestion) return;
    await speakQuestion(currentQuestion.question);
  }, [currentQuestion, speakQuestion]);

  /* ── Finish interview ── */
  const finishInterview = useCallback(async (results: QuestionResult[]) => {
    stopDetection();
    setPhase("done");
    setSavingSession(true);

    try {
      const qa = results.map((r) => ({
        question: r.question.question,
        answer: r.answer,
        scores: r.analysis,
      }));

      const reportRes = await fetch("/api/generate-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: session.role, qa }),
      });
      const reportData = await reportRes.json();
      const report = reportData.report;

      setReport({
        overallScore: report.overallScore,
        reportSummary: report.summary,
        reportStrengths: report.strengths,
        reportImprovements: report.improvements,
        reportTips: report.tips,
        emotionLog,
        results,
      });

      if (user && user.uid !== "mock-user-123") {
        try {
          await addDoc(collection(db, "sessions"), {
            userId: user.uid,
            userEmail: user.email,
            userName: user.displayName,
            userPhoto: user.photoURL,
            role: session.role,
            resumeBase64: session.resumeBase64 ?? "",
            overallScore: report.overallScore,
            results: results.map((r) => ({
              question: r.question.question,
              answer: r.answer,
              relevance: r.analysis.relevance,
              depth: r.analysis.depth,
              clarity: r.analysis.clarity,
            })),
            emotionLog,
            completedAt: new Date().toISOString(),
          });
        } catch (dbErr) {
          console.warn("[Firestore] Failed to save session:", dbErr);
        }
      }

      router.push("/report");
    } catch (err) {
      console.error("Failed to finish interview:", err);
      router.push("/report");
    } finally {
      setSavingSession(false);
    }
  }, [stopDetection, session.role, session.resumeBase64, setReport, emotionLog, user, router]);

  /* ── Submit answer ── */
  const submitAnswer = useCallback(async () => {
    if (phase !== "listening" && phase !== "listening2") return;
    stopListening();
    stopSpeech();
    const answer = transcript.trim();
    setPhase("analyzing");

    try {
      const res = await fetch("/api/analyze-answer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: currentQuestion?.question, answer, role: session.role }),
      });
      const data = await res.json();
      const analysis: AnswerAnalysis = data.analysis;
      setCurrentAnalysis(analysis);

      if (
        phase === "listening" && analysis.followUp &&
        (analysis.relevance < 60 || analysis.depth < 60 || analysis.clarity < 60)
      ) {
        setFollowUpQuestion(analysis.followUp);
        setPhase("followup");
        try { await speak(analysis.followUp); } catch (err) { console.warn("[TTS] Follow-up failed:", err); }
        resetTranscript();
        startListening();
        setPhase("listening2");
      } else {
        const result: QuestionResult = {
          question: currentQuestion!,
          answer,
          analysis,
          followUp: followUpQuestion ?? undefined,
        };
        addResult(result);
        addEmotionEntry({ time: Math.round(Date.now() / 1000), emotion, confidence });

        const next = currentQuestionIndex + 1;
        if (next >= Math.min(TOTAL_QUESTIONS, questions.length)) {
          await finishInterview([...(session.results ?? []), result]);
        } else {
          setCurrentQuestionIndex(next);
          setFollowUpQuestion(null);
          setCurrentAnalysis(null);
          await speakQuestion(questions[next].question);
        }
      }
    } catch (err) {
      console.error("[SubmitAnswer] Analysis failed:", err);
      setError("Analysis failed. Saving answer and moving to next question.");

      const fallbackResult: QuestionResult = {
        question: currentQuestion!,
        answer,
        analysis: { relevance: 50, depth: 50, clarity: 50, tips: ["Analysis failed."], followUp: null },
      };
      addResult(fallbackResult);
      addEmotionEntry({ time: Math.round(Date.now() / 1000), emotion, confidence });

      const next = currentQuestionIndex + 1;
      if (next >= Math.min(TOTAL_QUESTIONS, questions.length)) {
        await finishInterview([...(session.results ?? []), fallbackResult]);
      } else {
        setCurrentQuestionIndex(next);
        setFollowUpQuestion(null);
        setCurrentAnalysis(null);
        await speakQuestion(questions[next].question);
      }
    }
  }, [phase, stopListening, stopSpeech, transcript, currentQuestion, session, addResult, addEmotionEntry, emotion, confidence, followUpQuestion, currentQuestionIndex, questions, setCurrentQuestionIndex, speakQuestion, speak, resetTranscript, startListening, finishInterview]);

  /* ── Derived ── */
  const displayQuestion =
    (followUpQuestion && (phase === "followup" || phase === "listening2"))
      ? followUpQuestion
      : currentQuestion?.question;

  const isMicDenied = micPermissionDenied || (!!speechError && (speechError.includes("Microphone access denied") || speechError.includes("not-allowed")));

  const phaseLabel: Record<Phase, string> = {
    loading: "Loading…", ready: "Ready", speaking: "AI Speaking…",
    listening: "Your Turn", analyzing: "Analyzing…", followup: "Follow-Up…",
    listening2: "Your Turn", done: "Complete",
  };

  /* ── Loading / Done screens ── */
  if (authLoading || phase === "loading") return <PageLoader label="Preparing your interview…" />;

  if (phase === "done") {
    return (
      <div className="min-h-screen flex items-center justify-center interview-bg">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="text-center p-10 rounded-3xl glass-strong"
        >
          <div className="text-6xl mb-5">🎉</div>
          <h2 className="text-3xl font-extrabold text-white mb-3">Interview Complete!</h2>
          <p className="text-slate-400">{savingSession ? "Saving your session…" : "Generating your report…"}</p>
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
            className="w-8 h-8 rounded-full border-2 border-white/10 border-t-purple-500 mx-auto mt-6"
          />
        </motion.div>
      </div>
    );
  }

  /* ── Main Interview UI ── */
  return (
    <div className="h-screen flex flex-col interview-bg overflow-hidden">

      {/* ── Top Bar ── */}
      <header className="flex-shrink-0 flex items-center justify-between px-5 py-3 bg-[#03071280] backdrop-blur-xl border-b border-white/[0.06]">
        {/* Brand */}
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl flex items-center justify-center text-base" style={{ background: "linear-gradient(135deg,#8b5cf6,#3b82f6)" }}>🎯</div>
          <span className="font-display font-bold text-base text-slate-200 tracking-tight">InterviewCoach AI</span>
        </div>

        {/* Progress bar */}
        <div className="flex-1 max-w-sm mx-8">
          <QuestionProgress
            current={currentQuestionIndex + 1}
            total={Math.min(TOTAL_QUESTIONS, questions.length || TOTAL_QUESTIONS)}
          />
        </div>

        {/* Status pill */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/[0.05] border border-white/[0.08]">
            <motion.span
              className={`w-2 h-2 rounded-full inline-block ${isListening ? "bg-emerald-400" : isSpeaking ? "bg-amber-400" : "bg-slate-500"}`}
              animate={isListening || isSpeaking ? { scale: [1, 1.4, 1] } : {}}
              transition={{ duration: 0.7, repeat: Infinity }}
            />
            <span className="text-xs font-semibold text-slate-400">{phaseLabel[phase]}</span>
          </div>
          <span className="text-xs text-slate-500 font-medium hidden sm:block">{session.role} Interview</span>
        </div>
      </header>

      {/* ── Body ── */}
      <div className="flex-1 flex min-h-0">

        {/* ════ LEFT / MAIN PANEL ════ */}
        <main className="flex-1 flex flex-col min-w-0 p-4 gap-4 overflow-y-auto">

          {/* Video Call Tiles Row */}
          <div className="grid grid-cols-2 gap-3 w-full" style={{ maxHeight: "42vh" }}>
            <AITile isSpeaking={isSpeaking} />
            <CandidateTile
              webcamRef={webcamRef}
              userName={user?.displayName ?? "You"}
              isListening={isListening}
              onReady={() => setWebcamReady(true)}
              onError={() => setWebcamReady(false)}
            />
          </div>

          {/* ── Question Chat Bubble ── */}
          {phase !== "ready" && displayQuestion && (
            <AnimatePresence mode="wait">
              <motion.div
                key={displayQuestion}
                initial={{ opacity: 0, x: -12 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 12 }}
                transition={{ duration: 0.35 }}
                className="flex items-start gap-3"
              >
                {/* AI mini avatar */}
                <div className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-sm mt-1"
                  style={{ background: "linear-gradient(135deg,#7c3aed,#2563eb)" }}>
                  🤖
                </div>
                <div className="chat-bubble flex-1 px-4 py-3 rounded-2xl rounded-tl-none border border-purple-500/20"
                  style={{ background: "rgba(139,92,246,0.08)", backdropFilter: "blur(8px)" }}>
                  <p className="text-[11px] font-bold text-purple-400 mb-1 uppercase tracking-widest">
                    {(phase === "followup" || phase === "listening2") ? "Follow-Up" : `Question ${currentQuestionIndex + 1}`}
                    {currentQuestion?.category && ` · ${currentQuestion.category}`}
                  </p>
                  <p className="text-slate-100 text-[15px] leading-relaxed font-medium">{displayQuestion}</p>
                </div>
              </motion.div>
            </AnimatePresence>
          )}

          {/* Ready state placeholder */}
          {phase === "ready" && (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center space-y-2">
                <p className="text-slate-400 text-sm">Click <strong className="text-purple-400">Start Interview</strong> when you&apos;re ready</p>
              </div>
            </div>
          )}

          {/* ── Answer Area ── */}
          {phase !== "ready" && (
            <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-4 flex flex-col gap-3">
              {/* Header */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-sm">🎙️</span>
                  <span className="text-xs font-semibold text-slate-400 uppercase tracking-widest">Your Answer</span>
                </div>
                {isListening && (
                  <motion.div
                    className="flex items-center gap-2"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                  >
                    <div className="flex items-end gap-[2px] h-4">
                      {[1, 2, 3, 4, 3, 2].map((h, i) => (
                        <motion.span
                          key={i}
                          className="inline-block w-1 rounded-full bg-emerald-400"
                          style={{ height: `${h * 25}%` }}
                          animate={{ height: [`${h * 15}%`, `${h * 35}%`, `${h * 15}%`] }}
                          transition={{ duration: 0.5, repeat: Infinity, delay: i * 0.08 }}
                        />
                      ))}
                    </div>
                    <span className="text-xs font-semibold text-emerald-400">Listening…</span>
                  </motion.div>
                )}
              </div>

              {/* Mic permission warning */}
              {isMicDenied && (
                <div className="flex gap-2 rounded-xl px-3 py-2.5 bg-red-500/10 border border-red-500/25 text-red-400 text-xs">
                  <span>⚠️</span>
                  <span>Microphone access denied. Please allow mic access in your browser settings for <strong>localhost:3000</strong>.</span>
                </div>
              )}

              {/* Textarea */}
              <textarea
                value={transcript}
                onChange={(e) => setTranscript(e.target.value)}
                placeholder={
                  isListening
                    ? "Listening… speak now or type here"
                    : phase === "analyzing"
                    ? "Analyzing your answer…"
                    : "Your answer will appear here. You can also type directly."
                }
                disabled={phase !== "listening" && phase !== "listening2"}
                rows={3}
                className="w-full resize-none rounded-xl bg-black/20 border text-sm text-slate-100 placeholder-slate-600 focus:ring-2 focus:ring-purple-500/40 focus:outline-none transition-all disabled:opacity-60 disabled:cursor-not-allowed"
                style={{
                  borderColor: isListening ? "rgba(34,197,94,0.35)" : "rgba(255,255,255,0.08)",
                  padding: "10px 14px",
                  lineHeight: 1.65,
                }}
              />

              {/* Interim transcript hint */}
              {interimTranscript && (
                <p className="text-xs text-purple-300/80 italic px-1">
                  Detecting: <span className="text-purple-300">{interimTranscript}</span>
                </p>
              )}

              {/* Speech error */}
              {speechError && speechError !== "No speech detected. Please speak clearly." && (
                <p className="text-xs text-amber-400 px-1">🎙️ {speechError} — You can type your answer above.</p>
              )}
            </div>
          )}

          {/* ── Error banner ── */}
          {error && (
            <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-red-500/10 border border-red-500/25 text-red-400 text-xs">
              ⚠️ {error}
            </div>
          )}

          {/* ── Controls ── */}
          <div className="flex gap-3 flex-wrap mt-auto">
            {phase === "ready" && (
              <motion.button
                whileHover={{ scale: 1.02, boxShadow: "0 12px 40px rgba(139,92,246,0.45)" }}
                whileTap={{ scale: 0.97 }}
                onClick={startInterview}
                className="flex-1 py-4 rounded-2xl text-white font-bold text-base cursor-pointer border-0"
                style={{ background: "linear-gradient(135deg,#8b5cf6,#3b82f6)", boxShadow: "0 8px 30px rgba(139,92,246,0.35)" }}
              >
                🚀 Start Interview
              </motion.button>
            )}

            {(phase === "listening" || phase === "listening2") && (
              <>
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.97 }}
                  onClick={submitAnswer}
                  className="flex-1 py-3.5 rounded-2xl text-white font-bold text-sm cursor-pointer border-0"
                  style={{ background: "linear-gradient(135deg,#8b5cf6,#3b82f6)", boxShadow: "0 6px 24px rgba(139,92,246,0.35)" }}
                >
                  ✓ Submit Answer
                </motion.button>
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.97 }}
                  onClick={submitAnswer}
                  className="px-5 py-3.5 rounded-2xl text-slate-400 text-sm font-semibold cursor-pointer"
                  style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)" }}
                >
                  Skip →
                </motion.button>
              </>
            )}

            {(phase === "speaking" || phase === "analyzing" || phase === "followup") && (
              <div className="flex-1 py-3.5 rounded-2xl flex items-center justify-center gap-3"
                style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}>
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                  className="w-4 h-4 rounded-full border-2 border-white/10 border-t-purple-500"
                />
                <span className="text-slate-500 text-sm">{phaseLabel[phase]}</span>
              </div>
            )}
          </div>
        </main>

        {/* ════ RIGHT SIDEBAR ════ */}
        <aside className="w-72 flex-shrink-0 flex flex-col gap-3 p-4 border-l border-white/[0.06] bg-white/[0.01] overflow-y-auto">

          {/* Emotion Meter */}
          <EmotionMeter emotion={emotion} confidence={confidence} isDetecting={isDetecting} />

          {/* Last Answer Scores */}
          {currentAnalysis && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="rounded-2xl border border-white/[0.07] p-4"
              style={{ background: "rgba(255,255,255,0.02)" }}
            >
              <p className="text-[11px] font-bold text-slate-500 uppercase tracking-widest mb-3">Last Answer</p>
              {[
                { label: "Relevance", value: currentAnalysis.relevance, color: "#a78bfa" },
                { label: "Depth", value: currentAnalysis.depth, color: "#60a5fa" },
                { label: "Clarity", value: currentAnalysis.clarity, color: "#22d3ee" },
              ].map((item) => (
                <div key={item.label} className="mb-3">
                  <div className="flex justify-between mb-1.5">
                    <span className="text-xs text-slate-500">{item.label}</span>
                    <span className="text-xs font-bold" style={{ color: item.color }}>{item.value}</span>
                  </div>
                  <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.06)" }}>
                    <motion.div
                      animate={{ width: `${item.value}%` }}
                      transition={{ duration: 0.6 }}
                      className="h-full rounded-full"
                      style={{ background: item.color }}
                    />
                  </div>
                </div>
              ))}
            </motion.div>
          )}

          {/* Session Info */}
          <div className="rounded-2xl border border-white/[0.07] p-4" style={{ background: "rgba(255,255,255,0.02)" }}>
            <p className="text-[11px] font-bold text-slate-500 uppercase tracking-widest mb-3">Session Info</p>
            <div className="flex flex-col gap-2.5">
              {[
                { label: "Role", value: session.role },
                { label: "Question", value: `${currentQuestionIndex + 1} / ${Math.min(TOTAL_QUESTIONS, questions.length || TOTAL_QUESTIONS)}` },
                { label: "Answers", value: String(session.results?.length ?? 0) },
                { label: "Emotion", value: emotion },
              ].map((item) => (
                <div key={item.label} className="flex items-center justify-between">
                  <span className="text-xs text-slate-500">{item.label}</span>
                  <span className="text-xs font-semibold text-slate-300">{String(item.value)}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Tips from last analysis */}
          {currentAnalysis?.tips && currentAnalysis.tips.length > 0 && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="rounded-2xl border border-amber-500/15 p-4"
              style={{ background: "rgba(245,158,11,0.05)" }}
            >
              <p className="text-[11px] font-bold text-amber-500/80 uppercase tracking-widest mb-2">💡 Tip</p>
              <p className="text-xs text-slate-400 leading-relaxed">{currentAnalysis.tips[0]}</p>
            </motion.div>
          )}

          {/* End Interview */}
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.97 }}
            onClick={() => finishInterview(session.results ?? [])}
            className="mt-auto w-full py-3 rounded-xl text-red-400 text-sm font-semibold cursor-pointer"
            style={{ background: "rgba(239,68,68,0.07)", border: "1px solid rgba(239,68,68,0.18)" }}
          >
            End Interview Early
          </motion.button>
        </aside>
      </div>
    </div>
  );
}

export default function InterviewPage() {
  return <InterviewContent />;
}
