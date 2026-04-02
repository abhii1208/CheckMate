import { NavLink } from 'react-router-dom';

const navItems = [
  { to: '/import', label: '1. Import', icon: 'I' },
  { to: '/scan', label: '2. Scan', icon: 'S' },
  { to: '/update', label: '3. Update', icon: 'U' },
  { to: '/export', label: '4. Export', icon: 'E' },
  { to: '/reports', label: 'Reports', icon: 'R' },
];

function Sidebar() {
  return (
    <aside className="sidebar">
      <div className="brand-block">
        <img src="/checkmate-logo.svg" alt="CheckMate logo" className="brand-logo" />
        <div>
          <h2>CheckMate</h2>
          <p>Inventory workflow</p>
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
        <strong>Workflow</strong>
        <span>Import sheet, scan and filter, update the correct row, then export the final file.</span>
      </div>
    </aside>
  );
}

export default Sidebar;
