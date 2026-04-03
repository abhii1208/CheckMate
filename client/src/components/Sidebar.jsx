import { NavLink } from 'react-router-dom';

const navItems = [
  { to: '/import', label: 'Import', meta: 'Step 1' },
  { to: '/scan', label: 'Scan', meta: 'Step 2' },
  { to: '/update', label: 'Update', meta: 'Step 3' },
  { to: '/export', label: 'Export', meta: 'Step 4' },
  { to: '/reports', label: 'Reports', meta: 'History' },
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
            <span className="nav-dot" aria-hidden="true" />
            <span className="nav-copy">
              <strong className="nav-label">{item.label}</strong>
              <small className="nav-meta">{item.meta}</small>
            </span>
          </NavLink>
        ))}
      </nav>

      <div className="sidebar-note">
        <strong>Workflow</strong>
        <span>Import the sheet, scan or filter the exact entry, update the current values, then export the final file.</span>
      </div>
    </aside>
  );
}

export default Sidebar;
