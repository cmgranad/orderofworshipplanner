import { useState, useEffect } from 'react'
import { supabase } from './supabase'
import jsPDF from 'jspdf'

const STANDARD = 'standard'
const NONSTANDARD = 'nonstandard'

const DEFAULT_ITEMS = [
  { type: STANDARD, title: 'Prelude', position: 0, notes: '', script: '', fill_in: {} },
  { type: STANDARD, title: 'Welcome & Announcements', position: 1, notes: '', script: '', fill_in: {} },
  { type: NONSTANDARD, title: 'Centering Song', position: 2, notes: '', script: '', fill_in: { song: '', artist: '', key: '' } },
  { type: STANDARD, title: 'Call to Worship', position: 3, notes: '', script: '', fill_in: {} },
  { type: NONSTANDARD, title: 'Choir Anthem', position: 4, notes: '', script: '', fill_in: { song: '', artist: '', key: '' } },
  { type: STANDARD, title: 'Prayer of Dedication', position: 5, notes: '', script: '', fill_in: {} },
  { type: NONSTANDARD, title: 'Special Music', position: 6, notes: '', script: '', fill_in: { song: '', artist: '', performer: '' } },
  { type: STANDARD, title: 'Offertory', position: 7, notes: '', script: '', fill_in: {} },
  { type: STANDARD, title: 'Communion', position: 8, notes: '', script: '', fill_in: {} },
  { type: STANDARD, title: 'Postlude', position: 9, notes: '', script: '', fill_in: {} },
]

