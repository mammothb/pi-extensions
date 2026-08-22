/**
 * Single source of truth for the package version, used as the
 * `InstrumentationScope.version` on emitted telemetry.
 *
 * Derived from package.json so it cannot drift from the published version —
 * a changeset bump (Phase 6) updates the version in one place only.
 */
import pkg from "../package.json";

export const PI_OTEL_VERSION: string = pkg.version;
