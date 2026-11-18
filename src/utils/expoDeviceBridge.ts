// ============================================================================
// Expo SDK 58.0.0 Device & System Functionality Bridge
// Packages: expo-camera (CameraView), expo-contacts (Contact), expo-sensors (Gyroscope)
// ============================================================================

export interface ExpoSdkVersionSpec {
  expoSdkVersion: '58.0.0' | '57.0.0' | '56.0.0';
  reactNativeVersion: string;
  reactVersion: string;
  reactNativeWebVersion: string;
  reactNativeTvVersion: string;
  minNodeVersion: string;
  androidMinVersion: string;
  minSdkVersion: number;
  compileSdkVersion: number;
  targetSdkVersion: number;
  iosMinVersion: string;
  xcodeMinVersion: string;
}

export const EXPO_SDK_COMPATIBILITY_MATRIX: ExpoSdkVersionSpec[] = [
  {
    expoSdkVersion: '58.0.0',
    reactNativeVersion: '0.88',
    reactVersion: '19.3.0',
    reactNativeWebVersion: '0.21.0',
    reactNativeTvVersion: '0.87-stable',
    minNodeVersion: '22.13.x',
    androidMinVersion: '7+',
    minSdkVersion: 24,
    compileSdkVersion: 37,
    targetSdkVersion: 36,
    iosMinVersion: '16.4+',
    xcodeMinVersion: '26.4+',
  },
  {
    expoSdkVersion: '57.0.0',
    reactNativeVersion: '0.86',
    reactVersion: '19.2.3',
    reactNativeWebVersion: '0.21.0',
    reactNativeTvVersion: '0.86-stable',
    minNodeVersion: '22.13.x',
    androidMinVersion: '7+',
    minSdkVersion: 24,
    compileSdkVersion: 36,
    targetSdkVersion: 36,
    iosMinVersion: '16.4+',
    xcodeMinVersion: '26.4+',
  },
  {
    expoSdkVersion: '56.0.0',
    reactNativeVersion: '0.85',
    reactVersion: '19.2.3',
    reactNativeWebVersion: '0.21.0',
    reactNativeTvVersion: '0.85-stable',
    minNodeVersion: '20.19.x',
    androidMinVersion: '7+',
    minSdkVersion: 24,
    compileSdkVersion: 36,
    targetSdkVersion: 36,
    iosMinVersion: '16.4+',
    xcodeMinVersion: '26.4+',
  },
];

export const EXPO_INSTALL_COMMAND =
  'npx expo install expo-camera expo-contacts expo-sensors';

export const EXPO_CANARY_COMMAND =
  'npm install expo@canary && npx expo install --fix';

export const EXPO_BARE_INIT_COMMAND =
  'npx create-expo-app my-app --template bare-minimum';

export interface ExpoCastContact {
  id: string;
  name: string;
  role: string;
  phoneNumber: string;
  email: string;
  characterAppearance: string;
  characterStyle: string;
}

export interface GyroscopeReading {
  x: number;
  y: number;
  z: number;
  timestamp: number;
}

const DEFAULT_CAST_CONTACTS: ExpoCastContact[] = [
  {
    id: 'expo-contact-1',
    name: 'Clara Montes (Lead Actress)',
    role: 'Bida / Lead Heroine',
    phoneNumber: '+63 917 555 0142',
    email: 'clara.montes@moviecity.ph',
    characterAppearance:
      '26yo Filipina lead actress, long wavy dark hair, expressive eyes, emerald silk gown',
    characterStyle:
      'Cinematic teleserye close-up, warm rim light, shallow depth of field, 35mm film grain',
  },
  {
    id: 'expo-contact-2',
    name: 'Kidlat Santos (Action Lead)',
    role: 'Action / Stunt Lead',
    phoneNumber: '+63 918 555 0199',
    email: 'kidlat.santos@moviecity.ph',
    characterAppearance:
      '28yo Filipino action star, athletic build, leather jacket, intense gaze under neon rain',
    characterStyle:
      'High-contrast action cinema, dramatic anamorphic lens flare, handheld kinetic framing',
  },
  {
    id: 'expo-contact-3',
    name: 'Marco Valdez (Antagonist)',
    role: 'Kontrabida / Corporate Rival',
    phoneNumber: '+63 919 555 0277',
    email: 'marco.valdez@moviecity.ph',
    characterAppearance:
      '34yo corporate mogul, tailored charcoal suit, silver-rimmed glasses, Makati penthouse backdrop',
    characterStyle:
      'Neo-noir thriller lighting, cold steel-blue shadows, razor-sharp 85mm portrait lens',
  },
];

/**
 * Simulates `Contact.getAll()` from `expo-contacts` with production cast & crew directory.
 */
