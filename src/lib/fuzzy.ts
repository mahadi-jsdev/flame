/**
 * VS Code/Sublime-style "go to file" matching: every character of `query`
 * must appear in `target`, in order, but not necessarily adjacent. Returns
 * a score (higher = better match) or `null` if it isn't a match at all.
 * Rewards consecutive runs and matches right after a path/word boundary
 * (e.g. typing "gp" ranks "GitPanel.tsx" above "app.tsx").
 */
export function fuzzyScore(query: string, target: string): number | null {
  if (!query) return 0;
  const q = query.toLowerCase();
  const t = target.toLowerCase();

  let qi = 0;
  let score = 0;
  let consecutive = 0;
  let lastMatchIndex = -1;

  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] !== q[qi]) continue;

    score += 1;
    if (lastMatchIndex === ti - 1) {
      consecutive += 1;
      score += consecutive * 2;
    } else {
      consecutive = 0;
    }

    const prevChar = ti > 0 ? t[ti - 1] : "";
    if (ti === 0 || "/.-_ ".includes(prevChar)) {
      score += 3;
    }

    lastMatchIndex = ti;
    qi += 1;
  }

  if (qi < q.length) return null;
  return score - target.length * 0.01;
}
