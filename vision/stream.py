"""
stream.py

Camera capture and frame sampling for Orion.
Provides live camera capture, screen capture, motion detection, and frame utilities.
Part of Orion — Persistent AI Companion System.
"""

import base64
import logging
import threading
import time
from pathlib import Path
from typing import Iterator, Optional

import numpy as np

import config

_log = logging.getLogger("orion.vision")
_log_file = config.LOGS_DIR / "vision.log"
_handler = logging.FileHandler(_log_file)
_handler.setFormatter(logging.Formatter("%(asctime)s | %(levelname)-8s | %(message)s"))
_log.addHandler(_handler)
_log.setLevel(getattr(logging, config.LOG_LEVEL, logging.INFO))


class CameraStream:
    """
    Camera capture and frame sampling.

    Provides:
    - Live camera capture via OpenCV
    - Screen capture via mss
    - Motion detection between frames
    - Frame encoding utilities

    Example:
        stream = CameraStream()
        stream.start(source=0)
        frame = stream.get_frame()
        stream.stop()
    """

    def __init__(self):
        """Initialize the camera stream."""
        self._cap = None
        self._running = False
        self._latest_frame: Optional[np.ndarray] = None
        self._thread: Optional[threading.Thread] = None
        self._frame_lock = threading.Lock()
        self._source = 0

    def start(self, source: int = 0) -> None:
        """
        Open camera and start background capture thread.

        Args:
            source: Camera source index. Defaults to 0.

        Example:
            stream.start(source=0)
        """
        if self._running:
            _log.warning("CAMERA | Already running")
            return

        self._source = source

        try:
            import cv2

            self._cap = cv2.VideoCapture(source)
            if not self._cap.isOpened():
                _log.error("CAMERA | Failed to open camera source %d", source)
                raise RuntimeError(f"Cannot open camera source {source}")

            self._running = True
            self._thread = threading.Thread(target=self._capture_loop, daemon=True)
            self._thread.start()

            _log.info("CAMERA | Started capture from source %d", source)

        except ImportError:
            _log.error("CAMERA | OpenCV not installed. Run: pip install opencv-python")
            raise

    def stop(self) -> None:
        """
        Release camera and stop capture thread.

        Example:
            stream.stop()
        """
        self._running = False

        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=2)

        if self._cap is not None:
            self._cap.release()
            self._cap = None

        _log.info("CAMERA | Stopped capture")

    def _capture_loop(self) -> None:
        """Background thread for continuous frame capture."""
        import cv2

        while self._running:
            if self._cap is None or not self._cap.isOpened():
                break

            ret, frame = self._cap.read()
            if ret:
                with self._frame_lock:
                    self._latest_frame = frame

            time.sleep(0.01)

    def get_frame(self) -> Optional[np.ndarray]:
        """
        Get the latest captured frame.

        Returns:
            Numpy array (H, W, C) in BGR format, or None if no frame.

        Example:
            frame = stream.get_frame()
            if frame is not None:
                process(frame)
        """
        with self._frame_lock:
            if self._latest_frame is not None:
                return self._latest_frame.copy()
            return None

    def capture_screenshot(self) -> np.ndarray:
        """
        Capture screen via mss library.

        Returns:
            Numpy array (H, W, C) in RGB format.

        Example:
            screenshot = stream.capture_screenshot()
        """
        try:
            import mss

            with mss.mss() as sct:
                monitor = sct.monitors[1] if len(sct.monitors) > 1 else sct.monitors[0]
                screenshot = sct.grab(monitor)

                frame = np.array(screenshot)
                frame = frame[:, :, :3]

                _log.debug(
                    "SCREENSHOT | Captured: %dx%d", frame.shape[1], frame.shape[0]
                )
                return frame

        except ImportError:
            _log.error("SCREENSHOT | mss not installed. Run: pip install mss")
            raise
        except Exception as exc:
            _log.error("SCREENSHOT | Error: %s", exc)
            raise

    def sample_frames(self, interval_seconds: float = 2.0) -> Iterator[np.ndarray]:
        """
        Yield frames at specified interval.

        Args:
            interval_seconds: Seconds between frames. Defaults to 2.0.

        Yields:
            Numpy arrays representing frames.

        Example:
            for frame in stream.sample_frames(interval_seconds=2.0):
                process(frame)
        """
        while self._running:
            frame = self.get_frame()
            if frame is not None:
                yield frame
            time.sleep(interval_seconds)

    def detect_motion(
        self,
        frame1: np.ndarray,
        frame2: np.ndarray,
        threshold: float = 0.02,
    ) -> bool:
        """
        Detect motion by comparing two frames.

        Args:
            frame1: First frame.
            frame2: Second frame.
            threshold: Motion threshold (0-1). Defaults to 0.02.

        Returns:
            True if significant motion detected.

        Example:
            if stream.detect_motion(prev_frame, curr_frame):
                print("Motion detected!")
        """
        try:
            import cv2

            if frame1 is None or frame2 is None:
                return False

            if frame1.shape != frame2.shape:
                return False

            gray1 = cv2.cvtColor(frame1, cv2.COLOR_BGR2GRAY)
            gray2 = cv2.cvtColor(frame2, cv2.COLOR_BGR2GRAY)

            diff = cv2.absdiff(gray1, gray2)

            _, thresh = cv2.threshold(diff, 25, 255, cv2.THRESH_BINARY)

            motion_pixels = np.sum(thresh > 0)
            total_pixels = thresh.size
            motion_ratio = motion_pixels / total_pixels

            detected = motion_ratio > threshold

            if detected:
                _log.debug(
                    "MOTION | Detected: ratio=%.4f > threshold=%.4f",
                    motion_ratio,
                    threshold,
                )

            return detected

        except Exception as exc:
            _log.error("MOTION | Detection error: %s", exc)
            return False

    def frame_to_base64(self, frame: np.ndarray) -> str:
        """
        Encode frame as base64 JPEG string.

        Args:
            frame: Numpy array (H, W, C).

        Returns:
            Base64 encoded string.

        Example:
            b64 = stream.frame_to_base64(frame)
        """
        try:
            import cv2

            _, buffer = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 85])
            b64_string = base64.b64encode(buffer).decode("utf-8")

            return b64_string

        except Exception as exc:
            _log.error("FRAME ENCODE | Error: %s", exc)
            return ""

    def save_frame(self, frame: np.ndarray, path: str) -> None:
        """
        Save frame to disk as JPEG.

        Args:
            frame: Numpy array (H, W, C).
            path: Output file path.

        Example:
            stream.save_frame(frame, "frame_001.jpg")
        """
        try:
            import cv2

            output_path = Path(path).expanduser().resolve()
            output_path.parent.mkdir(parents=True, exist_ok=True)

            cv2.imwrite(str(output_path), frame)

            _log.info("FRAME SAVE | Saved to %s", output_path)

        except Exception as exc:
            _log.error("FRAME SAVE | Error: %s", exc)

    def is_running(self) -> bool:
        """Check if camera stream is running."""
        return self._running

    def get_frame_count(self) -> int:
        """Get current frame count from camera."""
        if self._cap is None:
            return 0
        return int(self._cap.get(1))

    def get_resolution(self) -> tuple[int, int]:
        """Get camera resolution (width, height)."""
        if self._cap is None:
            return (0, 0)
        width = int(self._cap.get(3))
        height = int(self._cap.get(4))
        return (width, height)

    def set_resolution(self, width: int, height: int) -> bool:
        """
        Set camera resolution.

        Args:
            width: Frame width.
            height: Frame height.

        Returns:
            True on success.
        """
        if self._cap is None:
            return False

        self._cap.set(3, width)
        self._cap.set(4, height)

        actual_width = int(self._cap.get(3))
        actual_height = int(self._cap.get(4))

        _log.info("CAMERA | Set resolution to %dx%d", actual_width, actual_height)
        return True


