import { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';

import api, { setAuthToken } from '../api';
import { useAuth } from '../AuthContext';
import Loader from '../components/Loader';

function ReportsPage() {
  const { auth } = useAuth();
  const [logs, setLogs] = useState([]);
  const [products, setProducts] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isExporting, setIsExporting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    if (auth?.token) setAuthToken(auth.token);
    const loadReports = async () => {
      try {
        const [logsResponse, productsResponse] = await Promise.all([
          api.get('/logs'),
          api.get('/products'),
        ]);
        setLogs(logsResponse.data);
        setProducts(productsResponse.data);
        setErrorMessage('');
      } catch (error) {
        setErrorMessage(error.userMessage || 'Failed to load reports.');
      } finally {
        setIsLoading(false);
      }
    };
    loadReports();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth]);

  const mismatches = useMemo(
    () =>
      products.filter(
        (product) => Boolean(product.last_verified_at) && Number(product.difference || 0) !== 0
      ),
    [products]
  );

  const handleDownload = async () => {
    try {
      setIsExporting(true);
      setErrorMessage('');

      if (!products.length) {
        setErrorMessage('There is no updated inventory data to export yet.');
        return;
      }

      const { utils, writeFile } = await import('xlsx');
      const exportRows = products.map((product) => ({
        name: product.name,
        barcode: product.barcode,
        original_quantity: product.expected_stock,
        updated_quantity: product.actual_stock,
        updated_entry:
          Number(product.difference || 0) !== 0
            ? `Changed from ${product.expected_stock} to ${product.actual_stock}`
            : 'No change',
        change: product.difference,
        last_verified_at: product.last_verified_at || '',
      }));

      const workbook = utils.book_new();
      const worksheet = utils.json_to_sheet(exportRows);
      utils.book_append_sheet(workbook, worksheet, 'Updated Inventory');
      writeFile(workbook, 'checkmate-updated-inventory.xlsx');
      toast.success('Updated inventory exported successfully.');
    } catch (error) {
      setErrorMessage(error.userMessage || 'Failed to export the updated inventory file.');
    } finally {
      setIsExporting(false);
    }
  };

  if (isLoading) {
    return <Loader label="Loading reports..." />;
  }

  return (
    <div className="page-stack">
      {errorMessage ? <div className="warning-banner">{errorMessage}</div> : null}

      <section className="panel">
        <div className="section-header">
          <div>
            <h2>Logs & export</h2>
            <p>Review mismatches and download the latest updated inventory as an Excel file.</p>
          </div>
          <button type="button" className="primary-btn" onClick={handleDownload} disabled={isExporting}>
            {isExporting ? 'Preparing export...' : 'Download updated Excel'}
          </button>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Product</th>
                <th>Barcode</th>
                <th>Original Qty</th>
                <th>Updated Qty</th>
                <th>Change</th>
              </tr>
            </thead>
            <tbody>
              {mismatches.length ? (
                mismatches.map((product) => (
                  <tr key={product.id}>
                    <td>{product.name}</td>
                    <td>{product.barcode}</td>
                    <td>{product.expected_stock}</td>
                    <td>{product.actual_stock}</td>
                    <td>{product.difference > 0 ? `+${product.difference}` : product.difference}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan="5">No mismatches recorded yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <div className="section-header">
          <div>
            <h3>Verification history</h3>
            <p>Latest stock updates stored in the audit log.</p>
          </div>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Timestamp</th>
                <th>Product</th>
                <th>Barcode</th>
                <th>Old stock</th>
                <th>New stock</th>
                <th>Difference</th>
              </tr>
            </thead>
            <tbody>
              {logs.length ? (
                logs.map((log) => (
                  <tr key={log.id}>
                    <td>{new Date(log.timestamp).toLocaleString()}</td>
                    <td>{log.product_name}</td>
                    <td>{log.barcode}</td>
                    <td>{log.old_stock}</td>
                    <td>{log.new_stock}</td>
                    <td>{log.difference > 0 ? `+${log.difference}` : log.difference}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan="6">No log entries yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

export default ReportsPage;
