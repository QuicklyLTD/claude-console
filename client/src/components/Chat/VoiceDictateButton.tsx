import { useEffect, useRef, useState } from "react";
import { useComposerRuntime } from "@assistant-ui/react";
import { Mic, MicOff } from "lucide-react";
import { cn } from "@/lib/utils";

// TypeScript DOM lib bazı ortamlarda SpeechRecognition tanımını bilmez;
// vendor prefix ile (webkitSpeechRecognition) erişirken cast için minimum
// tip yüzeyi.
interface SRResult { 0: { transcript: string }; isFinal: boolean }
interface SREvent { resultIndex: number; results: ArrayLike<SRResult> }
interface SR {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: SREvent) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: unknown) => void) | null;
  start(): void;
  stop(): void;
}
type SRCtor = new () => SR;

function getSRCtor(): SRCtor | null {
  const w = window as unknown as { SpeechRecognition?: SRCtor; webkitSpeechRecognition?: SRCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function VoiceDictateButton({ lang = "tr-TR" }: { lang?: string }) {
  const composer = useComposerRuntime();
  const [recording, setRecording] = useState(false);
  const recRef = useRef<SR | null>(null);
  const baseRef = useRef<string>("");
  const Ctor = getSRCtor();

  useEffect(() => () => { recRef.current?.stop(); }, []);

  if (!Ctor) return null;

  function start() {
    const rec = new Ctor!();
    rec.lang = lang;
    rec.continuous = true;
    rec.interimResults = true;

    // Mevcut composer metnini taban al; yeni konuşma sonuna eklenir.
    const current = composer.getState().text ?? "";
    baseRef.current = current;

    rec.onresult = (e: SREvent) => {
      let transcript = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r) transcript += r[0].transcript;
      }
      const sep = baseRef.current && !/\s$/.test(baseRef.current) ? " " : "";
      composer.setText(baseRef.current + sep + transcript);
    };
    rec.onend = () => setRecording(false);
    rec.onerror = () => setRecording(false);

    try {
      rec.start();
      recRef.current = rec;
      setRecording(true);
    } catch {
      setRecording(false);
    }
  }

  function stop() {
    recRef.current?.stop();
    recRef.current = null;
    setRecording(false);
  }

  return (
    <button
      type="button"
      onClick={recording ? stop : start}
      aria-label={recording ? "Dinlemeyi durdur" : "Sesle yaz"}
      title={recording ? "Dinlemeyi durdur" : "Sesle yaz (Web Speech API)"}
      className={cn(
        "inline-flex size-8 shrink-0 items-center justify-center rounded-full border transition",
        recording
          ? "bg-red-500 text-white border-transparent animate-pulse"
          : "text-muted-foreground hover:text-foreground hover:bg-muted/60",
      )}
    >
      {recording ? <MicOff className="size-4" /> : <Mic className="size-4" />}
    </button>
  );
}
