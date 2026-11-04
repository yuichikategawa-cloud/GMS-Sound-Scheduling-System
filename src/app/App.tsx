/**
 * Application transition shell.
 *
 * Part 1 deliberately delegates to the preserved legacy application so the
 * reengineering foundation can ship without changing existing workflows.
 * Feature modules will replace this delegation incrementally in later parts.
 */
import LegacyApp from "../legacy/LegacyApp";

export default function App() {
  return <LegacyApp />;
}
