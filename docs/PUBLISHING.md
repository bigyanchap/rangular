# Publishing to npm

The four packages are publish-shaped since 0.2.0: each builds its
own dist, scoped packages carry `publishConfig` access public,
and the CLI declares typescript as its runtime dependency. This
document is the release runbook. Nothing here has been run yet;
the first publish happens on the maintainer's word.

## Prerequisites

- An npm account that is a member of the `rangular-framework`
  organization (the scope owner).
- `npm login` completed in the terminal that will publish.
- A clean tree: `npm test` passes 100% (the test script builds
  every package before running the suite, so the dist output the
  tarballs carry is always fresh; `prepack` also rebuilds).

## Publish

Publish all four at the same version, in this order (order does
not matter technically, since no package depends on another at
runtime except apps depending on ui and runtime; the order below
keeps the story readable):

    npm publish --workspace @rangular-framework/runtime
    npm publish --workspace @rangular-framework/ui
    npm publish --workspace @rangular-framework/compiler
    npm publish --workspace @rangular-framework/cli

## Verify the publish

From a scratch directory, with nothing of the repo around:

    npm install -g @rangular-framework/cli
    rg init my-app --app
    cd my-app
    npm install
    npx expo start

The scaffolded app must carry caret-range dependencies on the
framework packages (published mode), and `rg build` must compile
its starter. Then remove the scratch app.

## Versioning

All four packages share one version and release together. A
change to generated code or to the scaffold's dependency shape
is a breaking change for generated apps and takes at least a
minor bump while the version is 0.x.
