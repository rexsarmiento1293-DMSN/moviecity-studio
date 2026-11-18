export interface SegmentSlice {
  index: number;
  segmentNumber: number;
  startTimeSec: number;
  durationSec: number;
  endTimeSec: number;
  rawFileName: string;
  renderedFileName: string;
}

export interface ParsedSegmentProgress {
  completedCount: number;
  totalSegments: number;
  percent: number;
  segmentNumber: number;
  elapsedSec: number;
  sizeKb: number;
  encoderUsed: string;
  success: boolean;
  error?: string;
}

export interface QueueCliOptions {
  inputPath: string;
  baseName?: string;
  segments: number;
  workers: number;
  crf: number;
  forceCpu: boolean;
  generateTest: boolean;
  testDuration?: number;
}

export interface PrometheusMetricsSnapshot {
  queueLength: number;
  currentProgressRatio: number;
  jobsCompletedTotal: number;
  jobsFailedTotal: number;
  lastRenderSeconds: number;
}

export interface VideoUploadValidationResult {
  valid: boolean;
  sanitizedFileName: string;
  baseName: string;
  errorFilipino?: string;
}

const ALLOWED_VIDEO_EXTENSIONS = new Set([
  '.mp4',
  '.mov',
  '.webm',
  '.mkv',
  '.avi',
  '.m4v',
  '.3gp',
  '.mpeg',
  '.mpg',
  '.ogv',
]);

const ALLOWED_VIDEO_MIMES = new Set([
  'video/mp4',
  'video/webm',
  'video/quicktime',
  'video/x-matroska',
  'video/x-msvideo',
  'video/avi',
  'video/mpeg',
  'video/3gpp',
  'video/ogg',
]);

/**
 * Sanitizes a raw filename or title into a safe base name (<pangalan>) for
 * MarilagOutput/<pangalan>_final.mp4 and MarilagOutput/<pangalan>_final.jpg.
 */
export function sanitizeVideoBaseName(rawName: string): string {
  const trimmed = String(rawName || '').trim();
  const withoutPath = trimmed.split(/[/\\]/).pop() || '';
  const withoutExt = withoutPath.replace(/\.[a-zA-Z0-9]{1,6}$/, '');
  const withoutFinalSuffix = withoutExt.replace(/_final$/i, '');
  const cleaned = withoutFinalSuffix
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^[_-]+|[_-]+$/g, '');
  if (!cleaned) {
    return 'video';
  }
  return cleaned.slice(0, 64);
}

/**
 * Validates that an uploaded file is a genuine video by extension & MIME type,
 * checks its size limit, and returns a sanitized filename and base name.
 */
export function validateVideoUpload(params: {
  fileName: string;
  mimeType?: string;
  sizeBytes: number;
  maxSizeBytes?: number;
}): VideoUploadValidationResult {
  const maxBytes = params.maxSizeBytes ?? 200 * 1024 * 1024; // 200 MB default
  const rawName = String(params.fileName || '').trim();

  if (!rawName) {
    return {
      valid: false,
      sanitizedFileName: '',
      baseName: '',
      errorFilipino: 'Walang pangalan ang file na in-upload. Pumili ng valid na video file.',
    };
  }

  if (!Number.isFinite(params.sizeBytes) || params.sizeBytes <= 0) {
    return {
      valid: false,
      sanitizedFileName: '',
      baseName: '',
      errorFilipino: 'Walang laman (0 bytes) ang video file. Pumili ng ibang video.',
    };
  }

  if (params.sizeBytes > maxBytes) {
    const maxMb = Math.round(maxBytes / (1024 * 1024));
    return {
      valid: false,
      sanitizedFileName: '',
      baseName: '',
      errorFilipino: `Masyadong malaki ang file. Ang pinapayagang laki ay hanggang ${maxMb} MB lamang.`,
    };
  }

  const extMatch = rawName.toLowerCase().match(/(\.[a-z0-9]{2,5})$/);
  const ext = extMatch ? extMatch[1] : '';
  const mime = String(params.mimeType || '').toLowerCase().trim();

  const hasValidExt = ALLOWED_VIDEO_EXTENSIONS.has(ext);
  const hasValidMime = !mime || ALLOWED_VIDEO_MIMES.has(mime) || mime.startsWith('video/');

  if (!hasValidExt || !hasValidMime) {
    return {
      valid: false,
      sanitizedFileName: '',
      baseName: '',
      errorFilipino:
        'Hindi valid na video file ito. Tanging video files lang (.mp4, .mov, .webm, .mkv, .avi, .3gp) ang pinapayagan.',
    };
  }

  const baseName = sanitizeVideoBaseName(rawName);
  const sanitizedFileName = `${baseName}${ext || '.mp4'}`;

  return {
    valid: true,
    sanitizedFileName,
    baseName,
  };
}

