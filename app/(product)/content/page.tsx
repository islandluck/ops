"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { FileText, Globe, Loader2, MessageCircle, Newspaper, Plus, Sparkles, Trash2, TrendingUp } from "lucide-react";
import { PageHeader, PageBody } from "@/components/app/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Drawer } from "@/components/ui/drawer";
import { Input, Textarea } from "@/components/ui/input";
import { cn } from "@/lib/cn";
import { createPostAction, deletePostAction, getPostsAction } from "@/app/actions";
import { markdownToPlainText } from "@/lib/content/format";
import type { ChannelKind, Post, PostChannel } from "@/lib/types";

const CHANNEL_META: Record<ChannelKind, { label: string; icon: typeof Globe }> = {
  page: { label: "Article", icon: Globe },
  x_thread: { label: "X thread", icon: MessageCircle },
  substack: { label: "Substack", icon: FileText },
};

function channelChip(c: PostChannel): { text: string; cls: string } {
  const base = CHANNEL_META[c.channel].label;
  if (c.status === "published") return { text: `${base} · live`, cls: "border-emerald-200 bg-emerald-50 text-emerald-700" };
  if (c.status === "scheduled") return { text: `${base} · scheduled`, cls: "border-violet-200 bg-violet-50 text-violet-700" };
  if (c.status === "handoff") return { text: `${base} · ready`, cls: "border-amber-200 bg-amber-50 text-amber-700" };
  return { text: `${base} · packaged`, cls: "border-border bg-muted text-muted-foreground" };
}

export default function ContentPage() {
  const router = useRouter();
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  async function reload() {
    try {
      setPosts(await getPostsAction());
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void reload();
  }, []);

  return (
    <>
      <PageHeader
        title="Content"
        description="Write a post once, run it through the Growth Marketer, then package and distribute it everywhere — a hosted article, an X thread, and a Substack-ready draft."
        actions={
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" />
            New post
          </Button>
        }
      />
      <PageBody>
        {loading ? (
          <div className="flex items-center justify-center py-20 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : posts.length === 0 ? (
          <Card className="flex flex-col items-center gap-3 p-12 text-center">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Newspaper className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-[15px] font-semibold">Write once, publish everywhere</h3>
              <p className="mx-auto mt-1 max-w-md text-[13px] text-muted-foreground">
                Give a topic and your writer drafts a longform post in your voice. Boost it for virality, then push it to
                your site, X, and Substack — on a schedule.
              </p>
            </div>
            <Button size="sm" onClick={() => setCreating(true)}>
              <Plus className="h-4 w-4" />
              Write a post
            </Button>
          </Card>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {posts.map((p) => (
              <PostCard
                key={p.id}
                post={p}
                onOpen={() => router.push(`/content/${p.id}`)}
                onDeleted={reload}
              />
            ))}
          </div>
        )}
      </PageBody>

      {creating && (
        <NewPostDrawer
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false);
            router.push(`/content/${id}`);
          }}
        />
      )}
    </>
  );
}

function PostCard({ post, onOpen, onDeleted }: { post: Post; onOpen: () => void; onDeleted: () => void }) {
  const excerpt = post.dek || markdownToPlainText(post.body_md).slice(0, 140);
  const channels = post.channels ?? [];
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function del(e: React.MouseEvent) {
    e.stopPropagation();
    setDeleting(true);
    await deletePostAction(post.id);
    onDeleted();
  }

  return (
    <Card className="card-interactive group relative flex cursor-pointer flex-col p-4" onClick={onOpen}>
      {confirming ? (
        <div
          className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 rounded-[inherit] bg-card/95 p-5 text-center backdrop-blur-[1px]"
          onClick={(e) => e.stopPropagation()}
        >
          <p className="text-[12.5px] text-foreground/80">Delete this post? Any scheduled thread is canceled.</p>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="destructive" onClick={del} disabled={deleting}>
              {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
              Delete
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirming(false)} disabled={deleting}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <button
          onClick={(e) => {
            e.stopPropagation();
            setConfirming(true);
          }}
          className="absolute right-2 top-2 z-10 rounded-lg p-1.5 text-muted-foreground/50 opacity-0 transition hover:bg-accent hover:text-destructive group-hover:opacity-100"
          aria-label="Delete post"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      )}
      <div className="flex items-center justify-between gap-2 pr-6">
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium",
            post.status === "distributed"
              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
              : "border-border bg-muted text-muted-foreground",
          )}
        >
          {post.status === "distributed" ? "Distributed" : "Draft"}
        </span>
        {post.boosted && (
          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-violet-600">
            <TrendingUp className="h-3 w-3" /> Boosted
          </span>
        )}
      </div>
      <h3 className="mt-2.5 line-clamp-2 text-[14px] font-semibold leading-snug">{post.title || "Untitled post"}</h3>
      <p className="mt-1 line-clamp-3 text-[12px] text-muted-foreground">{excerpt}</p>
      <div className="mt-3 flex-1" />
      {channels.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5 border-t border-border pt-3">
          {channels.map((c) => {
            const chip = channelChip(c);
            return (
              <span
                key={c.id}
                className={cn("inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10.5px] font-medium", chip.cls)}
              >
                {chip.text}
              </span>
            );
          })}
        </div>
      )}
    </Card>
  );
}

function NewPostDrawer({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const [topic, setTopic] = useState("");
  const [angle, setAngle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    if (!topic.trim() || busy) return;
    setBusy(true);
    setError("");
    const res = await createPostAction({ topic: topic.trim(), angle: angle.trim() || undefined, generate: true });
    setBusy(false);
    if (res.ok && res.postId) onCreated(res.postId);
    else setError(res.error ?? "Couldn't draft the post.");
  }

  return (
    <Drawer open onClose={onClose}>
      <div className="flex shrink-0 items-center justify-between border-b border-border px-5 py-4">
        <div>
          <p className="inline-flex items-center gap-1.5 text-[12px] font-medium text-primary">
            <Newspaper className="h-3.5 w-3.5" /> New post
          </p>
          <h2 className="text-[17px] font-semibold">What should it be about?</h2>
        </div>
        <button onClick={onClose} className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent" aria-label="Close">
          ✕
        </button>
      </div>
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5">
        <div className="space-y-1.5">
          <label className="text-[13px] font-medium">Topic</label>
          <Textarea
            autoFocus
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            className="min-h-[90px]"
            placeholder="e.g. Why chemical-looping beats electrolysis for on-site ammonia — the economics nobody talks about."
          />
          <p className="text-[11.5px] text-muted-foreground">
            Your writer drafts a full longform post in your voice. You can edit every word next.
          </p>
        </div>
        <div className="space-y-1.5">
          <label className="text-[13px] font-medium">Angle or must-include (optional)</label>
          <Input
            value={angle}
            onChange={(e) => setAngle(e.target.value)}
            placeholder="e.g. Speak to plant engineers; end with a concrete pilot cost."
          />
        </div>
        {error && <p className="text-[12.5px] text-destructive">{error}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-2 border-t border-border px-5 py-3.5">
        <Button variant="success" className="flex-1" onClick={submit} disabled={busy || !topic.trim()}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {busy ? "Drafting your post…" : "Draft the post"}
        </Button>
      </div>
    </Drawer>
  );
}
