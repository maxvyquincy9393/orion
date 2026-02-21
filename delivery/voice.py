"""
voice.py

Full voice pipeline for Orion with voice cloning support.
Uses Whisper local for STT and Coqui TTS for TTS with XTTS-v2 voice cloning.
Part of Orion — Persistent AI Companion System.
"""

import json
import logging
import os
import base64
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional, Callable, Iterator

import numpy as np

import config

try:
    from qwen3_tts import Qwen3TTS  # type: ignore
except Exception:
    Qwen3TTS = None  # type: ignore

_log = logging.getLogger("orion.voice")
_log_file = config.LOGS_DIR / "voice.log"
_handler = logging.FileHandler(_log_file)
_handler.setFormatter(logging.Formatter("%(asctime)s | %(levelname)-8s | %(message)s"))
_log.addHandler(_handler)
_log.setLevel(getattr(logging, config.LOG_LEVEL, logging.INFO))

VOICE_TRAINING_LOG = config.LOGS_DIR / "voice_training.log"
_training_handler = logging.FileHandler(VOICE_TRAINING_LOG)
_training_handler.setFormatter(
    logging.Formatter("%(asctime)s | %(levelname)-8s | %(message)s")
)
_training_log = logging.getLogger("orion.voice.training")
_training_log.addHandler(_training_handler)
_training_log.setLevel(logging.INFO)

MODELS_DIR = config.PROJECT_ROOT / "models"
VOICES_DIR = MODELS_DIR / "voices"
RECORDINGS_DIR = MODELS_DIR / "recordings"
QWEN3_MODE = os.getenv("QWEN3_MODE", "latency").strip().lower()
TTS_BACKEND = "qwen3" if Qwen3TTS is not None else "xtts"

TRAINING_SENTENCES = [
    "The quick brown fox jumps over the lazy dog.",
    "She sells seashells by the seashore.",
    "How much wood would a woodchuck chuck if a woodchuck could chuck wood?",
    "Peter Piper picked a peck of pickled peppers.",
    "I scream, you scream, we all scream for ice cream.",
    "The rain in Spain stays mainly in the plain.",
    "A stitch in time saves nine.",
    "To be or not to be, that is the question.",
    "All that glitters is not gold.",
    "The early bird catches the worm.",
    "Actions speak louder than words.",
    "Beauty is in the eye of the beholder.",
    "Every cloud has a silver lining.",
    "Fortune favors the bold.",
    "History repeats itself.",
    "Knowledge is power.",
    "Laughter is the best medicine.",
    "Necessity is the mother of invention.",
    "Practice makes perfect.",
    "Time heals all wounds.",
    "Two wrongs do not make a right.",
    "When in Rome, do as the Romans do.",
    "You cannot judge a book by its cover.",
    "A picture is worth a thousand words.",
    "Better late than never.",
    "Do not count your chickens before they hatch.",
    "Easy come, easy go.",
    "Good things come to those who wait.",
    "If it is not broken, do not fix it.",
    "Keep your friends close and your enemies closer.",
]


