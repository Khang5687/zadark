# ZaDark Repository Instructions

## Releases

- Write release notes in concise, natural Vietnamese with full diacritics.
- Lead with user-visible changes. Prefer direct verbs such as `Thêm`, `Sửa`, and `Cải thiện`.
- Keep notes proportional: use a short bullet list for normal releases; add sections only when a large release genuinely needs them.
- Do not publish commit lists, internal architecture details, test counts, implementation jargon, marketing copy, or emojis.
- Mention requirements, download sizes, privacy implications, and limitations only when users need them to make a decision.
- Do not claim support or verification that was not actually completed.
- Use the title `ZaDark <version>` and a matching tag.
- Publish a normal GitHub release by default. Never mark a release as a prerelease unless the user explicitly asks for one.
- Show the final Vietnamese title and notes to the user for approval before publishing a release.

## Versioning

ZaDark uses `[two-digit year].[release sequence within that year]`.

- A new feature or regular release increments the yearly sequence: `26.2` -> `26.3`.
- A patch that only fixes the current release adds or increments a third component: `26.3` -> `26.3.1` -> `26.3.2`.
- Do not add a trailing `.0`, use calendar months as the sequence, or use SemVer major/minor meanings.
- Before choosing a version, fetch tags from upstream and origin and confirm that the version is unused.
- Keep the Git tag, GitHub release title, root `package.json`, `src/pc/package.json`, and every browser `manifest.json` version identical.
- Do not use `alpha`, `beta`, `rc`, `dev`, build metadata, or prerelease tags unless the user explicitly requests a prerelease.

## Release Procedure

1. Fetch and merge the latest `upstream/main` without discarding unrelated worktree changes.
2. Select and apply the version according to the rules above.
3. Run tests, build the project, and generate the required distribution artifacts.
4. Review the staged diff so unrelated files are not included.
5. Commit and push the release changes.
6. Present the final Vietnamese release draft for approval.
7. Create the GitHub release as a normal release after approval and upload every current-version artifact from `dist/` plus its complete checksum file. Source archives alone are not a complete release.
