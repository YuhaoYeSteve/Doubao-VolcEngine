---
name: "smart-push"
description: "Updates README.md with changelog/version info, PREVIEWS it for user approval, then pushes to GitHub. Invoke when user asks to push code, release version, or sync to remote."
---

# Smart Push with README Update

This skill augments the standard git push workflow by ensuring documentation is kept in sync with code changes.

## Workflow

When the user requests to push code or release a version:

1.  **Analyze Recent Changes**:
    *   Check `git log` for recent commits that haven't been pushed.
    *   Check staged/unstaged changes.
2.  **Draft Changelog**:
    *   Summarize the changes (features, fixes, refactors).
    *   Determine the new version number if applicable (or just use the date).
3.  **Update README.md**:
    *   Read `README.md`.
    *   Insert the changelog/updates in a dedicated "Recent Updates" or "Changelog" section.
    *   Ensure the format matches the existing file style.
4.  **Preview and Confirm (CRITICAL)**:
    *   **STOP** and show the user the updated `README.md` content or the diff.
    *   **Ask for explicit confirmation** (e.g., "Does this changelog look good? Should I proceed with the push?").
    *   **Do NOT** run git commit or push until the user says "yes" or "confirm".
5.  **Commit Documentation**:
    *   (Only after confirmation)
    *   `git add README.md`
    *   `git commit -m "docs: update README with latest changes"`
6.  **Push**:
    *   (Only after confirmation)
    *   Execute `git push`.

## Usage
*   Trigger this skill when the user says "push the code", "upload to github", or "release new version".
