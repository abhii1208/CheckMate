import { useEffect, useState } from 'react';

import api from '../api';
import Loader from '../components/Loader';
import StatCard from '../components/StatCard';

function DashboardPage() {
  const [summary, setSummary] = useState({
    total_products: 0,
    matched_items: 0,
    mismatched_items: 0,
    pending_items: 0,
  });
  const [products, setProducts] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    const loadDashboard = async () => {
      try {
        const [summaryResponse, productsResponse] = await Promise.all([
          api.get('/dashboard'),
          api.get('/products'),
        ]);

        setSummary(summaryResponse.data);
        setProducts(productsResponse.data.slice(0, 8));
        setErrorMessage('');
      } catch (error) {
        setErrorMessage(error.userMessage || 'Failed to load dashboard data.');
      } finally {
        setIsLoading(false);
      }
    };

    loadDashboard();
  }, []);

  if (isLoading) {
    return <Loader label="Loading dashboard..." />;
  }

  return (
    <div className="page-stack">
      <section className="hero-card">
        <div>
          <span className="eyebrow">Operations overview</span>
          <h2>Track matches, mismatches, and pending stock checks in one place.</h2>
        </div>
        <button type="button" className="secondary-btn" onClick={() => window.location.reload()}>
          Refresh
        </button>
      </section>

      {errorMessage ? <div className="warning-banner">{errorMessage}</div> : null}

      <section className="stats-grid">
        <StatCard title="Total products" value={summary.total_products} tone="neutral" subtitle="Imported records" />
        <StatCard title="Matched items" value={summary.matched_items} tone="success" subtitle="Verified with no difference" />
        <StatCard title="Mismatched items" value={summary.mismatched_items} tone="danger" subtitle="Need review" />
        <StatCard title="Pending checks" value={summary.pending_items} tone="warning" subtitle="Not yet verified" />
      </section>

      <section className="panel">
        <div className="section-header">
          <div>
            <h3>Latest inventory snapshot</h3>
            <p>Most recent uploaded products and their verification status.</p>
          </div>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Product</th>
                <th>Barcode</th>
                <th>Expected</th>
                <th>Actual</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {products.length ? (
                products.map((product) => {
                  const difference = Number(product.difference || 0);
                  const verified = Boolean(product.last_verified_at);
                  const label = !verified ? 'Pending' : difference === 0 ? 'Match' : 'Mismatch';

                  return (
                    <tr key={product.id}>
                      <td>{product.name}</td>
                      <td>{product.barcode}</td>
                      <td>{product.expected_stock}</td>
                      <td>{product.actual_stock}</td>
                      <td>
                        <span
                          className={`badge ${
                            !verified ? 'badge-warning' : difference === 0 ? 'badge-success' : 'badge-danger'
                          }`}
                        >
                          {label}
                        </span>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan="5">Upload inventory data to populate the dashboard.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

export default DashboardPage;
