/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { 
  Languages, 
  ArrowRightLeft, 
  Volume2, 
  Copy, 
  Mic,
  MicOff,
  Check, 
  Info, 
  Loader2,
  Settings2,
  Sparkles,
  Camera,
  Scan,
  X,
  AlertCircle
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { translationService, type Language, type TranslationResult } from './services/geminiService';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("ErrorBoundary caught an error", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
          <div className="max-w-md w-full bg-white rounded-3xl shadow-xl p-8 text-center border border-red-100">
            <div className="w-16 h-16 bg-red-50 rounded-2xl flex items-center justify-center mx-auto mb-6">
              <AlertCircle className="w-8 h-8 text-red-500" />
            </div>
            <h2 className="text-2xl font-bold text-gray-900 mb-2">Something went wrong</h2>
            <p className="text-gray-500 mb-8 leading-relaxed">
              The application encountered an unexpected error. Please try refreshing the page.
            </p>
            <button 
              onClick={() => window.location.reload()}
              className="w-full bg-emerald-500 hover:bg-emerald-600 text-white font-semibold py-3 rounded-xl transition-all shadow-lg shadow-emerald-200"
            >
              Refresh Page
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default function App() {
  const [inputText, setInputText] = useState('');
  const [fromLang, setFromLang] = useState<Language | 'auto'>('auto');
  const [toLang, setToLang] = useState<Language>('es');
  const [result, setResult] = useState<TranslationResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [copied, setCopied] = useState(false);
  const [context, setContext] = useState('');
  const [showContext, setShowContext] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [autoRead, setAutoRead] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const recognitionRef = useRef<any>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [isInputFocused, setIsInputFocused] = useState(false);
  const [hoveredWord, setHoveredWord] = useState<{ text: string, translation: string, x: number, y: number } | null>(null);

  const debounceTimer = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const handleImageScan = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsScanning(true);
    setError(null);
    try {
      const reader = new FileReader();
      reader.onloadend = async () => {
        try {
          const base64 = reader.result as string;
          const extractedText = await translationService.extractTextFromImage(base64, file.type);
          if (extractedText) {
            setInputText(extractedText);
          }
        } catch (err: any) {
          console.error("Scanning error:", err);
          if (err.status === 'RESOURCE_EXHAUSTED' || err.code === 429) {
            setError("Rate limit exceeded for scanning. Please wait a moment.");
          } else {
            setError("Failed to extract text from image.");
          }
        } finally {
          setIsScanning(false);
        }
      };
      reader.readAsDataURL(file);
    } catch (err) {
      console.error("Reader error:", err);
      setIsScanning(false);
    }
  };

  const toggleRecording = () => {
    try {
      if (isRecording) {
        recognitionRef.current?.stop();
        setIsRecording(false);
        return;
      }

      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (!SpeechRecognition) {
        setError("Speech recognition is not supported in this browser.");
        return;
      }

      const recognition = new SpeechRecognition();
      recognition.lang = fromLang === 'auto' ? 'en-US' : (fromLang === 'en' ? 'en-US' : 'es-ES');
      recognition.continuous = false;
      recognition.interimResults = false;

      recognition.onstart = () => {
        setIsRecording(true);
        setError(null);
      };

      recognition.onresult = (event: any) => {
        const transcript = event.results[0][0].transcript;
        setInputText(prev => prev + (prev ? ' ' : '') + transcript);
      };

      recognition.onerror = (event: any) => {
        console.error("Speech recognition error:", event.error);
        setIsRecording(false);
        if (event.error === 'not-allowed') {
          setError("Microphone access denied. Please check your browser permissions.");
        } else if (event.error === 'not-supported' || event.error === 'service-not-allowed') {
          setError("Speech recognition is not supported in this context or browser.");
        } else {
          setError("Error capturing speech. Please try again.");
        }
      };

      recognition.onend = () => {
        setIsRecording(false);
      };

      recognitionRef.current = recognition;
      recognition.start();
    } catch (err: any) {
      console.error("Speech recognition start error:", err);
      setError(err.message || "Failed to start speech recognition.");
      setIsRecording(false);
    }
  };

  const handleHoverWord = async (word: string, from: Language | 'auto', to: Language, e: React.MouseEvent) => {
    if (!word.trim() || word.length < 2) return;
    
    // Clean word from punctuation
    const cleanWord = word.replace(/[.,!?;:()]/g, '');
    if (!cleanWord) return;

    const rect = (e.target as HTMLElement).getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top - 10;

    setHoveredWord({ text: cleanWord, translation: '...', x, y });

    try {
      const translation = await translationService.quickTranslate(cleanWord, from, to);
      setHoveredWord(prev => prev && prev.text === cleanWord ? { ...prev, translation } : prev);
    } catch (error) {
      setHoveredWord(null);
    }
  };

  const HoverableText = ({ text, from, to, className }: { text: string, from: Language | 'auto', to: Language, className?: string }) => {
    const words = text.split(/(\s+)/);
    return (
      <div className={cn("relative inline-block", className)}>
        {words.map((word, i) => (
          <span 
            key={i}
            onMouseEnter={(e) => handleHoverWord(word, from, to, e)}
            onMouseLeave={() => setHoveredWord(null)}
            className={cn(
              "inline-block transition-colors rounded px-0.5",
              word.trim().length >= 2 ? "hover:bg-emerald-500/20 cursor-help" : ""
            )}
          >
            {word}
          </span>
        ))}
      </div>
    );
  };

  const handleTranslate = async (text: string) => {
    if (!text.trim()) {
      setResult(null);
      return;
    }

    if (isOffline) {
      setError("You are currently offline. Please check your internet connection.");
      return;
    }

    setIsLoading(true);
    setError(null);
    try {
      const res = await translationService.translate(text, fromLang, toLang, context);
      setResult(res);
      if (autoRead && res.translatedText) {
        handleSpeak(res.translatedText, toLang);
      }
    } catch (err: any) {
      console.error("Translation error:", err);
      setError(err.message || "An error occurred during translation.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    
    if (inputText.trim()) {
      debounceTimer.current = setTimeout(() => {
        handleTranslate(inputText);
      }, 800);
    } else {
      setResult(null);
    }

    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, [inputText, fromLang, toLang, context]);

  const handleFromLangChange = (val: Language | 'auto') => {
    setFromLang(val);
    if (val === 'en') setToLang('es');
    if (val === 'es') setToLang('en');
  };

  const swapLanguages = () => {
    const currentFrom = fromLang === 'auto' ? (result?.detectedLanguage || 'en') : fromLang;
    const currentTo = toLang;

    setFromLang(currentTo);
    setToLang(currentFrom as Language);

    // Also swap text if there's a result
    if (result) {
      setInputText(result.translatedText);
    }
  };

  const handleSpeak = async (text: string, lang: Language) => {
    if (isSpeaking) {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      setIsSpeaking(false);
      return;
    }

    setError(null);
    setIsSpeaking(true);
    
    try {
      const audioUrl = await translationService.speak(text, lang);
      const audio = new Audio(audioUrl);
      audioRef.current = audio;
      
      audio.onended = () => {
        setIsSpeaking(false);
        audioRef.current = null;
      };

      try {
        await audio.play();
      } catch (playError: any) {
        if (playError.name === 'NotAllowedError') {
          throw new Error("Audio playback was blocked by your browser. Please click the 'Read Aloud' button manually to enable sound.");
        }
        if (playError.name === 'NotSupportedError' || playError.message?.includes('not supported')) {
          throw new Error("Your browser doesn't support this audio format. Please try using a modern browser like Chrome or Safari.");
        }
        throw playError;
      }
    } catch (error: any) {
      console.error("Speech error:", error);
      setError(error.message || "Failed to play audio. Please try again.");
      setIsSpeaking(false);
      audioRef.current = null;
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-[#F5F5F5] text-[#1A1A1A] font-sans selection:bg-emerald-100">
      {/* Header */}
      <header className="max-w-5xl mx-auto px-6 py-8 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-emerald-500 rounded-xl flex items-center justify-center shadow-lg shadow-emerald-200">
            <Languages className="text-white w-6 h-6" />
          </div>
          <div className="flex flex-col">
            <h1 className="text-xl font-semibold tracking-tight">EnEs Accurate</h1>
            {isOffline && (
              <span className="text-[10px] text-orange-500 font-bold uppercase tracking-wider flex items-center gap-1">
                <div className="w-1 h-1 bg-orange-500 rounded-full animate-pulse" />
                Offline Mode
              </span>
            )}
          </div>
        </div>
        <button 
          onClick={() => setShowContext(!showContext)}
          className={cn(
            "p-2 rounded-full transition-colors",
            showContext ? "bg-emerald-100 text-emerald-600" : "hover:bg-gray-200 text-gray-500"
          )}
        >
          <Settings2 className="w-5 h-5" />
        </button>
      </header>

      <main className="max-w-5xl mx-auto px-6 pb-20">
        {/* Context Panel */}
        <AnimatePresence>
          {showContext && (
            <motion.div 
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden mb-6"
            >
              <div className="bg-white rounded-2xl p-6 border border-gray-100 shadow-sm">
                <div className="flex items-center gap-2 mb-3 text-emerald-600">
                  <Sparkles className="w-4 h-4" />
                  <span className="text-sm font-medium uppercase tracking-wider">Translation Context</span>
                </div>
                <p className="text-sm text-gray-500 mb-4">
                  Add details about the tone or situation to improve accuracy (e.g., "formal medical setting", "casual slang with friends").
                </p>
                <div className="space-y-4">
                  <input 
                    type="text"
                    value={context}
                    onChange={(e) => setContext(e.target.value)}
                    placeholder="e.g. Formal business email..."
                    className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all"
                  />
                  
                  <label className="flex items-center gap-3 cursor-pointer group">
                    <div 
                      onClick={() => setAutoRead(!autoRead)}
                      className={cn(
                        "w-10 h-5 rounded-full transition-all relative",
                        autoRead ? "bg-emerald-500" : "bg-gray-200"
                      )}
                    >
                      <div className={cn(
                        "absolute top-1 w-3 h-3 bg-white rounded-full transition-all",
                        autoRead ? "left-6" : "left-1"
                      )} />
                    </div>
                    <span className="text-sm font-medium text-gray-700 group-hover:text-emerald-600 transition-colors">
                      Auto-read translations
                    </span>
                  </label>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Translator Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Output Section (Now on the Left) */}
          <div className={cn(
            "rounded-3xl shadow-sm border p-6 flex flex-col min-h-[400px] transition-all duration-500 order-2 md:order-1",
            isLoading ? "bg-gray-50 border-gray-100" : "bg-emerald-500 border-emerald-400 text-white"
          )}>
            <div className="flex items-center justify-between mb-6">
              <span className="text-sm font-medium opacity-80">
                {toLang === 'en' ? 'English' : 'Spanish'}
              </span>
              {isLoading && <Loader2 className="w-5 h-5 animate-spin text-emerald-500" />}
            </div>

            <div className="flex-1">
              {error ? (
                <motion.div 
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="bg-red-500/10 border border-red-500/20 p-4 rounded-2xl flex gap-3 text-red-100"
                >
                  <Info className="w-5 h-5 shrink-0" />
                  <p className="text-sm">{error}</p>
                </motion.div>
              ) : result ? (
                <motion.div 
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="space-y-6 flex flex-col"
                >
                  {/* Information Window (Nuance & Alternatives) - Now at the Top */}
                  <div className="order-1 space-y-4">
                    {result.nuanceNotes && (
                      <div className={cn(
                        "p-4 rounded-2xl text-sm flex gap-3",
                        isLoading ? "bg-white/50 text-gray-600" : "bg-white/10 text-white/90"
                      )}>
                        <Info className="w-5 h-5 shrink-0" />
                        <p>{result.nuanceNotes}</p>
                      </div>
                    )}

                    {result.alternatives && result.alternatives.length > 0 && (
                      <div className="space-y-2">
                        <span className="text-[10px] uppercase tracking-widest opacity-60 font-bold">Alternatives</span>
                        <div className="flex flex-wrap gap-2">
                          {result.alternatives.map((alt, i) => (
                            <button 
                              key={i}
                              onClick={() => setInputText(alt)}
                              className="text-xs bg-white/10 hover:bg-white/20 px-3 py-1.5 rounded-full transition-colors"
                            >
                              {alt}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Translated Text - Now at the Bottom */}
                  <div className="order-2 pt-4">
                    <HoverableText 
                      text={result.translatedText} 
                      from={toLang} 
                      to={fromLang === 'auto' ? (result.detectedLanguage || 'en') : fromLang}
                      className="text-2xl font-light leading-relaxed text-white"
                    />
                  </div>
                </motion.div>
              ) : (
                <p className={cn(
                  "text-2xl font-light opacity-20",
                  isLoading ? "text-gray-400" : "text-white"
                )}>
                  Translation will appear here...
                </p>
              )}
            </div>

            <div className={cn(
              "flex items-center justify-between mt-6 pt-6 border-t",
              isLoading ? "border-gray-200" : "border-white/10"
            )}>
              <div className="flex items-center gap-2">
                <button 
                  onClick={() => result && handleSpeak(result.translatedText, toLang)}
                  disabled={!result}
                  className={cn(
                    "px-4 py-2 rounded-xl transition-all flex items-center gap-2",
                    isSpeaking ? "bg-white text-emerald-600 shadow-lg" : "hover:bg-white/10 text-white"
                  )}
                >
                  {isSpeaking ? (
                    <motion.div
                      animate={{ scale: [1, 1.2, 1] }}
                      transition={{ repeat: Infinity, duration: 1 }}
                    >
                      <Loader2 className="w-5 h-5 animate-spin" />
                    </motion.div>
                  ) : (
                    <Volume2 className="w-5 h-5" />
                  )}
                  <span className="text-sm font-medium">
                    {isSpeaking ? "Stop Reading" : "Read Aloud"}
                  </span>
                </button>
                <button 
                  onClick={() => result && copyToClipboard(result.translatedText)}
                  disabled={!result}
                  className="p-3 hover:bg-white/10 rounded-xl transition-colors text-current disabled:opacity-30 relative"
                >
                  {copied ? <Check className="w-5 h-5 text-emerald-200" /> : <Copy className="w-5 h-5" />}
                </button>
              </div>
            </div>
          </div>

          {/* Input Section (Now on the Right) */}
          <div className="bg-white rounded-3xl shadow-sm border border-gray-100 p-6 flex flex-col min-h-[400px] order-1 md:order-2">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-4">
                <select 
                  value={fromLang}
                  onChange={(e) => handleFromLangChange(e.target.value as Language | 'auto')}
                  className="bg-transparent font-medium text-sm focus:outline-none cursor-pointer hover:text-emerald-600 transition-colors"
                >
                  <option value="auto">Auto Detect</option>
                  <option value="en">English</option>
                  <option value="es">Spanish</option>
                </select>
                {fromLang === 'auto' && result?.detectedLanguage && (
                  <span className="text-[10px] bg-gray-100 px-2 py-0.5 rounded text-gray-500 font-bold uppercase">
                    {result.detectedLanguage === 'en' ? 'English' : 'Spanish'}
                  </span>
                )}
                <button 
                  onClick={swapLanguages}
                  className="p-2 hover:bg-gray-100 rounded-full transition-colors text-gray-400 hover:text-emerald-600"
                >
                  <ArrowRightLeft className="w-4 h-4" />
                </button>
                <span className="text-sm font-medium text-emerald-600">
                  {toLang === 'en' ? 'English' : 'Spanish'}
                </span>
              </div>
            </div>

            <div className="flex-1 relative">
              {inputText && (
                <button 
                  onClick={() => setInputText('')}
                  className="absolute top-0 right-0 p-1 hover:bg-gray-100 rounded-full transition-colors text-gray-300 hover:text-gray-500 z-10"
                  title="Clear text"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
              {isInputFocused || !inputText ? (
                <textarea 
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  onFocus={() => setIsInputFocused(true)}
                  onBlur={() => setIsInputFocused(false)}
                  placeholder="Enter text to translate..."
                  className="w-full h-full resize-none text-2xl font-light focus:outline-none placeholder:text-gray-300 bg-transparent"
                  autoFocus={!inputText}
                />
              ) : (
                <div 
                  className="w-full h-full cursor-text"
                  onClick={() => setIsInputFocused(true)}
                >
                  <HoverableText 
                    text={inputText} 
                    from={fromLang} 
                    to={toLang}
                    className="text-2xl font-light leading-relaxed text-gray-900"
                  />
                </div>
              )}
            </div>

            <div className="flex items-center justify-between mt-6 pt-6 border-t border-gray-50">
              <div className="flex items-center gap-2">
                <button 
                  onClick={() => handleSpeak(inputText, fromLang === 'auto' ? (result?.detectedLanguage || 'en') : fromLang)}
                  disabled={!inputText || isSpeaking}
                  className="p-3 hover:bg-gray-100 rounded-xl transition-colors text-gray-400 disabled:opacity-30"
                >
                  <Volume2 className="w-5 h-5" />
                </button>
                <button 
                  onClick={toggleRecording}
                  className={cn(
                    "p-3 rounded-xl transition-all flex items-center gap-2",
                    isRecording ? "bg-red-50 text-red-600 shadow-sm" : "hover:bg-gray-100 text-gray-400"
                  )}
                  title={isRecording ? "Stop recording" : "Start voice input"}
                >
                  {isRecording ? (
                    <motion.div
                      animate={{ scale: [1, 1.2, 1] }}
                      transition={{ repeat: Infinity, duration: 1 }}
                    >
                      <Mic className="w-5 h-5" />
                    </motion.div>
                  ) : (
                    <Mic className="w-5 h-5" />
                  )}
                  {isRecording && <span className="text-xs font-bold animate-pulse">REC</span>}
                </button>
                <button 
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isScanning}
                  className={cn(
                    "p-3 rounded-xl transition-all flex items-center gap-2",
                    isScanning ? "bg-emerald-50 text-emerald-600" : "hover:bg-gray-100 text-gray-400"
                  )}
                  title="Scan text from image"
                >
                  {isScanning ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      <span className="text-xs font-bold animate-pulse">SCANNING...</span>
                    </>
                  ) : (
                    <>
                      <Camera className="w-5 h-5" />
                      <span className="text-xs font-medium">Scan</span>
                    </>
                  )}
                </button>
                <input 
                  type="file"
                  ref={fileInputRef}
                  onChange={handleImageScan}
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                />
              </div>
              <span className="text-xs text-gray-400 font-mono">
                {inputText.length} characters
              </span>
            </div>
          </div>
        </div>

        {/* Features Footer */}
        <div className="mt-12 grid grid-cols-1 sm:grid-cols-3 gap-6">
          <div className="flex flex-col gap-2">
            <div className="w-8 h-8 rounded-lg bg-white flex items-center justify-center shadow-sm border border-gray-100">
              <Sparkles className="w-4 h-4 text-emerald-500" />
            </div>
            <h3 className="text-sm font-semibold">Context Aware</h3>
            <p className="text-xs text-gray-500 leading-relaxed">Uses Gemini 3.1 Pro to understand tone, setting, and cultural nuances.</p>
          </div>
          <div className="flex flex-col gap-2">
            <div className="w-8 h-8 rounded-lg bg-white flex items-center justify-center shadow-sm border border-gray-100">
              <Volume2 className="w-4 h-4 text-emerald-500" />
            </div>
            <h3 className="text-sm font-semibold">Natural Speech</h3>
            <p className="text-xs text-gray-500 leading-relaxed">High-quality text-to-speech for both languages to help with pronunciation.</p>
          </div>
          <div className="flex flex-col gap-2">
            <div className="w-8 h-8 rounded-lg bg-white flex items-center justify-center shadow-sm border border-gray-100">
              <Info className="w-4 h-4 text-emerald-500" />
            </div>
            <h3 className="text-sm font-semibold">Nuance Detection</h3>
            <p className="text-xs text-gray-500 leading-relaxed">Explains formal vs informal usage and provides alternative translations.</p>
          </div>
        </div>
        
        {/* Tooltip */}
        <AnimatePresence>
          {hoveredWord && (
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 5 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 5 }}
              style={{ 
                position: 'fixed', 
                left: hoveredWord.x, 
                top: hoveredWord.y, 
                transform: 'translateX(-50%) translateY(-100%)',
                zIndex: 1000,
                pointerEvents: 'none'
              }}
              className="bg-gray-900 text-white px-3 py-1.5 rounded-lg text-sm shadow-xl border border-white/10 flex flex-col items-center gap-0.5"
            >
              <span className="text-[10px] uppercase tracking-widest opacity-50 font-bold">{hoveredWord.text}</span>
              <span className="font-medium">
                {hoveredWord.translation === '...' ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  hoveredWord.translation
                )}
              </span>
              <div className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-full w-0 h-0 border-l-[6px] border-l-transparent border-r-[6px] border-r-transparent border-t-[6px] border-t-gray-900" />
            </motion.div>
          )}
        </AnimatePresence>
      </main>
      </div>
    </ErrorBoundary>
  );
}
