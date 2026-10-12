# Releases

This page says how a version of KMO is made and published, and what the repository needs for that. It is for people who
work on KMO itself.

## One version for everything

The packages, the chart and the two images share one version. The file `.cz.toml` holds it, with the list of the files
that carry it: the five `package.json` files, the lockfile, the chart's `Chart.yaml` and the example ArgoCD application.
Only [Commitizen](https://commitizen-tools.github.io/commitizen/) changes these version numbers, and only Commitizen
writes `CHANGELOG.md`. Do not edit them by hand.

## How a version is made

Each piece of work is on a branch and ends in a pull request. Each merge to `main` runs the workflow
`.github/workflows/release.yml`, which has three jobs.

1. **Check.** The static checks and the unit tests.
2. **Bump.** Commitizen reads the commit messages since the last tag and decides the next version from their types. It
   writes the version into the files, adds to the changelog, makes one commit and one tag, `v<version>`, and pushes both
   to `main`.
3. **Publish.** Only when the bump made a version. It builds the two images and the chart from the new tag and pushes
   them.

The type of a commit decides the version:

| Type    | Effect while the version is `0.x`              |
| ------- | ---------------------------------------------- |
| `fix`   | Raises the patch number.                       |
| `feat`  | Raises the minor number.                       |
| `chore` | No version. Nothing is published.              |
| `!`     | A breaking change. It raises the minor number. |

So a merge that holds only `chore` commits makes no release. A hook checks each commit message on your computer;
`mise run setup` installs it.

The commit of the bump has `[skip ci]` in its message, so that it does not start the workflows again.

## What a release publishes

All three go to `ghcr.io`, under the owner of the repository:

- the image `kmo-receiver`, with the version as its tag;
- the image `kmo-certgen`, the program of the chart's Jobs, with the same tag;
- the chart `charts/kmo`, as an OCI artifact, with the same version.

The chart names both images by that tag. The packages are private while the repository is.

The end-to-end suites do not run in GitHub. Run `mise run test:e2e` before you ask for a merge.

## The checks on a pull request

The workflow `.github/workflows/ci.yml` runs on each pull request: the static checks, the unit tests and a build of the
chart. The build stops when the chart that Pepr generates has changed, or when the result holds a private key.

## The GitHub App

The bump job pushes a commit to `main`. When `main` has a rule that asks for a pull request or a check, the workflow's
own token cannot do that. A GitHub App can, when it is on the bypass list of the rule. An App is preferred to a personal
token: its tokens live for one hour and belong to no person.

The workflow reads two secrets of the repository, `APP_ID` and `APP_PRIVATE_KEY`. To set them up, once:

1. **Make the App, or use one that exists.** In GitHub: your settings, "Developer settings", "GitHub Apps", "New GitHub
   App". Give it a name and the address of the repository as its homepage. Clear "Active" under "Webhook". Under
   "Repository permissions", set "Contents" to "Read and write", and nothing else. Under "Where can this GitHub App be
   installed", choose "Only on this account".
2. **Read the App ID** on the page of the App. It is a number and not a secret.
3. **Make a private key.** On the same page, under "Private keys", choose "Generate a private key". The browser saves a
   `.pem` file. Do not put it in the repository.
4. **Install the App.** On the page of the App, choose "Install App", then the account, then "Only select repositories",
   then the repository of KMO.
5. **Store the two secrets.** With the GitHub command line, in the repository: `gh secret set APP_ID`, then paste the
   number; and `gh secret set APP_PRIVATE_KEY < path/to/the/file.pem`. Then delete the `.pem` file.
6. **Put the App on the bypass list**, when `main` has a ruleset: the settings of the repository, "Rules", "Rulesets",
   the ruleset of `main`, "Bypass list", "Add bypass".

`gh secret list` shows the two names and never the values.

Without the two secrets, the bump job fails at its first step, and nothing is published.

## Try the settings without a release

`uvx --from commitizen==4.19.2 cz bump --dry-run` says which version the next merge would make, and changes nothing.

To see the whole bump, make a copy of the working tree in a temporary folder, start a new Git repository there with one
`feat` commit, and run the same command without `--dry-run`. The copy gets the commit and the tag, and the real
repository stays as it is.

## Read next

- [Installing](installing.md) for how a cluster uses a release.
- [Commands](commands.md) for the tasks and the suites.
