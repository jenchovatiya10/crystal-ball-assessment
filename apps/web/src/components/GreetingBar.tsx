type GreetingBarProps = {
  title?: string;
  subtitle?: string;
};

/**
 * Presentational greeting chrome for Replay Greeting mode.
 * No API calls or business logic here.
 */
export function GreetingBar({
  title = "Replay Greeting",
  subtitle = "A deterministic greeting will appear here once connected to the API.",
}: GreetingBarProps) {
  return (
    <section className="greeting-bar" aria-label="Greeting">
      <p className="greeting-bar-kicker">Live queue pulse</p>
      <h2 className="greeting-bar-title">{title}</h2>
      <p className="greeting-bar-subtitle">{subtitle}</p>
    </section>
  );
}
