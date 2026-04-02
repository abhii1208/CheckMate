import { NavLink } from 'react-router-dom';

const navItems = [
  { to: '/scanner', label: 'Inventory Manager', icon: '📦' },
  { to: '/reports', label: 'Logs & Export', icon: '🧾' },
];

function Sidebar() {
  return (
    <aside className="sidebar">
      <div className="brand-block">
        <img src="/checkmate-logo.svg" alt="CheckMate logo" className="brand-logo" />
        <div>
          <h2>CheckMate</h2>
          <p>Inventory manager</p>
        </div>
      </div>

      <nav className="sidebar-nav">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
          >
            <span>{item.icon}</span>
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>

      <div className="sidebar-note">
        <strong>Simple 4-step flow</strong>
        <span>Import data, scan product, update quantity, download Excel.</span>
      </div>
    </aside>
  );
}

export default Sidebar;