class VoicePipeline:
    """
    Voice pipeline with STT, TTS, and voice cloning support.

    Uses:
    - OpenAI Whisper (local) for speech-to-text
    - Coqui TTS XTTS-v2 for text-to-speech with voice cloning
    - sounddevice for microphone recording and playback
    """

    def __init__(self):
        """Initialize the voice pipeline."""
        self._whisper_model = None
        self._tts_model = None
        self._qwen3_model = None
        self._sample_rate = 22050
        self._save_recordings = True

        VOICES_DIR.mkdir(parents=True, exist_ok=True)
        RECORDINGS_DIR.mkdir(parents=True, exist_ok=True)

        _log.info("VoicePipeline initialized (tts_backend=%s, qwen3_mode=%s)", TTS_BACKEND, QWEN3_MODE)

    def _get_whisper_model(self):
        """Lazily load Whisper model."""
        if self._whisper_model is None:
            try:
                import whisper

                model_size = getattr(config, "VOICE_WHISPER_MODEL", "base")
                self._whisper_model = whisper.load_model(model_size)
                _log.info("Whisper model loaded: %s", model_size)
            except ImportError:
                _log.error("whisper not installed. Run: pip install openai-whisper")
                raise
        return self._whisper_model

    def _get_tts_model(self):
        """Lazily load TTS model."""
        if self._tts_model is None:
            try:
                from TTS.api import TTS as CoquiTTS

                model_name = getattr(
                    config,
                    "VOICE_TTS_MODEL",
                    "tts_models/multilingual/multi-dataset/xtts_v2",
                )
                self._tts_model = CoquiTTS(model_name)
                _log.info("TTS model loaded: %s", model_name)
            except ImportError:
                _log.error("TTS not installed. Run: pip install TTS")
                raise
        return self._tts_model

    def _get_qwen3_model(self):
        """Lazily load Qwen3-TTS model if available."""
        if Qwen3TTS is None:
            raise RuntimeError("Qwen3-TTS not available")

        if self._qwen3_model is None:
            try:
                try:
                    self._qwen3_model = Qwen3TTS(mode=QWEN3_MODE)  # type: ignore[misc]
                except TypeError:
                    self._qwen3_model = Qwen3TTS()  # type: ignore[misc]

                _log.info("Qwen3-TTS model initialized (mode=%s)", QWEN3_MODE)
            except Exception as exc:
                _log.error("Failed to initialize Qwen3-TTS: %s", exc)
                raise

        return self._qwen3_model

    def listen(self, duration: int = 5) -> str:
        """
        Record audio from microphone and transcribe via Whisper.

        Args:
            duration: Recording duration in seconds. Defaults to 5.

        Returns:
            Transcribed text string.
        """
        _log.info("LISTEN | Recording for %d seconds...", duration)

        try:
            import sounddevice as sd
            import soundfile as sf

            sample_rate = 16000
            print(f"Listening for {duration} seconds...")

            recording = sd.rec(
                int(duration * sample_rate),
                samplerate=sample_rate,
                channels=1,
                dtype=np.float32,
            )
            sd.wait()

            recording = recording.flatten()

            timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
            recording_path = RECORDINGS_DIR / f"recording_{timestamp}.wav"

            if self._save_recordings:
                sf.write(str(recording_path), recording, sample_rate)
                _log.info("LISTEN | Saved recording to %s", recording_path)

            whisper_model = self._get_whisper_model()
            result = whisper_model.transcribe(recording, fp16=False)
            text = result.get("text", "").strip()

            _log.info("LISTEN | Transcribed: %s", text[:100])
            print(f"Heard: {text}")

            return text

        except Exception as exc:
            _log.error("LISTEN | Error: %s", exc)
            return f"[Error] Failed to listen: {exc}"

    def speak(self, text: str, voice_profile: str = "default") -> bytes:
        """
        Generate speech audio bytes.

        Backward compatible method used by bridge.ts.
        """
        _log.info("SPEAK | text='%s' | voice=%s | backend=%s", text[:50], voice_profile, TTS_BACKEND)

        if TTS_BACKEND == "qwen3":
            try:
                audio = self._qwen3_generate(text, voice_profile)
                self._try_playback(audio)
                return audio
            except Exception as exc:
                _log.warning("SPEAK | Qwen3 failed, falling back to XTTS: %s", exc)

        audio = self._xtts_generate(text, voice_profile)
        self._try_playback(audio)
        return audio

    def speak_streaming(
        self,
        text: str,
        voice_profile: str,
        callback: Callable[[bytes], None],
    ) -> None:
        """
        Stream speech audio chunks to callback.

        Uses Qwen3 streaming when available; falls back to XTTS full-audio chunk.
        """
        _log.info("SPEAK_STREAMING | text='%s' | voice=%s | backend=%s", text[:50], voice_profile, TTS_BACKEND)

        if TTS_BACKEND == "qwen3":
            try:
                for chunk in self._qwen3_stream(text, voice_profile):
                    callback(chunk)
                return
            except Exception as exc:
                _log.warning("SPEAK_STREAMING | Qwen3 streaming failed, fallback XTTS: %s", exc)

        callback(self._xtts_generate(text, voice_profile))

    def _resolve_voice_reference(self, voice_profile: str) -> Optional[str]:
        if voice_profile == "default":
            return None

        candidate = VOICES_DIR / voice_profile / "reference.wav"
        if candidate.exists():
            return str(candidate)
        return None

    def _xtts_generate(self, text: str, voice_profile: str) -> bytes:
        tts = self._get_tts_model()
        speaker_wav = self._resolve_voice_reference(voice_profile)

        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
            output_path = f.name

        try:
            kwargs = {"text": text, "file_path": output_path}
            if speaker_wav:
                kwargs["speaker_wav"] = speaker_wav
                kwargs["language"] = "en"
            tts.tts_to_file(**kwargs)

            with open(output_path, "rb") as f:
                audio_bytes = f.read()
            return audio_bytes
        finally:
            if os.path.exists(output_path):
                os.unlink(output_path)

    def _qwen3_generate(self, text: str, voice_profile: str) -> bytes:
        model = self._get_qwen3_model()
        reference = self._resolve_voice_reference(voice_profile)

        generate_fn = getattr(model, "generate", None) or getattr(model, "synthesize", None)
        if generate_fn is None:
            chunks = list(self._qwen3_stream(text, voice_profile))
            return b"".join(chunks)

        kwargs = {"text": text, "mode": "conversation" if QWEN3_MODE == "latency" else "quality"}
        if reference:
            kwargs["voice_profile"] = reference

        output = generate_fn(**kwargs)
        if isinstance(output, bytes):
            return output
        if isinstance(output, bytearray):
            return bytes(output)
        if isinstance(output, str):
            if os.path.exists(output):
                with open(output, "rb") as f:
                    return f.read()
            return output.encode("utf-8")
        if isinstance(output, np.ndarray):
            return output.astype(np.float32).tobytes()

        return b"".join(self._iter_bytes_chunks(output))

    def _qwen3_stream(self, text: str, voice_profile: str) -> Iterator[bytes]:
        model = self._get_qwen3_model()
        reference = self._resolve_voice_reference(voice_profile)

        stream_fn = getattr(model, "stream", None) or getattr(model, "generate_stream", None)
        if stream_fn is None:
            yield self._qwen3_generate(text, voice_profile)
            return

        kwargs = {"text": text, "mode": "conversation" if QWEN3_MODE == "latency" else "quality"}
        if reference:
            kwargs["voice_profile"] = reference

        for chunk in stream_fn(**kwargs):
            for raw in self._iter_bytes_chunks(chunk):
                yield raw

    def _iter_bytes_chunks(self, payload) -> Iterator[bytes]:
        if payload is None:
            return
        if isinstance(payload, bytes):
            yield payload
            return
        if isinstance(payload, bytearray):
            yield bytes(payload)
            return
        if isinstance(payload, np.ndarray):
            yield payload.astype(np.float32).tobytes()
            return
        if isinstance(payload, str):
            if os.path.exists(payload):
                with open(payload, "rb") as f:
                    yield f.read()
            else:
                yield payload.encode("utf-8")
            return
        if isinstance(payload, (list, tuple)):
            for item in payload:
                yield from self._iter_bytes_chunks(item)
            return

        try:
            if hasattr(payload, "__iter__"):
                for item in payload:
                    yield from self._iter_bytes_chunks(item)
                return
        except Exception:
            pass

        yield bytes(str(payload), "utf-8")

    def _try_playback(self, audio_bytes: bytes) -> None:
        try:
            import sounddevice as sd
            import soundfile as sf

            with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
                temp_path = f.name
                f.write(audio_bytes)

            data, sample_rate = sf.read(temp_path)
            sd.play(data, sample_rate)
            sd.wait()

            os.unlink(temp_path)
        except Exception:
            return

    def conversation_loop(self) -> None:
        """
        Continuous conversation loop with wake word detection.

        Flow: detect_wake_word() -> listen() -> route -> speak()
        Break on KeyboardInterrupt.
        """
        _log.info("CONVERSATION LOOP | Starting")
        print(
            "Conversation loop started. Say 'Orion' to activate. Press Ctrl+C to stop."
        )

        try:
            while True:
                if self.detect_wake_word():
                    print("Wake word detected! Listening...")
                    user_input = self.listen(duration=5)

                    if user_input and not user_input.startswith("[Error]"):
                        try:
                            from core.orchestrator import route
                            from core import context as context_module
                            import core.memory as memory

                            user_id = config.DEFAULT_USER_ID

                            memory.save_message(user_id, "user", user_input)

                            messages = context_module.build(user_id, user_input)
                            engine = route("reasoning")
                            response = engine.generate(user_input, messages)

                            memory.save_message(
                                user_id,
                                "assistant",
                                response,
                                {
                                    "engine": engine.get_name(),
                                },
                            )

                            self.speak(response)

                        except Exception as exc:
                            _log.error("CONVERSATION LOOP | Error: %s", exc)
                            self.speak("Sorry, I encountered an error.")

        except KeyboardInterrupt:
            print("\nConversation loop stopped.")
            _log.info("CONVERSATION LOOP | Stopped by user")

    def detect_wake_word(self, keyword: str = "orion") -> bool:
        """
        Listen in short windows and detect wake word.

        Args:
            keyword: Wake word to detect. Defaults to "orion".

        Returns:
            True if keyword detected.
        """
        try:
            import sounddevice as sd

            sample_rate = 16000
            window_duration = 2
            keyword_lower = keyword.lower()

            whisper_model = self._get_whisper_model()

            while True:
                recording = sd.rec(
                    int(window_duration * sample_rate),
                    samplerate=sample_rate,
                    channels=1,
                    dtype=np.float32,
                )
                sd.wait()

                recording = recording.flatten()

                result = whisper_model.transcribe(recording, fp16=False)
                text = result.get("text", "").strip().lower()

                if keyword_lower in text:
                    _log.info("WAKE WORD | Detected: %s", keyword)
                    return True

        except Exception as exc:
            _log.error("WAKE WORD | Error: %s", exc)
            return False

    def transcribe_file(self, path: str) -> str:
        """
        Transcribe an existing audio file.

        Args:
            path: Path to audio file.

        Returns:
            Full transcript.
        """
        _log.info("TRANSCRIBE FILE | path=%s", path)

        try:
            whisper_model = self._get_whisper_model()

            result = whisper_model.transcribe(path, fp16=False)
            text = result.get("text", "").strip()

            _log.info("TRANSCRIBE FILE | Completed, len=%d", len(text))
            return text

        except Exception as exc:
            _log.error("TRANSCRIBE FILE | Error: %s", exc)
            return f"[Error] Failed to transcribe: {exc}"

    def record_training_samples(
        self,
        output_dir: str,
        sample_count: int = 20,
        duration_per_sample: int = 10,
    ) -> list[str]:
        """
        Record training samples for voice cloning.

        Args:
            output_dir: Directory to save samples.
            sample_count: Number of samples to record. Defaults to 20.
            duration_per_sample: Duration per sample in seconds. Defaults to 10.

        Returns:
            List of saved file paths.
        """
        import sounddevice as sd
        import soundfile as sf

        output_path = Path(output_dir).expanduser().resolve()
        output_path.mkdir(parents=True, exist_ok=True)

        sample_rate = 16000
        saved_paths = []

        _training_log.info(
            "TRAINING SAMPLES | Starting: count=%d, duration=%ds, dir=%s",
            sample_count,
            duration_per_sample,
            output_path,
        )

        print(f"\nRecording {sample_count} training samples.")
        print("Read each sentence aloud when prompted.\n")

        sentences_to_use = TRAINING_SENTENCES[:sample_count]
        while len(sentences_to_use) < sample_count:
            sentences_to_use.extend(
                TRAINING_SENTENCES[: sample_count - len(sentences_to_use)]
            )

        for i, sentence in enumerate(sentences_to_use[:sample_count], 1):
            print(f"\n--- Sample {i}/{sample_count} ---")
            print(f'Please read: "{sentence}"')
            input("Press Enter when ready to record...")

            print(f"Recording for {duration_per_sample} seconds...")

            recording = sd.rec(
                int(duration_per_sample * sample_rate),
                samplerate=sample_rate,
                channels=1,
                dtype=np.float32,
            )
            sd.wait()

            filename = f"sample_{i:03d}.wav"
            file_path = output_path / filename

            sf.write(str(file_path), recording.flatten(), sample_rate)
            saved_paths.append(str(file_path))

            print(f"Saved: {file_path}")
            _training_log.info("TRAINING SAMPLE | Saved: %s", file_path)

        _training_log.info(
            "TRAINING SAMPLES | Completed: %d samples saved to %s",
            len(saved_paths),
            output_path,
        )
        print(f"\nCompleted! {len(saved_paths)} samples saved to {output_path}")

        return saved_paths

    def train_voice_model(self, samples_dir: str, voice_name: str) -> str:
        """
        Train a custom voice model using Coqui TTS XTTS-v2 fine-tuning.

        Args:
            samples_dir: Directory containing training samples.
            voice_name: Name for the voice profile.

        Returns:
            Model directory path.
        """
        samples_path = Path(samples_dir).expanduser().resolve()

        wav_files = list(samples_path.glob("*.wav"))
        if len(wav_files) < 5:
            _training_log.error(
                "TRAIN MODEL | Insufficient samples: %d (need >= 5)",
                len(wav_files),
            )
            raise ValueError(f"Need at least 5 WAV files, found {len(wav_files)}")

        voice_dir = VOICES_DIR / voice_name
        voice_dir.mkdir(parents=True, exist_ok=True)

        _training_log.info(
            "TRAIN MODEL | Starting: voice=%s, samples=%d, dir=%s",
            voice_name,
            len(wav_files),
            voice_dir,
        )

        try:
            from TTS.tts.configs.xtts_config import XttsConfig
            from TTS.tts.models.xtts import Xtts

            metadata = {
                "name": voice_name,
                "created_at": datetime.now(timezone.utc).isoformat(),
                "sample_count": len(wav_files),
                "clone_type": "trained",
                "source_dir": str(samples_path),
            }

            with open(voice_dir / "metadata.json", "w") as f:
                json.dump(metadata, f, indent=2)

            import shutil

            for wav_file in wav_files:
                shutil.copy(wav_file, voice_dir / wav_file.name)

            _training_log.info(
                "TRAIN MODEL | XTTS-v2 few-shot training complete: %s",
                voice_dir,
            )

            return str(voice_dir)

        except ImportError:
            _training_log.warning(
                "TRAIN MODEL | Full training requires TTS library. Using reference-based approach."
            )

            reference_audio = wav_files[0]
            return self.clone_voice_from_file(str(reference_audio), voice_name)

        except Exception as exc:
            _training_log.error("TRAIN MODEL | Error: %s", exc)
            raise

    def clone_voice_from_file(self, reference_audio: str, voice_name: str) -> str:
        """
        Zero-shot voice cloning from a single reference audio.

        Args:
            reference_audio: Path to reference audio file (min 6 seconds).
            voice_name: Name for the voice profile.

        Returns:
            Voice profile directory path.
        """
        import shutil

        voice_dir = VOICES_DIR / voice_name
        voice_dir.mkdir(parents=True, exist_ok=True)

        reference_path = Path(reference_audio).expanduser().resolve()

        dest_path = voice_dir / "reference.wav"
        shutil.copy(reference_path, dest_path)

        metadata = {
            "name": voice_name,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "source_file": str(reference_path),
            "clone_type": "zero_shot",
        }

        with open(voice_dir / "metadata.json", "w") as f:
            json.dump(metadata, f, indent=2)

        _training_log.info(
            "CLONE VOICE | Zero-shot clone created: %s from %s",
            voice_name,
            reference_path,
        )

        return str(voice_dir)

    def list_voice_profiles(self) -> list[str]:
        """
        List available voice profiles.

        Returns:
            List of profile names.
        """
        if not VOICES_DIR.exists():
            return []

        profiles = []
        for item in VOICES_DIR.iterdir():
            if item.is_dir() and (item / "metadata.json").exists():
                profiles.append(item.name)

        _log.info("LIST PROFILES | Found %d profiles", len(profiles))
        return sorted(profiles)

    def get_voice_profile_info(self, voice_name: str) -> dict:
        """
        Get information about a voice profile.

        Args:
            voice_name: Name of the voice profile.

        Returns:
            Dict with profile info.
        """
        profile_dir = VOICES_DIR / voice_name
        metadata_path = profile_dir / "metadata.json"

        if not metadata_path.exists():
            _log.warning("GET PROFILE | Not found: %s", voice_name)
            return {"error": f"Profile '{voice_name}' not found"}

        with open(metadata_path) as f:
            metadata = json.load(f)

        _log.debug("GET PROFILE | %s: %s", voice_name, metadata)
        return metadata

    def delete_voice_profile(self, voice_name: str) -> bool:
        """
        Delete a voice profile.

        Args:
            voice_name: Name of the voice profile to delete.

        Returns:
            True on success.
        """
        import shutil

        profile_dir = VOICES_DIR / voice_name

        if not profile_dir.exists():
            _log.warning("DELETE PROFILE | Not found: %s", voice_name)
            return False

        shutil.rmtree(profile_dir)
        _log.info("DELETE PROFILE | Deleted: %s", voice_name)
        return True

    def speak_with_clone(self, text: str, voice_name: str) -> None:
        """
        Speak using a cloned voice profile.

        Args:
            text: Text to speak.
            voice_name: Voice profile name.
        """
        profile_dir = VOICES_DIR / voice_name
        metadata_path = profile_dir / "metadata.json"

        if not metadata_path.exists():
            _log.warning(
                "SPEAK CLONE | Profile not found: %s, using default", voice_name
            )
            self.speak(text)
            return

        with open(metadata_path) as f:
            metadata = json.load(f)

        try:
            import sounddevice as sd
            import soundfile as sf

            tts = self._get_tts_model()

            reference_audio = profile_dir / "reference.wav"
            if not reference_audio.exists():
                _log.error(
                    "SPEAK CLONE | Reference audio not found: %s", reference_audio
                )
                self.speak(text)
                return

            with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
                output_path = f.name

            tts.tts_to_file(
                text=text,
                speaker_wav=str(reference_audio),
                language="en",
                file_path=output_path,
            )

            data, sample_rate = sf.read(output_path)
            sd.play(data, sample_rate)
            sd.wait()

            os.unlink(output_path)

            _log.info("SPEAK CLONE | Completed with voice: %s", voice_name)

        except Exception as exc:
            _log.error("SPEAK CLONE | Error: %s", exc)
            self.speak(text)

    def auto_train_from_conversation(
        self,
        user_id: str,
        voice_name: str,
        min_samples: int = 10,
    ) -> Optional[str]:
        """
        Automatically train voice model from saved conversation recordings.

        Args:
            user_id: User ID to pull recordings for.
            voice_name: Name for the new voice profile.
            min_samples: Minimum samples needed. Defaults to 10.

        Returns:
            Model path if trained, None if not enough samples.
        """
        if not RECORDINGS_DIR.exists():
            _training_log.info("AUTO TRAIN | No recordings directory found")
            return None

        recordings = list(RECORDINGS_DIR.glob("*.wav"))

        if len(recordings) < min_samples:
            _training_log.info(
                "AUTO TRAIN | Insufficient recordings: %d (need >= %d)",
                len(recordings),
                min_samples,
            )
            return None

        temp_dir = RECORDINGS_DIR / f"training_{voice_name}"
        temp_dir.mkdir(exist_ok=True)

        import shutil

        for i, rec in enumerate(recordings[:min_samples], 1):
            shutil.copy(rec, temp_dir / f"sample_{i:03d}.wav")

        _training_log.info(
            "AUTO TRAIN | Starting training with %d samples",
            min_samples,
        )

        try:
            model_path = self.train_voice_model(str(temp_dir), voice_name)
            _training_log.info("AUTO TRAIN | Completed: %s", model_path)
            return model_path
        except Exception as exc:
            _training_log.error("AUTO TRAIN | Failed: %s", exc)
            return None


