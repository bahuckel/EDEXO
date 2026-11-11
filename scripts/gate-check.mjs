/**
 * First step of every `dist:*` script (plan 2.4): refuse to build a tree `npm run gate` has not passed.
 * EDEXO_SKIP_GATE=1 builds anyway, said out loud.
 */
import { stampProblem } from "./gateStamp.mjs";

const problem = stampProblem();
if (problem && process.env.EDEXO_SKIP_GATE === "1") {
  console.warn(`gate-check: ${problem}; building anyway (EDEXO_SKIP_GATE=1)`);
} else if (problem) {
  console.error(`gate-check: ${problem}. Run "npm run gate" first (or EDEXO_SKIP_GATE=1 to build without it).`);
  process.exit(1);
} else {
  console.log("gate-check: this tree passed the gate");
}
