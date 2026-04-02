function StatCard({ title, value, tone = 'neutral', subtitle }) {
  return (
    <article className={`stat-card ${tone}`}>
      <p>{title}</p>
      <h3>{value}</h3>
      {subtitle ? <span>{subtitle}</span> : null}
    </article>
  );
}

export default StatCard;
