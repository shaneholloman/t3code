/**
 * Adds the nullable `provider_instance_id` routing column to
 * `provider_session_runtime`.
 *
 * Slice D of the provider-array refactor splits "driver kind" from
 * "configured instance". Existing rows have only the driver name in
 * `provider_name`; new rows additionally carry the user-defined instance
 * routing key. Reads fall back to the default instance for the driver
 * (`defaultInstanceIdForDriver(provider_name)`) when this column is NULL,
 * which preserves continuity for sessions started before the migration ran.
 *
 * The column is nullable on purpose — backfilling it during the migration
 * would require knowing which configured instance "owned" each historical
 * session, and that mapping is ambiguous when the user later configures
 * multiple instances of the same driver. Letting the application layer
 * resolve the fallback per row keeps the migration cheap and reversible.
 */
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as Effect from "effect/Effect";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    ALTER TABLE provider_session_runtime
    ADD COLUMN provider_instance_id TEXT
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_provider_session_runtime_instance
    ON provider_session_runtime(provider_instance_id)
  `;
});
