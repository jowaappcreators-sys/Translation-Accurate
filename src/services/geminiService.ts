import { GoogleGenAI, Modality, GenerateContentResponse, Type } from "@google/genai";

const getApiKey = () => process.env.GEMINI_API_KEY || "";

export type Language = 'en' | 'es';

export interface TranslationResult {
  translatedText: string;
  detectedLanguage: Language;
  nuanceNotes?: string;
  alternatives?: string[];
}

export class TranslationError extends Error {
  constructor(
    public message: string,
    public type: 'quota' | 'network' | 'safety' | 'unknown' = 'unknown',
    public originalError?: any
  ) {
    super(message);
    this.name = 'TranslationError';
  }
}

export class TranslationService {
  private cache: Map<string, TranslationResult> = new Map();

  constructor() {
    this.loadCache();
  }

  private loadCache() {
    try {
      const saved = localStorage.getItem('translation_cache');
      if (saved) {
        const parsed = JSON.parse(saved);
        this.cache = new Map(Object.entries(parsed));
      }
    } catch (e) {
      console.error("Cache load failed", e);
    }
  }

  private saveCache() {
    try {
      const obj = Object.fromEntries(this.cache);
      localStorage.setItem('translation_cache', JSON.stringify(obj));
    } catch (e) {
      console.error("Cache save failed", e);
    }
  }

  async extractTextFromImage(base64Image: string, mimeType: string, retries = 2): Promise<string> {
    const apiKey = getApiKey();
    if (!apiKey) throw new Error("API Key missing");
    const ai = new GoogleGenAI({ apiKey });

    const imagePart = {
      inlineData: {
        mimeType,
        data: base64Image.split(',')[1] || base64Image,
      },
    };
    const textPart = {
      text: `Act as an expert OCR (Optical Character Recognition) engine. Extract all text from this image with high precision.
      - Preserve the original formatting and line breaks.
      - Handle various fonts, including handwriting, stylized text, and small print.
      - If the image is low quality, blurry, or has poor lighting, use visual context to infer the most likely characters.
      - Ignore background noise, logos, or non-text graphical elements.
      - Return ONLY the extracted text. Do not include any conversational filler or explanations.`,
    };

    try {
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [{ parts: [imagePart, textPart] }],
      });

