// Runs the Firestore security-rules tests against the local emulator.
//
// The emulator needs a JVM. Homebrew installs openjdk "keg-only", i.e. not on
// PATH, and we would rather locate it here than ask every contributor to edit
// their shell config. Checks PATH first, then the usual install locations.

import { execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";

const CANDIDATE_DIRS = [
  process.env.JAVA_HOME ? `${process.env.JAVA_HOME}/bin` : null,
  "/opt/homebrew/opt/openjdk/bin",
  "/usr/local/opt/openjdk/bin",
  "/usr/lib/jvm/default-java/bin",
].filter(Boolean);

function javaOnPath() {
  try {
    execFileSync("java", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function resolveJavaDir() {
  if (javaOnPath()) return null; // already usable, no PATH change needed
  const found = CANDIDATE_DIRS.find((dir) => existsSync(`${dir}/java`));
  if (found) return found;

  console.error(
    "\nNo Java runtime found, and the Firestore emulator needs one.\n" +
      "Install a JDK, then re-run:\n" +
      "  macOS:  brew install openjdk\n" +
      "  Debian: sudo apt install default-jre\n",
  );
  process.exit(1);
}

const javaDir = resolveJavaDir();
const env = { ...process.env };
if (javaDir) env.PATH = `${javaDir}:${env.PATH}`;

const child = spawn(
  "npx",
  [
    "firebase",
    "emulators:exec",
    "--only",
    "firestore",
    "--project",
    "demo-pints-rules",
    // --test-concurrency=1 is required, not a preference. Every rules test file
    // calls clearFirestore() in beforeEach against one shared emulator; running
    // files in parallel means one file wipes the database mid-test in another.
    // Symptoms are a RESOURCE_EXHAUSTED error and a query that hangs for ~10s.
    "node --test --test-concurrency=1 test/rules/*.test.mjs",
  ],
  { env, stdio: "inherit" },
);

child.on("exit", (code) => process.exit(code ?? 1));
