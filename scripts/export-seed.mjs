import { writeFile } from "node:fs/promises";
import {
  world,
  references,
  holdout,
  AS_OF,
  DATASET_SEED,
  SHOWCASES,
} from "../legacy/data.mjs";
import { assess, fitBaseline, evaluate } from "../legacy/engine.mjs";
const baseline = fitBaseline(references);
await writeFile(
  new URL("../backend/data/seed.json", import.meta.url),
  JSON.stringify({
    world,
    references,
    holdout,
    asOf: AS_OF,
    seed: DATASET_SEED,
    showcases: SHOWCASES,
  }),
);
await writeFile(
  new URL("../backend/data/parity.json", import.meta.url),
  JSON.stringify({
    baseline,
    assessments: world.population.map((p) =>
      assess(p, world.population, baseline),
    ),
    holdoutAssessments: holdout.population.map((p) =>
      assess(p, holdout.population, baseline),
    ),
    metrics: evaluate(holdout.population, holdout.truth, baseline),
  }),
);
console.log(
  "Exported reproducible synthetic cohorts and original scoring fixtures.",
);
