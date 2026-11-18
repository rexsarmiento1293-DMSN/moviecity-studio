// skills/cinematicSkill.js
import { GoogleGenAI } from "@google/genai";

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
`
};

// Ito yung main function na tatawagin ng app mo
export function buildCinematicPrompt(type, userInput) {
  if (!userInput) return "";

  const cleanInput = userInput.trim();
  if (!cleanInput) return "";

  if (type === 'image') {
    if (cleanInput.startsWith('Generate a 4K cinematic ultra high definition realistic image of ')) {
      return cleanInput;
    }
    return `Generate a 4K cinematic ultra high definition realistic image of ${cleanInput}. Use Unreal Engine 5 render style, photorealistic lighting, ray-traced shadows, 8k resolution textures, dramatic studio lighting, 35mm lens, f/1.8 aperture, hyper-detailed, ultra sharp focus`;
  }

  if (type === 'video') {
    if (cleanInput.startsWith('Generate a 4K cinematic ultra high definition realistic 3D video about ')) {
      return cleanInput;
    }
    return `Generate a 4K cinematic ultra high definition realistic 3D video about ${cleanInput}. Camera movement is smooth cinematic drone shot / slow panning, professional color grading, hyper-realistic textures, 60fps feel, studio-grade visual effects, dramatic lighting, Unreal Engine 5`;
  }
  
  return cleanInput;
}

// Server-side AI prompt enhancement using GoogleGenAI and CINEMATIC_SKILLS
export async function generateCinematicPromptFromAI(type, userInput, options = {}) {
  if (!userInput) return "";
  const cleanInput = String(userInput).trim();
  if (!cleanInput) return "";

  // Pipiliin kung anong system prompt ang gagamitin base sa type
  const systemPrompt = type === 'image' 
    ? CINEMATIC_SKILLS.IMAGE_SYSTEM_PROMPT 
    : CINEMATIC_SKILLS.VIDEO_SYSTEM_PROMPT;

  const apiKey = options.apiKey || (typeof process !== 'undefined' && process.env ? process.env.GEMINI_API_KEY : '');
  const aiClient = options.aiClient || new GoogleGenAI({ apiKey });

  // Tatawagin si Gemini para ENHANCIN ang prompt ng user
  const primaryModel = options.model || 'gemini-2.5-flash';
  try {
    const response = await aiClient.models.generateContent({
      model: primaryModel,
      contents: `User Subject: ${cleanInput}`,
      config: {
        systemInstruction: systemPrompt, // Dito papasok ang "Skill" ni Gemini
        temperature: 0.7, // Binibigyan si Gemini ng kaunting creativity para mag-enhance
      }
    });
    return (response.text || "").trim().replace(/^["']|["']$/g, "");
  } catch (err) {
    if (primaryModel !== 'gemini-3.8-flash') {
      const fallbackResponse = await aiClient.models.generateContent({
        model: 'gemini-3.8-flash',
        contents: `User Subject: ${cleanInput}`,
        config: {
          systemInstruction: systemPrompt,
          temperature: 0.7,
        }
      });
      return (fallbackResponse.text || "").trim().replace(/^["']|["']$/g, "");
    }
    throw err;
  }
}