export const Contact = {
  async getAll(): Promise<ExpoCastContact[]> {
    return DEFAULT_CAST_CONTACTS.map((c) => ({ ...c }));
  },
};

/**
 * Maps 3-axis Gyroscope sensor data `(x, y, z)` from `expo-sensors`
 * into a deterministic cinematic camera motion preset for the Teleserye Pipeline.
 */
export function mapGyroscopeToCameraMotion(reading: Pick<GyroscopeReading, 'x' | 'y' | 'z'>): {
  motionPreset: string;
  intensityLabel: 'Steady Tripod' | 'Subtle Handheld' | 'Dynamic Whip Pan' | '360 Orbit Climax';
  magnitude: number;
} {
  const magnitude = Number(
    Math.sqrt(reading.x ** 2 + reading.y ** 2 + reading.z ** 2).toFixed(2)
  );

  if (magnitude >= 2.2) {
    return {
      motionPreset: '360 Orbit Emotional Climax',
      intensityLabel: '360 Orbit Climax',
      magnitude,
    };
  }
  if (magnitude >= 1.2) {
    return {
      motionPreset: 'Dramatic Handheld Close-Up',
      intensityLabel: 'Dynamic Whip Pan',
      magnitude,
    };
  }
  if (magnitude >= 0.4) {
    return {
      motionPreset: 'Slow Dolly Zoom + Rain FX',
      intensityLabel: 'Subtle Handheld',
      magnitude,
    };
  }
  return {
    motionPreset: 'Wide Crane Establishing Shot',
    intensityLabel: 'Steady Tripod',
    magnitude,
  };
}

/**
 * Generates a deterministic SVG data URL frame from `CameraView` (`expo-camera`)
 * when a physical webcam is unavailable or in headless/studio mode.
 */
export function captureCameraViewReferenceFrame(options: {
  facing: 'front' | 'back';
  sceneTitle: string;
  gyro: Pick<GyroscopeReading, 'x' | 'y' | 'z'>;
}): string {
  const { facing, sceneTitle, gyro } = options;
  const motion = mapGyroscopeToCameraMotion(gyro);
  const safeTitle = (sceneTitle || 'LIVE CAMERA VIEW').replace(/[<>&"']/g, '');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360">
    <defs>
      <linearGradient id="camBg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#0c0c0e"/>
        <stop offset="50%" stop-color="#1f1218"/>
        <stop offset="100%" stop-color="#0c0c0e"/>
      </linearGradient>
    </defs>
    <rect width="640" height="360" fill="url(#camBg)"/>
    <rect x="20" y="20" width="600" height="320" fill="none" stroke="#ff3e3e" stroke-width="1.5" stroke-dasharray="10 6"/>
    <line x1="320" y1="150" x2="320" y2="210" stroke="#00ff41" stroke-width="1.5"/>
    <line x1="290" y1="180" x2="350" y2="180" stroke="#00ff41" stroke-width="1.5"/>
    <rect x="34" y="34" width="180" height="24" fill="#ff3e3e"/>
    <text x="42" y="50" fill="#0c0c0e" font-family="monospace" font-weight="bold" font-size="12">EXPO-CAMERA · ${facing.toUpperCase()}</text>
    <text x="34" y="295" fill="#e4e4e7" font-family="sans-serif" font-weight="bold" font-size="18">${safeTitle}</text>
    <text x="34" y="320" fill="#00ff41" font-family="monospace" font-size="12">GYRO (${gyro.x.toFixed(2)}, ${gyro.y.toFixed(2)}, ${gyro.z.toFixed(2)}) → ${motion.motionPreset}</text>
  </svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

/**
 * Validates that an Android/Expo configuration meets Expo SDK 58.0.0 requirements.
 */
export function validateExpoSdkConfig(config: {
  sdkVersion: string;
  compileSdkVersion: number;
  targetSdkVersion: number;
  minSdkVersion: number;
}): { valid: boolean; issues: string[] } {
  const issues: string[] = [];
  if (config.sdkVersion !== '58.0.0') {
    issues.push(`Expected sdkVersion 58.0.0, got ${config.sdkVersion}`);
  }
  if (config.compileSdkVersion < 37) {
    issues.push(`Expo SDK 58.0.0 requires compileSdkVersion >= 37 (got ${config.compileSdkVersion})`);
  }
  if (config.targetSdkVersion < 36) {
    issues.push(`Expo SDK 58.0.0 requires targetSdkVersion >= 36 (got ${config.targetSdkVersion})`);
  }
  if (config.minSdkVersion < 24) {
    issues.push(`Expo SDK 58.0.0 requires Android 7+ / minSdkVersion >= 24 (got ${config.minSdkVersion})`);
  }
  return {
    valid: issues.length === 0,
    issues,
  };
}