export default function App() {
  const [session, setSession] = useState(null)
  const [email, setEmail] = useState('')
  const [magicSent, setMagicSent] = useState(false)
  const [items, setItems] = useState([])
  const [comments, setComments] = useState({})
  const [expanded, setExpanded] = useState({})
  const [serviceDate, setServiceDate] = useState(() => {
    const d = new Date()
    const day = d.getDay()
    const diff = (7 - day) % 7 || 7
    d.setDate(d.getDate() + diff)
    return d.toISOString().split('T')[0]
  })
  const [saveStatus, setSaveStatus] = useState('Synced')
  const [dragSrcId, setDragSrcId] = useState(null)
  const [showExportModal, setShowExportModal] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => setSession(session))
    supabase.auth.onAuthStateChange((_event, session) => setSession(session))
  }, [])

  useEffect(() => {
    if (session) loadItems()
  }, [session, serviceDate])

  async function loadItems() {
    const { data, error } = await supabase.from('service_items').select('*').eq('service_date', serviceDate).order('position')
    if (error) return
    if (data.length === 0) {
      const toInsert = DEFAULT_ITEMS.map(i => ({ ...i, service_date: serviceDate }))
      const { data: inserted } = await supabase.from('service_items').insert(toInsert).select()
      setItems(inserted || [])
    } else {
      setItems(data)
      data.forEach(item => loadComments(item.id))
    }
  }

  async function loadComments(itemId) {
    const { data } = await supabase.from('comments').select('*').eq('item_id', itemId).order('created_at')
    if (data) setComments(prev => ({ ...prev, [itemId]: data }))
  }

  async function sendMagicLink() {
    const { error } = await supabase.auth.signInWithOtp({ email })
    if (error) alert(error.message)
    else setMagicSent(true)
  }

  async function saveItem(item) {
    setSaveStatus('Saving...')
    const { error } = await supabase.from('service_items').update({
      title: item.title, notes: item.notes, script: item.script, fill_in: item.fill_in, position: item.position
    }).eq('id', item.id)
    if (error) console.error(error)
    else setSaveStatus('Synced')
  }

  function updateItem(id, field, value) {
    setItems(prev => {
      const updated = prev.map(i => i.id === id ? { ...i, [field]: value } : i)
      const item = updated.find(i => i.id === id)
      clearTimeout(window._saveTimer)
      window._saveTimer = setTimeout(() => saveItem(item), 800)
      return updated
    })
  }

  function updateFillIn(id, field, value) {
    setItems(prev => {
      const updated = prev.map(i => i.id === id ? { ...i, fill_in: { ...i.fill_in, [field]: value } } : i)
      const item = updated.find(i => i.id === id)
      clearTimeout(window._saveTimer)
      window._saveTimer = setTimeout(() => saveItem(item), 800)
      return updated
    })
  }

  async function addComment(itemId, body, parentId = null) {
    if (!body.trim()) return
    const { error } = await supabase.from('comments').insert({
      item_id: itemId, parent_id: parentId, author_email: session.user.email,
      author_name: session.user.email.split('@')[0], body,
    })
    if (!error) loadComments(itemId)
  }

  async function addItem() {
    const title = prompt('Item title:')
    if (!title) return
    const type = window.confirm('Is this a non-standard item?') ? NONSTANDARD : STANDARD
    const fill_in = type === NONSTANDARD ? { song: '', artist: '', key: '' } : {}
    const { data } = await supabase.from('service_items').insert({
      service_date: serviceDate, type, title, position: items.length, notes: '', script: '', fill_in
    }).select()
    if (data) setItems(prev => [...prev, data[0]])
  }

  async function deleteItem(id) {
    if (!window.confirm('Delete this item?')) return
    await supabase.from('service_items').delete().eq('id', id)
    setItems(prev => prev.filter(i => i.id !== id))
  }

  // HYBRID MOVE LOGIC
  async function moveItem(id, directionOrTargetId) {
    const index = items.findIndex(i => i.id === id)
    if (index < 0) return

    let targetIndex
    if (directionOrTargetId === 'up') {
      if (index === 0) return
      targetIndex = index - 1
    } else if (directionOrTargetId === 'down') {
      if (index === items.length - 1) return
      targetIndex = index + 1
    } else {
      targetIndex = items.findIndex(i => i.id === directionOrTargetId)
    }

    if (targetIndex === index) return

    const reordered = [...items]
    const [movedItem] = reordered.splice(index, 1)
    reordered.splice(targetIndex, 0, movedItem)

    const withPositions = reordered.map((item, idx) => ({ ...item, position: idx }))
    setItems(withPositions)
    withPositions.forEach(item => saveItem(item))
  }

  function onDragStart(id) { setDragSrcId(id) }
  function onDrop(targetId) {
    if (!dragSrcId) return
    moveItem(dragSrcId, targetId)
    setDragSrcId(null)
  }

  function exportPDF(includeNotes, includeScript) {
    const doc = new jsPDF()
    doc.setFontSize(18); doc.text('Worship Service Order', 14, 20)
    doc.setFontSize(12); doc.text(serviceDate, 14, 28)
    let y = 40
    items.forEach(item => {
      if (y > 270) { doc.addPage(); y = 20 }
      doc.setFont(undefined, 'bold'); doc.text(item.title, 14, y); y += 7
      doc.setFont(undefined, 'normal'); doc.setFontSize(10)
      if (item.fill_in) {
        Object.entries(item.fill_in).forEach(([k, v]) => { if(v) { doc.text(`${k}: ${v}`, 14, y); y += 5 } })
      }
      if (includeNotes && item.notes) { doc.text(`Notes: ${item.notes}`, 14, y); y += 5 }
      if (includeScript && item.script) { doc.text(`Script: ${item.script}`, 14, y); y += 5 }
      y += 5
    })
    doc.save(`worship-${serviceDate}.pdf`)
  }

  if (!session) return (
    <div style={{ padding: '60px 20px', fontFamily: '-apple-system, sans-serif', maxWidth: 400, margin: '0 auto' }}>
      <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 8, letterSpacing: '-0.02em' }}>Worship Planner</h1>
      <p style={{ color: '#666', marginBottom: 32 }}>Sign in via magic link to begin.</p>
      {magicSent ? <div style={{ background: '#e0f2fe', color: '#0369a1', padding: '16px', borderRadius: 12 }}>Check your email!</div> : (
        <>
          <input type="email" placeholder="Email address" value={email} onChange={e => setEmail(e.target.value)} 
            style={{ width: '100%', padding: '14px', borderRadius: 12, border: '1px solid #ddd', fontSize: 16, marginBottom: 12 }} />
          <button onClick={sendMagicLink} style={{ width: '100%', padding: '14px', background: '#185FA5', color: 'white', border: 'none', borderRadius: 12, fontWeight: 600, fontSize: 16 }}>Send Magic Link</button>
        </>
      )}
    </div>
  )

  return (
    <div style={{ maxWidth: 600, margin: '0 auto', background: '#F8F9FA', minHeight: '100vh', fontFamily: '-apple-system, sans-serif', paddingBottom: 80 }}>
      <div style={{ position: 'sticky', top: 0, background: 'rgba(255,255,255,0.9)', backdropFilter: 'blur(10px)', padding: '16px', borderBottom: '1px solid #eee', zIndex: 10 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>Service Plan</h2>
          <span style={{ fontSize: 12, color: saveStatus === 'Synced' ? '#10b981' : '#f59e0b', fontWeight: 600 }}>{saveStatus}</span>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input type="date" value={serviceDate} onChange={e => setServiceDate(e.target.value)} 
            style={{ flex: 1, padding: '8px', borderRadius: 8, border: '1px solid #ddd', fontSize: 14 }} />
          <button onClick={() => setShowExportModal(true)} style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid #ddd', background: 'white', fontSize: 14 }}>PDF</button>
          <button onClick={addItem} style={{ padding: '8px 12px', borderRadius: 8, border: 'none', background: '#185FA5', color: 'white', fontSize: 14 }}>+ Item</button>
        </div>
      </div>

      <div style={{ padding: 12 }}>
        {items.map(item => (
          <ItemCard key={item.id} item={item} comments={comments[item.id] || []} 
            expanded={!!expanded[item.id]} onToggle={() => setExpanded(prev => ({ ...prev, [item.id]: !prev[item.id] }))}
            onUpdate={updateItem} onFillIn={updateFillIn} onDelete={() => deleteItem(item.id)}
            onAddComment={addComment} onDragStart={() => onDragStart(item.id)} onDrop={() => onDrop(item.id)}
            onMove={moveItem}
          />
        ))}
      </div>

      {showExportModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 20 }}>
          <div style={{ background: 'white', padding: 24, borderRadius: 20, width: '100%', maxWidth: 340 }}>
            <h3 style={{ marginTop: 0 }}>Export Plan</h3>
            <button onClick={() => { exportPDF(false, false); setShowExportModal(false) }} style={modalBtnStyle}>Order of Service</button>
            <button onClick={() => { exportPDF(true, false); setShowExportModal(false) }} style={modalBtnStyle}>With Notes</button>
            <button onClick={() => { exportPDF(true, true); setShowExportModal(false) }} style={modalBtnStyle}>Full Script</button>
            <button onClick={() => setShowExportModal(false)} style={{ width: '100%', background: 'none', border: 'none', color: '#666', marginTop: 12 }}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  )
}

