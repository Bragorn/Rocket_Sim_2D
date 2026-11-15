/* =====================================================================
   RUN ALL TESTS  (tests/run-all.js)
   Runs every file in tests/ that ends in -tests.js, one after another, and
   prints one line for each plus the checks that failed.
   Needs Node.js. From the project folder:   node tests/run-all.js
   ===================================================================== */
const { spawnSync } = require("child_process"), fs = require("fs"), path = require("path");
const files = fs.readdirSync(__dirname).filter((f) => /-tests\.js$/.test(f)).sort();
let failedFiles = 0, total = 0, passed = 0;
for (const f of files) {
  const r = spawnSync(process.execPath, [path.join(__dirname, f)], { encoding: "utf8" });
  const out = (r.stdout || "") + (r.stderr || "");
  const ok = (out.match(/^\s+PASS /gm) || []).length, fails = out.split("\n").filter((l) => /^\s+FAIL /.test(l));
  total += ok + fails.length; passed += ok;
  const clean = r.status === 0 && fails.length === 0;
  if (!clean) failedFiles++;
  console.log((clean ? "  OK    " : "  FAIL  ") + f + "  (" + ok + " of " + (ok + fails.length) + " checks)");
  for (const l of fails) console.log("        " + l.trim());
  if (r.status !== 0 && fails.length === 0) console.log("        the file stopped with an error:\n" + out.split("\n").slice(-12).map((l) => "        " + l).join("\n"));
}
console.log("\n" + (failedFiles === 0 ? "ALL " + files.length + " TEST FILES PASSED (" + passed + " checks)" : failedFiles + " OF " + files.length + " TEST FILES FAILED (" + passed + " of " + total + " checks passed)"));
process.exit(failedFiles === 0 ? 0 : 1);
