"use client";

import { useState, useEffect, useRef, useCallback } from "react";

interface UseSpeechRecognitionReturn {
  transcript: string;
  interimTranscript: string;
  isListening: boolean;
  isSupported: boolean;
  error: string | null;
  startListening: () => void;
  stopListening: () => void;
  resetTranscript: () => void;
  setTranscript: React.Dispatch<React.SetStateAction<string>>;
}

const MAX_NETWORK_RETRIES = 3;
const RETRY_DELAY_MS = 1500;

export function useSpeechRecognition(): UseSpeechRecognitionReturn {
  const [transcript, setTranscript] = useState("");
  const [interimTranscript, setInterimTranscript] = useState("");
  const [isListening, setIsListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const shouldBeListeningRef = useRef(false);
  const networkRetryCountRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isSupported =
    typeof window !== "undefined" &&
    ("SpeechRecognition" in window || "webkitSpeechRecognition" in window);

  const createRecognition = useCallback((): SpeechRecognition | null => {
    if (!isSupported) {
      console.warn("[SpeechRecognition] Speech recognition not supported in this browser.");
      return null;
    }
    const SpeechRecognitionAPI =
      window.SpeechRecognition || window.webkitSpeechRecognition;
    const recognition = new SpeechRecognitionAPI();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";
    recognition.maxAlternatives = 1;
    return recognition;
  }, [isSupported]);

  const startRecognitionInstanceRef = useRef<() => void>(() => {});

  /** Internal start — shared by initial call and auto-retry */
  const startRecognitionInstance = useCallback(() => {
    const recognition = createRecognition();
    if (!recognition) return;

    recognition.onstart = () => {
      console.log("[SpeechRecognition] onstart - Speech recognition engine started active listening.");
      networkRetryCountRef.current = 0; // reset retries on successful start
      setIsListening(true);
      setError(null);
    };

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      console.log("[SpeechRecognition] onresult - Speech segment detected:", event);
      let finalTranscript = "";
      let interim = "";

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          finalTranscript += result[0].transcript;
        } else {
          interim += result[0].transcript;
        }
      }

      console.log(`[SpeechRecognition] Parsed results - final: "${finalTranscript}", interim: "${interim}"`);

      if (finalTranscript) {
        setTranscript((prev) => prev + finalTranscript + " ");
      }
      setInterimTranscript(interim);
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      console.warn("[SpeechRecognition] onerror - Error details:", event.error);

      if (event.error === "no-speech") {
        // Normal — browser fires this after silence; onend will handle restart
        console.log("[SpeechRecognition] Silence detected (no-speech error). Quietly restarting in onend.");
        return;
      }

      if (event.error === "network") {
        // Chrome requires Google servers for Web Speech API.
        // Silently retry a few times before showing a soft fallback message.
        const attempt = networkRetryCountRef.current + 1;
        networkRetryCountRef.current = attempt;

        if (attempt < MAX_NETWORK_RETRIES) {
          console.warn(`[SpeechRecognition] Network error - attempt ${attempt}/${MAX_NETWORK_RETRIES - 1}. Retrying in ${RETRY_DELAY_MS}ms…`);
          // Don't show an error yet; onend will fire and trigger restart
          return;
        }

        // All retries exhausted — show a soft, actionable message
        console.error("[SpeechRecognition] Network error persists after all retries. Falling back to text input.");
        setError("Mic unavailable (network issue) — please type your answer below.");
        shouldBeListeningRef.current = false;
        setIsListening(false);
        return;
      }

      if (event.error === "not-allowed") {
        console.error("[SpeechRecognition] Microphone access denied.");
        setError("Microphone access denied. Please allow microphone access in your browser.");
        shouldBeListeningRef.current = false;
        setIsListening(false);
        return;
      }

      if (event.error === "aborted") {
        console.log("[SpeechRecognition] Speech recognition aborted quietly.");
        return;
      }

      console.error(`[SpeechRecognition] Generic error encountered: ${event.error}`);
      setError(`Speech recognition error: ${event.error}`);
      shouldBeListeningRef.current = false;
      setIsListening(false);
    };

    recognition.onend = () => {
      console.log("[SpeechRecognition] onend - Engine ended. shouldBeListening:", shouldBeListeningRef.current, "networkRetryCount:", networkRetryCountRef.current);
      setInterimTranscript("");

      // Auto-restart if we're still supposed to be listening
      if (shouldBeListeningRef.current && networkRetryCountRef.current < MAX_NETWORK_RETRIES) {
        const isNetworkRetry = networkRetryCountRef.current > 0;
        const delay = isNetworkRetry ? RETRY_DELAY_MS : 50;

        if (isNetworkRetry) {
          setIsListening(false);
        }

        console.log(`[SpeechRecognition] Auto-restarting engine in ${delay}ms to resume listening…`);
        retryTimerRef.current = setTimeout(() => {
          if (shouldBeListeningRef.current) {
            startRecognitionInstanceRef.current();
          }
        }, delay);
      } else {
        setIsListening(false);
      }
    };

    recognitionRef.current = recognition;
    try {
      recognition.start();
      console.log("[SpeechRecognition] recognition.start() called successfully.");
    } catch (err) {
      console.error("[SpeechRecognition] Failed to start:", err);
      setError("Failed to start speech recognition.");
      setIsListening(false);
      shouldBeListeningRef.current = false;
    }
  }, [createRecognition]);

  // Keep the ref up-to-date with startRecognitionInstance
  useEffect(() => {
    startRecognitionInstanceRef.current = startRecognitionInstance;
  }, [startRecognitionInstance]);

  const startListening = useCallback(() => {
    if (!isSupported) {
      setError("Speech recognition is not supported in this browser.");
      return;
    }

    console.log("[SpeechRecognition] startListening called explicitly. Initializing engine.");
    setError(null);
    setTranscript("");
    setInterimTranscript("");
    networkRetryCountRef.current = 0;
    shouldBeListeningRef.current = true;
    setIsListening(true); // set instantly to prevent visual flicker before onstart

    // Clear any pending retry timer
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }

    // Stop any existing instance first
    if (recognitionRef.current) {
      try {
        console.log("[SpeechRecognition] Stopping active instance prior to restarting.");
        const oldRecognition = recognitionRef.current;
        oldRecognition.onstart = null;
        oldRecognition.onresult = null;
        oldRecognition.onerror = null;
        oldRecognition.onend = null;
        oldRecognition.stop();
      } catch { /* ignore */ }
      recognitionRef.current = null;
    }

    startRecognitionInstance();
  }, [isSupported, startRecognitionInstance]);

  const stopListening = useCallback(() => {
    console.log("[SpeechRecognition] stopListening called explicitly. Shutting down engine.");
    shouldBeListeningRef.current = false;

    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }

    if (recognitionRef.current) {
      try {
        const oldRecognition = recognitionRef.current;
        oldRecognition.onstart = null;
        oldRecognition.onresult = null;
        oldRecognition.onerror = null;
        oldRecognition.onend = null;
        oldRecognition.stop();
      } catch (err) {
        console.error("[SpeechRecognition] Error stopping instance:", err);
      }
      recognitionRef.current = null;
    }
    setIsListening(false);
    setInterimTranscript("");
  }, []);

  const resetTranscript = useCallback(() => {
    console.log("[SpeechRecognition] resetTranscript called.");
    setTranscript("");
    setInterimTranscript("");
  }, []);

  useEffect(() => {
    return () => {
      console.log("[SpeechRecognition] Hook unmounting. Cleaning up timers and active instances.");
      shouldBeListeningRef.current = false;
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
      if (recognitionRef.current) {
        try {
          const oldRecognition = recognitionRef.current;
          oldRecognition.onstart = null;
          oldRecognition.onresult = null;
          oldRecognition.onerror = null;
          oldRecognition.onend = null;
          oldRecognition.stop();
        } catch { /* ignore */ }
      }
    };
  }, []);

  return {
    transcript,
    interimTranscript,
    isListening,
    isSupported,
    error,
    startListening,
    stopListening,
    resetTranscript,
    setTranscript,
  };
}
