import { useEffect, useRef, useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Bot, Globe, Loader2, Send, Sparkles, Trash2 } from 'lucide-react';
import { askAi, buildSnapshot, type ChatMessage } from '@/lib/ai';

const suggestions = [
  'Koja gradilišta imaju najlošiju maržu i zašto?',
  'Usporedi troškove i fakturirano po gradilištima.',
  'Koji rokovi i dokumenti ističu ovaj mjesec?',
  'Koliko smo potrošili na kooperante po gradilištima?',
];

export function AsistentView() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [web, setWeb] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const snapshotRef = useRef<unknown>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, busy]);

  const send = async (text: string) => {
    const question = text.trim();
    if (!question || busy) return;
    const next: ChatMessage[] = [...messages, { role: 'user', text: question }];
    setMessages(next);
    setInput('');
    setBusy(true);
    setError(null);
    try {
      snapshotRef.current = await buildSnapshot();
      const answer = await askAi(next, snapshotRef.current, web);
      setMessages([...next, answer]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Greška pri slanju upita.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto flex min-h-[32rem] min-w-0 w-full max-w-4xl flex-col xl:h-[calc(100vh-4rem)]">
      <div className="mb-4 flex min-w-0 flex-col items-stretch justify-between gap-3 xl:flex-row xl:items-center">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900"><Sparkles className="h-6 w-6 text-indigo-600" /> AI asistent</h1>
          <p className="mt-1 text-sm text-slate-500">Analizira podatke iz programa (gradilišta, troškovi, fakture, rokovi…) i po potrebi pretražuje web</p>
        </div>
        {messages.length > 0 && (
          <button type="button" onClick={() => setMessages([])} className="inline-flex items-center gap-1 rounded-lg px-3 py-2 text-sm text-slate-600 hover:bg-slate-100">
            <Trash2 className="h-4 w-4" /> Novi razgovor
          </button>
        )}
      </div>

      <div className="min-h-0 min-w-0 flex-1 space-y-4 overflow-y-auto rounded-xl border border-slate-200 bg-white p-3 xl:p-4">
        {messages.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-4 text-center text-slate-500">
            <Bot className="h-10 w-10 text-indigo-400" />
            <p className="text-sm">Pitaj me nešto o poslovanju. Na primjer:</p>
            <div className="flex max-w-xl flex-wrap justify-center gap-2">
              {suggestions.map((s) => (
                <button key={s} type="button" onClick={() => void send(s)} className="rounded-full border border-slate-200 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50">{s}</button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, index) => (
          <div key={index} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`min-w-0 max-w-full break-words rounded-2xl px-4 py-2.5 text-sm xl:max-w-[85%] ${m.role === 'user' ? 'whitespace-pre-wrap bg-sky-600 text-white' : 'bg-slate-100 text-slate-800'}`}>
              {m.role === 'user' ? m.text : (
                <div className="min-w-0 space-y-2 [overflow-wrap:anywhere] [&_pre]:whitespace-pre-wrap [&_a]:text-sky-700 [&_a]:underline [&_h1]:text-base [&_h1]:font-bold [&_h2]:text-base [&_h2]:font-bold [&_h3]:mt-3 [&_h3]:text-sm [&_h3]:font-bold [&_li]:ml-1 [&_ol]:list-decimal [&_ol]:space-y-1 [&_ol]:pl-5 [&_strong]:font-semibold [&_strong]:text-slate-900 [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-5">
                  <Markdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                      table: ({ children }) => <div className="min-w-0 max-w-full overflow-x-auto"><table className="w-full border-collapse text-xs">{children}</table></div>,
                      th: ({ children }) => <th className="border border-slate-300 bg-slate-200 px-2 py-1 text-left font-semibold">{children}</th>,
                      td: ({ children }) => <td className="border border-slate-300 bg-white px-2 py-1">{children}</td>,
                      a: ({ children, href }) => <a href={href} target="_blank" rel="noreferrer">{children}</a>,
                    }}
                  >
                    {m.text}
                  </Markdown>
                </div>
              )}
              {m.sources && m.sources.length > 0 && (
                <div className="mt-2 border-t border-slate-300 pt-2 text-xs text-slate-500">
                  Izvori: {m.sources.slice(0, 5).map((s, i) => (
                    <a key={i} href={s.uri} target="_blank" rel="noreferrer" className="mr-2 underline">{s.title}</a>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
        {busy && <div className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Analiziram…</div>}
        {error && <p className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        <div ref={bottomRef} />
      </div>

      <form onSubmit={(event) => { event.preventDefault(); void send(input); }} className="mt-3 flex min-w-0 flex-col items-stretch gap-2 xl:flex-row xl:items-center">
        <button type="button" onClick={() => setWeb(!web)} title="Web pretraga za vanjske podatke" className={`inline-flex items-center gap-1 rounded-lg border px-3 py-2.5 text-sm ${web ? 'border-indigo-600 bg-indigo-50 text-indigo-700' : 'border-slate-300 text-slate-500'}`}>
          <Globe className="h-4 w-4" /> Web
        </button>
        <input value={input} onChange={(event) => setInput(event.target.value)} placeholder="Upiši pitanje…" className="min-w-0 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm xl:flex-1" />
        <button type="submit" disabled={busy || !input.trim()} className="inline-flex items-center gap-2 rounded-lg bg-sky-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-50">
          <Send className="h-4 w-4" /> Pošalji
        </button>
      </form>
    </div>
  );
}
