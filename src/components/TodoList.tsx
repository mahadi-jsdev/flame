import { useState } from "react";
import { useWorkspaceStore } from "../store/workspaceStore";
import { Check, ListTodo, X } from "lucide-react";

export function TodoList() {
  const store = useWorkspaceStore();
  const [draft, setDraft] = useState("");

  const submit = () => {
    if (!draft.trim()) return;
    store.addTodo(draft);
    setDraft("");
  };

  const todos = [...store.todos].sort((a, b) => Number(a.done) - Number(b.done));

  return (
    <div className="flex flex-col min-h-0">
      <div className="flex items-center gap-1.5 mb-2 px-1 text-[10px] font-display font-semibold text-[#6f6455] uppercase tracking-widest shrink-0">
        <ListTodo size={11} />
        Todo
      </div>

      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
        }}
        placeholder="Add a todo… #tag"
        spellCheck={false}
        className="shrink-0 w-full bg-black/25 border border-white/10 focus:border-accent/40 rounded-md px-2 py-1.5 text-[12px] text-[#f3e9d8] placeholder:text-[#6f6455] outline-none mb-2"
      />

      <div className="space-y-0.5">
        {todos.map((t) => (
          <div
            key={t.id}
            className="group flex items-start gap-2 px-1 py-1 rounded-md hover:bg-white/[0.04] transition-colors"
          >
            <button
              onClick={() => store.toggleTodo(t.id)}
              className={`mt-0.5 shrink-0 w-3.5 h-3.5 rounded-[3px] border flex items-center justify-center transition-colors ${
                t.done
                  ? "bg-accent border-accent text-[#1a1006]"
                  : "border-white/20 text-transparent hover:border-accent/50"
              }`}
              title={t.done ? "Mark not done" : "Mark done"}
            >
              <Check size={9} strokeWidth={3} />
            </button>
            <div className="flex-1 min-w-0">
              <span
                className={`text-[12.5px] break-words ${
                  t.done ? "line-through text-[#6f6455]" : "text-[#d9cbb5]"
                }`}
              >
                {t.text}
              </span>
              {t.tag && (
                <span className="ml-1.5 inline-block align-middle text-[9.5px] font-mono px-1 py-0.5 rounded bg-accent-2/10 text-accent-2 border border-accent-2/20">
                  #{t.tag}
                </span>
              )}
            </div>
            <button
              onClick={() => store.removeTodo(t.id)}
              className="opacity-0 group-hover:opacity-100 shrink-0 p-0.5 rounded text-[#6f6455] hover:text-rose-300 hover:bg-rose-500/20 transition-all"
              title="Delete todo"
            >
              <X size={11} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
