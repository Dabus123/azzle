export interface GitHubRepo {
  full_name: string;
  html_url: string;
  description: string | null;
  stargazers_count: number;
  topics: string[];
  owner: { login: string };
}

export class GitHubClient {
  constructor(private token: string) {}

  async searchRepos(query: string, perPage = 30): Promise<GitHubRepo[]> {
    const url = new URL("https://api.github.com/search/repositories");
    url.searchParams.set("q", query);
    url.searchParams.set("sort", "updated");
    url.searchParams.set("per_page", String(perPage));

    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;

    const res = await fetch(url, { headers });
    if (!res.ok) {
      console.warn(`[github] search failed: ${res.status}`);
      return this.seedRepos(query);
    }
    const data = (await res.json()) as { items?: GitHubRepo[] };
    return data.items ?? [];
  }

  async searchIssues(query: string, perPage = 20): Promise<
    Array<{ title: string; html_url: string; repository_url: string }>
  > {
    const url = new URL("https://api.github.com/search/issues");
    url.searchParams.set("q", query);
    url.searchParams.set("per_page", String(perPage));

    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
    };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;

    const res = await fetch(url, { headers });
    if (!res.ok) return [];
    const data = (await res.json()) as {
      items?: Array<{ title: string; html_url: string; repository_url: string }>;
    };
    return data.items ?? [];
  }

  async getUser(login: string): Promise<{
    login: string;
    email: string | null;
    twitter: string | null;
    blog: string | null;
  } | null> {
    const headers = this.authHeaders();
    const res = await fetch(`https://api.github.com/users/${encodeURIComponent(login)}`, {
      headers,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      login?: string;
      email?: string | null;
      twitter_username?: string | null;
      blog?: string | null;
    };
    return {
      login: data.login ?? login,
      email: data.email ?? null,
      twitter: data.twitter_username ?? null,
      blog: data.blog ?? null,
    };
  }

  /** Public commit author email when profile email is hidden. */
  async getCommitAuthorEmail(owner: string, repoHint?: string | null): Promise<string | null> {
    let repoName = this.parseRepoName(repoHint);
    if (!repoName) {
      const repos = await this.listUserRepos(owner, 3);
      for (const r of repos) {
        const email = await this.fetchCommitEmailFromRepo(owner, r.name);
        if (email) return email;
      }
      return null;
    }
    return this.fetchCommitEmailFromRepo(owner, repoName);
  }

  private authHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    return headers;
  }

  private isPublicEmail(email: string): boolean {
    if (!email.includes("@")) return false;
    if (/noreply|users\.noreply\.github/i.test(email)) return false;
    return true;
  }

  private parseRepoName(hint?: string | null): string | null {
    if (!hint) return null;
    const trimmed = hint.trim();
    const fullName = /^([^/]+)\/([^/]+)$/.exec(trimmed);
    if (fullName && !trimmed.includes("github.com")) {
      return fullName[2].replace(/\.git$/, "");
    }
    const urlMatch = /github\.com\/[^/]+\/([^/?#]+)/i.exec(trimmed);
    return urlMatch ? urlMatch[1].replace(/\.git$/, "") : null;
  }

  private async listUserRepos(
    owner: string,
    perPage = 3
  ): Promise<Array<{ name: string; full_name: string }>> {
    const res = await fetch(
      `https://api.github.com/users/${encodeURIComponent(owner)}/repos?sort=updated&per_page=${perPage}`,
      { headers: this.authHeaders() }
    );
    if (!res.ok) return [];
    const data = (await res.json()) as Array<{ name?: string; full_name?: string }>;
    return data
      .filter((r) => r.name && r.full_name)
      .map((r) => ({ name: r.name!, full_name: r.full_name! }));
  }

  private async fetchCommitEmailFromRepo(owner: string, repoName: string): Promise<string | null> {
    const res = await fetch(
      `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repoName)}/commits?per_page=10`,
      { headers: this.authHeaders() }
    );
    if (!res.ok) return null;
    const commits = (await res.json()) as Array<{
      commit?: { author?: { email?: string } };
      author?: { email?: string | null };
    }>;
    for (const c of commits) {
      const email = c.commit?.author?.email ?? c.author?.email ?? null;
      if (email && this.isPublicEmail(email)) return email;
    }
    return null;
  }

  private seedRepos(query: string): GitHubRepo[] {
    const keywords = query.split(/\s+/).slice(0, 3);
    return keywords.map((kw, i) => ({
      full_name: `example/${kw}-agent-${i}`,
      html_url: `https://github.com/example/${kw}-agent-${i}`,
      description: `Autonomous ${kw} agent framework`,
      stargazers_count: 100 + i * 50,
      topics: [kw, "agent", "automation"],
      owner: { login: "example" },
    }));
  }
}