def capture_single_frame(source: int = 0) -> Optional[np.ndarray]:
    """
    Capture a single frame from camera.

    Args:
        source: Camera source index.

    Returns:
        Frame as numpy array or None.

    Example:
        frame = capture_single_frame()
    """
    try:
        import cv2

        cap = cv2.VideoCapture(source)
        if not cap.isOpened():
            _log.error("CAMERA | Cannot open source %d", source)
            return None

        ret, frame = cap.read()
        cap.release()

        if ret:
            return frame
        return None

    except Exception as exc:
        _log.error("CAMERA | Single frame capture error: %s", exc)
        return None


def capture_screen_region(
    x: int, y: int, width: int, height: int
) -> Optional[np.ndarray]:
    """
    Capture a specific region of the screen.

    Args:
        x: X offset.
        y: Y offset.
        width: Region width.
        height: Region height.

    Returns:
        Frame as numpy array or None.

    Example:
        region = capture_screen_region(0, 0, 800, 600)
    """
    try:
        import mss

        with mss.mss() as sct:
            monitor = {"top": y, "left": x, "width": width, "height": height}
            screenshot = sct.grab(monitor)

            frame = np.array(screenshot)
            frame = frame[:, :, :3]

            return frame

    except Exception as exc:
        _log.error("SCREEN REGION | Error: %s", exc)
        return None


def list_cameras() -> list[int]:
    """
    List available camera sources.

    Returns:
        List of available camera indices.

    Example:
        cameras = list_cameras()
    """
    import cv2

    available = []
    for i in range(10):
        cap = cv2.VideoCapture(i)
        if cap.isOpened():
            available.append(i)
            cap.release()

    _log.info("CAMERA | Available sources: %s", available)
    return available
