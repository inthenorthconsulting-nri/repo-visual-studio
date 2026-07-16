import { simpleGit } from "simple-git";

export interface GitCommit {
  hash: string;
  message: string;
  author: string;
  date: string;
}

export interface GitSnapshot {
  commit: string;
  branch: string;
  recentCommits: GitCommit[];
  contributorCount: number;
  commitsLast90Days: number;
}

export async function readGitSnapshot(repoRoot: string, recentLimit = 10): Promise<GitSnapshot> {
  const git = simpleGit(repoRoot);
  const isRepo = await git.checkIsRepo();
  if (!isRepo) {
    return {
      commit: "unknown",
      branch: "unknown",
      recentCommits: [],
      contributorCount: 0,
      commitsLast90Days: 0,
    };
  }

  const [commit, branchSummary, log] = await Promise.all([
    git.revparse(["HEAD"]).catch(() => "unknown"),
    git.branch().catch(() => ({ current: "unknown" }) as { current: string }),
    git
      .log({ maxCount: recentLimit })
      .catch(() => ({ all: [] }) as { all: readonly { hash: string; message: string; author_name: string; date: string }[] }),
  ]);

  const ninetyDaysAgo = new Date();
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
  const sinceLog = await git
    .log({ "--since": ninetyDaysAgo.toISOString() })
    .catch(() => ({ all: [] }) as { all: readonly { author_name: string }[] });

  const contributors = new Set(sinceLog.all.map((entry) => entry.author_name));

  return {
    commit: commit.trim(),
    branch: branchSummary.current ?? "unknown",
    recentCommits: log.all.map((entry) => ({
      hash: entry.hash,
      message: entry.message,
      author: entry.author_name,
      date: entry.date,
    })),
    contributorCount: contributors.size,
    commitsLast90Days: sinceLog.all.length,
  };
}
