import { join } from "node:path";

import { default as swisseph } from "swisseph";

/**
 * Resolved against this file, not the working directory.
 *
 * A relative path here pointed one level above the project root, so the committed
 * .se1 files were never found and swisseph fell back to its built-in Moshier
 * ephemeris — silently, since a missing path is not an error.
 */
swisseph.swe_set_ephe_path(join(import.meta.dirname, "../assets/ephe"));

export default swisseph;
