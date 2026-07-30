export const SIMULATION_CONNECTION_KEY = "workspace-simulation";

/**
 * Environment isolation for filed-email reads.
 *
 * WS-18 removed the single-connection filter so a project's filed emails are
 * found by project rather than by whichever mailbox filed them — correct, and
 * the prerequisite for per-user Gmail. But dropping the predicate entirely also
 * merged the two ENVIRONMENTS: simulation archives are written under the
 * `workspace-simulation` connection into the same table, so a live deployment
 * began reporting simulated filings as real evidence, and a simulation reset
 * could no longer purge rows the live reads had adopted.
 *
 * The fix is a scope, not a key. Live reads exclude the simulation connection;
 * simulation reads see only it. That keeps reads open across ANY number of real
 * connections — which is the whole point of WS-18 and what per-user mailboxes
 * will need — while never mixing pretend data into real answers.
 */
export function archiveScope(simulation: boolean, column = "connection_key") {
  return simulation
    ? { clause: `${column} = ?`, bindings: [SIMULATION_CONNECTION_KEY] as unknown[] }
    : { clause: `${column} <> ?`, bindings: [SIMULATION_CONNECTION_KEY] as unknown[] };
}
