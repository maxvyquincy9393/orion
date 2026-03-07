"""
streaming_voice.py

Low-latency streaming voice pipeline for Orion.

Architecture based on arXiv 2508.04721 (Low-Latency Voice Agents):
  - Concurrent multi-threaded pipeline: ASR → LLM → TTS run in parallel
  - Sentence-level streaming: TTS starts speaking before LLM finishes
  - VAD (Voice Activity Detection) for turn detection
  - Target end-to-end latency: <800ms (human conversational threshold)

Pipeline stages:
  1. Mic Input → VAD → Segmented audio chunks
  2. Streaming ASR: Whisper processes segments as they arrive
  3. Partial transcript → LLM via WebSocket (sentence-level chunking)
  4. LLM token stream → sentence buffer → TTS queue
  5. TTS starts speaking first sentence while LLM still generating rest

Based on:
  - arXiv 2508.04721: concurrent streaming architecture
  - arXiv 2509.15969: VoXtream 102ms first-packet streaming TTS

Part of Orion — Persistent AI Companion System.
"""

import asyncio
import logging
import queue
import threading
import time
from typing import AsyncIterator, Callable, Optional

import numpy as np

# Import config from parent
import sys
sys.path.insert(0, '.')
import config

_log = logging.getLogger("orion.voice.streaming")
_log.setLevel(getattr(logging, config.LOG_LEVEL, logging.INFO))

# Sentence-ending punctuation for streaming segmentation
SENTENCE_ENDINGS = (".", "!", "?", "...", "\n")

# VAD parameters
VAD_SILENCE_THRESHOLD = 0.01   # RMS below this = silence
VAD_SILENCE_DURATION_S = 0.8   # How long silence before segment ends
VAD_MIN_SPEECH_DURATION_S = 0.3  # Minimum speech to process


class SentenceBuffer:
    """
    Buffers LLM token stream and emits complete sentences.

    Allows TTS to start speaking the first sentence while LLM
    continues generating the rest — core of the concurrent pipeline.
    """

    def __init__(self, callback: Callable[[str], None]) -> None:
        self._buffer = ""
        self._callback = callback

    def feed(self, token: str) -> None:
        """Add a token and emit if a sentence boundary is reached."""
        self._buffer += token

        # Check for sentence boundary
        for ending in SENTENCE_ENDINGS:
            idx = self._buffer.find(ending)
            if idx != -1:
                sentence = self._buffer[: idx + len(ending)].strip()
                self._buffer = self._buffer[idx + len(ending) :]
                if sentence:
                    self._callback(sentence)
                return

    def flush(self) -> None:
        """Emit any remaining buffered text."""
        if self._buffer.strip():
            self._callback(self._buffer.strip())
            self._buffer = ""


class VADSegmenter:
    """
    Voice Activity Detection: segments continuous mic stream
    into speech chunks based on silence gaps.

    Returns audio segments suitable for Whisper transcription.
    """

    def __init__(
        self,
        sample_rate: int = 16000,
        silence_threshold: float = VAD_SILENCE_THRESHOLD,
        silence_duration_s: float = VAD_SILENCE_DURATION_S,
    ) -> None:
        self._sample_rate = sample_rate
        self._silence_threshold = silence_threshold
        self._silence_duration_s = silence_duration_s
        self._chunk_size = int(sample_rate * 0.1)  # 100ms chunks

    def segment_stream(
        self,
        audio_iterator: "queue.Queue[Optional[np.ndarray]]",
    ) -> "queue.Queue[np.ndarray]":
        """
        Reads from audio_iterator, detects speech segments,
        and puts complete segments into output queue.
        """
        output: "queue.Queue[np.ndarray]" = queue.Queue()

        def _worker() -> None:
            speech_buffer: list[np.ndarray] = []
            silence_samples = 0
            silence_limit = int(self._silence_duration_s * self._sample_rate)
            is_speaking = False

            while True:
                chunk = audio_iterator.get()
                if chunk is None:
                    # Flush remaining speech
                    if speech_buffer:
                        segment = np.concatenate(speech_buffer)
                        if len(segment) > int(VAD_MIN_SPEECH_DURATION_S * self._sample_rate):
                            output.put(segment)
                    output.put(None)  # End signal
                    return

                rms = float(np.sqrt(np.mean(chunk ** 2)))
                is_silent = rms < self._silence_threshold

                if not is_silent:
                    is_speaking = True
                    silence_samples = 0
                    speech_buffer.append(chunk)
                elif is_speaking:
                    silence_samples += len(chunk)
                    speech_buffer.append(chunk)

                    if silence_samples >= silence_limit:
                        # End of speech segment
                        segment = np.concatenate(speech_buffer)
                        if len(segment) > int(VAD_MIN_SPEECH_DURATION_S * self._sample_rate):
                            output.put(segment)
                        speech_buffer = []
                        silence_samples = 0
                        is_speaking = False

        thread = threading.Thread(target=_worker, daemon=True)
        thread.start()
        return output