/**
 * Caps the requested segment count so it never exceeds the integer floor of the video duration in seconds.
 * Default requestedSegments is 24.
 */
export function capSegmentsByDuration(
  requestedSegments: number,
  totalDurationSec: number
): number {
  const req = Math.max(1, Math.min(256, Math.floor(requestedSegments || 24)));
  if (!Number.isFinite(totalDurationSec) || totalDurationSec <= 0) {
    return req;
  }
  const maxBySeconds = Math.max(1, Math.floor(totalDurationSec));
  return Math.max(1, Math.min(req, maxBySeconds));
}

/**
 * Splits a total video duration (in seconds) into `segmentCount` (default 24, capped at duration in seconds)
 * contiguous, non-overlapping slices that sum exactly to `totalDurationSec`.
 */
export function calculateSegmentSlices(
  totalDurationSec: number,
  segmentCount: number = 24
): SegmentSlice[] {
  if (!Number.isFinite(totalDurationSec) || totalDurationSec <= 0) {
    throw new Error('totalDurationSec must be a positive number');
  }
  if (!Number.isInteger(segmentCount) || segmentCount < 1 || segmentCount > 256) {
    throw new Error('segmentCount must be an integer between 1 and 256');
  }

  const cappedCount = capSegmentsByDuration(segmentCount, totalDurationSec);
  const baseDuration = totalDurationSec / cappedCount;
  const slices: SegmentSlice[] = [];

  for (let idx = 0; idx < cappedCount; idx++) {
    const startTimeSec = Number((idx * baseDuration).toFixed(4));
    const durationSec =
      idx === cappedCount - 1
        ? Number((totalDurationSec - startTimeSec).toFixed(4))
        : Number(baseDuration.toFixed(4));
    const endTimeSec = Number((startTimeSec + durationSec).toFixed(4));
    const padded = String(idx).padStart(3, '0');

    slices.push({
      index: idx,
      segmentNumber: idx + 1,
      startTimeSec,
      durationSec,
      endTimeSec,
      rawFileName: `seg_${padded}_raw.mp4`,
      renderedFileName: `seg_${padded}_rendered.mp4`,
    });
  }

  return slices;
}

/**
 * Selects either h264_nvenc or libx264 fallback based on hardware probe outcome.
 */
export function selectOptimalEncoder(params: {
  nvencProbeReturnCode: number;
  forceCpu?: boolean;
}): { encoder: 'h264_nvenc' | 'libx264'; preset: 'p4' | 'veryfast'; qualityFlag: '-cq' | '-crf' } {
  if (params.forceCpu || params.nvencProbeReturnCode !== 0) {
    return {
      encoder: 'libx264',
      preset: 'veryfast',
      qualityFlag: '-crf',
    };
  }
  return {
    encoder: 'h264_nvenc',
    preset: 'p4',
    qualityFlag: '-cq',
  };
}

/**
 * Parses a structured progress log line emitted by render/queue_cli.py.
 */
