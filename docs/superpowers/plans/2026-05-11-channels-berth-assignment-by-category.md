# Channels — Berth Assignment by Category Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the per-berth channel assignment table in the Channels screen with a per-category dropdown list, and remove the pier filter.

**Architecture:** Single file change (`Channels.jsx`). The parent `Channels` component fetches categories from the existing `/berths/berth-categories/` endpoint and passes them into `BerthGrid`. `BerthGrid` is refactored to render one row per category instead of a table of berths, with bulk-PATCH logic on dropdown change and a "Mixed" sentinel for split categories.

**Tech Stack:** React (functional components + hooks), existing `api` axios wrapper, existing `PATCH /berths/:id/` endpoint.

---

## File Map

- Modify: `frontend/src/screens/Channels.jsx`
  - `Channels` (lines 331–381): add categories state + fetch, remove `pierFilter` state, pass `categories` to `BerthGrid`
  - `BerthGrid` (lines 243–327): replace pier filter + table with category-row list + bulk-PATCH handler

---

### Task 1: Fetch categories in `Channels` parent and remove pier filter

**Files:**
- Modify: `frontend/src/screens/Channels.jsx`

- [ ] **Step 1: Add categories state and fetch**

  In the `Channels` function, replace:

  ```jsx
  const [berths, setBerths] = useState([]);
  const [berthsLoading, setBerthsLoading] = useState(true);
  const [pierFilter, setPierFilter] = useState('');
  ```

  with:

  ```jsx
  const [berths, setBerths] = useState([]);
  const [berthsLoading, setBerthsLoading] = useState(true);
  const [categories, setCategories] = useState([]);
  const [categoriesLoading, setCategoriesLoading] = useState(true);
  ```

- [ ] **Step 2: Add categories fetch alongside existing berths fetch**

  The existing `useEffect` fetches berths. Add a second `useEffect` directly after it:

  ```jsx
  useEffect(() => {
    api.get('/berths/berth-categories/')
      .then(r => setCategories(r.data.results ?? r.data))
      .catch(() => {})
      .finally(() => setCategoriesLoading(false));
  }, []);
  ```

- [ ] **Step 3: Include categoriesLoading in the loading gate**

  Replace:

  ```jsx
  if (marinaLoading || connsLoading || berthsLoading) {
  ```

  with:

  ```jsx
  if (marinaLoading || connsLoading || berthsLoading || categoriesLoading) {
  ```

- [ ] **Step 4: Update BerthGrid call — remove pier props, add categories**

  Replace the `BerthGrid` JSX:

  ```jsx
  <BerthGrid
    berths={berths}
    setBerths={setBerths}
    connections={connections}
    piersFilter={pierFilter}
    setPiersFilter={setPierFilter}
  />
  ```

  with:

  ```jsx
  <BerthGrid
    berths={berths}
    setBerths={setBerths}
    connections={connections}
    categories={categories}
  />
  ```

- [ ] **Step 5: Commit**

  ```bash
  git add frontend/src/screens/Channels.jsx
  git commit -m "feat(channels): fetch categories, remove pier filter state"
  ```

---

### Task 2: Refactor BerthGrid to category-based list

**Files:**
- Modify: `frontend/src/screens/Channels.jsx`

- [ ] **Step 1: Replace the entire BerthGrid function**

  Delete the current `BerthGrid` function (lines 243–327) and replace it with:

  ```jsx
  function BerthGrid({ berths, setBerths, connections, categories }) {
    const [saving, setSaving] = useState(null); // category id while saving

    function getCategoryValue(catId) {
      const catBerths = berths.filter(b => b.category === catId);
      if (catBerths.length === 0) return '';
      const unique = [...new Set(catBerths.map(b => b.ota_connection))];
      if (unique.length > 1) return '__mixed__';
      return unique[0] == null ? '' : String(unique[0]);
    }

    async function handleCategoryChange(catId, connId) {
      setSaving(catId);
      const catBerths = berths.filter(b => b.category === catId);
      try {
        await Promise.all(
          catBerths.map(b =>
            api.patch(`/berths/${b.id}/`, { ota_connection: connId })
              .then(({ data }) => data)
          )
        );
        setBerths(prev =>
          prev.map(b => b.category === catId ? { ...b, ota_connection: connId } : b)
        );
      } finally {
        setSaving(null);
      }
    }

    return (
      <div className="card">
        <div className="card-header">
          <div className="card-header-title">Berth Assignment</div>
        </div>
        <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {categories.map(cat => {
            const val = getCategoryValue(cat.id);
            const isMixed = val === '__mixed__';
            const isSaving = saving === cat.id;
            return (
              <div
                key={cat.id}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0' }}
              >
                <div style={{ fontSize: 13, fontWeight: 500 }}>{cat.name}</div>
                <select
                  value={val}
                  disabled={isSaving}
                  onChange={e => {
                    const v = e.target.value;
                    if (v === '__mixed__') return;
                    handleCategoryChange(cat.id, v ? Number(v) : null);
                  }}
                  style={{ fontSize: 12, padding: '3px 6px', borderRadius: 5, border: 'var(--border)' }}
                >
                  {isMixed && <option value="__mixed__" disabled>Mixed</option>}
                  <option value="">Direct</option>
                  {connections.map(c => (
                    <option key={c.id} value={String(c.id)}>{c.name}</option>
                  ))}
                </select>
              </div>
            );
          })}
        </div>
      </div>
    );
  }
  ```

- [ ] **Step 2: Verify the screen loads**

  Start the dev server (`npm run dev` or `vite` from `frontend/`) and open the Channels screen. Confirm:
  - "Berth Assignment" card appears on the right column
  - No pier filter dropdown in the card header
  - One row per category is visible
  - Dropdowns show "Direct", "Mixed", or a connection name correctly

- [ ] **Step 3: Test mixed state**

  If you have a marina with berths in the same category assigned to different channels, confirm the dropdown shows "Mixed" and is not a blank/error state.

- [ ] **Step 4: Test bulk assignment**

  Pick a category showing "Mixed" or any channel and change the dropdown to a different channel. Confirm:
  - Dropdown disables while saving
  - After save, all berths in that category show the new channel if you refresh
  - "Mixed" option disappears after picking a real channel

- [ ] **Step 5: Commit**

  ```bash
  git add frontend/src/screens/Channels.jsx
  git commit -m "feat(channels): replace berth table with per-category channel dropdowns"
  ```