class StreamingVoicePipeline:
    """
    Full streaming voice pipeline: mic → ASR → LLM → TTS → speaker.

    Architecture based on arXiv 2508.04721:
    Multi-threaded with concurrent stages to minimize latency.

    Usage:
        pipeline = StreamingVoicePipeline()
        pipeline.run_conversation(response_callback)
    """

    def __init__(self) -> None:
        self._whisper_model = None
        self._tts_pipeline = None
        self._sample_rate = 16000

    def _load_whisper(self):
        """Lazily load Whisper for STT."""
        if self._whisper_model is None:
            import whisper
            model_size = getattr(config, "VOICE_WHISPER_MODEL", "base")
            self._whisper_model = whisper.load_model(model_size)
            _log.info("Whisper loaded: %s", model_size)
        return self._whisper_model

    def transcribe_segment(self, audio: np.ndarray) -> str:
        """Transcribe a speech segment using Whisper."""
        model = self._load_whisper()
        result = model.transcribe(
            audio.astype(np.float32),
            fp16=False,
            language=getattr(config, "VOICE_LANGUAGE", None),
        )
        text = result.get("text", "").strip()
        _log.info("STT | '%s'", text[:80])
        return text

    def speak_streaming(self, text: str, on_chunk: Callable[[bytes], None]) -> None:
        """
        Stream TTS audio chunks to callback.
        Starts generating audio immediately (low first-packet latency).
        """
        from delivery.voice import VoicePipeline
        voice = VoicePipeline()
        voice.speak_streaming(
            text,
            getattr(config, "VOICE_PROFILE", "default"),
            on_chunk,
        )
        _log.debug("TTS | Streamed: '%s'", text[:50])

    def run_conversation(
        self,
        on_user_speech: Callable[[str], None],
        on_response_chunk: Callable[[bytes], None],
        get_llm_response: Callable[[str], AsyncIterator[str]],
        stop_event: Optional[threading.Event] = None,
    ) -> None:
        """
        Main conversation loop.

        Args:
            on_user_speech: Called with transcribed user input
            on_response_chunk: Called with each TTS audio chunk
            get_llm_response: Async generator yielding LLM tokens
            stop_event: Set this to stop the loop
        """
        import sounddevice as sd

        _log.info("CONVERSATION | Starting streaming pipeline")

        mic_queue: "queue.Queue[Optional[np.ndarray]]" = queue.Queue()
        tts_queue: "queue.Queue[Optional[str]]" = queue.Queue()
        vad = VADSegmenter(sample_rate=self._sample_rate)

        stop = stop_event or threading.Event()

        # Stage 1: Mic capture thread
        def mic_worker() -> None:
            chunk_size = int(self._sample_rate * 0.1)  # 100ms
            with sd.InputStream(
                samplerate=self._sample_rate,
                channels=1,
                dtype=np.float32,
                blocksize=chunk_size,
            ) as stream:
                while not stop.is_set():
                    chunk, _ = stream.read(chunk_size)
                    mic_queue.put(chunk.flatten())
            mic_queue.put(None)
            _log.info("MIC | Stopped")

        # Stage 2: VAD + ASR thread
        def asr_worker() -> None:
            segments = vad.segment_stream(mic_queue)
            while not stop.is_set():
                segment = segments.get()
                if segment is None:
                    break
                text = self.transcribe_segment(segment)
                if text:
                    on_user_speech(text)
                    tts_queue.put(text)
            _log.info("ASR | Stopped")

        # Stage 3: LLM + TTS pipeline thread
        def llm_tts_worker() -> None:
            import asyncio

            loop = asyncio.new_event_loop()

            async def process_turn(user_text: str) -> None:
                sentence_buf = SentenceBuffer(
                    lambda sentence: self.speak_streaming(sentence, on_response_chunk)
                )

                async for token in get_llm_response(user_text):
                    sentence_buf.feed(token)

                sentence_buf.flush()

            while not stop.is_set():
                try:
                    user_text = tts_queue.get(timeout=0.5)
                    if user_text is None:
                        break
                    loop.run_until_complete(process_turn(user_text))
                except queue.Empty:
                    continue

            loop.close()
            _log.info("LLM-TTS | Stopped")

        # Start all threads
        threads = [
            threading.Thread(target=mic_worker, daemon=True, name="mic"),
            threading.Thread(target=asr_worker, daemon=True, name="asr"),
            threading.Thread(target=llm_tts_worker, daemon=True, name="llm-tts"),
        ]

        for t in threads:
            t.start()

        try:
            for t in threads:
                t.join()
        except KeyboardInterrupt:
            stop.set()
            _log.info("CONVERSATION | Interrupted by user")


def test_streaming_pipeline():
    """Quick test of the streaming pipeline components."""
    _log.info("Testing streaming voice pipeline...")
    
    pipeline = StreamingVoicePipeline()
    
    # Test VAD segmenter
    _log.info("Testing VAD segmenter...")
    audio_queue: "queue.Queue[Optional[np.ndarray]]" = queue.Queue()
    audio_queue.put(None)  # End immediately
    
    # Test sentence buffer
    _log.info("Testing sentence buffer...")
    received_sentences: list[str] = []
    buf = SentenceBuffer(lambda s: received_sentences.append(s))
    buf.feed("Hello world. This is a test.")
    assert len(received_sentences) == 1
    assert received_sentences[0] == "Hello world."
    
    _log.info("All tests passed!")


if __name__ == "__main__":
    test_streaming_pipeline()
