import "server-only";

import { getValidAccessToken } from "@/lib/integrations/tokens";
import { getUserByUsername, getUserRecentTweets } from "@/lib/integrations/x";
import { scoreReplyOpportunities } from "@/lib/ai/reply-radar";
import { suggestReplies } from "@/lib/ai/style";
import {
  activeTargetsForRefresh,
  getPlanningContext,
  getXStyleProfile,
  insertOpportunity,
  markTargetChecked,
  setTargetUserId,
  workspacesWithActiveTargets,
} from "@/lib/db/queries";

/**
 * Reply radar — for each watched account, pull recent tweets, score which are
 * worth replying to, pre-draft the top ones, and store them as opportunities.
 * Reads other users' timelines (needs the X API Basic tier); a read block is
 * reported back so the UI can prompt to upgrade rather than fail silently.
 */

const SCORE_THRESHOLD = 55;

function ageMinutes(iso: string | null): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.round((Date.now() - t) / 60000));
}

export interface RadarResult {
  found: number;
  readBlocked: boolean;
  targets: number;
}

export async function refreshReplyRadar(
  workspaceId: string,
  opts: { maxTargets?: number; perTarget?: number; draftTop?: number } = {},
): Promise<RadarResult> {
  const token = await getValidAccessToken(workspaceId, "X (Twitter)");
  if (!token) return { found: 0, readBlocked: false, targets: 0 };

  const targets = await activeTargetsForRefresh(workspaceId, opts.maxTargets ?? 6);
  if (!targets.length) return { found: 0, readBlocked: false, targets: 0 };

  const { brief } = await getPlanningContext(workspaceId);
  const style = await getXStyleProfile(workspaceId);
  const draftTop = opts.draftTop ?? 2;

  let found = 0;
  let readBlocked = false;

  for (const target of targets) {
    let userId = target.x_user_id;
    if (!userId) {
      const u = await getUserByUsername(token, target.handle);
      if (u) {
        userId = u.id;
        await setTargetUserId(workspaceId, target.id, u.id);
      }
    }
    if (!userId) continue;

    const tweets = await getUserRecentTweets(token, userId, {
      sinceId: target.last_seen_tweet_id,
      max: opts.perTarget ?? 10,
    });
    if (tweets === null) {
      readBlocked = true; // read tier missing / rate-limited
      continue;
    }
    // Advance the cursor to the newest tweet seen, even if none qualify.
    await markTargetChecked(workspaceId, target.id, tweets[0]?.id ?? target.last_seen_tweet_id);

    const candidates = tweets.filter((t) => t.text && !/^https?:\/\/\S+$/.test(t.text.trim()));
    if (!candidates.length) continue;

    let scored;
    try {
      scored = await scoreReplyOpportunities(
        candidates.map((t) => ({
          text: t.text,
          author: `@${target.handle}`,
          ageMinutes: ageMinutes(t.created_at),
          likes: t.likes,
          replies: t.replies,
        })),
        { company: brief.company_name, idealCustomer: brief.ideal_customer_profile },
      );
    } catch {
      continue; // scoring failed (e.g. no AI credits) — skip this target
    }

    const top = scored
      .filter((s) => s.score >= SCORE_THRESHOLD)
      .sort((a, b) => b.score - a.score)
      .slice(0, draftTop);

    for (const s of top) {
      const t = candidates[s.index];
      if (!t) continue;
      let replies: { reply: string; note: string }[] = [];
      try {
        replies = await suggestReplies(
          { text: t.text, author: `@${target.handle}` },
          {
            company: brief.company_name,
            idealCustomer: brief.ideal_customer_profile,
            voiceRules: brief.voice_rules,
            restrictedPhrases: brief.restricted_phrases,
            styleProfile: style,
          },
        );
      } catch {
        /* best-effort — the opportunity still surfaces; the UI drafts on demand */
      }
      const inserted = await insertOpportunity(workspaceId, {
        targetId: target.id,
        tweetId: t.id,
        tweetUrl: `https://x.com/${target.handle}/status/${t.id}`,
        authorHandle: `@${target.handle}`,
        tweetText: t.text,
        score: s.score,
        reason: s.reason,
        suggestedReplies: replies,
      });
      if (inserted) found++;
    }
  }

  return { found, readBlocked, targets: targets.length };
}

/** Cron: refresh the radar for a bounded set of workspaces that have targets. */
export async function refreshAllReplyRadars(limit = 10): Promise<{ workspaces: number; found: number }> {
  const wsIds = await workspacesWithActiveTargets(limit);
  let found = 0;
  for (const ws of wsIds) {
    try {
      const r = await refreshReplyRadar(ws, { maxTargets: 4, perTarget: 8, draftTop: 2 });
      found += r.found;
    } catch {
      /* skip a failing workspace */
    }
  }
  return { workspaces: wsIds.length, found };
}
