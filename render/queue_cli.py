#!/usr/bin/env python3
"""
render/queue_cli.py
Marilag Parallel Video Render Queue CLI

Mga Tampok (Features):
  (a) Hinahati ang video sa segments (default 24, hindi lalampas sa haba ng video sa segundo) gamit ang FFmpeg / FFprobe
  (b) Auto-detect ng NVIDIA NVENC (h264_nvenc) na may automatic fallback sa libx264
  (c) Nagre-render ng segments nang parallel gamit ang concurrent workers at may retry kada segment
  (d) Sine-save bilang MarilagOutput/<pangalan>_final.mp4 at gumagawa ng thumbnail na MarilagOutput/<pangalan>_final.jpg nang hindi nag-o-overwrite ng lumang final.mp4
  (e) Sumusuporta sa video na may audio at video na walang audio (-an), may malinaw na error handling sa Filipino at progress log
"""

from __future__ import annotations

import argparse
import concurrent.futures
import json
import logging
import math
import os
import re
import shutil
import signal
import subprocess
import sys
import tempfile
import time
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import List, Optional, Tuple


DEFAULT_SEGMENTS = 24
DEFAULT_OUTPUT_DIR = Path("MarilagOutput")


@dataclass
class SegmentTask:
    index: int
    total: int
    start_time: float
    duration: float
    raw_segment_path: str
    rendered_segment_path: str
    encoder: str
    preset: str
    crf_or_cq: int
    has_audio: bool
    retries: int = 2


@dataclass
class SegmentResult:
    index: int
    success: bool
    elapsed_sec: float
    output_path: str
    size_bytes: int
    encoder_used: str
    attempts: int = 1
    error: Optional[str] = None


def sanitize_base_name(raw_name: str) -> str:
    stem = Path(raw_name).stem
    stem = re.sub(r"_final$", "", stem, flags=re.IGNORECASE)
    cleaned = re.sub(r"[^a-zA-Z0-9_-]+", "_", stem).strip("_-")
    if not cleaned:
        cleaned = "video"
    return cleaned[:64]


def resolve_non_overwriting_base_name(
    output_dir: Path, requested_base: str, allow_overwrite: bool = False
) -> str:
    base = sanitize_base_name(requested_base)
    if allow_overwrite:
        return base
    candidate = base
    counter = 2
    while (output_dir / f"{candidate}_final.mp4").exists():
        candidate = f"{base}_{counter}"
        counter += 1
    return candidate


