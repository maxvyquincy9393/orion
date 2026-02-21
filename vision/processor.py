"""
processor.py

Vision engine integration for Orion.
Processes frames via Gemini Vision or GPT-4V for scene understanding.
Part of Orion — Persistent AI Companion System.
"""

import base64
import logging
from typing import Optional

import numpy as np

import config

_log = logging.getLogger("orion.vision")
_log_file = config.LOGS_DIR / "vision.log"
_handler = logging.FileHandler(_log_file)
_handler.setFormatter(logging.Formatter("%(asctime)s | %(levelname)-8s | %(message)s"))
_log.addHandler(_handler)
_log.setLevel(getattr(logging, config.LOG_LEVEL, logging.INFO))


class VisionProcessor:
    """
    Vision processor for frame analysis.

    Supports:
    - Gemini Vision (primary)
    - GPT-4V (fallback)
    - OCR via pytesseract

    Example:
        processor = VisionProcessor()
        description = processor.analyze_frame(frame, "What do you see?")
    """

    def __init__(self):
        """Initialize the vision processor."""
        self._gemini_model = None
        self._openai_client = None

    def _get_gemini_model(self):
        """Lazily initialize Gemini Vision model."""
        if self._gemini_model is None:
            try:
                import google.generativeai as genai

                token = config.GOOGLE_ACCESS_TOKEN
                if not token:
                    return None

                genai.configure(api_key=token)
                self._gemini_model = genai.GenerativeModel("gemini-pro-vision")
                _log.info("VISION | Gemini Vision initialized")
            except Exception as exc:
                _log.warning("VISION | Gemini init failed: %s", exc)
                return None

        return self._gemini_model

    def _get_openai_client(self):
        """Lazily initialize OpenAI client for GPT-4V."""
        if self._openai_client is None:
            try:
                from openai import OpenAI

                token = config.OPENAI_ACCESS_TOKEN
                if not token:
                    return None

                self._openai_client = OpenAI(api_key=token)
                _log.info("VISION | OpenAI GPT-4V initialized")
            except Exception as exc:
                _log.warning("VISION | OpenAI init failed: %s", exc)
                return None

        return self._openai_client

    def _frame_to_base64(self, frame: np.ndarray) -> str:
        """Convert frame to base64 JPEG."""
        import cv2

        _, buffer = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 85])
        return base64.b64encode(buffer).decode("utf-8")

    def analyze_frame(self, frame: np.ndarray, prompt: str = "What do you see?") -> str:
        """
        Analyze a frame using vision LLM.

        Auto-detects which engine to use based on available API keys.

        Args:
            frame: Numpy array (H, W, C).
            prompt: Question about the frame.

        Returns:
            Description string.

        Example:
            description = processor.analyze_frame(frame, "Describe the scene")
        """
        if frame is None:
            return "[Error] No frame provided"

        b64_image = self._frame_to_base64(frame)

        vision_engine = getattr(config, "VISION_ENGINE", "gemini").lower()

        if vision_engine == "gemini" or vision_engine == "auto":
            result = self._analyze_with_gemini(b64_image, prompt)
            if result and not result.startswith("[Error]"):
                return result

        if vision_engine == "openai" or vision_engine == "auto":
            result = self._analyze_with_openai(b64_image, prompt)
            if result and not result.startswith("[Error]"):
                return result

        return "[Error] No vision engine available"

    def _analyze_with_gemini(self, b64_image: str, prompt: str) -> str:
        """Analyze image with Gemini Vision."""
        model = self._get_gemini_model()
        if model is None:
            return "[Error] Gemini Vision not available"

        try:
            import google.generativeai as genai

            image_bytes = base64.b64decode(b64_image)

            response = model.generate_content(
                [
                    prompt,
                    {"mime_type": "image/jpeg", "data": image_bytes},
                ]
            )

            _log.info("VISION | Gemini analysis complete")
            return response.text

        except Exception as exc:
            _log.error("VISION | Gemini error: %s", exc)
            return f"[Error] Gemini Vision failed: {exc}"

    def _analyze_with_openai(self, b64_image: str, prompt: str) -> str:
        """Analyze image with GPT-4V."""
        client = self._get_openai_client()
        if client is None:
            return "[Error] GPT-4V not available"

        try:
            response = client.chat.completions.create(
                model="gpt-4-vision-preview",
                messages=[
                    {
                        "role": "user",
                        "content": [
                            {"type": "text", "text": prompt},
                            {
                                "type": "image_url",
                                "image_url": {
                                    "url": f"data:image/jpeg;base64,{b64_image}",
                                },
                            },
                        ],
                    }
                ],
                max_tokens=1000,
            )

            _log.info("VISION | GPT-4V analysis complete")
            return response.choices[0].message.content

        except Exception as exc:
            _log.error("VISION | GPT-4V error: %s", exc)
            return f"[Error] GPT-4V failed: {exc}"

    def analyze_screen(self, prompt: str = "What is on the screen?") -> str:
        """
        Capture and analyze current screen.

        Args:
            prompt: Question about the screen.

        Returns:
            Description string.

        Example:
            description = processor.analyze_screen("What applications are open?")
        """
        from vision.stream import CameraStream

        stream = CameraStream()
        try:
            frame = stream.capture_screenshot()
            return self.analyze_frame(frame, prompt)
        except Exception as exc:
            _log.error("VISION | Screen analysis error: %s", exc)
            return f"[Error] Screen analysis failed: {exc}"

    def watch_and_describe(self, duration_seconds: int = 10) -> list[str]:
        """
        Sample frames for duration and describe motion events.

        Args:
            duration_seconds: Watch duration. Defaults to 10.

        Returns:
            List of descriptions for frames with motion.

        Example:
            descriptions = processor.watch_and_describe(duration_seconds=30)
        """
        from vision.stream import CameraStream
        import time

        stream = CameraStream()
        descriptions = []

        try:
            stream.start(source=0)

            prev_frame = stream.get_frame()
            frame_interval = 2.0
            motion_threshold = getattr(config, "MOTION_THRESHOLD", 0.02)

            start_time = time.time()

            while time.time() - start_time < duration_seconds:
                time.sleep(frame_interval)

                curr_frame = stream.get_frame()
                if curr_frame is None:
                    continue

                if prev_frame is not None:
                    if stream.detect_motion(prev_frame, curr_frame, motion_threshold):
                        description = self.analyze_frame(
                            curr_frame,
                            "Briefly describe what changed or is happening in this frame.",
                        )
                        descriptions.append(description)
                        _log.info("VISION WATCH | Motion detected, described")

                prev_frame = curr_frame

        except Exception as exc:
            _log.error("VISION WATCH | Error: %s", exc)
        finally:
            stream.stop()

        _log.info("VISION WATCH | Completed with %d descriptions", len(descriptions))
        return descriptions

    def extract_text_from_frame(self, frame: np.ndarray) -> str:
        """
        Extract visible text from frame using OCR.

        Args:
            frame: Numpy array (H, W, C).

        Returns:
            Extracted text string.

        Example:
            text = processor.extract_text_from_frame(frame)
        """
        if frame is None:
            return "[Error] No frame provided"

        try:
            import pytesseract
            import cv2

            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)

            text = pytesseract.image_to_string(gray)

            _log.info("VISION OCR | Extracted %d chars", len(text))
            return text.strip()

        except ImportError:
            _log.warning("VISION OCR | pytesseract not installed, using vision LLM")
            return self.analyze_frame(
                frame, "Extract and return all visible text from this image."
            )
        except Exception as exc:
            _log.error("VISION OCR | Error: %s", exc)
            return f"[Error] OCR failed: {exc}"

    def compare_frames(self, frame1: np.ndarray, frame2: np.ndarray) -> str:
        """
        Compare two frames and describe changes.

        Args:
            frame1: First frame.
            frame2: Second frame.

        Returns:
            Description of changes.

        Example:
            changes = processor.compare_frames(old_frame, new_frame)
        """
        if frame1 is None or frame2 is None:
            return "[Error] Both frames required"

        b64_1 = self._frame_to_base64(frame1)
        b64_2 = self._frame_to_base64(frame2)

        prompt = """Compare these two images. Describe what has changed between them.
Focus on:
- Objects that appeared, disappeared, or moved
- Changes in position, color, or state
- Any text or UI changes
Be specific and concise."""

        try:
            client = self._get_openai_client()
            if client:
                response = client.chat.completions.create(
                    model="gpt-4-vision-preview",
                    messages=[
                        {
                            "role": "user",
                            "content": [
                                {"type": "text", "text": prompt},
                                {
                                    "type": "image_url",
                                    "image_url": {
                                        "url": f"data:image/jpeg;base64,{b64_1}"
                                    },
                                },
                                {
                                    "type": "image_url",
                                    "image_url": {
                                        "url": f"data:image/jpeg;base64,{b64_2}"
                                    },
                                },
                            ],
                        }
                    ],
                    max_tokens=500,
                )
                _log.info("VISION | Frame comparison complete")
                return response.choices[0].message.content

            return "[Error] No vision engine available for comparison"

        except Exception as exc:
            _log.error("VISION | Frame comparison error: %s", exc)
            return f"[Error] Comparison failed: {exc}"

    def detect_objects(self, frame: np.ndarray) -> list[dict]:
        """
        Detect objects in frame.

        Args:
            frame: Numpy array (H, W, C).

        Returns:
            List of detected objects with labels and positions.

        Example:
            objects = processor.detect_objects(frame)
        """
        description = self.analyze_frame(
            frame,
            "List all objects visible in this image. Format as a JSON array with objects containing 'name' and approximate 'position' (center, left, right, top, bottom).",
        )

        import json

        try:
            if description.startswith("["):
                return json.loads(description)

            json_start = description.find("[")
            json_end = description.rfind("]") + 1
            if json_start != -1 and json_end > json_start:
                return json.loads(description[json_start:json_end])

            return [{"name": description, "position": "unknown"}]

        except json.JSONDecodeError:
            return [{"name": description, "position": "unknown"}]

    def is_available(self) -> bool:
        """Check if any vision engine is available."""
        return (
            self._get_gemini_model() is not None
            or self._get_openai_client() is not None
        )

    def get_engine_name(self) -> str:
        """Get the name of the active vision engine."""
        if self._get_gemini_model():
            return "gemini"
        if self._get_openai_client():
            return "openai"
        return "none"
