/**
 * Mutation testing, run by hand about weekly (`npm run mutation`; review 2026-11-10 T17, plan 2.5): Stryker changes one
 * operator or constant at a time in six pure modules and runs the tests that cover it; a change no test notices is a
 * survivor, a place where the suite is green whatever the code says. Goal: fewer than 10 survivors.
 *
 * In place, not in a sandbox copy (the working tree is 6 GB of local data): Stryker puts every file back when it ends
 * or is stopped with Ctrl+C. Run nothing else in the repo meanwhile (no gate, no dev server); after a crash,
 * `git diff -- src` shows a file it left changed. Two runners keep the PC usable. The report lands in
 * node_modules/.cache/edexo-stryker/.
 *
 * A single module: `npx stryker run --mutate src/server/atomicWrite.ts`.
 */
export default {
  testRunner: "vitest",
  plugins: ["@stryker-mutator/vitest-runner"],
  mutate: [
    "src/server/matchSpeciesBands.ts",
    "src/server/organicValue.ts",
    "src/server/organicTracking.ts",
    "src/server/atomicWrite.ts",
    "src/server/updateCheck.ts",
    "src/server/presenceFloors.ts",
  ],
  inPlace: true,
  concurrency: 2,
  /*
    "all", not "perTest": per-test coverage under vitest 5 tied mutants to the wrong tests (an empty retry set in
    atomicWrite.ts "survived" although atomicWriteFaults.test.ts fails on it; 2026-11-11). Every covered mutant runs
    the tests related to its file instead.
  */
  coverageAnalysis: "all",
  reporters: ["clear-text", "progress", "html", "json"],
  htmlReporter: { fileName: "node_modules/.cache/edexo-stryker/report.html" },
  jsonReporter: { fileName: "node_modules/.cache/edexo-stryker/report.json" },
  tempDirName: "node_modules/.cache/stryker-tmp",
  cleanTempDir: "always",
  thresholds: { high: 90, low: 75, break: null },
  vitest: { configFile: "vitest.config.ts", related: true },
};
