// Read-only GitHub URL inspection for research leads found in Discord.
// Public GitHub API only in this first slice: no cloning, writes, or token
// handling. Private repositories can be added later through a separate
// explicitly authenticated GitHub connector.
const API_BASE = "https://api.github.com";
const MAX_TEXT = 16_000;
export class GitHubResearchError extends Error {
    status;
    constructor(message, status = 400) {
        super(message);
        this.status = status;
    }
}
function targetFromUrl(raw) {
    let url;
    try {
        url = new URL(raw);
    }
    catch {
        throw new GitHubResearchError("GitHub inspection needs a valid https://github.com URL.");
    }
    if (url.protocol !== "https:" || !["github.com", "www.github.com"].includes(url.hostname.toLowerCase())) {
        throw new GitHubResearchError("Only github.com links are supported by the read-only inspector.");
    }
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length < 2)
        throw new GitHubResearchError("The GitHub URL does not contain an owner and repository.");
    const owner = parts[0];
    const repo = parts[1].replace(/\.git$/, "");
    if (!/^[A-Za-z0-9_.-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(repo)) {
        throw new GitHubResearchError("The GitHub URL contains an unsupported repository name.");
    }
    if (parts[2] === "issues" && /^\d+$/.test(parts[3] ?? ""))
        return { kind: "issue", owner, repo, number: parts[3] };
    if (parts[2] === "pull" && /^\d+$/.test(parts[3] ?? ""))
        return { kind: "pull", owner, repo, number: parts[3] };
    if ((parts[2] === "blob" || parts[2] === "tree") && parts.length >= 5) {
        return { kind: parts[2], owner, repo, ref: parts[3], path: parts.slice(4).join("/") };
    }
    return { kind: "repo", owner, repo };
}
async function githubApi(path) {
    const response = await fetch(`${API_BASE}${path}`, {
        headers: { accept: "application/vnd.github+json", "user-agent": "OpenMausBot-read-only-research" },
        signal: AbortSignal.timeout(30_000),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
        if (response.status === 404)
            throw new GitHubResearchError("That GitHub resource is private, missing, or unavailable anonymously.", 404);
        throw new GitHubResearchError(`GitHub API request failed (${response.status}).`, response.status);
    }
    return body;
}
function trimText(value) {
    const text = typeof value === "string" ? value : "";
    return text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}\n[truncated]` : text;
}
export async function inspectGitHubUrl(raw) {
    const target = targetFromUrl(raw);
    const base = `/repos/${encodeURIComponent(target.owner)}/${encodeURIComponent(target.repo)}`;
    if (target.kind === "repo") {
        const repo = await githubApi(base);
        return {
            kind: target.kind,
            url: repo.html_url,
            owner: repo.owner?.login ?? target.owner,
            repository: repo.name ?? target.repo,
            description: repo.description ?? null,
            defaultBranch: repo.default_branch ?? null,
            language: repo.language ?? null,
            stars: repo.stargazers_count ?? null,
            forks: repo.forks_count ?? null,
            openIssues: repo.open_issues_count ?? null,
            topics: Array.isArray(repo.topics) ? repo.topics.slice(0, 30) : [],
            updatedAt: repo.updated_at ?? null,
        };
    }
    if (target.kind === "issue" || target.kind === "pull") {
        const item = await githubApi(`${base}/${target.kind === "pull" ? "pulls" : "issues"}/${target.number}`);
        const result = {
            kind: target.kind,
            url: item.html_url,
            number: item.number,
            title: item.title,
            state: item.state,
            author: item.user?.login ?? null,
            body: trimText(item.body),
            labels: Array.isArray(item.labels) ? item.labels.slice(0, 30).map((label) => label.name) : [],
            comments: item.comments ?? 0,
            createdAt: item.created_at ?? null,
            updatedAt: item.updated_at ?? null,
        };
        if (target.kind === "pull") {
            result.base = item.base?.ref ?? null;
            result.head = item.head?.ref ?? null;
            result.changedFiles = item.changed_files ?? null;
            result.additions = item.additions ?? null;
            result.deletions = item.deletions ?? null;
            result.patchUrl = item.patch_url ?? null;
        }
        return result;
    }
    const content = await githubApi(`${base}/contents/${target.path.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(target.ref)}`);
    if (target.kind === "tree" || content.type === "dir") {
        return {
            kind: "tree",
            url: raw,
            path: target.path,
            entries: Array.isArray(content) ? content.slice(0, 100).map((entry) => ({ name: entry.name, type: entry.type, path: entry.path, url: entry.html_url })) : [],
        };
    }
    if (content.type !== "file" || typeof content.content !== "string")
        throw new GitHubResearchError("That GitHub link is not a readable file or directory.");
    const decoded = Buffer.from(content.content.replace(/\s/g, ""), "base64").toString("utf8");
    return { kind: "file", url: raw, path: content.path, encoding: "utf-8", content: trimText(decoded) };
}
export const _internal = { targetFromUrl, trimText };