      return response.text || "";
    } catch (error: any) {
      if (retries > 0 && (error.status === 'RESOURCE_EXHAUSTED' || error.code === 429)) {
        await new Promise(resolve => setTimeout(resolve, 2000));
        return this.extractTextFromImage(base64Image, mimeType, retries - 1);
      }
      throw error;
    }
  }

  async translate(
    text: string, 
    from: Language | 'auto', 
    to: Language, 
    context?: string,
    retries = 3
  ): Promise<TranslationResult> {
    const apiKey = getApiKey();
    if (!apiKey) {
      throw new TranslationError("Gemini API key is missing. Please add GEMINI_API_KEY to your secrets.", 'unknown');
    }

    const ai = new GoogleGenAI({ apiKey });
    const cacheKey = `${from}-${to}-${text.trim().toLowerCase()}-${context || ''}`;
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey)!;
    }

    const prompt = `
      Translate the following text from ${from === 'auto' ? 'detected language' : from} to ${to}.
      The text is: "${text}"
      ${context ? `Context/Tone: ${context}` : ''}
      
      Requirements:
      1. Provide the most accurate translation.
      2. If there are multiple ways to say it (e.g., formal vs informal 'you' in Spanish), explain the nuance.
      3. Provide 2-3 alternative translations if applicable.
      4. Return the result in JSON format.
    `;

    try {
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [{ parts: [{ text: prompt }] }],
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              translatedText: { type: Type.STRING },
              detectedLanguage: { type: Type.STRING },
              nuanceNotes: { type: Type.STRING },
              alternatives: {
                type: Type.ARRAY,
                items: { type: Type.STRING }
              }
            },
            required: ["translatedText", "detectedLanguage"]
          }
        }
      });
      
      const textResponse = response.text;
      if (!textResponse) {
        throw new Error("The model returned an empty response. Please try again.");
      }

      let cleanText = textResponse.trim();
      // Handle cases where the model might still wrap JSON in markdown blocks
      if (cleanText.startsWith('```')) {
        cleanText = cleanText.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
      }

      const result = JSON.parse(cleanText) as TranslationResult;
      if (!result.translatedText) {
        throw new Error("The translation was empty. Please try again.");
      }
      
      this.cache.set(cacheKey, result);
      this.saveCache();
      return result;
    } catch (error: any) {
      if (retries > 0 && (error.status === 'RESOURCE_EXHAUSTED' || error.code === 429)) {
        const delay = Math.pow(2, 4 - retries) * 1000;
        await new Promise(resolve => setTimeout(resolve, delay));
        return this.translate(text, from, to, context, retries - 1);
      }

      // Categorize errors for the UI
      if (error.status === 'RESOURCE_EXHAUSTED' || error.code === 429) {
        throw new TranslationError(
          "We've hit our translation limit for the moment. Please wait about 30 seconds and try again.",
          'quota',
          error
        );
      }

      if (!navigator.onLine || error.message?.includes('network') || error.message?.includes('fetch')) {
        throw new TranslationError(
          "Network connection lost. Please check your internet and try again.",
          'network',
          error
        );
      }

      if (error.message?.includes('safety') || error.message?.includes('blocked')) {
        throw new TranslationError(
          "This text couldn't be translated due to safety filters. Please try rephrasing.",
          'safety',
          error
        );
      }

      throw new TranslationError(
        "Something went wrong with the translation. Please try again in a moment.",
        'unknown',
        error
      );
    }
  }

  async speak(text: string, lang: Language): Promise<string> {
    const apiKey = getApiKey();
    if (!apiKey) throw new Error("API Key missing");
    const ai = new GoogleGenAI({ apiKey });
    
    const voiceName = lang === 'en' ? 'Kore' : 'Puck';
    
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-preview-tts",
      contents: [{ parts: [{ text: `Speak this clearly in ${lang === 'en' ? 'English' : 'Spanish'}: ${text}` }] }],
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName }
          }
        }
      }
    });

    const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (!base64Audio) throw new Error("Failed to generate audio");
    
    // Add WAV header to raw PCM data
    const rawData = atob(base64Audio);
    const buffer = new ArrayBuffer(44 + rawData.length);
    const view = new DataView(buffer);
    
    // RIFF identifier
    view.setUint32(0, 0x52494646, false); // "RIFF"
    // file length
    view.setUint32(4, 36 + rawData.length, true);
    // RIFF type
    view.setUint32(8, 0x57415645, false); // "WAVE"
    // format chunk identifier
    view.setUint32(12, 0x666d7420, false); // "fmt "
    // format chunk length
    view.setUint32(16, 16, true);
    // sample format (1 is PCM)
    view.setUint16(20, 1, true);
    // channel count
    view.setUint16(22, 1, true);
    // sample rate
    view.setUint32(24, 24000, true);
    // byte rate (sample rate * block align)
    view.setUint32(28, 24000 * 2, true);
    // block align (channel count * bytes per sample)
    view.setUint16(32, 2, true);
    // bits per sample
    view.setUint16(34, 16, true);
    // data chunk identifier
    view.setUint32(36, 0x64617461, false); // "data"
    // data chunk length
    view.setUint32(40, rawData.length, true);
    
    // write raw data
    for (let i = 0; i < rawData.length; i++) {
      view.setUint8(44 + i, rawData.charCodeAt(i));
    }
    
    const wavBase64 = btoa(String.fromCharCode(...new Uint8Array(buffer)));
    return `data:audio/wav;base64,${wavBase64}`;
  }

  async quickTranslate(text: string, from: Language | 'auto', to: Language): Promise<string> {
    const apiKey = getApiKey();
    if (!apiKey) return "";
    const ai = new GoogleGenAI({ apiKey });

    try {
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [{ parts: [{ text: `Translate this short snippet from ${from === 'auto' ? 'detected language' : from} to ${to}: "${text}". Return ONLY the translated text.` }] }],
      });
      return response.text?.trim() || "";
    } catch (error) {
      console.error("Quick translate error:", error);
      return "";
    }
  }
}

export const translationService = new TranslationService();
