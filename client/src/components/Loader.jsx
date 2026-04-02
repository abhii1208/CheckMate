function Loader({ label = 'Loading...' }) {
  return (
    <div className="loader-wrap">
      <div className="loader" />
      <span>{label}</span>
    </div>
  );
}

export default Loader;
