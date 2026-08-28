"use client";

import { useEffect, useRef, useState } from "react";
import { Hash, Loader2, Plus, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/cn";
import {
  createChatChannelAction,
  listChatChannelsAction,
  listChatMessagesAction,
  sendChatMessageAction,
} from "@/app/actions";
import type { ChatChannel, ChatMessage } from "@/lib/types";

function fmtTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  } catch {
    return "";
  }
}

/** In-platform team chat: channels + messages, kept fresh by a light 3s poll. */
export function ChatView({ canManage }: { canManage: boolean }) {
  const [channels, setChannels] = useState<ChatChannel[]>([]);
  const [channelId, setChannelId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const channelIdRef = useRef<string | null>(null);
  channelIdRef.current = channelId;

  useEffect(() => {
    listChatChannelsAction().then((cs) => {
      setChannels(cs);
      setChannelId((prev) => prev ?? cs[0]?.id ?? null);
      setLoading(false);
    });
  }, []);

  // Load + poll messages for the current channel.
  useEffect(() => {
    if (!channelId) return;
    let active = true;
    async function load() {
      const id = channelIdRef.current;
      if (!id) return;
      const msgs = await listChatMessagesAction(id);
      if (active && channelIdRef.current === id) setMessages(msgs);
    }
    void load();
    const t = setInterval(load, 3000);
    return () => {
      active = false;
      clearInterval(t);
    };
  }, [channelId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  async function send() {
    const body = draft.trim();
    if (!body || !channelId) return;
    setSending(true);
    setDraft("");
    const r = await sendChatMessageAction(channelId, body);
    setSending(false);
    if ("ok" in r && r.ok) {
      setMessages((prev) => [...prev, r.message]);
    } else {
      setDraft(body);
    }
  }

  async function addChannel() {
    const name = window.prompt("New channel name (e.g. marketing)");
    if (!name) return;
    const r = await createChatChannelAction(name);
    if ("ok" in r && r.ok) {
      setChannels((prev) => [...prev, r.channel]);
      setChannelId(r.channel.id);
    } else if ("error" in r) {
      window.alert(r.error);
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-12 text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex h-[520px] flex-col overflow-hidden rounded-xl border border-border">
      <div className="flex items-center gap-1 overflow-x-auto border-b border-border bg-muted/30 px-2 py-1.5">
        {channels.map((c) => (
          <button
            key={c.id}
            onClick={() => setChannelId(c.id)}
            className={cn(
              "inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-sm font-medium transition",
              c.id === channelId ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Hash className="h-3.5 w-3.5" /> {c.name}
          </button>
        ))}
        {canManage && (
          <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={addChannel} aria-label="New channel">
            <Plus className="h-4 w-4" />
          </Button>
        )}
      </div>

      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-3">
        {messages.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            No messages yet. Say hello 👋
          </div>
        ) : (
          messages.map((m) => (
            <div key={m.id} className={cn("flex flex-col", m.mine ? "items-end" : "items-start")}>
              <div className="mb-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <span className="font-medium text-foreground">{m.mine ? "You" : m.sender_name}</span>
                <span>{fmtTime(m.created_at)}</span>
              </div>
              <div
                className={cn(
                  "max-w-[80%] whitespace-pre-wrap rounded-2xl px-3 py-1.5 text-sm",
                  m.mine ? "bg-primary text-primary-foreground" : "bg-muted text-foreground",
                )}
              >
                {m.body}
              </div>
            </div>
          ))
        )}
      </div>

      <div className="flex items-center gap-2 border-t border-border p-2">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          placeholder="Message…"
          disabled={!channelId}
        />
        <Button size="icon" onClick={send} disabled={sending || !draft.trim()} aria-label="Send">
          {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </Button>
      </div>
    </div>
  );
}