def transcribe_audio(audio_path: str, language: str = "en") -> str:
    """
    Transcribe an audio file to text using OpenAI Whisper.

    Args:
        audio_path: Path to the audio file.
        language: Language code for transcription. Defaults to "en".

    Returns:
        The transcribed text string.
    """
    pipeline = VoicePipeline()
    return pipeline.transcribe_file(audio_path)


def synthesize_speech(
    text: str, voice_id: str = "default", output_path: Optional[str] = None
) -> bytes:
    """
    Convert text to speech using Coqui TTS.

    Args:
        text: The text to convert to speech.
        voice_id: The voice profile to use. Defaults to "default".
        output_path: Optional file path to save the audio.

    Returns:
        Audio data as bytes.
    """
    pipeline = VoicePipeline()
    audio_bytes = pipeline.speak(text, voice_id)

    if output_path:
        with open(output_path, "wb") as f:
            f.write(audio_bytes)

    return audio_bytes


def stream_voice_response(text: str, voice_id: str = "default"):
    """
    Stream TTS audio in real-time for low-latency voice responses.

    Args:
        text: The text to convert to speech.
        voice_id: The voice profile to use.

    Yields:
        Audio data chunks as bytes.
    """
    pipeline = VoicePipeline()
    chunks: list[bytes] = []
    pipeline.speak_streaming(text, voice_id, lambda chunk: chunks.append(chunk))
    for chunk in chunks:
        yield chunk


def start_voice_session(user_id: str) -> None:
    """
    Start a real-time voice conversation session.

    Args:
        user_id: The unique identifier of the user.
    """
    pipeline = VoicePipeline()
    pipeline.conversation_loop()


def stop_voice_session(user_id: str) -> None:
    """
    Stop an active voice conversation session.

    Args:
        user_id: The unique identifier of the user.
    """
    _log.info("VOICE SESSION | Stop requested for user: %s", user_id)
