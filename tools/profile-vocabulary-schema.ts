// Regenerates profiles/profile.schema.json from profiles/vocabulary.yaml (PLT-84).
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { profileSchema } from "../src/profile-vocabulary.ts";
const out = join(fileURLToPath(new URL("..", import.meta.url)), "profiles", "profile.schema.json");
writeFileSync(out, JSON.stringify(profileSchema(), null, 2) + "\n");
console.log("wrote " + out);
