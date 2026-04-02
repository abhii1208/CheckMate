import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { useWorkflow } from '../WorkflowContext';

function ImportWorkflowPage() {
  const navigate = useNavigate();
  const {
    pageError,
    statusMessage,
    selectedFileName,
    secondaryFileName,
    previewRows,
    importedEntries,
    isUploading,
    importPrimaryFile,
    importSecondaryFile,
    uploadPrimaryToServer,
  } = useWorkflow();
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef(null);
  const secondaryFileInputRef = useRef(null);
  const primaryFileRef = useRef(null);

  const handlePrimaryChange = async (event) => {
    const file = event.target.files?.[0];
    primaryFileRef.current = file || null;
    await importPrimaryFile(file);
  };

  const handleSecondaryChange = async (event) => {
    const file = event.target.files?.[0];
    await importSecondaryFile(file);
  };

  const handleDrop = async (event) => {
    event.preventDefault();
    setIsDragOver(false);
    const file = event.dataTransfer?.files?.[0];
    primaryFileRef.current = file || null;
    await importPrimaryFile(file);
  };

  const handleImportNow = async () => {
    const ok = await uploadPrimaryToServer(primaryFileRef.current);

    if (ok) {
      navigate('/scan');
    }
  };

  const previewColumns = Object.keys(previewRows[0] || {});

  return (
    <div className="page-stack">
      <section className="panel workflow-panel">
        <div className="section-header">
          <div>
            <span className="eyebrow">Step 1</span>
            <h2>Import Primary Sheet</h2>
            <p>Upload your main sheet first, then optionally attach a second reference sheet for extra matching keys.</p>
          </div>
        </div>

        {pageError ? <div className="warning-banner">{pageError}</div> : null}
        {statusMessage ? <div className="success-banner">{statusMessage}</div> : null}
      </section>

      <section className="panel upload-surface">
        <div
          className={`import-inline-card ${isDragOver ? 'drag-active' : ''}`}
          onDragOver={(event) => {
            event.preventDefault();
            setIsDragOver(true);
          }}
          onDragLeave={() => setIsDragOver(false)}
          onDrop={handleDrop}
        >
          <div className="upload-icon-badge">+</div>
          <div className="import-inline-content">
            <h3>Main workflow import</h3>
            <p>Primary sheet becomes your main working file. Secondary sheet adds extra searchable fields like batch, stock, or location references.</p>
            <div className="button-row">
              <button type="button" className="primary-btn" onClick={() => fileInputRef.current?.click()}>
                Choose primary sheet
              </button>
              <button type="button" className="secondary-btn" onClick={() => secondaryFileInputRef.current?.click()} disabled={!importedEntries.length}>
                Add secondary sheet
              </button>
              <button type="button" className="secondary-btn" onClick={handleImportNow} disabled={!primaryFileRef.current || isUploading}>
                {isUploading ? 'Importing...' : 'Import to backend'}
              </button>
            </div>

            <input ref={fileInputRef} type="file" accept=".xlsx,.csv" hidden onChange={handlePrimaryChange} />
            <input ref={secondaryFileInputRef} type="file" accept=".xlsx,.csv" hidden onChange={handleSecondaryChange} />

            <div className="upload-meta">
              <span><strong>Primary:</strong> {selectedFileName}</span>
              <span><strong>Secondary:</strong> {secondaryFileName}</span>
              <span><strong>Rows loaded:</strong> {importedEntries.length || previewRows.length}</span>
            </div>

            {importedEntries.length ? (
              <div className="button-row">
                <button type="button" className="primary-btn" onClick={() => navigate('/scan')}>
                  Continue to Scan & Filter
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </section>

      {previewRows.length ? (
        <section className="panel">
          <div className="section-header">
            <div>
              <h3>Preview</h3>
              <p>Review the imported data before moving to scanning.</p>
            </div>
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  {previewColumns.map((column) => <th key={column}>{column}</th>)}
                </tr>
              </thead>
              <tbody>
                {previewRows.map((row, index) => (
                  <tr key={`preview-${index}`}>
                    {previewColumns.map((column) => <td key={`${column}-${index}`}>{String(row[column])}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  );
}

export default ImportWorkflowPage;