export function parseProgressLogLine(line: string): ParsedSegmentProgress | null {
  const successMatch = line.match(
    /\[(\d+)\/(\d+)\s*\|\s*([\d.]+)%\]\s*Segment\s*#(\d+)\s*rendered in\s*([\d.]+)s\s*\((\d+)\s*KB,\s*([a-zA-Z0-9_]+)\)/
  );
  if (successMatch) {
    return {
      completedCount: parseInt(successMatch[1], 10),
      totalSegments: parseInt(successMatch[2], 10),
      percent: parseFloat(successMatch[3]),
      segmentNumber: parseInt(successMatch[4], 10),
      elapsedSec: parseFloat(successMatch[5]),
      sizeKb: parseInt(successMatch[6], 10),
      encoderUsed: successMatch[7],
      success: true,
    };
  }

  const failMatch = line.match(
    /\[(\d+)\/(\d+)\s*\|\s*([\d.]+)%\]\s*Segment\s*#(\d+)\s*FAILED:\s*(.+)$/
  );
  if (failMatch) {
    return {
      completedCount: parseInt(failMatch[1], 10),
      totalSegments: parseInt(failMatch[2], 10),
      percent: parseFloat(failMatch[3]),
      segmentNumber: parseInt(failMatch[4], 10),
      elapsedSec: 0,
      sizeKb: 0,
      encoderUsed: 'unknown',
      success: false,
      error: failMatch[5].trim(),
    };
  }

  return null;
}

/**
 * Formats Prometheus exposition text for /metrics.
 */
export function formatPrometheusMetrics(snapshot: PrometheusMetricsSnapshot): string {
  const queueLength = Math.max(0, Math.floor(snapshot.queueLength || 0));
  const progressRatio = Math.max(0, Math.min(1, Number((snapshot.currentProgressRatio || 0).toFixed(4))));
  const completedTotal = Math.max(0, Math.floor(snapshot.jobsCompletedTotal || 0));
  const failedTotal = Math.max(0, Math.floor(snapshot.jobsFailedTotal || 0));
  const lastSeconds = Math.max(0, Number((snapshot.lastRenderSeconds || 0).toFixed(3)));

  return [
    '# HELP marilag_queue_length Number of active or queued render jobs in Marilag Studio',
    '# TYPE marilag_queue_length gauge',
    `marilag_queue_length ${queueLength}`,
    '# HELP marilag_current_progress_ratio Progress ratio (0.0 to 1.0) of the current or most recent render job',
    '# TYPE marilag_current_progress_ratio gauge',
    `marilag_current_progress_ratio ${progressRatio}`,
    '# HELP marilag_jobs_completed_total Total number of completed video render jobs',
    '# TYPE marilag_jobs_completed_total counter',
    `marilag_jobs_completed_total ${completedTotal}`,
    '# HELP marilag_jobs_failed_total Total number of failed or canceled video render jobs',
    '# TYPE marilag_jobs_failed_total counter',
    `marilag_jobs_failed_total ${failedTotal}`,
    '# HELP marilag_last_render_seconds Duration in seconds of the most recently completed render job',
    '# TYPE marilag_last_render_seconds gauge',
    `marilag_last_render_seconds ${lastSeconds}`,
    '',
  ].join('\n');
}

/**
 * Builds the exact CLI command string to invoke render/queue_cli.py.
 */
export function buildQueueCliCommand(options: QueueCliOptions): string {
  const sanitizedInput = options.inputPath.trim() || 'test.mp4';
  const args = [
    'python3',
    'render/queue_cli.py',
    '--input',
    sanitizedInput,
  ];

  if (options.baseName && options.baseName.trim()) {
    args.push('--name', sanitizeVideoBaseName(options.baseName));
  }

  args.push(
    '--segments',
    String(Math.max(1, Math.min(256, Math.round(options.segments)))),
    '--workers',
    String(Math.max(1, Math.min(32, Math.round(options.workers)))),
    '--crf',
    String(Math.max(0, Math.min(51, Math.round(options.crf))))
  );

  if (options.forceCpu) {
    args.push('--force-cpu');
  }
  if (options.generateTest) {
    args.push('--generate-test');
    if (options.testDuration && options.testDuration > 0) {
      args.push('--test-duration', String(options.testDuration));
    }
  }

  return args.join(' ');
}
