# Vendored `@qamposer/react`

`qamposer-react-0.2.0-9488149.tgz` is the built `@qamposer/react` package from
[JanLahmann/qamposer-react](https://github.com/JanLahmann/qamposer-react), branch
`entangible`, commit `9488149` — the same build the app used as a git dependency
until 2026-10-17.

**Why vendored:** since 2026-10-16 npm can no longer install that git dependency.
Its prepare step (`npm install --force` + `npm run build` inside the clone) fails
with `git dep preparation failed … Cannot read properties of null (reading
'edgesOut')`, on Node 20 and on newer npm. A tarball of the built package
installs without running any scripts, so `npm ci` is reproducible again.
The tarball holds `dist/`, `LICENSE`, `README.md` and `package.json`, with the
lifecycle scripts (`prepare`, `prepublishOnly`) removed.

## Refreshing it after a change on the fork

From a checkout of the fork on the commit you want, with Node 20:

```sh
npm ci && npm run build
mkdir -p /tmp/qr/package
cp -R dist LICENSE README.md package.json /tmp/qr/package/
# drop the prepare/prepublishOnly scripts from /tmp/qr/package/package.json
COPYFILE_DISABLE=1 tar -C /tmp/qr --uid 0 --gid 0 -czf \
  <entangible>/pocket-app/vendor/qamposer-react-0.2.0-<sha>.tgz package
```

Then in `pocket-app/`: point `"@qamposer/react"` in `package.json` at
`file:vendor/qamposer-react-0.2.0-<sha>.tgz`, delete the old tarball, run
`npm install` to update the lockfile, and run the usual gates
(typecheck, vitest, build).
