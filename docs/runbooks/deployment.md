# Deploy the private Sites app

This is the owner-facing procedure for deploying the private ChatGPT Sites app
from GitHub and leaving one reliable record of what was deployed.

> **Merging is not deploying.** Merged code remains inert in `main` until the
> owner asks ChatGPT to deploy it.

## Procedure

1. **Choose the reviewed source.** Identify the exact GitHub branch and commit
   that the owner wants to deploy.
2. **Ask ChatGPT to deploy the private Sites app from GitHub.** The owner asks
   ChatGPT to deploy the private Sites app from GitHub; that request starts every
   deployment explicitly. There is no GitHub Actions deployment pipeline:
   [`.github/workflows/cloud-run-image.yml`](../../.github/workflows/cloud-run-image.yml)
   builds source images and can publish an image on an approved manual dispatch,
   but the workflow states that it does not deploy Cloud Run or execute a Job.
3. **Supply both build-time values to the Sites build.** They are an
   all-or-nothing pair defined by
   [`build/build-information.mjs`](../../build/build-information.mjs):

   - `FCI_BUILD_COMMIT_SHA` — the hexadecimal short SHA for the selected source
     commit.
   - `FCI_BUILD_TIMESTAMP` — the build time as an ISO-8601 UTC timestamp in the
     form `YYYY-MM-DDTHH:mm:ssZ`.

   A partial pair is rejected by the build. If neither value is supplied, the
   Settings card honestly renders **Build identifier unavailable**.
4. **Record the result as a new comment on
   [GitHub issue #258](https://github.com/OneStreamerNE98/FCI-Brett/issues/258).**
   Do not replace the issue body or edit an older entry. Use this complete
   template so the chronological deployment log remains self-sufficient:

   ```markdown
   - **Deployed:** <YYYY-MM-DD h:mm AM/PM EST or EDT> (`<YYYY-MM-DDTHH:mm:ssZ>`)
   - **Source:** `<exact source branch>` at `<exact commit SHA>`
   - **Sites version:** <Sites version>
   - **Result:** <Succeeded or Failed>
   - **Live URL:** <live URL>
   - **Impact:** Source files: <changed or unchanged>; hosted configuration: <changed or unchanged>; migrations: <changed or unchanged>; live data: <changed or unchanged>.
   ```

5. **Verify the build stamp.** Open **Settings → Data & security** in the
   deployed app and confirm that its short commit SHA matches the source SHA in
   the new issue #258 comment. If the card reads **Build identifier
   unavailable**, the build variables were not supplied and the issue #258
   deployment record is the only remaining source of truth. Do not claim the
   on-screen verification passed.

The repository does not maintain a second statement of what is live. Read the
newest issue #258 entry whenever the deployed state must be established.