def setup_logger(log_file: Path) -> logging.Logger:
    log_file.parent.mkdir(parents=True, exist_ok=True)
    logger = logging.getLogger("MarilagQueueCLI")
    logger.setLevel(logging.INFO)
    logger.handlers.clear()

    formatter = logging.Formatter(
        fmt="%(asctime)s | %(levelname)-7s | %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )

    file_handler = logging.FileHandler(log_file, encoding="utf-8")
    file_handler.setFormatter(formatter)
    logger.addHandler(file_handler)

    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setFormatter(formatter)
    logger.addHandler(console_handler)

    return logger


def check_ffmpeg_binaries() -> Tuple[str, str]:
    ffmpeg_bin = shutil.which("ffmpeg")
    ffprobe_bin = shutil.which("ffprobe")
    if not ffmpeg_bin or not ffprobe_bin:
        raise RuntimeError(
            "Hindi nahanap ang FFmpeg o FFprobe sa system PATH. Pakisigurong naka-install ang FFmpeg."
        )
    return ffmpeg_bin, ffprobe_bin


def detect_video_encoder(
    ffmpeg_bin: str, logger: logging.Logger, force_cpu: bool = False
) -> Tuple[str, str]:
    if force_cpu:
        logger.info("Pinili ang CPU mode -> Gagamitin ang encoder: libx264 (preset: veryfast)")
        return "libx264", "veryfast"

    probe_cmd = [
        ffmpeg_bin,
        "-hide_banner",
        "-loglevel",
        "error",
        "-f",
        "lavfi",
        "-i",
        "color=c=black:s=256x256:d=0.1",
        "-c:v",
        "h264_nvenc",
        "-f",
        "null",
        "-",
    ]
    try:
        res = subprocess.run(probe_cmd, capture_output=True, text=True, timeout=8)
        if res.returncode == 0:
            logger.info(
                "Na-detect ang NVIDIA NVENC GPU -> Gagamitin ang encoder: h264_nvenc (preset: p4)"
            )
            return "h264_nvenc", "p4"
        logger.info(
            "Walang NVENC GPU (code %d) -> Automatic fallback sa libx264",
            res.returncode,
        )
    except Exception as exc:
        logger.info("NVENC probe exception (%s) -> Automatic fallback sa libx264", exc)

    return "libx264", "veryfast"


def generate_sample_test_video(
    ffmpeg_bin: str,
    target_path: Path,
    duration: float,
    logger: logging.Logger,
    with_audio: bool = True,
) -> None:
    target_path.parent.mkdir(parents=True, exist_ok=True)
    logger.info(
        "Gumagawa ng test video sa '%s' (%.1fs, 1280x720@30fps, audio=%s)...",
        target_path,
        duration,
        "oo" if with_audio else "wala",
    )
    cmd = [
        ffmpeg_bin,
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-f",
        "lavfi",
        "-i",
        f"testsrc=duration={duration}:size=1280x720:rate=30",
    ]
    if with_audio:
        cmd.extend(
            [
                "-f",
                "lavfi",
                "-i",
                f"sine=frequency=440:duration={duration}",
            ]
        )
    cmd.extend(
        [
            "-c:v",
            "libx264",
            "-preset",
            "ultrafast",
            "-pix_fmt",
            "yuv420p",
        ]
    )
    if with_audio:
        cmd.extend(["-c:a", "aac", "-b:a", "128k"])
    else:
        cmd.append("-an")
    cmd.append(str(target_path))

    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode != 0:
        raise RuntimeError(
            f"Nabigo sa paggawa ng test video: {res.stderr.strip()}"
        )
    logger.info("Test video nagawa: %s (%d bytes)", target_path, target_path.stat().st_size)


def probe_video_info(ffprobe_bin: str, input_path: Path) -> Tuple[float, bool]:
    """Returns (duration_seconds, has_audio_stream)."""
    if not input_path.exists():
        raise FileNotFoundError(f"Hindi nahanap ang input video file: {input_path}")

    cmd = [
        ffprobe_bin,
        "-v",
        "error",
        "-show_entries",
        "format=duration:stream=codec_type",
        "-of",
        "json",
        str(input_path),
    ]
    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode != 0:
        raise RuntimeError(
            f"Hindi mabasa ang video file ({input_path.name}). Siguraduhing valid na video ito: {res.stderr.strip()}"
        )

    data = json.loads(res.stdout)
    streams = data.get("streams", [])
    has_video = any(s.get("codec_type") == "video" for s in streams)
    if not has_video:
        raise ValueError(
            f"Walang video stream na nakita sa file na '{input_path.name}'."
        )
    has_audio = any(s.get("codec_type") == "audio" for s in streams)

    duration = float(data.get("format", {}).get("duration", 0.0))
    if duration <= 0:
        raise ValueError(
            f"Di-wastong haba ng video ({duration}s) para sa '{input_path.name}'."
        )
    return duration, has_audio


def cap_segments_by_duration(requested_segments: int, total_duration: float) -> int:
    max_by_duration = max(1, int(math.floor(total_duration)))
    return max(1, min(requested_segments, max_by_duration))


def split_video_into_segments(
    ffmpeg_bin: str,
    input_path: Path,
    temp_dir: Path,
    num_segments: int,
    total_duration: float,
    has_audio: bool,
    encoder: str,
    preset: str,
    crf: int,
    retries: int,
    logger: logging.Logger,
) -> List[SegmentTask]:
    raw_dir = temp_dir / "raw_segments"
    rendered_dir = temp_dir / "rendered_segments"
    raw_dir.mkdir(parents=True, exist_ok=True)
    rendered_dir.mkdir(parents=True, exist_ok=True)

    segment_duration = total_duration / float(num_segments)
    tasks: List[SegmentTask] = []

    logger.info(
        "Hinahati ang '%s' (%.2fs, audio=%s) sa %d segments (~%.3fs bawat segment)...",
        input_path.name,
        total_duration,
        "mayroon" if has_audio else "wala",
        num_segments,
        segment_duration,
    )

    for idx in range(num_segments):
        start_t = idx * segment_duration
        dur_t = (
            total_duration - start_t
            if idx == num_segments - 1
            else segment_duration
        )
        raw_seg = raw_dir / f"seg_{idx:03d}_raw.mp4"
        out_seg = rendered_dir / f"seg_{idx:03d}_rendered.mp4"

        split_cmd = [
            ffmpeg_bin,
            "-y",
            "-hide_banner",
            "-loglevel",
            "error",
            "-ss",
            f"{start_t:.4f}",
            "-i",
            str(input_path),
            "-t",
            f"{dur_t:.4f}",
            "-c:v",
            "libx264",
            "-preset",
            "ultrafast",
            "-pix_fmt",
            "yuv420p",
        ]
        if has_audio:
            split_cmd.extend(["-c:a", "aac"])
        else:
            split_cmd.append("-an")
        split_cmd.append(str(raw_seg))

        res = subprocess.run(split_cmd, capture_output=True, text=True)
        if res.returncode != 0 or not raw_seg.exists():
            raise RuntimeError(
                f"Nabigo sa paghati ng segment {idx + 1}/{num_segments}: {res.stderr.strip()}"
            )

        tasks.append(
            SegmentTask(
                index=idx,
                total=num_segments,
                start_time=round(start_t, 4),
                duration=round(dur_t, 4),
                raw_segment_path=str(raw_seg),
                rendered_segment_path=str(out_seg),
                encoder=encoder,
                preset=preset,
                crf_or_cq=crf,
                has_audio=has_audio,
                retries=retries,
            )
        )

    logger.info("Matagumpay na nahati ang %d raw segments.", num_segments)
    return tasks


def render_single_segment(task: SegmentTask) -> SegmentResult:
    t0 = time.perf_counter()
    current_encoder = task.encoder
    current_preset = task.preset
    last_error = None
    attempts_made = 0

    for attempt in range(1, task.retries + 2):
        attempts_made = attempt
        quality_flags = (
            ["-cq", str(task.crf_or_cq)]
            if current_encoder == "h264_nvenc"
            else ["-crf", str(task.crf_or_cq)]
        )
        cmd = [
            "ffmpeg",
            "-y",
            "-hide_banner",
            "-loglevel",
            "error",
            "-i",
            task.raw_segment_path,
            "-c:v",
            current_encoder,
            "-preset",
            current_preset,
            *quality_flags,
            "-pix_fmt",
            "yuv420p",
        ]
        if task.has_audio:
            cmd.extend(["-c:a", "aac", "-b:a", "192k"])
        else:
            cmd.append("-an")
        cmd.extend(["-movflags", "+faststart", task.rendered_segment_path])

        try:
            res = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
            out_path = Path(task.rendered_segment_path)
            if res.returncode == 0 and out_path.exists() and out_path.stat().st_size > 0:
                elapsed = round(time.perf_counter() - t0, 3)
                return SegmentResult(
                    index=task.index,
                    success=True,
                    elapsed_sec=elapsed,
                    output_path=task.rendered_segment_path,
                    size_bytes=out_path.stat().st_size,
                    encoder_used=current_encoder,
                    attempts=attempts_made,
                )
            last_error = (res.stderr or f"FFmpeg lumabas na may code {res.returncode}").strip()
        except Exception as exc:
            last_error = str(exc)

        if current_encoder == "h264_nvenc":
            current_encoder = "libx264"
            current_preset = "veryfast"

        time.sleep(0.2 * attempt)

    elapsed = round(time.perf_counter() - t0, 3)
    return SegmentResult(
        index=task.index,
        success=False,
        elapsed_sec=elapsed,
        output_path=task.rendered_segment_path,
        size_bytes=0,
        encoder_used=current_encoder,
        attempts=attempts_made,
        error=last_error,
    )


def merge_segments(
    ffmpeg_bin: str,
    rendered_paths: List[str],
    output_file: Path,
    temp_dir: Path,
    logger: logging.Logger,
) -> None:
    output_file.parent.mkdir(parents=True, exist_ok=True)
    concat_list_path = temp_dir / "concat_list.txt"

    lines = []
    for p in rendered_paths:
        abs_p = str(Path(p).resolve()).replace("'", "'\\''")
        lines.append(f"file '{abs_p}'")
    concat_list_path.write_text("\n".join(lines) + "\n", encoding="utf-8")

    logger.info("Pinagsasama (merging) ang %d segments sa '%s'...", len(rendered_paths), output_file)
    merge_cmd = [
        ffmpeg_bin,
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        str(concat_list_path),
        "-c",
        "copy",
        "-movflags",
        "+faststart",
        str(output_file),
    ]
    res = subprocess.run(merge_cmd, capture_output=True, text=True)
    if res.returncode != 0 or not output_file.exists() or output_file.stat().st_size == 0:
        raise RuntimeError(
            f"Nabigo sa pagsasama (merge) ng mga segment sa {output_file}: {res.stderr.strip()}"
        )


def generate_thumbnail(
    ffmpeg_bin: str,
    video_file: Path,
    thumbnail_file: Path,
    duration: float,
    logger: logging.Logger,
) -> None:
    thumbnail_file.parent.mkdir(parents=True, exist_ok=True)
    seek_time = max(0.0, min(duration * 0.5, max(0.0, duration - 0.1)))
    cmd = [
        ffmpeg_bin,
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-ss",
        f"{seek_time:.3f}",
        "-i",
        str(video_file),
        "-frames:v",
        "1",
        "-q:v",
        "2",
        str(thumbnail_file),
    ]
    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode != 0 or not thumbnail_file.exists():
        # Fallback to frame 0
        fallback_cmd = [
            ffmpeg_bin,
            "-y",
            "-hide_banner",
            "-loglevel",
            "error",
            "-i",
            str(video_file),
            "-frames:v",
            "1",
            "-q:v",
            "2",
            str(thumbnail_file),
        ]
        subprocess.run(fallback_cmd, capture_output=True, text=True)

    if thumbnail_file.exists():
        logger.info("Thumbnail nagawa: %s (%d bytes)", thumbnail_file, thumbnail_file.stat().st_size)
    else:
        logger.warning("Hindi nakagawa ng thumbnail para sa %s", video_file)


def run_pipeline(args: argparse.Namespace) -> int:
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    progress_log = output_dir / "render_progress.log"
    summary_json = output_dir / "render_summary.json"
    logger = setup_logger(progress_log)
    pipeline_start = time.perf_counter()

    def handle_sigterm(_signum: int, _frame: object) -> None:
        logger.error("Kinansela ng user ang render job (SIGTERM).")
        sys.exit(130)

    signal.signal(signal.SIGTERM, handle_sigterm)
    signal.signal(signal.SIGINT, handle_sigterm)

    logger.info("=== MARILAG PARALLEL RENDER QUEUE INITIALIZED ===")
    try:
        ffmpeg_bin, ffprobe_bin = check_ffmpeg_binaries()
        input_path = Path(args.input)

        if args.generate_test or (not input_path.exists() and input_path.name == "test.mp4"):
            generate_sample_test_video(
                ffmpeg_bin,
                input_path,
                args.test_duration,
                logger,
                with_audio=not args.no_audio,
            )

        total_duration, has_audio = probe_video_info(ffprobe_bin, input_path)

        requested_segments = max(1, args.segments)
        actual_segments = cap_segments_by_duration(requested_segments, total_duration)
        if actual_segments < requested_segments:
            logger.info(
                "Ang hiniling na %d segments ay nilimitahan sa %d segments dahil %.2fs lang ang haba ng video.",
                requested_segments,
                actual_segments,
                total_duration,
            )

        raw_base = args.name if args.name else input_path.stem
        base_name = resolve_non_overwriting_base_name(
            output_dir, raw_base, allow_overwrite=args.allow_overwrite
        )

        final_output = output_dir / f"{base_name}_final.mp4"
        thumbnail_output = output_dir / f"{base_name}_final.jpg"
        per_video_meta = output_dir / f"{base_name}_final.json"

        encoder, preset = detect_video_encoder(ffmpeg_bin, logger, force_cpu=args.force_cpu)

        with tempfile.TemporaryDirectory(prefix="marilag_queue_") as tmp_str:
            temp_dir = Path(tmp_str)
            tasks = split_video_into_segments(
                ffmpeg_bin=ffmpeg_bin,
                input_path=input_path,
                temp_dir=temp_dir,
                num_segments=actual_segments,
                total_duration=total_duration,
                has_audio=has_audio,
                encoder=encoder,
                preset=preset,
                crf=args.crf,
                retries=args.retries,
                logger=logger,
            )

            logger.info(
                "Sinisimulan ang parallel render ng %d segments gamit ang %d worker(s)...",
                len(tasks),
                args.workers,
            )
            results: List[Optional[SegmentResult]] = [None] * len(tasks)
            completed_count = 0

            with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
                future_map = {
                    pool.submit(render_single_segment, task): task for task in tasks
                }
                for future in concurrent.futures.as_completed(future_map):
                    res = future.result()
                    results[res.index] = res
                    completed_count += 1
                    pct = (completed_count / len(tasks)) * 100.0
                    if res.success:
                        logger.info(
                            "[%02d/%02d | %5.1f%%] Segment #%02d rendered in %.2fs (%d KB, %s)",
                            completed_count,
                            len(tasks),
                            pct,
                            res.index + 1,
                            res.elapsed_sec,
                            max(1, res.size_bytes // 1024),
                            res.encoder_used,
                        )
                    else:
                        logger.error(
                            "[%02d/%02d | %5.1f%%] Segment #%02d FAILED: %s",
                            completed_count,
                            len(tasks),
                            pct,
                            res.index + 1,
                            res.error,
                        )

            failed = [r for r in results if r is None or not r.success]
            if failed:
                raise RuntimeError(
                    f"Nabigo ang {len(failed)} sa {len(tasks)} segment(s) sa pag-render. Hindi itinuloy ang merge."
                )

            ordered_paths = [r.output_path for r in results if r is not None]
            merge_segments(ffmpeg_bin, ordered_paths, final_output, temp_dir, logger)

        final_duration, final_has_audio = probe_video_info(ffprobe_bin, final_output)
        generate_thumbnail(ffmpeg_bin, final_output, thumbnail_output, final_duration, logger)

        total_elapsed = round(time.perf_counter() - pipeline_start, 3)
        final_size = final_output.stat().st_size

        summary = {
            "status": "completed",
            "base_name": base_name,
            "title": base_name.replace("_", " "),
            "input": str(input_path),
            "output": str(final_output),
            "thumbnail": str(thumbnail_output),
            "windows_style_output": f"MarilagOutput\\{base_name}_final.mp4",
            "windows_style_thumbnail": f"MarilagOutput\\{base_name}_final.jpg",
            "requested_segments": requested_segments,
            "segments": actual_segments,
            "workers": args.workers,
            "detected_encoder": encoder,
            "has_audio": final_has_audio,
            "input_duration_sec": round(total_duration, 3),
            "output_duration_sec": round(final_duration, 3),
            "output_size_bytes": final_size,
            "total_elapsed_sec": total_elapsed,
            "completed_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "log_file": str(progress_log),
            "segment_results": [asdict(r) for r in results if r is not None],
        }
        summary_json.write_text(json.dumps(summary, indent=2), encoding="utf-8")
        per_video_meta.write_text(json.dumps(summary, indent=2), encoding="utf-8")

        logger.info(
            "=== RENDER COMPLETE: %s (%.2f MB, %.2fs duration) in %.2fs ===",
            final_output,
            final_size / (1024 * 1024),
            final_duration,
            total_elapsed,
        )
        return 0

    except Exception as exc:
        logger.error("PIPELINE ERROR: %s", exc)
        return 1


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Marilag Parallel FFmpeg Render Queue CLI"
    )
    parser.add_argument(
        "-i",
        "--input",
        default="test.mp4",
        help="Input video path (default: test.mp4)",
    )
    parser.add_argument(
        "--name",
        default="",
        help="Base name (<pangalan>) for MarilagOutput/<pangalan>_final.mp4 and .jpg",
    )
    parser.add_argument(
        "-n",
        "--segments",
        type=int,
        default=DEFAULT_SEGMENTS,
        help="Number of segments to split and render (default: 24, capped at video duration in seconds)",
    )
    parser.add_argument(
        "-w",
        "--workers",
        type=int,
        default=max(2, min(8, (os.cpu_count() or 4))),
        help="Number of parallel render workers",
    )
    parser.add_argument(
        "-o",
        "--output-dir",
        default=str(DEFAULT_OUTPUT_DIR),
        help="Output directory (default: MarilagOutput)",
    )
    parser.add_argument(
        "--crf",
        type=int,
        default=23,
        help="CRF / CQ quality value (default: 23)",
    )
    parser.add_argument(
        "--retries",
        type=int,
        default=2,
        help="Retries per segment on failure (default: 2)",
    )
    parser.add_argument(
        "--force-cpu",
        action="store_true",
        help="Skip NVENC detection and force libx264",
    )
    parser.add_argument(
        "--allow-overwrite",
        action="store_true",
        help="Allow overwriting existing <pangalan>_final.mp4 if specified",
    )
    parser.add_argument(
        "--generate-test",
        action="store_true",
        help="Generate a synthetic test video before running the pipeline",
    )
    parser.add_argument(
        "--test-duration",
        type=float,
        default=20.0,
        help="Duration in seconds for generated test video (default: 20.0)",
    )
    parser.add_argument(
        "--no-audio",
        action="store_true",
        help="Generate synthetic test video without an audio stream",
    )
    return parser


if __name__ == "__main__":
    cli_args = build_parser().parse_args()
    sys.exit(run_pipeline(cli_args))
