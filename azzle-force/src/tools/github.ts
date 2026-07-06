async function githubFetch(
  url: string,
  headers: Record<string, string>,
  init?: RequestInit,
  retries = 3
): Promise<Response> {
  let lastErr: unknown;
  for (let i = 0; i < retries; i++) {
    try {
      return await fetch(url, { ...init, headers: { ...headers, ...(init?.headers as Record<string, string>) } });
    } catch (err) {
      lastErr = err;
      if (i < retries - 1) await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
    }
  }
  throw lastErr;
}

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

    const res = await githubFetch(url.toString(), headers);
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

    const res = await githubFetch(url.toString(), headers);
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
    const res = await githubFetch(
      `https://api.github.com/users/${encodeURIComponent(login)}`,
      headers
    );
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
    const res = await githubFetch(
      `https://api.github.com/users/${encodeURIComponent(owner)}/repos?sort=updated&per_page=${perPage}`,
      this.authHeaders()
    );
    if (!res.ok) return [];
    const data = (await res.json()) as Array<{ name?: string; full_name?: string }>;
    return data
      .filter((r) => r.name && r.full_name)
      .map((r) => ({ name: r.name!, full_name: r.full_name! }));
  }

  private async fetchCommitEmailFromRepo(owner: string, repoName: string): Promise<string | null> {
    const res = await githubFetch(
      `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repoName)}/commits?per_page=10`,
      this.authHeaders()
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

  /** Current token owner login (e.g. azzleforce). */
  async getAuthenticatedLogin(): Promise<string | null> {
    if (!this.token) return null;
    const res = await githubFetch("https://api.github.com/user", this.authHeaders());
    if (!res.ok) return null;
    const data = (await res.json()) as { login?: string };
    return data.login ?? null;
  }

  /** First repo in list the token can access (for Pages deploy). */
  async resolveAccessibleRepo(candidates: string[]): Promise<string | null> {
    if (!this.token) return null;
    const headers = this.authHeaders();
    for (const full of candidates) {
      const trimmed = full.trim();
      if (!trimmed.includes("/")) continue;
      const res = await githubFetch(`https://api.github.com/repos/${trimmed}`, headers);
      if (res.ok) return trimmed;
    }
    return null;
  }

  /** Create repo if missing. Throws if PAT lacks repo scope — create manually on GitHub. */
  async ensureRepo(
    repoFullName: string,
    opts?: { description?: string; autoInit?: boolean }
  ): Promise<void> {
    if (!this.token) throw new Error("GITHUB_TOKEN required");
    const [owner, name] = repoFullName.split("/");
    if (!owner || !name) throw new Error(`Invalid repo: ${repoFullName}`);

    const headers = this.authHeaders();
    const getRes = await githubFetch(`https://api.github.com/repos/${owner}/${name}`, headers);
    if (getRes.ok) return;

    if (getRes.status !== 404) {
      const err = await getRes.text();
      throw new Error(`GitHub repo check ${repoFullName} ${getRes.status}: ${err.slice(0, 200)}`);
    }

    const login = await this.getAuthenticatedLogin();
    const isUserRepo = login && owner.toLowerCase() === login.toLowerCase();
    const url = isUserRepo
      ? "https://api.github.com/user/repos"
      : `https://api.github.com/orgs/${owner}/repos`;

    const createRes = await githubFetch(url, headers, {
      method: "POST",
      body: JSON.stringify({
        name,
        description: opts?.description ?? "AZZLE FORCE — Human Terminal miniapp",
        homepage: "https://azzle.org",
        private: false,
        auto_init: opts?.autoInit ?? true,
      }),
    });
    if (createRes.ok) return;

    const err = await createRes.text();
    if (createRes.status === 403) {
      // Repo may exist but PAT cannot create — caller will try upsert next
      console.warn(
        `[github] cannot auto-create ${repoFullName} (PAT lacks repo scope) — will try deploy anyway`
      );
      return;
    }
    throw new Error(`GitHub create ${repoFullName} ${createRes.status}: ${err.slice(0, 300)}`);
  }

  /** Enable GitHub Pages from branch root (no-op if already configured). */
  async enablePages(repoFullName: string, branch = "main"): Promise<void> {
    if (!this.token) return;
    const [owner, repo] = repoFullName.split("/");
    if (!owner || !repo) return;

    const headers = this.authHeaders();
    const res = await githubFetch(`https://api.github.com/repos/${owner}/${repo}/pages`, headers, {
      method: "POST",
      body: JSON.stringify({
        build_type: "legacy",
        source: { branch, path: "/" },
      }),
    });
    if (res.ok || res.status === 409) return;
    const err = await res.text();
    console.warn(`[github] Pages enable ${repoFullName}: ${res.status} ${err.slice(0, 120)}`);
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

  /** Upsert a text file on a branch (GitHub Contents API). */
  async upsertFile(
    repoFullName: string,
    branch: string,
    path: string,
    content: string,
    message?: string
  ): Promise<void> {
    if (!this.token) throw new Error("GITHUB_TOKEN required for deploy");
    const [owner, repo] = repoFullName.split("/");
    if (!owner || !repo) throw new Error(`Invalid repo: ${repoFullName}`);

    const headers = this.authHeaders();
    const encodedPath = path.split("/").map(encodeURIComponent).join("/");
    const getUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${encodedPath}?ref=${encodeURIComponent(branch)}`;

    let sha: string | undefined;
    const getRes = await githubFetch(getUrl, headers);
    if (getRes.ok) {
      const data = (await getRes.json()) as { sha?: string };
      sha = data.sha;
    } else if (getRes.status !== 404) {
      const err = await getRes.text();
      throw new Error(`GitHub GET ${path} ${getRes.status}: ${err.slice(0, 200)}`);
    }

    const putUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${encodedPath}`;
    const body: Record<string, unknown> = {
      message: message ?? `azzle-force: update ${path}`,
      content: Buffer.from(content, "utf8").toString("base64"),
      branch,
    };
    if (sha) body.sha = sha;

    const putRes = await githubFetch(putUrl, headers, {
      method: "PUT",
      body: JSON.stringify(body),
    });
    if (!putRes.ok) {
      const err = await putRes.text();
      if (putRes.status === 403) {
        throw new Error(
          `GitHub PAT cannot write to ${repoFullName} (needs Contents: Read and write). ` +
            `Edit your fine-grained token at github.com/settings/tokens → ` +
            `Repository access: ${repoFullName} → Permissions → Contents: Read and write`
        );
      }
      if (putRes.status === 404) {
        throw new Error(
          `GitHub cannot write ${path} — repo ${repoFullName} not found or PAT lacks access. ` +
            `Set GITHUB_PAGES_REPO=azzleforce/azzleforce and grant Contents write on that repo.`
        );
      }
      throw new Error(`GitHub PUT ${path} ${putRes.status}: ${err.slice(0, 300)}`);
    }
  }

  /** Derive GitHub Pages base URL for a repo. */
  pagesBaseUrl(repoFullName: string): string {
    const [owner, repo] = repoFullName.split("/");
    if (!owner || !repo) return "";
    if (repo === `${owner}.github.io`) return `https://${owner}.github.io/`;
    return `https://${owner}.github.io/${repo}/`;
  }
}
