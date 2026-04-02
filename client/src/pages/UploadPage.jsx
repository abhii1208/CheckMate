import { useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';

import api from '../api';

function formatFileSize(bytes) {
  if (!bytes) {
    return '0 KB';
  }

  return `${(bytes / 1024).toFixed(1)} KB`;
}

function UploadPage() {
  const inputRef = useRef(null);
  const [file, setFile] = useState(null);
  const [previewRows, setPreviewRows] = useState([]);
  const [isUploading, setIsUploading] = useState(false);
  const [result, setResult] = useState(null);
  const [previewError, setPreviewError] = useState('');
  const [serverError, setServerError] = useState('');

  const columns = useMemo(() => Object.keys(previewRows[0] || {}), [previewRows]);
  const canUpload = Boolean(file) && previewRows.length > 0;

  const handleFileChange = async (event) => {
    const selectedFile = event.target.files?.[0];
    setFile(selectedFile || null);
    setResult(null);
    setServerError('');
    setPreviewError('');

    if (!selectedFile) {
      setPreviewRows([]);
      return;
    }

    const isSupported = /\.(xlsx|csv)$/i.test(selectedFile.name);
    if (!isSupported) {
      setPreviewRows([]);
      setPreviewError('Please choose a valid .xlsx or .csv file.');
      return;
    }

    try {
      const { read, utils } = await import('xlsx');
      const buffer = await selectedFile.arrayBuffer();
      const workbook = read(buffer, { type: 'array' });
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = utils.sheet_to_json(firstSheet, { defval: '' });

      if (!rows.length) {
        setPreviewRows([]);
        setPreviewError('The file is empty or the first sheet has no readable rows.');
        return;
      }

      setPreviewRows(rows.slice(0, 10));
    } catch (error) {
      setPreviewRows([]);
      setPreviewError('Failed to preview the selected spreadsheet. Please try another file.');
    }
  };

  const handleUpload = async () => {
    if (!file) {
      setServerError('Choose a file first before importing inventory.');
      return;
    }

    const formData = new FormData();
    formData.append('file', file);

    try {
      setIsUploading(true);
      setServerError('');
      const response = await api.post('/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });

      setResult(response.data);
      toast.success(response.data.message || 'Inventory uploaded successfully.');
    } catch (error) {
      setServerError(error.userMessage || 'Upload failed.');
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="page-stack">
      <section className="panel upload-surface">
        <div className="section-header">
          <div>
            <h2>Import inventory</h2>
            <p>Clean, fast uploads for `.xlsx` and `.csv` files with instant preview before sync.</p>
          </div>
        </div>

        <div className="upload-hero-grid">
          <div className="upload-dropzone">
            <div className="upload-icon-badge">↑</div>
            <h3>Choose stock file</h3>
            <p>Use any barcode/code column. Quantity columns are detected automatically where available.</p>

            <div className="button-row">
              <button type="button" className="primary-btn" onClick={() => inputRef.current?.click()}>
                Select file
              </button>
              <button type="button" className="secondary-btn" onClick={handleUpload} disabled={!canUpload || isUploading}>
                {isUploading ? 'Importing...' : 'Import inventory'}
              </button>
            </div>

            <input ref={inputRef} type="file" accept=".xlsx,.csv" onChange={handleFileChange} hidden />

            <div className="upload-meta">
              <span><strong>File:</strong> {file?.name || 'No file selected'}</span>
              <span><strong>Size:</strong> {formatFileSize(file?.size)}</span>
            </div>
          </div>

          <div className="upload-side-card">
            <h4>Import checklist</h4>
            <ul>
              <li>Use the first sheet for inventory data</li>
              <li>Keep barcodes unique per row</li>
              <li>Use integer values for `expected_stock`</li>
              <li>Review the preview before importing</li>
            </ul>
          </div>
        </div>

        {previewError ? <div className="warning-banner">{previewError}</div> : null}
        {serverError ? <div className="warning-banner">{serverError}</div> : null}
        {previewRows.length ? <div className="neutral-banner">Preview loaded. You can import this file now.</div> : null}
        {result ? <div className="success-banner">{result.message}</div> : null}
      </section>

      <section className="panel">
        <div className="section-header">
          <div>
            <h3>Preview before save</h3>
            <p>First 10 rows from the selected file.</p>
          </div>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                {columns.length ? columns.map((column) => <th key={column}>{column}</th>) : <th>Preview</th>}
              </tr>
            </thead>
            <tbody>
              {previewRows.length ? (
                previewRows.map((row, index) => (
                  <tr key={`${row.barcode || 'row'}-${index}`}>
                    {columns.map((column) => (
                      <td key={`${column}-${index}`}>{String(row[column])}</td>
                    ))}
                  </tr>
                ))
              ) : (
                <tr>
                  <td className="table-empty">
                    {file ? 'No readable rows found in the selected file.' : 'Select a file to preview its contents here.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

export default UploadPage;
