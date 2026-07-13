import { rollup } from "rollup";
import config from "../rollup.config.mjs";

const bundle = await rollup(config);
try {
  await bundle.write(config.output);
} finally {
  await bundle.close();
}

// Node 26 can retain a macOS CFRunLoop handle after Rollup has closed.
process.exit(0);
