// src/skills/cinematicSkill.ts

export type CinematicSkillType = 'image' | 'video' | string;

export const CINEMATIC_SKILLS = {
  IMAGE_SYSTEM_PROMPT: `
You are a Cinematic Prompt Engine. Your ONLY job is to convert the user's subject into a final image prompt.
ALWAYS use this exact structure. Do not add extra explanation.
STRUCTURE: "Generate a 4K cinematic ultra high definition realistic image of [ENHANCED_SUBJECT]. Use Unreal Engine 5 render style, photorealistic lighting, ray-traced shadows, 8k resolution textures, dramatic studio lighting, 35mm lens, f/1.8 aperture, hyper-detailed, ultra sharp focus"
RULE: Enhance the user subject to be more cinematic and detailed, and output in English.
`,

  VIDEO_SYSTEM_PROMPT: `
You are a Cinematic Video Prompt Engine. Your ONLY job is to convert the user's story into a final video prompt.
ALWAYS use this exact structure.
STRUCTURE: "Generate a 4K cinematic ultra high definition realistic 3D video about [ENHANCED_STORY]. Camera movement is smooth cinematic drone shot / slow panning, professional color grading, hyper-realistic textures, 60fps feel, studio-grade visual effects, dramatic lighting, Unreal Engine 5"
RULE: Enhance the story to be more cinematic and output in English.
`,
} as const;

// Ito yung main function na tatawagin ng app mo
export function buildCinematicPrompt(type: CinematicSkillType, userInput: string): string {
  if (!userInput) return '';

  const cleanInput = userInput.trim();
  if (!cleanInput) return '';

  if (type === 'image') {
    if (
      cleanInput.startsWith('Generate a 4K cinematic ultra high definition realistic image of ')
    ) {
      return cleanInput;
    }
    return `Generate a 4K cinematic ultra high definition realistic image of ${cleanInput}. Use Unreal Engine 5 render style, photorealistic lighting, ray-traced shadows, 8k resolution textures, dramatic studio lighting, 35mm lens, f/1.8 aperture, hyper-detailed, ultra sharp focus`;
  }

  if (type === 'video') {
    if (
      cleanInput.startsWith('Generate a 4K cinematic ultra high definition realistic 3D video about ')
    ) {
      return cleanInput;
    }
    return `Generate a 4K cinematic ultra high definition realistic 3D video about ${cleanInput}. Camera movement is smooth cinematic drone shot / slow panning, professional color grading, hyper-realistic textures, 60fps feel, studio-grade visual effects, dramatic lighting, Unreal Engine 5`;
  }

  return cleanInput;
}

/**
 * Client-safe wrapper for `generateCinematicPromptFromAI(type, userInput)`:
 * Routes the request through the server proxy (`POST /api/cinematic/prompt`) so that
 * `process.env.GEMINI_API_KEY` remains strictly isolated on the server while returning
 * the Gemini-enhanced 4K Unreal Engine 5 cinematic prompt.
 */
export async function generateCinematicPromptFromAI(
  type: 'image' | 'video' | string,
  userInput: string,
  fetchImpl: typeof fetch = globalThis.fetch
): Promise<string> {
  if (!userInput) return '';
  const cleanInput = userInput.trim();
  if (!cleanInput) return '';

  try {
    const resp = await fetchImpl('/api/cinematic/prompt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type,
        userInput: cleanInput,
        enhanceWithAi: true,
      }),
    });
    const data = await resp.json().catch(() => ({}));
    if (resp.ok && data?.prompt) {
      return String(data.prompt).trim();
    }
  } catch {
    // Fall back to deterministic buildCinematicPrompt if offline
  }

  return buildCinematicPrompt(type, cleanInput);
}
