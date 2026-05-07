import { useState } from 'react'

export default function LogicalPierDropdown({ value, logicalPiers, onSelect, onCreate }) {
  const [showCreate, setShowCreate] = useState(false)
  const [newName,    setNewName]    = useState('')
  const [newType,    setNewType]    = useState('pontoon')
  const [creating,   setCreating]   = useState(false)

  async function handleCreate() {
    if (!newName.trim()) return
    setCreating(true)
    try {
      const created = await onCreate({ name: newName.trim(), pier_type: newType, notes: '' })
      onSelect(created)
      setShowCreate(false)
      setNewName('')
    } finally {
      setCreating(false)
    }
  }

  const labelStyle = { fontSize: 10, color: 'rgba(0,0,0,0.4)', fontWeight: 600, letterSpacing: '0.5px', marginBottom: 3 }

  return (
    <div>
      <div style={labelStyle}>ASSIGN PIER</div>
      <select
        className="field-input"
        style={{ fontSize: 12, marginBottom: showCreate ? 8 : 0 }}
        value={value ?? ''}
        onChange={e => {
          if (e.target.value === '__create__') { setShowCreate(true); return }
          onSelect(logicalPiers.find(lp => lp.id === Number(e.target.value)) ?? null)
          setShowCreate(false)
        }}
      >
        <option value="">— Unassigned —</option>
        {logicalPiers.map(lp => (
          <option key={lp.id} value={lp.id}>{lp.name}</option>
        ))}
        <option value="__create__">+ Create new pier…</option>
      </select>

      {showCreate && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5, padding: '8px 10px', background: 'var(--bg)', borderRadius: 6, border: '1px solid rgba(0,0,0,0.09)' }}>
          <input
            className="field-input"
            style={{ fontSize: 12 }}
            placeholder="Pier name (e.g. North Dock)"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleCreate() }}
            autoFocus
          />
          <select
            className="field-input"
            style={{ fontSize: 12 }}
            value={newType}
            onChange={e => setNewType(e.target.value)}
          >
            <option value="pontoon">Pontoon</option>
            <option value="concrete">Concrete</option>
            <option value="steel">Steel</option>
          </select>
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              className="btn btn-primary btn-sm"
              style={{ flex: 1, fontSize: 11 }}
              onClick={handleCreate}
              disabled={creating || !newName.trim()}
            >
              {creating ? 'Creating…' : 'Create'}
            </button>
            <button
              className="btn btn-ghost btn-sm"
              style={{ fontSize: 11 }}
              onClick={() => { setShowCreate(false); setNewName('') }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