function ItemCard({ item, comments, expanded, onToggle, onUpdate, onFillIn, onDelete, onAddComment, onDragStart, onDrop, onMove }) {
  const isNS = item.type === NONSTANDARD
  const [msg, setMsg] = useState('')
  const isMobile = 'ontouchstart' in window || navigator.maxTouchPoints > 0

  return (
    <div 
      data-drag-id={item.id}
      draggable={!isMobile} 
      onDragStart={() => onDragStart(item.id)} 
      onDragOver={e => e.preventDefault()} 
      onDrop={() => onDrop(item.id)}
      style={{ background: 'white', borderRadius: '16px', marginBottom: '12px', border: '1px solid #efefef', boxShadow: '0 2px 4px rgba(0,0,0,0.02)' }}
    >
      <div style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
        
        {isMobile ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <button onClick={() => onMove(item.id, 'up')} style={arrowBtnStyle}>▲</button>
            <button onClick={() => onMove(item.id, 'down')} style={arrowBtnStyle}>▼</button>
          </div>
        ) : (
          <div style={{ color: '#ccc', fontSize: '20px', cursor: 'grab', padding: '0 8px' }}>⠿</div>
        )}
        
        <div style={{ flex: 1 }} onClick={onToggle}>
          <div style={{ fontSize: 10, fontWeight: 800, color: isNS ? '#b45309' : '#1d4ed8', textTransform: 'uppercase', marginBottom: 2 }}>{item.type}</div>
          <div style={{ fontWeight: 600, fontSize: 17, color: '#333' }}>{item.title}</div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button onClick={(e) => { e.stopPropagation(); onToggle() }}
            style={{ padding: '8px 12px', borderRadius: '8px', border: '1px solid #185FA5', background: expanded ? '#185FA5' : 'white', color: expanded ? 'white' : '#185FA5', fontSize: '13px', fontWeight: '600' }}>
            {expanded ? 'Done' : 'Edit'}
          </button>
          <button onClick={(e) => { e.stopPropagation(); onDelete() }} style={{ background: 'none', border: 'none', fontSize: '20px' }}>🗑️</button>
        </div>
      </div>

      {expanded && (
        <div style={{ padding: '0 16px 16px', borderTop: '1px solid #f9f9f9' }}>
          <div style={{ marginTop: 10 }}>
            <label style={{ fontSize: 11, fontWeight: 700, color: '#999', textTransform: 'uppercase' }}>Title</label>
            <input value={item.title} onChange={e => onUpdate(item.id, 'title', e.target.value)} style={cardInputStyle} />
          </div>
          {isNS && Object.keys(item.fill_in).map(f => (
            <div key={f} style={{ marginTop: 10 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: '#999', textTransform: 'uppercase' }}>{f}</label>
              <input value={item.fill_in[f] || ''} onChange={e => onFillIn(item.id, f, e.target.value)} style={cardInputStyle} />
            </div>
          ))}
          <div style={{ marginTop: 10 }}>
            <label style={{ fontSize: 11, fontWeight: 700, color: '#999', textTransform: 'uppercase' }}>Notes</label>
            <textarea value={item.notes} onChange={e => onUpdate(item.id, 'notes', e.target.value)} style={cardInputStyle} />
          </div>
          <div style={{ marginTop: 10 }}>
            <label style={{ fontSize: 11, fontWeight: 700, color: '#999', textTransform: 'uppercase' }}>Script / Talking Points</label>
            <textarea value={item.script} onChange={e => onUpdate(item.id, 'script', e.target.value)} style={{ ...cardInputStyle, minHeight: 80 }} />
          </div>
          
          <div style={{ marginTop: 20, background: '#f9fafb', borderRadius: 12, padding: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>Comments</div>
            {comments.map(c => <div key={c.id} style={{ fontSize: 13, marginBottom: 4 }}><strong>{c.author_name}:</strong> {c.body}</div>)}
            <input value={msg} onChange={e => setMsg(e.target.value)} onKeyDown={e => { if(e.key === 'Enter') { onAddComment(item.id, msg); setMsg('') }}}
              placeholder="Add a comment..." style={{ width: '100%', border: '1px solid #ddd', padding: 10, borderRadius: 8, marginTop: 8, fontSize: 14 }} />
          </div>
        </div>
      )}
    </div>
  )
}

const cardInputStyle = { width: '100%', padding: '10px', borderRadius: 8, border: '1px solid #eee', fontSize: 14, marginTop: 4, outline: 'none', fontFamily: 'inherit' }
const arrowBtnStyle = { border: '1px solid #eee', background: 'white', borderRadius: '6px', padding: '2px 8px', fontSize: '12px', cursor: 'pointer' }
const modalBtnStyle = { width: '100%', padding: 14, textAlign: 'left', borderRadius: 12, border: '1px solid #eee', background: '#f9fafb', marginBottom: 8, fontSize: 15, fontWeight: 500 }