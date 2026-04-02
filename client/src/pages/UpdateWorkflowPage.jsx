import { useNavigate } from 'react-router-dom';

import ProductCard from '../components/ProductCard';
import { useWorkflow } from '../WorkflowContext';

function UpdateWorkflowPage() {
  const navigate = useNavigate();
  const {
    product,
    importedEntries,
    pageError,
    statusMessage,
    sheetHeaders,
    duplicateOptions,
    selectedEntryId,
    selectDuplicateEntry,
    updateProductRowValue,
    saveSelectedRow,
    isSaving,
  } = useWorkflow();
  const updatedCount = importedEntries.filter((entry) => entry.isEdited || entry.updatedQuantity !== null).length;
  const pendingCount = importedEntries.filter((entry) => !entry.isEdited && entry.updatedQuantity === null).length;

  return (
    <div className="page-stack">
      <section className="panel workflow-panel">
        <div className="section-header">
          <div>
            <span className="eyebrow">Step 3</span>
            <h2>Update Matched Entry</h2>
            <p>The current values are already loaded here. Save and keep moving until all updates are complete, then finish.</p>
          </div>
          <div className="button-row">
            <button type="button" className="secondary-btn" onClick={() => navigate('/scan')}>
              Back to Scan
            </button>
            <button
              type="button"
              className="primary-btn"
              onClick={async () => {
                if (product) {
                  await saveSelectedRow();
                }
                navigate('/export');
              }}
            >
              Finish updates
            </button>
          </div>
        </div>
        {pageError ? <div className="warning-banner">{pageError}</div> : null}
        {statusMessage ? <div className="success-banner">{statusMessage}</div> : null}
      </section>

      <section className="stats-grid">
        <div className="stat-card success">
          <p>Updated entries</p>
          <h3>{updatedCount}</h3>
          <span>Entries already saved</span>
        </div>
        <div className="stat-card warning">
          <p>Pending entries</p>
          <h3>{pendingCount}</h3>
          <span>Entries still left to review</span>
        </div>
      </section>

      <ProductCard
        product={product}
        rowHeaders={product?.rowHeaders || sheetHeaders}
        onRowValueChange={updateProductRowValue}
        onSubmit={async () => {
          const ok = await saveSelectedRow();
          if (ok) {
            navigate('/scan');
          }
        }}
        isSaving={isSaving}
        duplicateOptions={duplicateOptions}
        selectedEntryId={selectedEntryId}
        onSelectEntry={selectDuplicateEntry}
      />

      <section className="panel">
        <div className="button-row">
          <button
            type="button"
            className="primary-btn"
            onClick={async () => {
              const ok = await saveSelectedRow();
              if (ok) {
                navigate('/scan');
              }
            }}
            disabled={!product || isSaving}
          >
            {isSaving ? 'Saving...' : 'Save & Next'}
          </button>
          <button
            type="button"
            className="secondary-btn"
            onClick={async () => {
              if (product) {
                await saveSelectedRow();
              }
              navigate('/export');
            }}
          >
            Finish updates
          </button>
        </div>
      </section>
    </div>
  );
}

export default UpdateWorkflowPage;
